import express from 'express';
import { ScadaAlertController } from './scadaAlertController.js';

const scadaAlertController = new ScadaAlertController();

export const scadaAlertRouter = express.Router();

scadaAlertRouter.get('/health', scadaAlertController.health);
scadaAlertRouter.post('/GetScadaAlertView', scadaAlertController.getAlertsList);
scadaAlertRouter.post('/AddScadaAlert', scadaAlertController.addScadaAlert);
scadaAlertRouter.post('/ScadaAlertStatusUpdate', scadaAlertController.updateStatus);

export default scadaAlertRouter;
