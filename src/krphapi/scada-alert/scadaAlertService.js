import { postgresDatabase } from '../../database/postgres.js';

const mapAlertRow = (row) => ({
  id: row.id,
  alertId: row.alert_id,
  deviceId: row.device_id,
  severity: row.severity,
  message: row.message,
  location: row.location,
  status: row.status,
  payload: row.payload,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class ScadaAlertService {
  async health() {
    const result = await postgresDatabase.query('SELECT COUNT(*)::int AS total FROM scada_alerts');

    return {
      module: 'scada-alert',
      status: 'ok',
      totalAlerts: result.rows[0].total,
    };
  }

  async getAlertsList({ page = 1, limit = 10 } = {}) {
    const currentPage = Number(page) || 1;
    const pageSize = Number(limit) || 10;
    const offset = (currentPage - 1) * pageSize;
    const result = await postgresDatabase.query(
      `
        SELECT *, COUNT(*) OVER()::int AS total_count
        FROM scada_alerts
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `,
      [pageSize, offset],
    );
    const total = result.rows[0]?.total_count || 0;

    return {
      page: currentPage,
      limit: pageSize,
      total,
      rows: result.rows.map(mapAlertRow),
    };
  }

  async addScadaAlert(payload = {}) {
    const alertId = payload.alertId || `SCADA-${Date.now()}`;
    const result = await postgresDatabase.query(
      `
        INSERT INTO scada_alerts (
          alert_id,
          device_id,
          severity,
          message,
          location,
          status,
          payload
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [
        alertId,
        payload.deviceId || null,
        payload.severity || null,
        payload.message || null,
        payload.location || null,
        payload.status || 'OPEN',
        payload,
      ],
    );

    return mapAlertRow(result.rows[0]);
  }

  async updateStatus({ alertId, status } = {}) {
    const result = await postgresDatabase.query(
      `
        UPDATE scada_alerts
        SET status = COALESCE($2, status),
            updated_at = NOW()
        WHERE alert_id = $1
        RETURNING *
      `,
      [alertId, status],
    );

    if (!result.rows[0]) {
      const error = new Error('SCADA alert not found');
      error.statusCode = 404;
      throw error;
    }

    return mapAlertRow(result.rows[0]);
  }
}

export default ScadaAlertService;
