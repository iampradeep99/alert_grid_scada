import { ScadaAlertService } from '../krphapi/scada-alert/scadaAlertService.js';

const scadaAlertService = new ScadaAlertService();

const insertScadaAlert = async (io, payload, callback) => {
  try {
    const alert = await scadaAlertService.addScadaAlert(payload);

    console.log(payload);

    io.emit('scada-alert:created', alert);

    callback?.({
      responseObject: null,
      responseDynamic: alert,
      responseCode: '1',
      responseMessage: 'SCADA alert inserted successfully',
      jsonString: null,
      recordCount: 0,
    });
  } catch (error) {
    callback?.({
      responseObject: null,
      responseDynamic: null,
      responseCode: '0',
      responseMessage: error.message || 'Failed to insert SCADA alert',
      jsonString: null,
      recordCount: 0,
    });
  }
};

export const registerScadaAlertEvents = (io, socket) => {
  socket.onAny((eventName, ...args) => {
    console.log(`Socket event received: ${eventName}`, args[0]);
  });

  socket.on('scada-alert:insert', (payload, callback) => {
    insertScadaAlert(io, payload, callback);
  });

  socket.on('message', (payload, callback) => {
    insertScadaAlert(io, payload, callback);
  });
};
