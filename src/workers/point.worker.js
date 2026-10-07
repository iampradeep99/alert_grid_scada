import { ScadaQueueWorker } from './scadaQueueWorker.js';
import { pointProcessor } from './processors/pointProcessor.js';

const worker = new ScadaQueueWorker({
  sourceType: 'point',
  processor: pointProcessor,
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
