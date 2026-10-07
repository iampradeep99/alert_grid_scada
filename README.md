# Alert Grid SCADA API

Minimal Node.js API boilerplate for SCADA alerts.

## Routes

```text
GET  /health
GET  /powergrid/scada/scada-alert/health
POST /powergrid/scada/scada-alert/GetScadaAlertView
POST /powergrid/scada/scada-alert/AddScadaAlert
POST /powergrid/scada/scada-alert/ScadaAlertStatusUpdate
```

## Socket.IO

Connect to:

```text
ws://localhost:3000
```

Events emitted by the API:

```text
scada:connected
scada-alert:created
scada-alert:updated
```

Client event accepted by the API:

```text
scada-alert:insert
```

Example:

```js
socket.emit(
  'scada-alert:insert',
  { deviceId: 'SCADA-01', severity: 'HIGH', message: 'Voltage spike detected' },
  (response) => console.log(response)
);
```

## Start

```bash
npm install
npm start
```

## Postgres

Default connection:

```text
host: localhost
port: 5432
user: postgres
password: root
database: postgres
```

The app only establishes a Postgres connection on startup. It does not create or migrate tables.

## Database Notifications

The app listens to this Postgres notification channel:

```text
new_record_updates
```

When Postgres sends a notification, the API emits Socket.IO events:

```text
alarm:new-record
scada-alert:db-change
```

The same notification is published to RabbitMQ:

```text
exchange: scada.assignment
queues:
- scada.assignment.alarm
- scada.assignment.analog
- scada.assignment.point
- scada.assignment.nms
message.type: SCADA_TABLE_CHANGE
```

Routing uses `payload.record.source_type`, `payload.source_type`, `payload.sourceType`, `payload.category`, or the notified `table` name.
If no source type exists, it goes to the `alarm` queue by default.

## Workers

`npm run dev` starts the API, Postgres listener, RabbitMQ publisher, and autoscaling workers by default.

Run category workers separately only when autoscaling is disabled:

```bash
npm run worker:alarm
npm run worker:analog
npm run worker:point
npm run worker:nms
```

Scale workers with env vars:

```bash
WORKER_CONCURRENCY=4 WORKER_PREFETCH=250 npm run worker:alarm
```

For very high load, run multiple replicas/processes instead of one huge `WORKER_CONCURRENCY`.

Auto-scale workers can also be run standalone:

```bash
npm run worker:autoscale
```

Auto-scaling envs:

```text
AUTOSCALE_MIN_REPLICAS=1
AUTOSCALE_MAX_REPLICAS=8
AUTOSCALE_MESSAGES_PER_REPLICA=1000
AUTOSCALE_POLL_INTERVAL_MS=5000
AUTOSCALE_SCALE_DOWN_DELAY_MS=30000
```

Disable in-app autoscaling:

```env
WORKER_AUTOSCALE_ENABLED=false
```

Check active worker replicas:

```bash
curl http://localhost:9400/debug/workers
```
