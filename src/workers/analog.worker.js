import { ScadaQueueWorker } from './scadaQueueWorker.js';
import { analogProcessor } from './processors/analogProcessor.js';

const worker = new ScadaQueueWorker({
  sourceType: 'analog',
  processor: analogProcessor,
});

await worker.start();

process.on('SIGINT', async () => {
  await worker.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await worker.stop();
  process.exit(0);
});
