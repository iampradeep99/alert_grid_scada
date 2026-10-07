import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { scadaAlertRouter } from './krphapi/scada-alert/scadaAlertRouter.js';
import { jsonErrorHandler } from './helper/errorHandler.js';
import { initSocket } from './socket.js';
import { postgresDatabase } from './database/postgres.js';
import { PostgresNotificationListener } from './database/postgresNotificationListener.js';
import { rabbitMQPublisher } from './queue/rabbitmqPublisher.js';
import { WorkerAutoScaler } from './workers/autoScaler.js';

const app = express();
const port = Number(process.env.PORT) || 3000;
const apiPrefix = process.env.API_PREFIX || '/powergrid/scada';
const corsOrigin = process.env.CORS_ORIGIN || '*';

app.use(cors({ origin: corsOrigin }));
app.use(bodyParser.json({ limit: process.env.BODY_LIMIT || '25mb' }));
app.use(bodyParser.urlencoded({ limit: process.env.BODY_LIMIT || '25mb', extended: true }));

app.get('/health', (_req, res) => {
  res.status(200).json({
    responseObject: null,
    responseDynamic: {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    },
    responseCode: '1',
    responseMessage: 'API is running',
    jsonString: null,
    recordCount: 0,
  });
});

app.post('/debug/notify', async (req, res, next) => {
  try {
    await postgresDatabase.query(
      'SELECT pg_notify($1, $2)',
      [
        process.env.DB_NOTIFY_CHANNEL || 'alarm_new_record',
        JSON.stringify(req.body || { source_type: 'alarm', message: 'debug notify' }),
      ],
    );

    res.status(200).json({
      responseObject: null,
      responseDynamic: null,
      responseCode: '1',
      responseMessage: 'Debug notification sent',
      jsonString: null,
      recordCount: 0,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/debug/workers', async (_req, res, next) => {
  try {
    const status = workerAutoScaler
      ? await workerAutoScaler.getQueueStatus()
      : [];

    res.status(200).json({
      responseObject: null,
      responseDynamic: status,
      responseCode: '1',
      responseMessage: 'Worker status fetched',
      jsonString: null,
      recordCount: status.length,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/debug/workers/local', (_req, res) => {
  const status = workerAutoScaler?.getStatus() || [];

  res.status(200).json({
    responseObject: null,
    responseDynamic: status,
    responseCode: '1',
    responseMessage: 'Local worker status fetched',
    jsonString: null,
    recordCount: status.length,
  });
});

const router = express.Router();
router.use('/scada-alert', scadaAlertRouter);
app.use(apiPrefix, router);

app.use((req, res) => {
  res.status(404).json({
    responseObject: null,
    responseDynamic: null,
    responseCode: '0',
    responseMessage: `Route not found: ${req.originalUrl}`,
    jsonString: null,
    recordCount: 0,
  });
});

app.use(jsonErrorHandler);

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
  },
});

initSocket(io);

await postgresDatabase.connect();
await rabbitMQPublisher.connect();

const autoScalerEnabled = process.env.WORKER_AUTOSCALE_ENABLED !== 'false';
const workerAutoScaler = autoScalerEnabled ? new WorkerAutoScaler() : null;

if (workerAutoScaler) {
  await workerAutoScaler.start();
}

const notificationListener = new PostgresNotificationListener({
  channel: process.env.DB_NOTIFY_CHANNEL || 'alarm_new_record',
  onNotification: async (data) => {
    console.log('Postgres notification received:', data);

    await rabbitMQPublisher.publish({
      type: 'SCADA_TABLE_CHANGE',
      source: 'postgres-notify',
      ...data,
    });

    io.emit('alarm:new-record', data);
    io.emit('scada-alert:db-change', data);
  },
});

await notificationListener.connect();

const startServer = (nextPort, attemptsLeft = 10) => {
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.warn(`Port ${nextPort} is busy. Trying ${nextPort + 1}`);
      startServer(nextPort + 1, attemptsLeft - 1);
      return;
    }

    throw error;
  });

  server.listen(nextPort, () => {
    console.log(`Server running at http://localhost:${nextPort}`);
    console.log(`SCADA alert API mounted at ${apiPrefix}/scada-alert`);
    console.log(`Socket.IO ready at ws://localhost:${nextPort}`);
    console.log('Postgres connection established');
  });
};

startServer(port);

const shutdown = (signal) => {
  console.log(`${signal} received. Closing server.`);
  server.close(async () => {
    await notificationListener.close();
    await workerAutoScaler?.stop();
    await rabbitMQPublisher.close();
    await postgresDatabase.close();
    console.log('Server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
