'use strict';
/**
 * integrations/pagerduty.js — PagerDuty Events API v2 incident creation.
 */

const https = require('https');

const PD_EVENTS_URL = 'https://events.pagerduty.com/v2/enqueue';

/**
 * Trigger a PagerDuty incident.
 * @param {string} routingKey    - PagerDuty routing key
 * @param {object} incident      - { title, severity, details, grafanaUrl, runId }
 */
async function triggerIncident(routingKey, incident) {
  const payload = {
    routing_key:   routingKey,
    event_action:  'trigger',
    dedup_key:     incident.runId ? `sentinel-${incident.runId}` : `sentinel-${Date.now()}`,
    payload: {
      summary:   incident.title || 'Grafana Sentinel alert',
      severity:  incident.severity || 'warning', // critical | error | warning | info
      source:    incident.grafanaUrl || 'grafana-sentinel',
      timestamp: new Date().toISOString(),
      custom_details: {
        health_score: incident.score,
        message:      incident.message,
        breaches:     incident.breaches,
        run_id:       incident.runId,
        report_url:   incident.reportUrl,
      },
    },
    links: incident.reportUrl
      ? [{ href: incident.reportUrl, text: 'View Sentinel Report' }]
      : [],
    images: [],
  };

  return _pdRequest(payload);
}

/**
 * Resolve a PagerDuty incident by dedup_key.
 */
async function resolveIncident(routingKey, runId) {
  const payload = {
    routing_key:   routingKey,
    event_action:  'resolve',
    dedup_key:     `sentinel-${runId}`,
  };

  return _pdRequest(payload);
}

/**
 * Acknowledge a PagerDuty incident.
 */
async function acknowledgeIncident(routingKey, runId) {
  const payload = {
    routing_key:   routingKey,
    event_action:  'acknowledge',
    dedup_key:     `sentinel-${runId}`,
  };

  return _pdRequest(payload);
}

function _pdRequest(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req  = https.request({
      hostname: 'events.pagerduty.com',
      path:     '/v2/enqueue',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ ok: res.statusCode === 202, status: res.statusCode, body: parsed });
        } catch {
          resolve({ ok: res.statusCode === 202, status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('PagerDuty request timeout')); });
    req.write(body);
    req.end();
  });
}

module.exports = { triggerIncident, resolveIncident, acknowledgeIncident };
