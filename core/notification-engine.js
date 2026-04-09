'use strict';
/**
 * core/notification-engine.js — Send alerts to Slack, PagerDuty, email, and generic webhooks.
 * Configurable routing per channel and severity.
 */

const https = require('https');
const http  = require('http');
const url   = require('url');

const SEVERITY_ORDER = { info: 0, warning: 1, critical: 2 };

class NotificationEngine {
  /**
   * @param {object[]} channels — Array of channel configs from config/notifications.yaml
   * @param {object} opts
   * @param {string} opts.minSeverity  - Minimum severity to send ('info'|'warning'|'critical')
   * @param {boolean} opts.dryRun      - Log but do not send
   */
  constructor(channels = [], opts = {}) {
    this.channels    = channels;
    this.minSeverity = opts.minSeverity || 'warning';
    this.dryRun      = opts.dryRun || false;
    this._sent = [];  // Log of sent notifications for diagnostics
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Send a notification for a health check failure / recovery.
   * @param {object} event
   * @param {string} event.type        — 'failure' | 'recovery' | 'degradation' | 'info'
   * @param {string} event.severity    — 'info' | 'warning' | 'critical'
   * @param {string} event.title
   * @param {string} event.message
   * @param {number} [event.score]     — Health score (0–100)
   * @param {string} [event.runId]
   * @param {string} [event.grafanaUrl]
   * @param {string} [event.reportUrl]
   * @param {object[]} [event.breaches] — Array of { component, score, severity }
   */
  async send(event) {
    if (!this._meetsMinSeverity(event.severity)) return;

    const results = await Promise.allSettled(
      this.channels
        .filter(ch => this._channelShouldReceive(ch, event))
        .map(ch => this._dispatch(ch, event)),
    );

    const sent = { event, timestamp: new Date().toISOString(), results: results.map(r => r.status) };
    this._sent.push(sent);
    return sent;
  }

  /** Test all configured channels with a ping message */
  async testChannels() {
    return this.send({
      type:     'info',
      severity: 'info',
      title:    'Grafana Sentinel — Channel Test',
      message:  'Notification channels are configured correctly.',
    });
  }

  getSentLog() {
    return this._sent;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Dispatch routing
  // ─────────────────────────────────────────────────────────────────────────────

  async _dispatch(channel, event) {
    if (this.dryRun) {
      console.log(`[NotificationEngine] DryRun — would send to ${channel.type}:`, event.title);
      return { ok: true, dryRun: true };
    }

    switch (channel.type) {
      case 'slack':      return this._sendSlack(channel, event);
      case 'pagerduty':  return this._sendPagerDuty(channel, event);
      case 'email':      return this._sendEmail(channel, event);
      case 'webhook':    return this._sendWebhook(channel, event);
      default:
        console.warn(`[NotificationEngine] Unknown channel type: ${channel.type}`);
        return { ok: false, error: `Unknown channel type: ${channel.type}` };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Slack
  // ─────────────────────────────────────────────────────────────────────────────

  async _sendSlack(channel, event) {
    const color = event.type === 'recovery' ? '#2eb67d'
      : event.severity === 'critical' ? '#e01e5a'
      : event.severity === 'warning'  ? '#ecb22e'
      : '#36c5f0';

    const breachText = (event.breaches || [])
      .map(b => `• *${b.component}*: ${Math.round(b.score)}% (${b.severity})`)
      .join('\n');

    const payload = {
      username: 'Grafana Sentinel',
      icon_emoji: ':grafana:',
      attachments: [{
        color,
        title: event.title,
        text: event.message,
        fields: [
          event.score !== undefined && { title: 'Health Score', value: `${event.score}/100`, short: true },
          event.grafanaUrl && { title: 'Grafana', value: event.grafanaUrl, short: true },
          event.runId && { title: 'Run ID', value: event.runId, short: true },
          event.reportUrl && { title: 'Report', value: event.reportUrl, short: false },
          breachText && { title: 'Breaches', value: breachText, short: false },
        ].filter(Boolean),
        footer: 'Grafana Sentinel',
        ts: Math.floor(Date.now() / 1000),
      }],
    };

    return this._httpPost(channel.webhook_url, payload);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PagerDuty
  // ─────────────────────────────────────────────────────────────────────────────

  async _sendPagerDuty(channel, event) {
    const eventAction = event.type === 'recovery' ? 'resolve' : 'trigger';
    const severity    = event.severity === 'critical' ? 'critical'
      : event.severity === 'warning' ? 'warning' : 'info';

    const payload = {
      routing_key:   channel.routing_key,
      event_action:  eventAction,
      dedup_key:     event.runId ? `sentinel-${event.runId}` : `sentinel-${Date.now()}`,
      payload: {
        summary:        event.title,
        severity,
        source:         event.grafanaUrl || 'grafana-sentinel',
        timestamp:      new Date().toISOString(),
        custom_details: {
          message:      event.message,
          health_score: event.score,
          breaches:     event.breaches,
          report_url:   event.reportUrl,
        },
      },
      links: event.reportUrl ? [{ href: event.reportUrl, text: 'View Report' }] : [],
    };

    return this._httpPost('https://events.pagerduty.com/v2/enqueue', payload);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Email (via nodemailer)
  // ─────────────────────────────────────────────────────────────────────────────

  async _sendEmail(channel, event) {
    const nodemailer = require('nodemailer');

    const transporter = nodemailer.createTransporter({
      host:   channel.smtp_host || 'localhost',
      port:   channel.smtp_port || 587,
      secure: channel.smtp_secure || false,
      auth:   channel.smtp_user ? { user: channel.smtp_user, pass: channel.smtp_pass } : undefined,
    });

    const breachHtml = (event.breaches || [])
      .map(b => `<li><strong>${b.component}</strong>: ${Math.round(b.score)}% (${b.severity})</li>`)
      .join('');

    const html = `
      <h2>${event.title}</h2>
      <p>${event.message}</p>
      ${event.score !== undefined ? `<p><strong>Health Score:</strong> ${event.score}/100</p>` : ''}
      ${event.grafanaUrl ? `<p><strong>Grafana:</strong> <a href="${event.grafanaUrl}">${event.grafanaUrl}</a></p>` : ''}
      ${event.reportUrl ? `<p><a href="${event.reportUrl}">View Full Report</a></p>` : ''}
      ${breachHtml ? `<ul>${breachHtml}</ul>` : ''}
      <hr><small>Sent by Grafana Sentinel</small>
    `;

    await transporter.sendMail({
      from:    channel.from || 'sentinel@localhost',
      to:      Array.isArray(channel.to) ? channel.to.join(',') : channel.to,
      subject: `[Grafana Sentinel] ${event.title}`,
      html,
    });

    return { ok: true };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Generic webhook
  // ─────────────────────────────────────────────────────────────────────────────

  async _sendWebhook(channel, event) {
    const body = {
      source:     'grafana-sentinel',
      type:       event.type,
      severity:   event.severity,
      title:      event.title,
      message:    event.message,
      score:      event.score,
      runId:      event.runId,
      grafanaUrl: event.grafanaUrl,
      reportUrl:  event.reportUrl,
      breaches:   event.breaches,
      timestamp:  new Date().toISOString(),
      ...(channel.extra_fields || {}),
    };

    const headers = { 'Content-Type': 'application/json', ...(channel.headers || {}) };
    return this._httpPost(channel.url, body, headers);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HTTP helper
  // ─────────────────────────────────────────────────────────────────────────────

  _httpPost(targetUrl, body, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const parsed  = url.parse(targetUrl);
      const payload = JSON.stringify(body);
      const lib     = parsed.protocol === 'https:' ? https : http;

      const req = lib.request({
        hostname: parsed.hostname,
        port:     parsed.port,
        path:     parsed.path,
        method:   'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...extraHeaders,
        },
      }, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data }));
      });

      req.on('error', err => reject(err));
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('Notification timeout')); });
      req.write(payload);
      req.end();
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Filtering
  // ─────────────────────────────────────────────────────────────────────────────

  _meetsMinSeverity(severity) {
    return (SEVERITY_ORDER[severity] || 0) >= (SEVERITY_ORDER[this.minSeverity] || 0);
  }

  _channelShouldReceive(channel, event) {
    // Channel-level min severity
    if (channel.min_severity && !this._meetsChannelSeverity(channel.min_severity, event.severity)) return false;
    // Event type filters
    if (channel.on_failure  === false && event.type === 'failure')    return false;
    if (channel.on_recovery === false && event.type === 'recovery')   return false;
    return true;
  }

  _meetsChannelSeverity(minSeverity, actualSeverity) {
    return (SEVERITY_ORDER[actualSeverity] || 0) >= (SEVERITY_ORDER[minSeverity] || 0);
  }
}

module.exports = { NotificationEngine };
