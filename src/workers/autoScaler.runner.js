import { WorkerAutoScaler } from './autoScaler.js';

const autoScaler = new WorkerAutoScaler();

await autoScaler.start();

process.on('SIGINT', async () => {
  await autoScaler.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await autoScaler.stop();
  process.exit(0);
});
