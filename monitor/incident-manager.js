'use strict';
/**
 * monitor/incident-manager.js — Auto-create and manage incidents on threshold breach.
 * Integrates with NotificationEngine for alerting.
 */

class IncidentManager {
  /**
   * @param {object} db                - better-sqlite3 Database instance
   * @param {NotificationEngine} notifier
   */
  constructor(db, notifier = null) {
    this.db       = db;
    this.notifier = notifier;
    this._ensureSchema();
  }

  _ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS incidents (
        id              TEXT PRIMARY KEY,
        grafana_url     TEXT NOT NULL,
        severity        TEXT NOT NULL,
        title           TEXT NOT NULL,
        description     TEXT,
        trigger_score   REAL,
        baseline_mean   REAL,
        status          TEXT DEFAULT 'open',
        opened_at       TEXT DEFAULT (datetime('now')),
        resolved_at     TEXT,
        resolved_by     TEXT,
        breaches        TEXT,
        run_id          TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_incidents_url ON incidents(grafana_url, status);
    `);
  }

  /**
   * Evaluate health score and create incident if needed.
   * Returns the incident (new or existing) or null if healthy.
   */
  async evaluate(grafanaUrl, healthScore, runId, trendReport = null) {
    const { score, status, breaches = [] } = healthScore;

    // Determine severity
    let severity = null;
    if (status === 'critical' || score < 50) {
      severity = 'critical';
    } else if (status === 'degraded' || score < 70) {
      severity = 'warning';
    } else if (trendReport?.anomaly?.is_anomaly) {
      severity = 'warning';
    }

    // Check for open incident
    const existing = this.getOpenIncident(grafanaUrl);

    if (!severity) {
      // Healthy — resolve any open incident
      if (existing) {
        await this.resolve(existing.id, 'auto_recovery', runId);
      }
      return null;
    }

    // Escalate if severity increased
    if (existing) {
      if (severity === 'critical' && existing.severity === 'warning') {
        this._escalate(existing.id, severity, score);
      }
      // Update trigger score
      this.db.prepare('UPDATE incidents SET trigger_score = ?, run_id = ? WHERE id = ?')
        .run(score, runId, existing.id);
      return existing;
    }

    // Create new incident
    const id      = `inc-${Date.now()}`;
    const title   = severity === 'critical'
      ? `CRITICAL: Grafana health score dropped to ${score}`
      : `WARNING: Grafana health degraded to ${score}`;
    const description = [
      `Health score: ${score}/100 (${status})`,
      trendReport?.anomaly?.is_anomaly
        ? `Anomaly detected: z-score = ${trendReport.anomaly.zscore}`
        : '',
      breaches.length ? `Breaches: ${breaches.map(b => b.component).join(', ')}` : '',
    ].filter(Boolean).join('\n');

    this.db.prepare(`
      INSERT INTO incidents (id, grafana_url, severity, title, description, trigger_score, run_id, breaches)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, grafanaUrl, severity, title, description, score, runId, JSON.stringify(breaches));

    const incident = this.getIncident(id);

    // Send notification
    if (this.notifier) {
      await this.notifier.send({
        type:       'failure',
        severity,
        title,
        message:    description,
        score,
        runId,
        grafanaUrl,
        breaches,
      }).catch(err => console.warn('[IncidentManager] Notification failed:', err.message));
    }

    return incident;
  }

  /**
   * Resolve an open incident.
   */
  async resolve(incidentId, reason = 'manual', runId = null) {
    const incident = this.getIncident(incidentId);
    if (!incident || incident.status === 'resolved') return;

    this.db.prepare(`
      UPDATE incidents
      SET status = 'resolved', resolved_at = datetime('now'), resolved_by = ?
      WHERE id = ?
    `).run(reason, incidentId);

    if (this.notifier) {
      await this.notifier.send({
        type:       'recovery',
        severity:   'info',
        title:      `RESOLVED: Grafana health recovered`,
        message:    `Incident ${incidentId} resolved (reason: ${reason})`,
        runId,
        grafanaUrl: incident.grafana_url,
      }).catch(() => {});
    }
  }

  getOpenIncident(grafanaUrl) {
    return this.db.prepare(`
      SELECT * FROM incidents WHERE grafana_url = ? AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1
    `).get(grafanaUrl);
  }

  getIncident(id) {
    return this.db.prepare('SELECT * FROM incidents WHERE id = ?').get(id);
  }

  listIncidents(grafanaUrl = null, status = null, limit = 50) {
    let query = 'SELECT * FROM incidents WHERE 1=1';
    const params = [];
    if (grafanaUrl) { query += ' AND grafana_url = ?'; params.push(grafanaUrl); }
    if (status)     { query += ' AND status = ?';      params.push(status); }
    query += ' ORDER BY opened_at DESC LIMIT ?';
    params.push(limit);
    return this.db.prepare(query).all(...params);
  }

  _escalate(incidentId, newSeverity, score) {
    this.db.prepare(`
      UPDATE incidents SET severity = ?, description = description || '\n[ESCALATED to ' || ? || ' at score ' || ? || ']'
      WHERE id = ?
    `).run(newSeverity, newSeverity, score, incidentId);
  }
}

module.exports = { IncidentManager };
