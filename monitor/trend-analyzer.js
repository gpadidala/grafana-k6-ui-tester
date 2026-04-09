'use strict';
/**
 * monitor/trend-analyzer.js — Detect anomalies using ±2 standard deviations from mean.
 * Returns trend direction, velocity, and anomaly classification.
 */

const { BaselineTracker } = require('./baseline-tracker');

class TrendAnalyzer {
  /**
   * @param {object} db  - better-sqlite3 Database instance
   */
  constructor(db) {
    this.tracker = new BaselineTracker(db);
  }

  /**
   * Full trend analysis for a Grafana instance.
   * @returns {TrendReport}
   */
  analyze(grafanaUrl, currentScore) {
    const baseline7d  = this.tracker.getBaseline(grafanaUrl, 7);
    const baseline30d = this.tracker.getBaseline(grafanaUrl, 30);
    const recent      = this.tracker.getTrend(grafanaUrl, 14);

    const anomaly   = this._detectAnomaly(currentScore, baseline7d);
    const direction = this._detectDirection(recent);
    const velocity  = this._detectVelocity(recent);

    return {
      grafana_url:    grafanaUrl,
      current_score:  currentScore,
      baseline_7d:    baseline7d,
      baseline_30d:   baseline30d,
      anomaly,
      direction,      // 'improving' | 'degrading' | 'stable'
      velocity,       // points per day (negative = degrading)
      recent_scores:  recent.map(r => r.score),
      assessment:     this._assessment(currentScore, anomaly, direction, velocity),
    };
  }

  /**
   * Detect if the current score is an anomaly (outside 2σ of baseline).
   */
  _detectAnomaly(score, baseline) {
    if (!baseline || baseline.data_points < 5) {
      return { is_anomaly: false, reason: 'insufficient_data', confidence: 'low' };
    }

    const zscore       = (score - baseline.mean) / Math.max(baseline.stddev, 0.1);
    const is_anomaly   = zscore < -2;
    const is_critical  = zscore < -3;
    const degradation  = Math.max(0, baseline.mean - score);

    return {
      is_anomaly,
      is_critical,
      zscore:            Math.round(zscore * 100) / 100,
      degradation_pts:   Math.round(degradation * 100) / 100,
      lower_bound:       baseline.lower_bound,
      mean:              baseline.mean,
      confidence:        baseline.data_points >= 14 ? 'high' : 'medium',
    };
  }

  /**
   * Detect overall trend direction from recent data points.
   */
  _detectDirection(recent) {
    if (recent.length < 3) return 'stable';

    // Simple linear regression
    const n = recent.length;
    const scores = recent.map(r => r.score);
    const xMean  = (n - 1) / 2;
    const yMean  = scores.reduce((a, b) => a + b, 0) / n;

    let numerator   = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      numerator   += (i - xMean) * (scores[i] - yMean);
      denominator += Math.pow(i - xMean, 2);
    }

    const slope = denominator !== 0 ? numerator / denominator : 0;

    if (slope > 0.5)  return 'improving';
    if (slope < -0.5) return 'degrading';
    return 'stable';
  }

  /**
   * Calculate velocity in score-points-per-day.
   */
  _detectVelocity(recent) {
    if (recent.length < 3) return 0;

    const oldest  = recent[0];
    const newest  = recent[recent.length - 1];
    const deltaDays = (new Date(newest.recorded_at) - new Date(oldest.recorded_at)) / (1000 * 60 * 60 * 24);

    if (deltaDays < 0.1) return 0;

    const deltaScore = newest.score - oldest.score;
    return Math.round((deltaScore / deltaDays) * 100) / 100;
  }

  /**
   * Overall assessment string for humans and alerting.
   */
  _assessment(score, anomaly, direction, velocity) {
    if (anomaly.is_critical) {
      return { level: 'critical', message: `Score ${score} is ${anomaly.degradation_pts}pts below normal baseline — immediate investigation required` };
    }
    if (anomaly.is_anomaly) {
      return { level: 'warning', message: `Score ${score} is anomalously low (z=${anomaly.zscore}) — investigate recent changes` };
    }
    if (direction === 'degrading' && velocity < -2) {
      return { level: 'warning', message: `Score degrading at ${Math.abs(velocity)} pts/day — monitor closely` };
    }
    if (direction === 'improving') {
      return { level: 'info', message: `Score improving at +${velocity} pts/day` };
    }
    return { level: 'ok', message: `Score ${score} is within normal range` };
  }

  /**
   * Get trend data for all monitored instances.
   */
  getAllTrends(db) {
    const urls = db.prepare(`
      SELECT DISTINCT grafana_url FROM health_baselines
      WHERE recorded_at >= datetime('now', '-30 days')
    `).all().map(r => r.grafana_url);

    return urls.map(url => {
      const latest = db.prepare(`
        SELECT score FROM health_baselines
        WHERE grafana_url = ?
        ORDER BY recorded_at DESC LIMIT 1
      `).get(url);
      return this.analyze(url, latest?.score || 0);
    });
  }
}

module.exports = { TrendAnalyzer };
