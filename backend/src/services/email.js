'use strict';

/**
 * Email notification service.
 *
 * Persists SMTP configuration to backend/data/email-config.json (gitignored)
 * and sends failure notification emails via nodemailer. Recipients are
 * resolved from Grafana usernames (createdBy / updatedBy) by calling
 * Grafana's /api/users/lookup endpoint.
 */

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const CONFIG_PATH = path.resolve(path.join(path.dirname(path.resolve(config.paths.db)), 'email-config.json'));

const DEFAULT_CONFIG = {
  host: '',
  port: 587,
  secure: false,           // true for 465, false for 587/TLS
  user: '',
  password: '',
  fromAddress: '',
  fromName: 'GrafanaProbe',
  defaultCc: '',           // comma-separated list
  enabled: false,
};

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (err) {
    logger.warn('email: failed to load config', { error: err.message });
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(cfg) {
  // Merge over defaults so partial saves don't drop fields
  const merged = { ...DEFAULT_CONFIG, ...loadConfig(), ...cfg };
  // If password is the masked sentinel, keep the existing one
  if (merged.password === '••••••••') {
    const existing = loadConfig();
    merged.password = existing.password || '';
  }
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

// Public-facing config: never returns the real password
function getRedactedConfig() {
  const cfg = loadConfig();
  return {
    ...cfg,
    password: cfg.password ? '••••••••' : '',
  };
}

function buildTransporter(cfg) {
  if (!cfg.host) throw new Error('SMTP host not configured');
  const opts = {
    host: cfg.host,
    port: parseInt(cfg.port || 587, 10),
    secure: !!cfg.secure,
  };
  if (cfg.user || cfg.password) {
    opts.auth = { user: cfg.user || '', pass: cfg.password || '' };
  }
  return nodemailer.createTransport(opts);
}

/**
 * Resolve a Grafana username to an email address via the lookup API.
 * Returns null when not found, when user is "Anonymous", or on error.
 */
async function resolveUserEmail(grafanaUrl, token, username) {
  if (!username || username.toLowerCase() === 'anonymous' || username === 'unknown') {
    return null;
  }
  try {
    const url = `${String(grafanaUrl).replace(/\/+$/, '')}/api/users/lookup?loginOrEmail=${encodeURIComponent(username)}`;
    const r = await axios.get(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 5000,
      validateStatus: () => true,
    });
    if (r.status === 200 && r.data && r.data.email) return r.data.email;
    return null;
  } catch (err) {
    logger.warn('email: user lookup failed', { username, error: err.message });
    return null;
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Compose the HTML body for a failure notification email.
 */
function buildFailureEmail({ test, dashboardTitle, dashboardUrl, screenshotUrl, runId, runDate }) {
  const status = test.status || 'FAIL';
  const statusColor = status === 'FAIL' ? '#ef4444' : '#eab308';
  const detail = test.detail || '';
  const panelTitle = test.metadata && test.metadata.panelTitle ? test.metadata.panelTitle : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>GrafanaProbe Alert</title></head>
<body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
    <div style="padding:20px 28px;background:linear-gradient(135deg,#6366f1,#a78bfa);color:#fff;">
      <div style="font-size:13px;opacity:0.85;margin-bottom:4px;">GrafanaProbe Alert</div>
      <div style="font-size:22px;font-weight:700;">${escapeHtml(status)}: ${escapeHtml(dashboardTitle || 'Dashboard')}</div>
    </div>
    <div style="padding:24px 28px;">
      <div style="display:inline-block;padding:4px 12px;border-radius:9999px;background:${statusColor}22;color:${statusColor};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:14px;">${escapeHtml(status)}</div>
      <h2 style="font-size:18px;margin:0 0 10px 0;color:#111827;">${escapeHtml(test.name || 'Test failure')}</h2>
      ${panelTitle ? `<div style="font-size:13px;color:#6b7280;margin-bottom:10px;">Panel: <strong>${escapeHtml(panelTitle)}</strong></div>` : ''}
      ${detail ? `<div style="padding:14px 16px;background:#fef2f2;border-left:3px solid ${statusColor};border-radius:6px;font-size:14px;color:#7f1d1d;margin-bottom:18px;">${escapeHtml(detail)}</div>` : ''}
      ${screenshotUrl ? `<div style="margin:18px 0;text-align:center;"><img src="${escapeHtml(screenshotUrl)}" alt="Failed panel screenshot" style="max-width:100%;border:1px solid #e5e7eb;border-radius:8px;" /></div>` : ''}
      ${dashboardUrl ? `<div style="margin-top:20px;"><a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;padding:10px 18px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Open in Grafana →</a></div>` : ''}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 16px;" />
      <div style="font-size:11px;color:#9ca3af;line-height:1.6;">
        Run ID: ${escapeHtml(runId || 'unknown')}<br/>
        Detected at: ${escapeHtml(runDate || new Date().toISOString())}<br/>
        Sent by GrafanaProbe v2 — your test results notifier
      </div>
    </div>
  </div>
</body>
</html>`;
}

async function sendFailureNotification({ test, dashboardTitle, dashboardUrl, screenshotUrl, runId, runDate, grafanaUrl, grafanaToken }) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new Error('Email notifications are disabled in Settings');
  if (!cfg.host) throw new Error('SMTP host not configured');
  if (!cfg.fromAddress) throw new Error('From address not configured');

  // Resolve recipients from the dashboard's createdBy/updatedBy via Grafana
  const md = (test.metadata && test.metadata.dashboardMeta) || test.metadata || {};
  const createdBy = md.createdBy || null;
  const updatedBy = md.updatedBy || null;

  const toEmails = new Set();
  if (createdBy) {
    const e = await resolveUserEmail(grafanaUrl || config.grafana.url, grafanaToken || config.grafana.token, createdBy);
    if (e) toEmails.add(e);
  }
  if (updatedBy && updatedBy !== createdBy) {
    const e = await resolveUserEmail(grafanaUrl || config.grafana.url, grafanaToken || config.grafana.token, updatedBy);
    if (e) toEmails.add(e);
  }

  // Default CC always receives the email
  const ccList = (cfg.defaultCc || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // If no resolved To recipients, fall back to using CC list as To so the
  // email actually goes somewhere
  let toFinal = [...toEmails];
  let ccFinal = ccList;
  if (toFinal.length === 0 && ccList.length > 0) {
    toFinal = ccList;
    ccFinal = [];
  }
  if (toFinal.length === 0) {
    throw new Error('No recipients: createdBy/updatedBy users have no email and no default CC configured');
  }

  const transporter = buildTransporter(cfg);
  const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.fromAddress}>` : cfg.fromAddress;
  const subject = `[GrafanaProbe] ${test.status || 'FAIL'}: ${dashboardTitle || 'Dashboard'}${test.metadata && test.metadata.panelTitle ? ' → ' + test.metadata.panelTitle : ''}`;
  const html = buildFailureEmail({ test, dashboardTitle, dashboardUrl, screenshotUrl, runId, runDate });

  const info = await transporter.sendMail({
    from,
    to: toFinal.join(', '),
    cc: ccFinal.length > 0 ? ccFinal.join(', ') : undefined,
    subject,
    html,
  });

  logger.info('email: failure notification sent', { messageId: info.messageId, to: toFinal, cc: ccFinal });
  return {
    ok: true,
    messageId: info.messageId,
    sentTo: toFinal,
    cc: ccFinal,
    resolvedFromCreatedBy: createdBy,
    resolvedFromUpdatedBy: updatedBy,
  };
}

async function sendTestEmail(toAddress) {
  const cfg = loadConfig();
  if (!cfg.host) throw new Error('SMTP host not configured');
  if (!cfg.fromAddress) throw new Error('From address not configured');

  const target = toAddress || cfg.fromAddress;
  const transporter = buildTransporter(cfg);
  const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.fromAddress}>` : cfg.fromAddress;

  const info = await transporter.sendMail({
    from,
    to: target,
    subject: '[GrafanaProbe] SMTP test email',
    html: `<p>This is a test email from GrafanaProbe.</p>
           <p>If you received this, your SMTP configuration is working correctly.</p>
           <p style="color:#6b7280;font-size:12px;">Sent at ${new Date().toISOString()}</p>`,
  });

  return { ok: true, messageId: info.messageId, sentTo: target };
}

module.exports = {
  loadConfig,
  saveConfig,
  getRedactedConfig,
  resolveUserEmail,
  sendFailureNotification,
  sendTestEmail,
};
