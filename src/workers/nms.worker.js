import { ScadaQueueWorker } from './scadaQueueWorker.js';
import { nmsProcessor } from './processors/nmsProcessor.js';

const worker = new ScadaQueueWorker({
  sourceType: 'nms',
  processor: nmsProcessor,
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
