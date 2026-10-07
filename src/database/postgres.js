import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

export class PostgresDatabase {
  constructor() {
    this.pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'root',
      database: process.env.DB_NAME || 'postgres',
      max: Number(process.env.DB_POOL_MAX) || 10,
    });
  }

  async connect() {
    const client = await this.pool.connect();
    const result = await client.query('SELECT current_database() AS database_name');
    console.log(`Postgres pool connected to database: ${result.rows[0].database_name}`);
    client.release();
  }

  async query(text, params) {
    return this.pool.query(text, params);
  }

  async close() {
    await this.pool.end();
  }
}

export const postgresDatabase = new PostgresDatabase();
