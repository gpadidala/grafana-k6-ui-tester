'use strict';
/**
 * integrations/slack.js — Rich Slack webhook messages for Sentinel alerts.
 */

const https = require('https');
const http  = require('http');
const url   = require('url');

const STATUS_COLORS = {
  healthy:  '#2eb67d',
  degraded: '#ecb22e',
  critical: '#e01e5a',
  info:     '#36c5f0',
};

/**
 * Send a Sentinel run summary to Slack.
 * @param {string} webhookUrl
 * @param {object} report          - Full test report
 * @param {object} [healthScore]   - HealthScorer output
 * @param {object} [opts]
 * @param {string} [opts.grafanaUrl]
 * @param {string} [opts.reportUrl]
 * @param {string} [opts.channel]
 */
async function sendRunSummary(webhookUrl, report, healthScore, opts = {}) {
  const summary = report.summary || {};
  const score   = healthScore?.score ?? summary.pass_rate ?? 0;
  const status  = healthScore?.status || (score >= 80 ? 'healthy' : score >= 60 ? 'degraded' : 'critical');
  const color   = STATUS_COLORS[status] || '#888';
  const grade   = healthScore?.grade?.letter || '—';

  const failedCats = (report.categories || [])
    .filter(c => c.status === 'FAIL')
    .map(c => `• ${c.icon || ''} ${c.name}`)
    .join('\n');

  const fields = [
    { title: 'Health Score', value: `${score}/100 (Grade ${grade})`, short: true },
    { title: 'Status',       value: status.toUpperCase(),            short: true },
    { title: 'Tests',        value: `✅ ${summary.passed} / ❌ ${summary.failed} / ⚠️ ${summary.warnings}`, short: true },
    { title: 'Pass Rate',    value: `${summary.pass_rate}%`,         short: true },
    opts.grafanaUrl && { title: 'Grafana', value: opts.grafanaUrl, short: false },
    opts.reportUrl  && { title: 'Report',  value: opts.reportUrl,  short: false },
    failedCats      && { title: 'Failed Categories', value: failedCats, short: false },
  ].filter(Boolean);

  const icon = score >= 80 ? ':white_check_mark:' : score >= 60 ? ':warning:' : ':x:';

  const payload = {
    username:    'Grafana Sentinel',
    icon_emoji:  ':grafana:',
    ...(opts.channel && { channel: opts.channel }),
    attachments: [{
      color,
      title:    `${icon} Grafana Sentinel — ${status.charAt(0).toUpperCase() + status.slice(1)}`,
      fallback: `Grafana Sentinel: ${status} — Score: ${score}/100`,
      fields,
      footer:   `Grafana Sentinel V3 | ${new Date(report.startedAt || Date.now()).toLocaleString()}`,
      ts:       Math.floor(Date.now() / 1000),
    }],
  };

  return _post(webhookUrl, payload);
}

/**
 * Send a threshold breach alert.
 */
async function sendBreachAlert(webhookUrl, breach, opts = {}) {
  const payload = {
    username:   'Grafana Sentinel',
    icon_emoji: ':rotating_light:',
    attachments: [{
      color:  STATUS_COLORS[breach.severity] || '#e01e5a',
      title:  `🚨 ${breach.title}`,
      text:   breach.message,
      fields: [
        { title: 'Severity', value: breach.severity?.toUpperCase(), short: true },
        { title: 'Score',    value: `${breach.score}/100`,          short: true },
        opts.reportUrl && { title: 'Report', value: opts.reportUrl, short: false },
      ].filter(Boolean),
      footer: 'Grafana Sentinel V3',
      ts:     Math.floor(Date.now() / 1000),
    }],
  };

  return _post(webhookUrl, payload);
}

/**
 * Send a recovery notification.
 */
async function sendRecovery(webhookUrl, previousIncident, currentScore, opts = {}) {
  const payload = {
    username:   'Grafana Sentinel',
    icon_emoji: ':white_check_mark:',
    attachments: [{
      color: STATUS_COLORS.healthy,
      title: '✅ Grafana Sentinel — Recovered',
      text:  `Grafana has recovered. Current score: ${currentScore}/100`,
      footer: 'Grafana Sentinel V3',
      ts:     Math.floor(Date.now() / 1000),
    }],
  };

  return _post(webhookUrl, payload);
}

function _post(webhookUrl, body) {
  return new Promise((resolve, reject) => {
    const parsed  = url.parse(webhookUrl);
    const payload = JSON.stringify(body);
    const lib     = parsed.protocol === 'https:' ? https : http;

    const req = lib.request({
      hostname: parsed.hostname,
      port:     parsed.port,
      path:     parsed.path,
      method:   'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode, data }));
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Slack webhook timeout')); });
    req.write(payload);
    req.end();
  });
}

module.exports = { sendRunSummary, sendBreachAlert, sendRecovery };
