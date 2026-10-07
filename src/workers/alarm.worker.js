import { ScadaQueueWorker } from './scadaQueueWorker.js';
import { alarmProcessor } from './processors/alarmProcessor.js';

const worker = new ScadaQueueWorker({
  sourceType: 'alarm',
  processor: alarmProcessor,
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
