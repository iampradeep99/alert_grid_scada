import { io } from 'socket.io-client';

const totalEvents = Number(process.env.TOTAL_EVENTS) || 10000;
const batchSize = Number(process.env.BATCH_SIZE) || 500;
const socketUrl = process.env.SOCKET_URL || 'http://localhost:9400';
const eventName = process.env.EVENT_NAME || 'scada-alert:insert';

const socket = io(socketUrl, {
  transports: ['websocket'],
  reconnection: false,
  timeout: 10000,
});

let sent = 0;
let acknowledged = 0;
let failed = 0;

const createPayload = (index) => ({
  deviceId: `SCADA-${index}`,
  severity: index % 2 === 0 ? 'HIGH' : 'LOW',
  message: `Load test alert ${index}`,
  location: `Bay ${index % 20}`,
  value: Number((Math.random() * 100).toFixed(2)),
  source: 'socket-load-test',
});

const sendEvent = (index) => {
  return new Promise((resolve) => {
    socket.timeout(10000).emit(eventName, createPayload(index), (error, response) => {
      if (error || response?.responseCode !== '1') {
        failed += 1;
      } else {
        acknowledged += 1;
      }

      resolve();
    });
  });
};

const runLoadTest = async () => {
  const startedAt = Date.now();

  while (sent < totalEvents) {
    const batch = [];

    for (let index = 0; index < batchSize && sent < totalEvents; index += 1) {
      sent += 1;
      batch.push(sendEvent(sent));
    }

    await Promise.all(batch);

    console.log({
      sent,
      acknowledged,
      failed,
      remaining: totalEvents - sent,
    });
  }

  const durationInSec = (Date.now() - startedAt) / 1000;

  console.log({
    status: 'done',
    sent,
    acknowledged,
    failed,
    durationInSec,
    eventsPerSecond: Number((sent / durationInSec).toFixed(2)),
  });

  socket.disconnect();
};

socket.on('connect', () => {
  console.log(`Connected to ${socketUrl} as ${socket.id}`);
  runLoadTest().catch((error) => {
    console.error('Load test failed:', error);
    socket.disconnect();
    process.exitCode = 1;
  });
});

socket.on('connect_error', (error) => {
  console.error('Socket connection failed:', error.message);
  process.exit(1);
});
