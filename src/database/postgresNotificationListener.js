import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

export class PostgresNotificationListener {
  constructor({ channel, onNotification }) {
    this.channel = channel;
    this.onNotification = onNotification;
    this.client = new Client({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'root',
      database: process.env.DB_NAME || 'postgres',
    });
  }

  async connect() {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(this.channel)) {
      throw new Error(`Invalid Postgres notification channel: ${this.channel}`);
    }

    await this.client.connect();
    const result = await this.client.query('SELECT current_database() AS database_name');
    await this.client.query(`LISTEN ${this.channel}`);

    this.client.on('notification', (message) => {
      let payload = message.payload;

      try {
        payload = JSON.parse(message.payload);
      } catch (_error) {
        payload = message.payload;
      }

      Promise.resolve(
        this.onNotification?.({
          channel: message.channel,
          payload,
          receivedAt: new Date().toISOString(),
        }),
      ).catch((error) => {
        console.error('Postgres notification handler failed:', error);
      });
    });

    this.client.on('error', (error) => {
      console.error('Postgres notification listener error:', error);
    });

    console.log(
      `Postgres notification listener ready on database: ${result.rows[0].database_name}, channel: ${this.channel}`,
    );
  }

  async close() {
    await this.client.end();
  }
}
