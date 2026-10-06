import { jsonResponseHandler } from '../../helper/errorHandler.js';
import { ScadaAlertService } from './scadaAlertService.js';

export class ScadaAlertController {
  constructor() {
    this.scadaAlertService = new ScadaAlertService();
  }

  health = async (req, res, next) => {
    try {
      const data = await this.scadaAlertService.health();
      return jsonResponseHandler(data, 'SCADA alert module is ready', req, res, next);
    } catch (error) {
      return next(error);
    }
  };

  getAlertsList = async (req, res, next) => {
    try {
      const data = await this.scadaAlertService.getAlertsList(req.body);
      return jsonResponseHandler(data, 'SCADA alerts fetched successfully', req, res, next);
    } catch (error) {
      return next(error);
    }
  };

  addScadaAlert = async (req, res, next) => {
    try {
      const data = await this.scadaAlertService.addScadaAlert(req.body);
      return jsonResponseHandler(data, 'SCADA alert created successfully', req, res, next);
    } catch (error) {
      return next(error);
    }
  };

  updateStatus = async (req, res, next) => {
    try {
      const data = await this.scadaAlertService.updateStatus(req.body);
      return jsonResponseHandler(data, 'SCADA alert status updated successfully', req, res, next);
    } catch (error) {
      return next(error);
    }
  };
}

export default ScadaAlertController;
