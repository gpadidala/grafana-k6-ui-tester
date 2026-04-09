'use strict';
/**
 * integrations/grafana-pushgateway.js — Push Sentinel test metrics to Prometheus Pushgateway.
 * Allows Grafana to display Sentinel health data as a data source.
 */

const https = require('https');
const http  = require('http');
const url   = require('url');

/**
 * Push test run metrics to Prometheus Pushgateway.
 * @param {string} pushgatewayUrl    - e.g. "http://pushgateway:9091"
 * @param {object} report            - Full test report
 * @param {string} [jobName]         - Prometheus job label (default: "grafana-sentinel")
 * @param {object} [extraLabels]     - Additional labels { key: value }
 */
async function pushMetrics(pushgatewayUrl, report, jobName = 'grafana-sentinel', extraLabels = {}) {
  const summary   = report.summary || {};
  const labels    = {
    grafana_url: encodeLabel(report.grafanaUrl || 'unknown'),
    run_id:      encodeLabel(report.id || 'unknown'),
    ...extraLabels,
  };

  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');

  const lines = [
    `# HELP sentinel_pass_rate_pct Percentage of tests that passed`,
    `# TYPE sentinel_pass_rate_pct gauge`,
    `sentinel_pass_rate_pct{${labelStr}} ${summary.pass_rate ?? 0}`,

    `# HELP sentinel_tests_total Total number of tests executed`,
    `# TYPE sentinel_tests_total gauge`,
    `sentinel_tests_total{${labelStr}} ${summary.total ?? 0}`,

    `# HELP sentinel_tests_passed Tests that passed`,
    `# TYPE sentinel_tests_passed gauge`,
    `sentinel_tests_passed{${labelStr}} ${summary.passed ?? 0}`,

    `# HELP sentinel_tests_failed Tests that failed`,
    `# TYPE sentinel_tests_failed gauge`,
    `sentinel_tests_failed{${labelStr}} ${summary.failed ?? 0}`,

    `# HELP sentinel_tests_warnings Tests with warnings`,
    `# TYPE sentinel_tests_warnings gauge`,
    `sentinel_tests_warnings{${labelStr}} ${summary.warnings ?? 0}`,

    `# HELP sentinel_categories_total Number of test categories`,
    `# TYPE sentinel_categories_total gauge`,
    `sentinel_categories_total{${labelStr}} ${(report.categories || []).length}`,

    `# HELP sentinel_run_duration_seconds Test run duration`,
    `# TYPE sentinel_run_duration_seconds gauge`,
    `sentinel_run_duration_seconds{${labelStr}} ${_durationSeconds(report)}`,

    // Per-category metrics
    ...(report.categories || []).flatMap(cat => {
      const catPass = (cat.tests || []).filter(t => t.status === 'PASS').length;
      const catTotal = (cat.tests || []).length;
      const catRate  = catTotal > 0 ? (catPass / catTotal * 100).toFixed(1) : 0;
      const catLabel = `${labelStr},category="${encodeLabel(cat.id)}"`;
      return [
        `sentinel_category_pass_rate{${catLabel}} ${catRate}`,
        `sentinel_category_tests_total{${catLabel}} ${catTotal}`,
        `sentinel_category_failed{${catLabel}} ${catTotal - catPass}`,
      ];
    }),
  ];

  const body = lines.join('\n') + '\n';
  const pushUrl = `${pushgatewayUrl.replace(/\/$/, '')}/metrics/job/${encodeURIComponent(jobName)}`;

  return _push(pushUrl, body);
}

/**
 * Push a health score to Pushgateway.
 */
async function pushHealthScore(pushgatewayUrl, healthScore, grafanaUrl, jobName = 'grafana-sentinel') {
  const labelStr = `grafana_url="${encodeLabel(grafanaUrl)}"`;
  const lines = [
    `# HELP sentinel_health_score 0-100 Sentinel health score`,
    `# TYPE sentinel_health_score gauge`,
    `sentinel_health_score{${labelStr}} ${healthScore.score}`,
    ...Object.entries(healthScore.components || {}).map(([name, c]) =>
      `sentinel_component_score{${labelStr},component="${name}"} ${c.score.toFixed(2)}`),
  ];

  const body    = lines.join('\n') + '\n';
  const pushUrl = `${pushgatewayUrl.replace(/\/$/, '')}/metrics/job/${encodeURIComponent(jobName)}`;
  return _push(pushUrl, body);
}

function _push(pushUrl, body) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(pushUrl);
    const lib    = parsed.protocol === 'https:' ? https : http;

    const req = lib.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 9091),
      path:     parsed.path,
      method:   'POST',
      headers: {
        'Content-Type':   'text/plain; version=0.0.4; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ ok: res.statusCode < 300, status: res.statusCode }));
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Pushgateway timeout')); });
    req.write(body);
    req.end();
  });
}

function encodeLabel(str) {
  return String(str).replace(/["\\\n]/g, '').slice(0, 100);
}

function _durationSeconds(report) {
  if (!report.startedAt || !report.completedAt) return 0;
  return ((new Date(report.completedAt) - new Date(report.startedAt)) / 1000).toFixed(1);
}

module.exports = { pushMetrics, pushHealthScore };
