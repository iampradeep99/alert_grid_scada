import 'dotenv/config';
import amqp from 'amqplib';

export class ScadaQueueWorker {
  constructor({ sourceType, processor }) {
    this.sourceType = sourceType;
    this.processor = processor;
    this.url = process.env.RABBITMQ_URL || 'amqp://localhost';
    this.queuePrefix = process.env.RABBITMQ_QUEUE_PREFIX || 'scada.assignment';
    this.prefetch = Number(process.env.WORKER_PREFETCH) || 100;
    this.concurrency = Number(process.env.WORKER_CONCURRENCY) || 1;
    this.connection = null;
    this.channels = [];
  }

  get queueName() {
    return `${this.queuePrefix}.${this.sourceType}`;
  }

  async start() {
    this.connection = await amqp.connect(this.url);
    this.connection.on('error', (error) => {
      console.error(`[${this.sourceType}] RabbitMQ connection error:`, error.message);
    });
    this.connection.on('close', () => {
      console.warn(`[${this.sourceType}] RabbitMQ connection closed`);
    });

    for (let index = 0; index < this.concurrency; index += 1) {
      const channel = await this.connection.createChannel();
      channel.on('error', (error) => {
        console.error(`[${this.sourceType}] RabbitMQ channel ${index} error:`, error.message);
      });
      channel.on('close', () => {
        console.warn(`[${this.sourceType}] RabbitMQ channel ${index} closed`);
      });
      this.channels.push(channel);

      await channel.assertQueue(this.queueName, { durable: true });
      channel.prefetch(this.prefetch);

      await channel.consume(this.queueName, async (message) => {
        if (!message) return;

        try {
          const payload = JSON.parse(message.content.toString());

          await this.processor.process({
            sourceType: this.sourceType,
            message: payload,
            workerIndex: index,
          });

          channel.ack(message);
        } catch (error) {
          console.error(`[${this.sourceType}] Worker ${index} failed:`, error);
          channel.nack(message, false, true);
        }
      });
    }

    console.log(`[${this.sourceType}] Worker started`, {
      queue: this.queueName,
      concurrency: this.concurrency,
      prefetch: this.prefetch,
    });
  }

  async stop() {
    await Promise.allSettled(this.channels.map((channel) => channel.close()));
    await this.connection?.close().catch((error) => {
      console.error(`[${this.sourceType}] RabbitMQ connection close failed:`, error.message);
    });
  }
}
