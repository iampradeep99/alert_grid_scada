const alerts = [];

export class ScadaAlertService {
  async health() {
    return {
      module: 'scada-alert',
      status: 'ok',
      totalAlerts: alerts.length,
    };
  }

  async getAlertsList({ page = 1, limit = 10 } = {}) {
    const currentPage = Number(page) || 1;
    const pageSize = Number(limit) || 10;
    const start = (currentPage - 1) * pageSize;

    return {
      page: currentPage,
      limit: pageSize,
      total: alerts.length,
      rows: alerts.slice(start, start + pageSize),
    };
  }

  async addScadaAlert(payload = {}) {
    const alert = {
      alertId: `SCADA-${Date.now()}`,
      status: 'OPEN',
      ...payload,
      createdAt: new Date().toISOString(),
    };

    alerts.push(alert);
    return alert;
  }

  async updateStatus({ alertId, status } = {}) {
    const alert = alerts.find((item) => item.alertId === alertId);

    if (!alert) {
      const error = new Error('SCADA alert not found');
      error.statusCode = 404;
      throw error;
    }

    alert.status = status || alert.status;
    alert.updatedAt = new Date().toISOString();
    return alert;
  }
}

export default ScadaAlertService;
