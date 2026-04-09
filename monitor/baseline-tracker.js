'use strict';
/**
 * monitor/baseline-tracker.js — SQLite-backed 30-day rolling baseline storage.
 * Records health scores over time and provides trend data for anomaly detection.
 */

class BaselineTracker {
  /**
   * @param {object} db  - better-sqlite3 Database instance
   * @param {number} retentionDays  - Days to keep data (default 30)
   */
  constructor(db, retentionDays = 30) {
    this.db            = db;
    this.retentionDays = retentionDays;
    this._ensureSchema();
  }

  _ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS health_baselines (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id           TEXT NOT NULL,
        grafana_url      TEXT NOT NULL,
        instance_label   TEXT,
        score            REAL NOT NULL,
        grade            TEXT,
        status           TEXT,
        dashboard_rate   REAL,
        alert_rate       REAL,
        datasource_rate  REAL,
        perf_score       REAL,
        total_tests      INTEGER,
        passed_tests     INTEGER,
        failed_tests     INTEGER,
        recorded_at      TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_baselines_url ON health_baselines(grafana_url, recorded_at);

      CREATE TABLE IF NOT EXISTS trend_aggregates (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        grafana_url      TEXT NOT NULL,
        window_days      INTEGER NOT NULL,
        mean_score       REAL,
        stddev_score     REAL,
        min_score        REAL,
        max_score        REAL,
        p10_score        REAL,
        p50_score        REAL,
        p90_score        REAL,
        data_points      INTEGER,
        computed_at      TEXT DEFAULT (datetime('now')),
        UNIQUE(grafana_url, window_days)
      )
    `);
  }

  /**
   * Record a health score data point.
   */
  record(grafanaUrl, runId, healthScore, extra = {}) {
    this.db.prepare(`
      INSERT INTO health_baselines
        (run_id, grafana_url, instance_label, score, grade, status,
         dashboard_rate, alert_rate, datasource_rate, perf_score,
         total_tests, passed_tests, failed_tests)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      grafanaUrl,
      extra.instanceLabel || null,
      healthScore.score,
      healthScore.grade?.letter || null,
      healthScore.status || null,
      healthScore.components?.dashboard_pass_rate?.score || null,
      healthScore.components?.alert_pass_rate?.score || null,
      healthScore.components?.datasource_health?.score || null,
      healthScore.components?.performance?.score || null,
      extra.totalTests   || null,
      extra.passedTests  || null,
      extra.failedTests  || null,
    );

    // Cleanup old data
    this._cleanup(grafanaUrl);
  }

  /**
   * Get the rolling baseline (mean, stddev, percentiles) for a given URL.
   */
  getBaseline(grafanaUrl, windowDays = 7) {
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const rows   = this.db.prepare(`
      SELECT score FROM health_baselines
      WHERE grafana_url = ? AND recorded_at >= ?
      ORDER BY recorded_at ASC
    `).all(grafanaUrl, cutoff);

    if (rows.length < 2) return null;

    const scores = rows.map(r => r.score);
    const mean   = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / scores.length;
    const stddev  = Math.sqrt(variance);
    const sorted  = [...scores].sort((a, b) => a - b);

    return {
      grafana_url:  grafanaUrl,
      window_days:  windowDays,
      data_points:  scores.length,
      mean:         Math.round(mean * 100) / 100,
      stddev:       Math.round(stddev * 100) / 100,
      min:          sorted[0],
      max:          sorted[sorted.length - 1],
      p10:          sorted[Math.floor(sorted.length * 0.10)],
      p50:          sorted[Math.floor(sorted.length * 0.50)],
      p90:          sorted[Math.floor(sorted.length * 0.90)],
      lower_bound:  Math.max(0,   Math.round((mean - 2 * stddev) * 100) / 100),
      upper_bound:  Math.min(100, Math.round((mean + 2 * stddev) * 100) / 100),
    };
  }

  /**
   * Get recent history for a URL.
   */
  getHistory(grafanaUrl, limit = 30) {
    return this.db.prepare(`
      SELECT * FROM health_baselines
      WHERE grafana_url = ?
      ORDER BY recorded_at DESC
      LIMIT ?
    `).all(grafanaUrl, limit);
  }

  /**
   * Get trend: last N data points for sparkline.
   */
  getTrend(grafanaUrl, limit = 14) {
    return this.db.prepare(`
      SELECT score, recorded_at FROM health_baselines
      WHERE grafana_url = ?
      ORDER BY recorded_at DESC
      LIMIT ?
    `).all(grafanaUrl, limit).reverse();
  }

  /**
   * Check if a given score is an anomaly (outside 2 standard deviations).
   */
  isAnomaly(grafanaUrl, score) {
    const baseline = this.getBaseline(grafanaUrl);
    if (!baseline) return false;
    return score < baseline.lower_bound;
  }

  /**
   * Update aggregated trend table.
   */
  refreshAggregates(grafanaUrl) {
    for (const window of [7, 14, 30]) {
      const b = this.getBaseline(grafanaUrl, window);
      if (!b) continue;
      this.db.prepare(`
        INSERT OR REPLACE INTO trend_aggregates
          (grafana_url, window_days, mean_score, stddev_score, min_score, max_score,
           p10_score, p50_score, p90_score, data_points)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(grafanaUrl, window, b.mean, b.stddev, b.min, b.max, b.p10, b.p50, b.p90, b.data_points);
    }
  }

  /**
   * Delete data older than retentionDays for a URL.
   */
  _cleanup(grafanaUrl) {
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000).toISOString();
    this.db.prepare('DELETE FROM health_baselines WHERE grafana_url = ? AND recorded_at < ?')
      .run(grafanaUrl, cutoff);
  }
}

module.exports = { BaselineTracker };
