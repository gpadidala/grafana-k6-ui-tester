'use strict';
/**
 * core/health-scorer.js — Calculate a 0–100 health score from test results.
 *
 * Weighted categories:
 *   dashboard_pass_rate  0.35
 *   alert_pass_rate      0.15
 *   datasource_health    0.20
 *   core_pages           0.10
 *   performance          0.10
 *   no_data_rate         0.05
 *   plugin_health        0.05
 */

const WEIGHTS = {
  dashboard_pass_rate:  0.35,
  alert_pass_rate:      0.15,
  datasource_health:    0.20,
  core_pages:           0.10,
  performance:          0.10,
  no_data_rate:         0.05,
  plugin_health:        0.05,
};

// Thresholds for letter grades
const GRADE_THRESHOLDS = [
  { min: 95, grade: 'A+', label: 'Excellent' },
  { min: 90, grade: 'A',  label: 'Very Good' },
  { min: 80, grade: 'B',  label: 'Good' },
  { min: 70, grade: 'C',  label: 'Fair' },
  { min: 60, grade: 'D',  label: 'Poor' },
  { min: 0,  grade: 'F',  label: 'Critical' },
];

class HealthScorer {
  /**
   * Compute overall health score from a completed test run report.
   *
   * @param {object} report  - { categories: [{ id, status, tests: [...] }], summary }
   * @param {object} [perfBaseline] - Optional: { dashboard_load_p95_ms, api_p99_ms }
   * @returns {SentinelHealthScore}
   */
  score(report, perfBaseline = null) {
    const categories = report.categories || [];
    const metrics = this._extractMetrics(categories, perfBaseline);
    const components = this._computeComponents(metrics);
    const total = this._weightedSum(components);

    return {
      score: Math.round(total),
      grade: this._grade(total),
      components,
      metrics,
      thresholds: WEIGHTS,
      status: total >= 80 ? 'healthy' : total >= 60 ? 'degraded' : 'critical',
      breaches: this._findBreaches(components),
    };
  }

  /**
   * Score from raw metric values (without a full report object).
   */
  scoreFromMetrics(metrics) {
    const components = this._computeComponents(metrics);
    const total = this._weightedSum(components);
    return {
      score: Math.round(total),
      grade: this._grade(total),
      components,
      metrics,
      status: total >= 80 ? 'healthy' : total >= 60 ? 'degraded' : 'critical',
      breaches: this._findBreaches(components),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Metric extraction
  // ─────────────────────────────────────────────────────────────────────────────

  _extractMetrics(categories, perfBaseline) {
    const metrics = {
      dashboard_pass_rate:  null,   // 0–100 pct
      alert_pass_rate:      null,
      datasource_health:    null,
      core_pages_pass_rate: null,
      perf_score:           null,   // 0–100 (inverted from load time vs threshold)
      no_data_rate:         null,   // 0–100 (0 = no panels with "no data")
      plugin_health:        null,
    };

    const catMap = {};
    for (const c of categories) catMap[c.id] = c;

    // Dashboard pass rate
    if (catMap.dashboards) {
      metrics.dashboard_pass_rate = this._passRate(catMap.dashboards.tests || []);
    }

    // Alert pass rate
    if (catMap.alerts) {
      metrics.alert_pass_rate = this._passRate(catMap.alerts.tests || []);
    }

    // Datasource health
    if (catMap.datasources) {
      metrics.datasource_health = this._passRate(catMap.datasources.tests || []);
    }

    // Core pages (api-health, navigation)
    const coreTests = [
      ...(catMap['api-health']?.tests || []),
      ...(catMap['navigation']?.tests || []),
    ];
    if (coreTests.length) {
      metrics.core_pages_pass_rate = this._passRate(coreTests);
    }

    // Performance score
    if (catMap['query-latency']) {
      const perf = catMap['query-latency'].tests || [];
      const passedPerf = perf.filter(t => t.status === 'PASS').length;
      metrics.perf_score = perf.length ? (passedPerf / perf.length) * 100 : 100;
    } else if (perfBaseline) {
      // If we have actual timing data vs baseline thresholds
      const ratio = Math.min(perfBaseline.dashboard_load_p95_ms / 5000, 2);
      metrics.perf_score = Math.max(0, 100 - (ratio - 1) * 100);
    }

    // No-data rate (lower = better; invert to score)
    if (catMap['data-freshness'] || catMap.panels) {
      const tests = [
        ...(catMap['data-freshness']?.tests || []),
        ...(catMap.panels?.tests || []),
      ];
      const noDataTests = tests.filter(t => t.name?.toLowerCase().includes('no data') || t.detail?.toLowerCase().includes('no data'));
      const noDataCount = noDataTests.filter(t => t.status !== 'PASS').length;
      metrics.no_data_rate = tests.length ? Math.max(0, 100 - (noDataCount / tests.length) * 100) : 100;
    }

    // Plugin health
    if (catMap.plugins || catMap['app-plugins']) {
      const pluginTests = [
        ...(catMap.plugins?.tests || []),
        ...(catMap['app-plugins']?.tests || []),
      ];
      metrics.plugin_health = pluginTests.length ? this._passRate(pluginTests) : 100;
    }

    // Fill nulls with 100 (no data = assume healthy)
    for (const key of Object.keys(metrics)) {
      if (metrics[key] === null) metrics[key] = 100;
    }

    return metrics;
  }

  _passRate(tests) {
    if (!tests.length) return 100;
    const passed = tests.filter(t => t.status === 'PASS' || t.status === 'pass').length;
    return (passed / tests.length) * 100;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Component scoring
  // ─────────────────────────────────────────────────────────────────────────────

  _computeComponents(metrics) {
    return {
      dashboard_pass_rate:  { score: metrics.dashboard_pass_rate,  weight: WEIGHTS.dashboard_pass_rate,  contribution: metrics.dashboard_pass_rate * WEIGHTS.dashboard_pass_rate },
      alert_pass_rate:      { score: metrics.alert_pass_rate,       weight: WEIGHTS.alert_pass_rate,      contribution: metrics.alert_pass_rate      * WEIGHTS.alert_pass_rate },
      datasource_health:    { score: metrics.datasource_health,     weight: WEIGHTS.datasource_health,    contribution: metrics.datasource_health    * WEIGHTS.datasource_health },
      core_pages:           { score: metrics.core_pages_pass_rate,  weight: WEIGHTS.core_pages,           contribution: metrics.core_pages_pass_rate * WEIGHTS.core_pages },
      performance:          { score: metrics.perf_score,            weight: WEIGHTS.performance,          contribution: metrics.perf_score           * WEIGHTS.performance },
      no_data_rate:         { score: metrics.no_data_rate,          weight: WEIGHTS.no_data_rate,         contribution: metrics.no_data_rate         * WEIGHTS.no_data_rate },
      plugin_health:        { score: metrics.plugin_health,         weight: WEIGHTS.plugin_health,        contribution: metrics.plugin_health        * WEIGHTS.plugin_health },
    };
  }

  _weightedSum(components) {
    return Object.values(components).reduce((sum, c) => sum + c.contribution, 0);
  }

  _grade(score) {
    for (const g of GRADE_THRESHOLDS) {
      if (score >= g.min) return { letter: g.grade, label: g.label };
    }
    return { letter: 'F', label: 'Critical' };
  }

  _findBreaches(components) {
    return Object.entries(components)
      .filter(([, c]) => c.score < 70)
      .map(([name, c]) => ({ component: name, score: Math.round(c.score), severity: c.score < 50 ? 'critical' : 'warning' }))
      .sort((a, b) => a.score - b.score);
  }

  /**
   * Compute delta between two scores for trend tracking.
   */
  delta(currentScore, previousScore) {
    const diff = currentScore.score - previousScore.score;
    return {
      delta: Math.round(diff * 10) / 10,
      direction: diff > 1 ? 'improving' : diff < -1 ? 'degrading' : 'stable',
      significant: Math.abs(diff) >= 5,
    };
  }
}

module.exports = { HealthScorer, WEIGHTS };
