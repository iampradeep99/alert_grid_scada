import { registerScadaAlertEvents } from './events/scadaAlert.events.js';

let ioInstance;

export const initSocket = (io) => {
  ioInstance = io;

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.emit('scada:connected', {
      socketId: socket.id,
      timestamp: new Date().toISOString(),
    });

    registerScadaAlertEvents(ioInstance, socket);

    socket.on('disconnect', (reason) => {
      console.log(`Socket disconnected: ${socket.id}`, reason);
    });
  });

  return ioInstance;
};

export const getSocket = () => ioInstance;

export const emitScadaAlertCreated = (alert) => {
  ioInstance?.emit('scada-alert:created', alert);
};

export const emitScadaAlertUpdated = (alert) => {
  ioInstance?.emit('scada-alert:updated', alert);
};
