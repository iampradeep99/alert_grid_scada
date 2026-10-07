import 'dotenv/config';
import amqp from 'amqplib';

export class RabbitMQPublisher {
  constructor() {
    this.url = process.env.RABBITMQ_URL || 'amqp://localhost';
    this.exchangeName = process.env.RABBITMQ_EXCHANGE || 'scada.assignment';
    this.defaultSourceType = process.env.RABBITMQ_DEFAULT_SOURCE_TYPE || 'alarm';
    this.queuePrefix = process.env.RABBITMQ_QUEUE_PREFIX || 'scada.assignment';
    this.sourceTypes = (process.env.RABBITMQ_SOURCE_TYPES || 'alarm,analog,point,nms')
      .split(',')
      .map((sourceType) => sourceType.trim().toLowerCase())
      .filter(Boolean);
    this.connection = null;
    this.channel = null;
    this.connecting = null;
  }

  async connect() {
    if (this.channel) return;
    if (this.connecting) {
      await this.connecting;
      return;
    }

    this.connecting = this.openConnection();

    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async openConnection() {
    this.connection = await amqp.connect(this.url);
    this.connection.on('error', (error) => {
      console.error('[rabbitmq:publisher] connection error:', error.message);
    });
    this.connection.on('close', () => {
      console.warn('[rabbitmq:publisher] connection closed');
      this.connection = null;
      this.channel = null;
    });

    this.channel = await this.connection.createChannel();
    this.channel.on('error', (error) => {
      console.error('[rabbitmq:publisher] channel error:', error.message);
    });
    this.channel.on('close', () => {
      console.warn('[rabbitmq:publisher] channel closed');
      this.channel = null;
    });

    await this.channel.assertExchange(this.exchangeName, 'direct', { durable: true });

    for (const sourceType of this.sourceTypes) {
      const queueName = this.getQueueName(sourceType);

      await this.channel.assertQueue(queueName, { durable: true });
      await this.channel.bindQueue(queueName, this.exchangeName, sourceType);
    }

    console.log(`RabbitMQ publisher ready on exchange: ${this.exchangeName}`);
  }

  getQueueName(sourceType) {
    return `${this.queuePrefix}.${sourceType}`;
  }

  getSourceType(message) {
    const payload = message?.payload?.record || message?.payload || message || {};
    const tableSourceTypeMap = {
      alarm: 'alarm',
      analog_history: 'analog',
      analog_history_key: 'analog',
      point_history: 'point',
      point_history_key: 'point',
      nms: 'nms',
      firewall: 'nms',
      idm: 'nms',
      seim: 'nms',
    };
    const tableName = String(payload.table || payload.table_name || payload.tableName || '').toLowerCase();
    const sourceType = payload.source_type
      || payload.sourceType
      || payload.category
      || tableSourceTypeMap[tableName]
      || this.defaultSourceType;

    return String(sourceType).toLowerCase();
  }

  async publish(message) {
    await this.connect();

    const sourceType = this.getSourceType(message);
    const routingKey = this.sourceTypes.includes(sourceType) ? sourceType : this.defaultSourceType;
    const payload = Buffer.from(JSON.stringify(message));

    let published;

    try {
      published = this.publishToChannel(routingKey, payload);
    } catch (error) {
      console.error('[rabbitmq:publisher] publish failed, reconnecting:', error.message);
      this.channel = null;
      this.connection = null;
      await this.connect();
      published = this.publishToChannel(routingKey, payload);
    }

    console.log(`RabbitMQ message published`, {
      exchange: this.exchangeName,
      routingKey,
      queue: this.getQueueName(routingKey),
    });

    return published;
  }

  publishToChannel(routingKey, payload) {
    if (!this.channel) {
      throw new Error('RabbitMQ publisher is not connected');
    }

    return this.channel.publish(this.exchangeName, routingKey, payload, {
      contentType: 'application/json',
      persistent: true,
      timestamp: Date.now(),
      headers: {
        sourceType: routingKey,
      },
    });
  }

  async close() {
    try {
      await this.channel?.close();
    } catch (error) {
      console.error('[rabbitmq:publisher] channel close failed:', error.message);
    }

    try {
      await this.connection?.close();
    } catch (error) {
      console.error('[rabbitmq:publisher] connection close failed:', error.message);
    }
  }
}

export const rabbitMQPublisher = new RabbitMQPublisher();
