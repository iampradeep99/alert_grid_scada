import 'dotenv/config';
import amqp from 'amqplib';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const numberEnv = (key, fallback) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
};

export class WorkerAutoScaler {
  constructor() {
    this.url = process.env.RABBITMQ_URL || 'amqp://localhost';
    this.queuePrefix = process.env.RABBITMQ_QUEUE_PREFIX || 'scada.assignment';
    this.sourceTypes = (process.env.RABBITMQ_SOURCE_TYPES || 'alarm,analog,point,nms')
      .split(',')
      .map((sourceType) => sourceType.trim().toLowerCase())
      .filter(Boolean);
    this.minReplicas = numberEnv('AUTOSCALE_MIN_REPLICAS', 1);
    this.maxReplicas = numberEnv('AUTOSCALE_MAX_REPLICAS', 8);
    this.messagesPerReplica = numberEnv('AUTOSCALE_MESSAGES_PER_REPLICA', 1000);
    this.pollIntervalMs = numberEnv('AUTOSCALE_POLL_INTERVAL_MS', 5000);
    this.scaleDownDelayMs = numberEnv('AUTOSCALE_SCALE_DOWN_DELAY_MS', 30000);
    this.workers = new Map();
    this.lastScaleUpAt = new Map();
    this.connection = null;
    this.channel = null;
    this.timer = null;
  }

  getStatus() {
    return this.sourceTypes.map((sourceType) => ({
      sourceType,
      queue: this.getQueueName(sourceType),
      activeWorkerProcesses: this.getWorkerList(sourceType).length,
      workerConcurrency: Number(process.env.WORKER_CONCURRENCY) || 1,
      totalProcessingSlots: this.getWorkerList(sourceType).length * (Number(process.env.WORKER_CONCURRENCY) || 1),
      minReplicas: this.minReplicas,
      maxReplicas: this.maxReplicas,
      messagesPerReplica: this.messagesPerReplica,
    }));
  }

  async getQueueStatus() {
    if (!this.channel) return this.getStatus();

    return Promise.all(
      this.sourceTypes.map(async (sourceType) => {
        const queueName = this.getQueueName(sourceType);
        const queue = await this.channel.assertQueue(queueName, { durable: true });
        const desiredReplicas = this.getDesiredReplicas(queue.messageCount);

        return {
          sourceType,
          queue: queueName,
          messages: queue.messageCount,
          activeConsumers: queue.consumerCount,
          activeWorkerProcesses: this.getWorkerList(sourceType).length,
          workerConcurrency: Number(process.env.WORKER_CONCURRENCY) || 1,
          totalProcessingSlots: this.getWorkerList(sourceType).length * (Number(process.env.WORKER_CONCURRENCY) || 1),
          desiredReplicas,
          minReplicas: this.minReplicas,
          maxReplicas: this.maxReplicas,
          messagesPerReplica: this.messagesPerReplica,
        };
      }),
    );
  }

  getQueueName(sourceType) {
    return `${this.queuePrefix}.${sourceType}`;
  }

  getWorkerScript(sourceType) {
    return path.join(__dirname, `${sourceType}.worker.js`);
  }

  getWorkerList(sourceType) {
    if (!this.workers.has(sourceType)) {
      this.workers.set(sourceType, []);
    }

    return this.workers.get(sourceType);
  }

  startWorker(sourceType) {
    const worker = spawn(process.execPath, [this.getWorkerScript(sourceType)], {
      env: process.env,
      stdio: 'inherit',
    });

    worker.on('exit', (code, signal) => {
      const list = this.getWorkerList(sourceType);
      const index = list.indexOf(worker);
      if (index !== -1) list.splice(index, 1);

      console.log(`[autoscale] ${sourceType} worker exited`, { code, signal });
    });

    this.getWorkerList(sourceType).push(worker);
    console.log(`[autoscale] started ${sourceType} worker`, {
      replicas: this.getWorkerList(sourceType).length,
    });
  }

  stopWorker(sourceType) {
    const list = this.getWorkerList(sourceType);
    const worker = list.pop();
    if (!worker) return;

    worker.kill('SIGTERM');
    console.log(`[autoscale] stopped ${sourceType} worker`, {
      replicas: list.length,
    });
  }

  getDesiredReplicas(messageCount) {
    const byQueueDepth = Math.ceil(messageCount / this.messagesPerReplica);
    return Math.max(this.minReplicas, Math.min(this.maxReplicas, byQueueDepth || this.minReplicas));
  }

  async scaleSourceType(sourceType) {
    const queueName = this.getQueueName(sourceType);
    const queue = await this.channel.assertQueue(queueName, { durable: true });
    const currentReplicas = this.getWorkerList(sourceType).length;
    const desiredReplicas = this.getDesiredReplicas(queue.messageCount);

    console.log(`[autoscale] queue depth`, {
      sourceType,
      queue: queueName,
      messages: queue.messageCount,
      consumers: queue.consumerCount,
      currentReplicas,
      desiredReplicas,
    });

    if (desiredReplicas > currentReplicas) {
      for (let count = currentReplicas; count < desiredReplicas; count += 1) {
        this.startWorker(sourceType);
      }
      this.lastScaleUpAt.set(sourceType, Date.now());
      return;
    }

    if (desiredReplicas < currentReplicas) {
      const lastScaleUpAt = this.lastScaleUpAt.get(sourceType) || 0;
      const canScaleDown = Date.now() - lastScaleUpAt >= this.scaleDownDelayMs;

      if (!canScaleDown) return;

      for (let count = currentReplicas; count > desiredReplicas; count -= 1) {
        this.stopWorker(sourceType);
      }
    }

    console.log(`[autoscale] ${sourceType}`, {
      queue: queueName,
      messages: queue.messageCount,
      replicas: this.getWorkerList(sourceType).length,
      desiredReplicas,
    });
  }

  async tick() {
    if (!this.channel) {
      console.warn('[autoscale] RabbitMQ channel is not connected, skipping tick');
      return;
    }

    await Promise.all(this.sourceTypes.map((sourceType) => this.scaleSourceType(sourceType)));
  }

  async start() {
    this.connection = await amqp.connect(this.url);
    this.connection.on('error', (error) => {
      console.error('[autoscale] RabbitMQ connection error:', error.message);
    });
    this.connection.on('close', () => {
      console.warn('[autoscale] RabbitMQ connection closed');
      this.connection = null;
      this.channel = null;
    });

    this.channel = await this.connection.createChannel();
    this.channel.on('error', (error) => {
      console.error('[autoscale] RabbitMQ channel error:', error.message);
    });
    this.channel.on('close', () => {
      console.warn('[autoscale] RabbitMQ channel closed');
      this.channel = null;
    });

    for (const sourceType of this.sourceTypes) {
      for (let count = 0; count < this.minReplicas; count += 1) {
        this.startWorker(sourceType);
      }
    }

    await this.tick();
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        console.error('[autoscale] tick failed:', error);
      });
    }, this.pollIntervalMs);

    console.log('[autoscale] started', {
      sourceTypes: this.sourceTypes,
      minReplicas: this.minReplicas,
      maxReplicas: this.maxReplicas,
      messagesPerReplica: this.messagesPerReplica,
      pollIntervalMs: this.pollIntervalMs,
    });
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);

    for (const sourceType of this.sourceTypes) {
      const list = this.getWorkerList(sourceType);
      while (list.length > 0) {
        this.stopWorker(sourceType);
      }
    }

    await this.channel?.close().catch((error) => {
      console.error('[autoscale] RabbitMQ channel close failed:', error.message);
    });
    await this.connection?.close().catch((error) => {
      console.error('[autoscale] RabbitMQ connection close failed:', error.message);
    });
  }
}
