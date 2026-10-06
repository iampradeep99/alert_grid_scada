import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { scadaAlertRouter } from './krphapi/scada-alert/scadaAlertRouter.js';
import { jsonErrorHandler } from './helper/errorHandler.js';

const app = express();
const port = Number(process.env.PORT) || 3000;
const apiPrefix = process.env.API_PREFIX || '/powergrid/scada';

app.use(cors());
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

const server = app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(`SCADA alert API mounted at ${apiPrefix}/scada-alert`);
});

const shutdown = (signal) => {
  console.log(`${signal} received. Closing server.`);
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
