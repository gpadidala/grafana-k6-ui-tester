const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const requestLogger = require('./middleware/requestLogger');
const GrafanaClient = require('./services/grafanaClient');
const PlaywrightRunner = require('./playwright/runner');
const JMeterRunner = require('./jmeter/runner');
const DashboardSnapshotService = require('./services/snapshot');
const snapshotDiffEngine = require('./services/snapshotDiff');
const snapshotAI = require('./services/snapshotAI');
const snapshotStorage = require('./services/snapshotStorage');
const AIDynamicTestGenerator = require('./services/adtg');
const { ops, saveDb } = require('./db');
const crypto = require('crypto');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Initialize DB
require('./db').getDb();

const TestEngine = require('./services/testEngine');

// Seed Smart Suite templates on startup (idempotent)
async function seedSmartSuites() {
  try {
    const seedPath = path.join(__dirname, 'data/seed-suites.json');
    if (!fs.existsSync(seedPath)) return;
    const seeds = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
    for (const s of seeds) {
      await ops.insertSmartSuite(s.id, s.name, s.description, s.originalPrompt, JSON.stringify(s), JSON.stringify(s.tags || []), true);
    }
    logger.info(`Seeded ${seeds.length} Smart Suite templates`);
  } catch (err) {
    logger.warn('Smart Suite seeding skipped', { error: err.message });
  }
}
setTimeout(seedSmartSuites, 1000); // wait for DB to initialize

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(requestLogger);

// Serve frontend build
app.use(express.static(path.join(__dirname, '../../frontend/build')));

const engine = new TestEngine();

// ─── Health ───
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0', author: 'Gopal Rao', categories: engine.getCategories().length });
});

app.get('/api/config', (req, res) => {
  res.json({
    grafanaUrl: config.grafana.url,
    hasToken: !!config.grafana.token,
    orgId: config.grafana.orgId,
    retention: { maxRunsPerEnv: config.retention.maxRunsPerEnv },
  });
});

// ─── Test Connection ───
app.post('/api/test-connection', async (req, res) => {
  const { grafanaUrl, token } = req.body;
  const client = new GrafanaClient(grafanaUrl || config.grafana.url, token || config.grafana.token);
  const health = await client.getHealth();
  const user = await client.getCurrentUser();
  res.json(health.ok
    ? { ok: true, version: health.data?.version, database: health.data?.database, user: user.data?.login || 'anonymous', ms: health.ms }
    : { ok: false, error: health.error || `HTTP ${health.status}`, ms: health.ms }
  );
});

// ─── Categories ───
app.get('/api/tests/categories', (req, res) => { res.json(engine.getCategories()); });

// ─── Datasources (for the "Scope by Datasource" filter in Run Tests) ───
app.get('/api/datasources', async (req, res) => {
  try {
    const { grafanaUrl, token } = req.query;
    const url = (grafanaUrl && String(grafanaUrl).trim()) || config.grafana.url;
    const tok = (token && String(token).trim()) || config.grafana.token;
    const client = new GrafanaClient(url, tok);
    const r = await client.getDataSources();
    if (!r.ok) return res.status(r.status || 500).json({ error: r.error || 'Failed to fetch datasources' });
    // Return just the fields the UI needs
    const list = (Array.isArray(r.data) ? r.data : []).map((d) => ({
      uid: d.uid,
      name: d.name,
      type: d.type,
      url: d.url,
      isDefault: d.isDefault,
    }));
    res.json(list);
  } catch (err) {
    logger.error('list datasources failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Impact preview: which dashboards/alerts reference this datasource?
// Useful before scoped test runs ("show me the blast radius first").
app.get('/api/datasources/:uid/impact', async (req, res) => {
  try {
    const { grafanaUrl, token } = req.query;
    const url = (grafanaUrl && String(grafanaUrl).trim()) || config.grafana.url;
    const tok = (token && String(token).trim()) || config.grafana.token;
    const client = new GrafanaClient(url, tok);
    const { dashboardUsesDatasource, alertRuleUsesDatasource } = require('./tests/utils/dsFilter');

    // Resolve the datasource (accept uid or name)
    const dsList = await client.getDataSources();
    if (!dsList.ok) return res.status(500).json({ error: dsList.error || 'Failed to fetch datasources' });
    const target = (dsList.data || []).find((d) => d.uid === req.params.uid || d.name === req.params.uid);
    if (!target) return res.status(404).json({ error: 'Datasource not found' });

    const filter = { uid: target.uid, name: target.name };

    // Dashboard impact
    const search = await client.searchDashboards();
    const hits = (search.ok && Array.isArray(search.data)) ? search.data : [];
    const impactedDashboards = [];
    for (const hit of hits) {
      if (!hit.uid) continue;
      const dash = await client.getDashboardByUid(hit.uid);
      if (!dash.ok) continue;
      const model = dash.data?.dashboard || {};
      if (dashboardUsesDatasource(model, filter)) {
        impactedDashboards.push({
          uid: hit.uid,
          title: hit.title,
          folder: hit.folderTitle || '',
          panelCount: Array.isArray(model.panels) ? model.panels.length : 0,
        });
      }
    }

    // Alert rule impact
    const rulesRes = await client.getAlertRules();
    let allRules = [];
    if (rulesRes.ok) {
      if (Array.isArray(rulesRes.data)) allRules = rulesRes.data;
      else if (typeof rulesRes.data === 'object' && rulesRes.data) {
        for (const folder of Object.values(rulesRes.data)) {
          if (Array.isArray(folder)) {
            for (const group of folder) {
              if (Array.isArray(group.rules)) allRules.push(...group.rules);
            }
          }
        }
      }
    }
    const impactedAlerts = allRules
      .filter((r) => alertRuleUsesDatasource(r, filter))
      .map((r) => ({ uid: r.uid, title: r.title || r.alert || r.name || 'Unnamed' }));

    res.json({
      datasource: { uid: target.uid, name: target.name, type: target.type },
      dashboards: impactedDashboards,
      alerts: impactedAlerts,
      summary: {
        dashboardCount: impactedDashboards.length,
        alertCount: impactedAlerts.length,
      },
    });
  } catch (err) {
    logger.error('datasource impact failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── Run Tests ───
app.post('/api/tests/run', async (req, res) => {
  const { grafanaUrl, token, categories, strategy, mode, envKey, datasourceFilter } = req.body;
  const url = (grafanaUrl && grafanaUrl.trim()) || config.grafana.url;
  const tok = (token && token.trim()) || config.grafana.token;
  const cats = categories || engine.getCategories().map(c => c.id);

  const report = await engine.runCategories(cats, url, tok, (evt) => io.emit('test-progress', evt), { strategy, mode, envId: envKey || null, datasourceFilter });

  // Retention: keep only the N most-recent runs for this env
  try {
    const pruned = await ops.pruneOldRuns(envKey || null, config.retention.maxRunsPerEnv);
    if (pruned.length > 0) {
      logger.info(`Retention: pruned ${pruned.length} old run(s) for env=${envKey || '(none)'}`);
    }
  } catch (err) {
    logger.warn('Retention prune failed', { error: err.message });
  }

  res.json(report);
});

app.post('/api/tests/run-category/:id', async (req, res) => {
  const { grafanaUrl, token, envKey, datasourceFilter } = req.body;
  const url = (grafanaUrl && grafanaUrl.trim()) || config.grafana.url;
  const tok = (token && token.trim()) || config.grafana.token;
  const report = await engine.runCategories([req.params.id], url, tok, (evt) => io.emit('test-progress', evt), { envId: envKey || null, datasourceFilter });

  try {
    const pruned = await ops.pruneOldRuns(envKey || null, config.retention.maxRunsPerEnv);
    if (pruned.length > 0) logger.info(`Retention: pruned ${pruned.length} old run(s) for env=${envKey || '(none)'}`);
  } catch (err) {
    logger.warn('Retention prune failed', { error: err.message });
  }

  res.json(report);
});

// ─── Reports ───
app.get('/api/reports', async (req, res) => { res.json(await engine.getReports()); });
app.get('/api/reports/:file', async (req, res) => {
  const report = await engine.getReport(req.params.file);
  if (!report) return res.status(404).json({ error: 'Not found' });
  res.json(report);
});
app.delete('/api/reports/:id', async (req, res) => { await engine.deleteReport(req.params.id); res.json({ deleted: true }); });
app.delete('/api/reports', async (req, res) => { await engine.deleteAllReports(); res.json({ deleted: true }); });

// ─── Email notifications ───
const emailService = require('./services/email');

app.get('/api/email/config', (req, res) => {
  res.json(emailService.getRedactedConfig());
});

app.post('/api/email/config', (req, res) => {
  try {
    const saved = emailService.saveConfig(req.body || {});
    res.json({
      ok: true,
      // Return redacted form so the password doesn't bounce back to UI
      ...emailService.getRedactedConfig(),
    });
  } catch (err) {
    logger.error('email config save failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/email/test', async (req, res) => {
  try {
    const { to } = req.body || {};
    const result = await emailService.sendTestEmail(to);
    res.json(result);
  } catch (err) {
    logger.error('email test failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/email/notify-failure', async (req, res) => {
  try {
    const { test, dashboardTitle, dashboardUrl, screenshotUrl, runId, runDate, grafanaUrl, grafanaToken } = req.body || {};
    if (!test) return res.status(400).json({ error: 'test object is required' });
    const result = await emailService.sendFailureNotification({
      test, dashboardTitle, dashboardUrl, screenshotUrl, runId, runDate, grafanaUrl, grafanaToken,
    });
    res.json(result);
  } catch (err) {
    logger.error('email notify-failure failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── Test screenshots (gzipped PNGs from Playwright) ───
const screenshotStore = require('./services/screenshotStore');
app.get('/api/test-screenshots/:runId/:name', (req, res) => {
  const rel = `${req.params.runId}/${req.params.name}`;
  const buf = screenshotStore.readScreenshot(rel);
  if (!buf) return res.status(404).send('Screenshot not found');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(buf);
});

// ─── HTML Report ───
// Absolute reports dir resolved once at module load — don't trust the
// process cwd at request time (it can drift when started via a background
// shell that later exits).
const REPORTS_DIR = path.resolve(config.paths.reports);

// Renders the JSON report as a standalone HTML page on the fly. The JSON
// file is the source of truth; we never write a .html file to disk.
app.get('/api/reports/html/:file', (req, res) => {
  try {
    let jsonName = req.params.file;
    if (jsonName.endsWith('.html')) jsonName = jsonName.slice(0, -5) + '.json';
    else if (!jsonName.endsWith('.json')) jsonName += '.json';
    const jsonPath = path.join(REPORTS_DIR, jsonName);
    if (!fs.existsSync(jsonPath)) {
      logger.warn('HTML report: file not found', { requested: req.params.file, resolved: jsonPath });
      return res.status(404).send(`Report not found: ${jsonName}`);
    }
    const report = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderReportHtml(report));
  } catch (err) {
    logger.error('HTML report render failed', { error: err.message });
    res.status(500).send(`<pre>Report render error: ${err.message}</pre>`);
  }
});

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Build a live Grafana URL for a test result based on its category + uid.
// Used in HTML reports so users can click through to verify the warning/error
// on the real dashboard, datasource, etc.
function linkForResource(grafanaUrl, categoryId, uid, metadata) {
  if (!grafanaUrl || !uid) return null;
  const base = String(grafanaUrl).replace(/\/+$/, '');
  switch (categoryId) {
    case 'panels': {
      const pid = metadata && metadata.panelId;
      return pid ? `${base}/d/${uid}?viewPanel=${pid}` : `${base}/d/${uid}`;
    }
    case 'datasources':
      return `${base}/connections/datasources/edit/${uid}`;
    case 'folders':
      return `${base}/dashboards/f/${uid}`;
    case 'plugins':
    case 'app-plugins':
      return `${base}/plugins/${uid}`;
    case 'alerts':
    case 'alert-e2e':
      return `${base}/alerting/grafana/${uid}/view`;
    case 'dashboards':
    case 'annotations':
    default:
      return `${base}/d/${uid}`;
  }
}

function renderReportHtml(report) {
  const summary = report.summary || {};
  const categories = report.categories || [];
  const total = summary.total || 0;
  const passed = summary.passed || 0;
  const failed = summary.failed || 0;
  const warnings = summary.warnings || 0;
  const passRate = summary.pass_rate || '0%';
  const statusColor = report.status === 'passed' ? '#10b981' : '#ef4444';
  const startedAt = report.startedAt || '';
  const completedAt = report.completedAt || '';
  const durationMs = (completedAt && startedAt) ? (new Date(completedAt) - new Date(startedAt)) : 0;
  const durationSec = durationMs ? (durationMs / 1000).toFixed(1) : '—';

  const fmtDate = (iso) => {
    if (!iso || String(iso).startsWith('0001')) return '—';
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return iso; }
  };

  const thStyle = 'padding:8px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #1e293b;white-space:nowrap;';
  const thStyleRight = thStyle + 'text-align:right;';
  const thStyleCenter = thStyle + 'text-align:center;';

  const catRows = categories.map(cat => {
    const s = cat.summary || {};
    const catColor = cat.status === 'PASS' ? '#10b981' : cat.status === 'FAIL' ? '#ef4444' : '#eab308';

    // Skip "[title] Dashboard info" rows — the info is now displayed inline
    // on every test row via the Created/Last Updated columns, so the
    // separate banner row would be redundant noise.
    const filteredTests = (cat.tests || []).filter((t) => {
      const isInfoRow = (t.metadata && t.metadata.infoRow) || /\bDashboard info$/.test(t.name || '');
      return !isInfoRow;
    });

    const testRows = filteredTests.map(t => {
      const tColor = t.status === 'PASS' ? '#10b981' : t.status === 'FAIL' ? '#ef4444' : '#eab308';
      const isIssue = t.status === 'WARN' || t.status === 'FAIL';

      // Always build a Grafana link when the test has a uid and a linkable
      // category — not just for FAIL/WARN. User wants every dashboard test
      // to be clickable so they can jump to the live dashboard regardless
      // of whether it passed.
      const link = linkForResource(report.grafanaUrl, cat.id, t.uid, t.metadata);

      const nameCell = link
        ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" style="color:${isIssue ? '#818cf8' : '#a5b4fc'};text-decoration:none;font-weight:${isIssue ? 600 : 500};">${escapeHtml(t.name)} <span style="font-size:10px;opacity:0.7;">↗</span></a>`
        : `<span style="color:#e2e8f0;">${escapeHtml(t.name)}</span>`;

      // Screenshot thumbnail (gzipped PNG persisted by Playwright spec)
      const shotPath = t.metadata && t.metadata.screenshot;
      const shotCell = shotPath
        ? `<div style="margin-top:6px;"><a href="/api/test-screenshots/${escapeHtml(shotPath)}" target="_blank" rel="noopener noreferrer" title="Click to view full screenshot"><img src="/api/test-screenshots/${escapeHtml(shotPath)}" style="max-width:200px;max-height:120px;border:1px solid #334155;border-radius:6px;display:block;" loading="lazy" alt="Panel screenshot" /></a></div>`
        : '';

      // Dashboard metadata pulled from the test's metadata.dashboardMeta
      // (attached by the Playwright dashboard-load spec) or from the
      // metadata object itself (attached by the K6 dashboards runner).
      const dm = (t.metadata && t.metadata.dashboardMeta) || t.metadata || {};
      const createdBy = dm.createdBy || '';
      const updatedBy = dm.updatedBy || '';
      const createdAt = dm.created || null;
      const updatedAt = dm.updated || null;
      const createdCell = createdBy
        ? `<div style="font-size:12px;color:#cbd5e1;font-weight:500;">${escapeHtml(createdBy)}</div><div style="font-size:10px;color:#64748b;">${escapeHtml(fmtDate(createdAt))}</div>`
        : '<span style="color:#475569;font-size:12px;">—</span>';
      const updatedCell = updatedBy
        ? `<div style="font-size:12px;color:#cbd5e1;font-weight:500;">${escapeHtml(updatedBy)}</div><div style="font-size:10px;color:#64748b;">${escapeHtml(fmtDate(updatedAt))}</div>`
        : '<span style="color:#475569;font-size:12px;">—</span>';

      // Email-notify button: any FAIL/WARN row with a dashboardMeta
      // (i.e. we know who to email). Rendered in its own dedicated column.
      const canEmail = isIssue && t.metadata && t.metadata.dashboardMeta;
      const emailCell = canEmail
        ? `<button class="gp-email-btn" data-test='${escapeHtml(JSON.stringify({
            name: t.name,
            status: t.status,
            detail: t.detail,
            uid: t.uid,
            url: link || (report.grafanaUrl && t.uid ? `${String(report.grafanaUrl).replace(/\/+$/, '')}/d/${t.uid}` : ''),
            metadata: t.metadata,
          }))}' data-grafana-url="${escapeHtml(report.grafanaUrl || '')}" data-run-id="${escapeHtml(report.id || '')}" data-screenshot="${escapeHtml(shotPath || '')}" title="Email this failure to the dashboard's createdBy/updatedBy + default CC" style="padding:4px 10px;border-radius:6px;border:1px solid #6366f1;background:rgba(99,102,241,0.1);color:#a5b4fc;font-size:12px;cursor:pointer;font-family:inherit;">📧</button>`
        : '<span style="color:#475569;font-size:11px;">—</span>';

      const tdBase = 'padding:8px 12px;border-bottom:1px solid #1e293b;vertical-align:top;';

      return `
        <tr>
          <td style="${tdBase}font-size:13px;">${nameCell}</td>
          <td style="${tdBase}"><span style="color:${tColor};font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(t.status)}</span></td>
          <td style="${tdBase}color:#94a3b8;font-size:12px;max-width:360px;">${escapeHtml(t.detail || '')}${shotCell}</td>
          <td style="${tdBase}">${createdCell}</td>
          <td style="${tdBase}">${updatedCell}</td>
          <td style="${tdBase}text-align:center;">${emailCell}</td>
          <td style="${tdBase}color:#64748b;font-size:11px;text-align:right;white-space:nowrap;">${t.ms || 0}ms</td>
        </tr>`;
    }).join('');
    return `
      <details style="margin-bottom:14px;background:#111827;border:1px solid #1e293b;border-radius:10px;overflow:hidden;">
        <summary style="padding:14px 18px;cursor:pointer;display:flex;align-items:center;gap:12px;list-style:none;">
          <span style="font-size:18px;">${escapeHtml(cat.icon || '📦')}</span>
          <span style="font-weight:600;font-size:15px;color:#f1f5f9;flex:1;">${escapeHtml(cat.name)}</span>
          <span style="font-size:12px;color:#94a3b8;">${s.passed || 0}/${s.total || 0} passed</span>
          <span style="padding:3px 10px;border-radius:9999px;background:${catColor}22;color:${catColor};font-size:11px;font-weight:700;">${escapeHtml(cat.status)}</span>
        </summary>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;min-width:900px;">
            <thead>
              <tr style="background:#0f172a;">
                <th style="${thStyle}">Test</th>
                <th style="${thStyle}">Status</th>
                <th style="${thStyle}">Detail</th>
                <th style="${thStyle}">👤 Created</th>
                <th style="${thStyle}">✏️ Last Updated</th>
                <th style="${thStyleCenter}">📧 Email</th>
                <th style="${thStyleRight}">ms</th>
              </tr>
            </thead>
            <tbody>${testRows}</tbody>
          </table>
        </div>
      </details>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Heimdall Report — ${escapeHtml(report.id || '')}</title>
<style>
  body { margin: 0; padding: 40px 24px; background: #030712; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .container { max-width: 1100px; margin: 0 auto; }
  .header { margin-bottom: 32px; }
  .brand { font-size: 32px; font-weight: 800; background: linear-gradient(135deg, #6366f1, #a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; margin: 0 0 6px 0; }
  .subtitle { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; margin-bottom: 32px; }
  .stat { background: #111827; border: 1px solid #1e293b; border-radius: 10px; padding: 18px 20px; }
  .stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 700; }
  .stat-value { font-size: 28px; font-weight: 800; color: #f1f5f9; margin-top: 6px; }
  .stat-value.pass { color: #10b981; }
  .stat-value.fail { color: #ef4444; }
  .stat-value.warn { color: #eab308; }
  .meta { background: #111827; border: 1px solid #1e293b; border-radius: 10px; padding: 16px 20px; margin-bottom: 28px; font-size: 13px; color: #94a3b8; }
  .meta strong { color: #e2e8f0; }
  .status-banner { display: inline-block; padding: 4px 14px; border-radius: 9999px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; background: ${statusColor}22; color: ${statusColor}; }
  h2 { font-size: 20px; color: #f1f5f9; margin: 32px 0 16px 0; }
  details[open] > summary { border-bottom: 1px solid #1e293b; }
  summary::-webkit-details-marker { display: none; }
  .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #1e293b; color: #64748b; font-size: 12px; text-align: center; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1 class="brand">Heimdall Report</h1>
    <div class="subtitle">Run ID: ${escapeHtml(report.id || '')} · <span class="status-banner">${escapeHtml(report.status || 'unknown')}</span></div>
  </div>

  <div class="meta">
    <strong>Grafana:</strong> ${escapeHtml(report.grafanaUrl || '')} &nbsp;·&nbsp;
    <strong>Version:</strong> ${escapeHtml(report.grafanaVersion || 'unknown')} &nbsp;·&nbsp;
    <strong>Started:</strong> ${escapeHtml(startedAt)} &nbsp;·&nbsp;
    <strong>Duration:</strong> ${durationSec}s
  </div>

  <div class="stats">
    <div class="stat"><div class="stat-label">Total Tests</div><div class="stat-value">${total}</div></div>
    <div class="stat"><div class="stat-label">Passed</div><div class="stat-value pass">${passed}</div></div>
    <div class="stat"><div class="stat-label">Failed</div><div class="stat-value fail">${failed}</div></div>
    <div class="stat"><div class="stat-label">Warnings</div><div class="stat-value warn">${warnings}</div></div>
    <div class="stat"><div class="stat-label">Pass Rate</div><div class="stat-value">${escapeHtml(passRate)}</div></div>
  </div>

  <h2>Categories</h2>
  ${catRows || '<div style="color:#64748b;font-size:13px;">No categories in this run.</div>'}

  <div class="footer">Generated by Heimdall v3 · by Gopal Rao</div>
</div>

<script>
  // Email-notify button handler. Works against the same backend that
  // served this report — read the host from window.location so the
  // report works whether opened directly from the API or from the React UI.
  document.addEventListener('click', async function(ev) {
    const btn = ev.target.closest('.gp-email-btn');
    if (!btn) return;
    ev.preventDefault();
    if (btn.disabled) return;
    const original = btn.innerText;
    btn.disabled = true;
    btn.innerText = '⏳';
    try {
      const test = JSON.parse(btn.getAttribute('data-test') || '{}');
      const grafanaUrl = btn.getAttribute('data-grafana-url') || '';
      const runId = btn.getAttribute('data-run-id') || '';
      const shot = btn.getAttribute('data-screenshot') || '';
      const apiBase = window.location.origin;
      const screenshotUrl = shot ? apiBase + '/api/test-screenshots/' + shot : '';
      const dashboardTitle = (test.metadata && test.metadata.dashboardTitle) || (test.name || '').replace(/^\\[/, '').replace(/\\].*/, '');
      const r = await fetch(apiBase + '/api/email/notify-failure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          test, dashboardTitle,
          dashboardUrl: test.url || '',
          screenshotUrl,
          runId,
          runDate: new Date().toISOString(),
          grafanaUrl,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed');
      btn.innerText = '✅ Sent';
      btn.style.background = 'rgba(16,185,129,0.15)';
      btn.style.borderColor = '#10b981';
      btn.style.color = '#34d399';
      setTimeout(function() {
        btn.innerText = original;
        btn.style.background = 'rgba(99,102,241,0.1)';
        btn.style.borderColor = '#6366f1';
        btn.style.color = '#a5b4fc';
        btn.disabled = false;
      }, 2500);
    } catch (e) {
      btn.innerText = '❌ ' + (e.message || 'Failed').slice(0, 40);
      btn.style.background = 'rgba(239,68,68,0.15)';
      btn.style.borderColor = '#ef4444';
      btn.style.color = '#fca5a5';
      setTimeout(function() {
        btn.innerText = original;
        btn.style.background = 'rgba(99,102,241,0.1)';
        btn.style.borderColor = '#6366f1';
        btn.style.color = '#a5b4fc';
        btn.disabled = false;
      }, 4000);
    }
  });
</script>
</body>
</html>`;
}

// ─── Playwright E2E ───
app.get('/api/playwright/suites', (req, res) => {
  const pw = new PlaywrightRunner();
  res.json(pw.getSuites());
});

app.post('/api/playwright/run', async (req, res) => {
  const { grafanaUrl, token, suites, datasourceFilter } = req.body;
  const url = (grafanaUrl && grafanaUrl.trim()) || config.grafana.url;
  const tok = (token && token.trim()) || config.grafana.token;
  const pw = new PlaywrightRunner(url, tok);

  try {
    const ret = await pw.runSuites(
      suites || pw.getSuites().map(s => s.id),
      (evt) => io.emit('pw-progress', evt),
      { datasourceFilter },
    );

    const suiteList = ret.results || [];
    const allTests = suiteList.flatMap(s => s.tests || []);
    const summary = {
      total: allTests.length,
      passed: allTests.filter(t => t.status === 'PASS').length,
      failed: allTests.filter(t => t.status === 'FAIL').length,
      warnings: allTests.filter(t => t.status === 'WARN').length,
    };
    summary.pass_rate = summary.total > 0 ? `${((summary.passed / summary.total) * 100).toFixed(1)}%` : '0%';

    res.json({
      status: summary.failed > 0 ? 'failed' : 'passed',
      summary,
      suites: suiteList,
      runId: ret.runId,
      reportFile: ret.reportFile,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await pw.close();
  }
});

// ─── ADTG (AI Dynamic Test Generator) ───
function getAdtg(grafanaUrl, token, llmConfig) {
  const url = (grafanaUrl && grafanaUrl.trim()) || config.grafana.url;
  const tok = (token && token.trim()) || config.grafana.token;
  // Accept per-request LLM overrides from the frontend (Settings page saves
  // these in localStorage and sends them on every ADTG call).
  const llmOpts = llmConfig && llmConfig.apiKey
    ? {
        provider: (llmConfig.provider || '').toLowerCase() === 'claude' ? 'claude' : 'openai',
        apiKey: llmConfig.apiKey,
        model: llmConfig.model || undefined,
      }
    : {};
  return new AIDynamicTestGenerator(url, tok, { llmOpts });
}

// Status: GET for backward compat (env-var only), POST for per-request check
// with the client's Settings-page LLM config
app.get('/api/adtg/status', (req, res) => {
  const adtg = getAdtg();
  res.json({
    llmConfigured: adtg.isLLMConfigured(),
    provider: process.env.LLM_PROVIDER || 'openai',
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
  });
});

app.post('/api/adtg/status', (req, res) => {
  const { llmConfig } = req.body || {};
  const adtg = getAdtg(null, null, llmConfig);
  res.json({
    llmConfigured: adtg.isLLMConfigured(),
    provider: (llmConfig && llmConfig.provider) || process.env.LLM_PROVIDER || 'openai',
    model: (llmConfig && llmConfig.model) || process.env.LLM_MODEL || 'gpt-4o-mini',
  });
});

// Generate plan from prompt (parse + generate in one call)
app.post('/api/adtg/generate', async (req, res) => {
  try {
    const { prompt, grafanaUrl, token, llmConfig } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt is required' });
    }
    const adtg = getAdtg(grafanaUrl, token, llmConfig);
    if (!adtg.isLLMConfigured()) {
      return res.status(400).json({ error: 'LLM not configured. Set LLM provider + API key in Settings, or LLM_API_KEY in backend/.env' });
    }
    const intent = await adtg.parseIntent(prompt, { version: 'unknown', orgId: 1 });
    const plan = await adtg.generatePlan(intent);
    const validation = adtg.validatePlan(plan);
    res.json({ plan, validation });
  } catch (err) {
    logger.error('ADTG generate failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Refine plan via chat
app.post('/api/adtg/refine', async (req, res) => {
  try {
    const { currentPlan, userMessage, grafanaUrl, token, llmConfig } = req.body;
    if (!currentPlan || !userMessage) {
      return res.status(400).json({ error: 'currentPlan and userMessage required' });
    }
    const adtg = getAdtg(grafanaUrl, token, llmConfig);
    const intent = await adtg.parseIntent(currentPlan.originalPrompt || '', currentPlan.grafanaContext || {});
    const plan = await adtg.generatePlan(intent, { currentPlan, userMessage });
    const validation = adtg.validatePlan(plan);
    res.json({ plan, validation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Validate a (possibly user-edited) plan
app.post('/api/adtg/validate', (req, res) => {
  try {
    const { plan, allowWrites, grafanaUrl, token, llmConfig } = req.body;
    const adtg = getAdtg(grafanaUrl, token, llmConfig);
    const validation = adtg.validatePlan(plan, { allowWrites });
    res.json(validation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Execute plan (synchronous + WebSocket)
app.post('/api/adtg/execute', async (req, res) => {
  try {
    const { plan, allowWrites, grafanaUrl, token, llmConfig } = req.body;
    const adtg = getAdtg(grafanaUrl, token, llmConfig);
    const result = await adtg.executePlan(plan, (evt) => io.emit(evt.type, evt), { allowWrites });
    // Save run to DB
    try {
      await ops.insertSmartSuiteRun(
        result.summary.runId,
        plan.suiteId || null,
        result.summary.startedAt,
        result.summary.completedAt,
        result.summary.status,
        JSON.stringify(result.summary),
        JSON.stringify(result.results),
        null
      );
    } catch (e) { logger.warn('Save run failed', { error: e.message }); }

    // AI explanation (best-effort, non-blocking on failure)
    let explanation = null;
    try {
      explanation = await adtg.explainResults(result);
    } catch (e) { logger.warn('explainResults failed', { error: e.message }); }

    res.json({ ...result, explanation });
  } catch (err) {
    logger.error('ADTG execute failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Smart Suites CRUD
app.get('/api/adtg/suites', async (req, res) => {
  try {
    const suites = await ops.listSmartSuites();
    const parsed = suites.map(s => ({
      ...s,
      tags: s.tags ? JSON.parse(s.tags) : [],
      plan: s.plan_json ? JSON.parse(s.plan_json) : null,
      isTemplate: !!s.is_template,
    }));
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/adtg/suites/:id', async (req, res) => {
  try {
    const s = await ops.getSmartSuite(req.params.id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    res.json({
      ...s,
      tags: s.tags ? JSON.parse(s.tags) : [],
      plan: s.plan_json ? JSON.parse(s.plan_json) : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/adtg/suites', async (req, res) => {
  try {
    const { name, description, plan, tags } = req.body;
    if (!name || !plan) return res.status(400).json({ error: 'name and plan required' });
    const id = plan.suiteId || uuidv4();
    await ops.insertSmartSuite(id, name, description || '', plan.originalPrompt || '', JSON.stringify(plan), JSON.stringify(tags || []), false);
    res.json({ id, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/adtg/suites/:id', async (req, res) => {
  try {
    await ops.deleteSmartSuite(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── JMeter Performance ───
app.get('/api/jmeter/plans', (req, res) => { res.json(new JMeterRunner().getPlans()); });
app.get('/api/jmeter/suites', (req, res) => { res.json(new JMeterRunner().getSuites()); });

app.post('/api/jmeter/run', async (req, res) => {
  const { grafanaUrl, token, plans, suite, threads, duration } = req.body;
  const url = (grafanaUrl && grafanaUrl.trim()) || config.grafana.url;
  const tok = (token && token.trim()) || config.grafana.token;
  const jm = new JMeterRunner(url, tok);
  const planIds = suite ? (SUITES || {})[suite] || plans : plans || jm.getPlans().map(p => p.id);

  try {
    const result = await jm.runPlans(planIds, { threads: threads || 20, duration: duration || 30 }, (evt) => io.emit('jm-progress', evt));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Screenshots ───
app.use('/screenshots', express.static(path.resolve(config.paths.screenshots)));

// ─── Socket.IO ───
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  socket.on('run-tests', async (data) => {
    const { grafanaUrl, token, categories, envKey, datasourceFilter } = data || {};
    const url = (grafanaUrl && grafanaUrl.trim()) || config.grafana.url;
    const tok = (token && token.trim()) || config.grafana.token;
    const cats = categories || engine.getCategories().map(c => c.id);

    const report = await engine.runCategories(cats, url, tok, (evt) => socket.emit('test-progress', evt), { envId: envKey || null, datasourceFilter });

    try {
      const pruned = await ops.pruneOldRuns(envKey || null, config.retention.maxRunsPerEnv);
      if (pruned.length > 0) logger.info(`Retention: pruned ${pruned.length} old run(s) for env=${envKey || '(none)'}`);
    } catch (err) {
      logger.warn('Retention prune failed', { error: err.message });
    }

    socket.emit('test-complete', report);
  });

  socket.on('run-jmeter', async (data) => {
    const { grafanaUrl, token, plans, threads, duration, datasourceFilter } = data || {};
    const url = (grafanaUrl && grafanaUrl.trim()) || config.grafana.url;
    const tok = (token && token.trim()) || config.grafana.token;
    const jm = new JMeterRunner(url, tok);
    try {
      const result = await jm.runPlans(
        plans || jm.getPlans().map(p => p.id),
        { threads: threads || 20, duration: duration || 30, datasourceFilter },
        (evt) => socket.emit('jm-progress', evt),
      );
      socket.emit('jm-complete', result);
    } catch (e) {
      socket.emit('jm-complete', { status: 'failed', error: e.message });
    }
  });

  socket.on('run-playwright', async (data) => {
    const { grafanaUrl, token, suites, datasourceFilter } = data || {};
    const url = (grafanaUrl && grafanaUrl.trim()) || config.grafana.url;
    const tok = (token && token.trim()) || config.grafana.token;
    const pw = new PlaywrightRunner(url, tok);
    try {
      const ret = await pw.runSuites(
        suites || pw.getSuites().map(s => s.id),
        (evt) => socket.emit('pw-progress', evt),
        { datasourceFilter },
      );
      // runSuites now returns { runId, reportFile, results, report }
      const suiteList = ret.results || [];
      const allTests = suiteList.flatMap(s => s.tests || []);
      const summary = {
        total: allTests.length,
        passed: allTests.filter(t => t.status === 'PASS').length,
        failed: allTests.filter(t => t.status === 'FAIL').length,
        warnings: allTests.filter(t => t.status === 'WARN').length,
      };
      summary.pass_rate = summary.total > 0 ? `${((summary.passed / summary.total) * 100).toFixed(1)}%` : '0%';
      socket.emit('pw-complete', {
        status: summary.failed > 0 ? 'failed' : 'passed',
        summary,
        suites: suiteList,
        runId: ret.runId,
        reportFile: ret.reportFile,
      });
    } catch (e) {
      socket.emit('pw-complete', { status: 'failed', error: e.message, suites: [] });
    } finally {
      await pw.close();
    }
  });

  socket.on('disconnect', () => logger.info(`Client disconnected: ${socket.id}`));
});

// ─── DSUD: Dashboard Snapshot & Upgrade Diff ───
app.post('/api/snapshots', async (req, res) => {
  try {
    const { name, notes, grafanaUrl, token } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const svc = new DashboardSnapshotService(
      grafanaUrl || config.grafana.url,
      token || config.grafana.token
    );
    const result = await svc.createSnapshot(name, {
      notes,
      createdBy: req.body.createdBy || 'system',
      onProgress: (evt) => io.emit('snapshot:progress', evt),
    });
    res.json(result);
  } catch (err) {
    logger.error('Snapshot create failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/snapshots', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '100', 10);
    res.json(await ops.listSnapshots(limit));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// IMPORTANT: static-path routes (diff, auto-detect-baseline, storage-info)
// must come BEFORE /api/snapshots/:id. Express matches in registration
// order, so a generic /:id would otherwise swallow them all with
// id = "diff" / "auto-detect-baseline" / "storage-info" → 404.

// Storage info for the Storage tab on the Snapshots page
app.get('/api/snapshots/storage-info', async (req, res) => {
  try {
    const baseDir = snapshotStorage.getSnapshotBaseDir();
    const totalBytes = fs.existsSync(baseDir) ? snapshotStorage.getDirSize(baseDir) : 0;
    const all = await ops.listSnapshots(1000);
    res.json({
      baseDir,
      totalBytes,
      snapshotCount: all.length,
      avgBytesPerSnapshot: all.length > 0 ? Math.round(totalBytes / all.length) : 0,
    });
  } catch (err) {
    logger.error('storage-info failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/snapshots/auto-detect-baseline', async (req, res) => {
  try {
    const { currentId } = req.query;
    if (!currentId) return res.status(400).json({ error: 'currentId required' });
    const svc = new DashboardSnapshotService();
    const baseline = await svc.autoDetectBaseline(currentId);
    res.json(baseline || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Diffs (static paths — must come before /:id)
app.post('/api/snapshots/diff', async (req, res) => {
  try {
    const { baselineId, currentId } = req.body;
    if (!baselineId || !currentId) return res.status(400).json({ error: 'baselineId and currentId required' });
    const baselineRow = await ops.getSnapshot(baselineId);
    const currentRow = await ops.getSnapshot(currentId);
    if (!baselineRow || !currentRow) return res.status(404).json({ error: 'Snapshot not found' });
    const baseline = {
      ...baselineRow,
      dashboards: await ops.listSnapshotDashboards(baselineId),
      alerts: await ops.listSnapshotAlerts(baselineId),
    };
    const current = {
      ...currentRow,
      dashboards: await ops.listSnapshotDashboards(currentId),
      alerts: await ops.listSnapshotAlerts(currentId),
    };

    const loadDashFn = (storagePath, uid) => snapshotStorage.readDashboard(storagePath, uid);
    const context = {
      grafanaVersionFrom: baseline.grafana_version,
      grafanaVersionTo: current.grafana_version,
    };

    const diffResult = await snapshotDiffEngine.diffSnapshots(baseline, current, loadDashFn, {
      context,
      onProgress: (evt) => io.emit('diff:progress', evt),
    });

    const diffId = crypto.randomUUID();
    const { summary, items } = diffResult;
    await ops.insertDiff(
      diffId, baselineId, currentId,
      JSON.stringify(summary),
      summary.total || 0,
      summary.critical || 0,
      summary.high || 0,
      summary.medium || 0,
      summary.low || 0,
      summary.info || 0
    );
    // Sanitize values before passing to sql.js — JSON.stringify(undefined)
    // returns the JS undefined (not a string), which sql.js rejects. Convert
    // undefined to null before stringifying so ADDED/REMOVED items (which
    // only have one side of the before/after pair) can be persisted.
    const jsonOrNull = (v) => (v === undefined ? null : JSON.stringify(v));
    for (const item of items) {
      const itemId = crypto.randomUUID();
      await ops.insertDiffItem(
        itemId, diffId,
        item.dashboardUid || null,
        item.dashboardTitle || null,
        item.panelId === undefined ? null : item.panelId,
        item.panelTitle || null,
        item.path || '',
        item.changeType || 'UNKNOWN',
        item.riskLevel || 'info',
        jsonOrNull(item.before),
        jsonOrNull(item.after),
        null, null
      );
    }
    await saveDb();
    res.json({ diffId, summary, itemCount: items.length });
  } catch (err) {
    logger.error('Diff create failed', { error: err.message || String(err), stack: err.stack });
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
});

app.get('/api/snapshots/diff', async (req, res) => {
  try { res.json(await ops.listDiffs(parseInt(req.query.limit || '50', 10))); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/snapshots/diff/:id', async (req, res) => {
  try {
    const diff = await ops.getDiff(req.params.id);
    if (!diff) return res.status(404).json({ error: 'Not found' });
    const items = await ops.listDiffItems(req.params.id, req.query);
    res.json({ ...diff, summary: diff.summary_json ? JSON.parse(diff.summary_json) : {}, items });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/snapshots/diff/:id/items/:itemId/ack', async (req, res) => {
  try {
    await ops.acknowledgeDiffItem(req.params.itemId);
    saveDb();
    res.json({ acknowledged: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/snapshots/diff/:id/ai-analyze', async (req, res) => {
  try {
    if (!snapshotAI.isEnabled()) return res.status(400).json({ error: 'LLM_API_KEY not configured' });
    const diff = await ops.getDiff(req.params.id);
    if (!diff) return res.status(404).json({ error: 'Not found' });
    const items = await ops.listDiffItems(req.params.id);
    const nonCosmetic = items.filter(i => i.change_type !== 'COSMETIC' && i.change_type !== 'SCHEMA_MIGRATION');
    const explanations = await snapshotAI.explainChanges(nonCosmetic.map(i => ({
      grafanaVersionFrom: '', grafanaVersionTo: '',
      dashboardTitle: i.dashboard_title, panelTitle: i.panel_title,
      changeType: i.change_type, riskLevel: i.risk_level, path: i.path,
      before: i.before_value, after: i.after_value,
    })));
    for (let i = 0; i < nonCosmetic.length; i++) {
      const expl = explanations[i];
      if (expl) await ops.updateDiffItemAI(nonCosmetic[i].id, expl.explanation, expl.recommendation);
    }
    await saveDb();
    res.json({ analyzed: nonCosmetic.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Parametrized /:id routes MUST come LAST — otherwise they swallow
// static paths like /diff, /storage-info, /auto-detect-baseline.
app.get('/api/snapshots/:id', async (req, res) => {
  try {
    const snap = await ops.getSnapshot(req.params.id);
    if (!snap) return res.status(404).json({ error: 'Not found' });
    const dashboards = await ops.listSnapshotDashboards(req.params.id);
    const alerts = await ops.listSnapshotAlerts(req.params.id);
    res.json({ ...snap, dashboards, alerts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/snapshots/:id', async (req, res) => {
  try {
    const svc = new DashboardSnapshotService();
    await svc.deleteSnapshot(req.params.id);
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/snapshots/:id/dashboards/:uid', async (req, res) => {
  try {
    const svc = new DashboardSnapshotService();
    const dash = await svc.loadDashboardFromSnapshot(req.params.id, req.params.uid);
    res.json(dash);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Stream the snapshot dir as a zip download.
// NOTE: this is a parametrized route, but because the first segment
// after /api/snapshots/ is the :id (a uuid, never a reserved word like
// "diff"/"storage-info"), and because the route ends with "/export"
// (a second segment), Express won't confuse it with the /:id handler.
app.get('/api/snapshots/:id/export', async (req, res) => {
  try {
    const snap = await ops.getSnapshot(req.params.id);
    if (!snap) return res.status(404).json({ error: 'Snapshot not found' });
    if (!snap.storage_path || !fs.existsSync(snap.storage_path)) {
      return res.status(404).json({ error: 'Snapshot storage dir missing' });
    }

    const safeName = String(snap.name || snap.id).replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `heimdall-snapshot-${safeName}-${snap.id.slice(0, 8)}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Stream the zip straight to the response — no temp file on disk
    const archiver = require('archiver');
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('warning', (err) => logger.warn('zip export warning', { error: err.message }));
    archive.on('error', (err) => {
      logger.error('zip export failed', { error: err.message, id: req.params.id });
      if (!res.headersSent) res.status(500).json({ error: err.message });
      else res.end();
    });

    archive.pipe(res);
    archive.directory(snap.storage_path, false);
    await archive.finalize();
  } catch (err) {
    logger.error('Snapshot export failed', { error: err.message });
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.post('/api/snapshots/:id/restore', async (req, res) => {
  try {
    const { dashboardUid, allowWrites, confirmation } = req.body;
    if (!allowWrites) return res.status(403).json({ error: 'Write operations disabled. Set allowWrites:true' });
    if (!confirmation || confirmation !== `RESTORE ${dashboardUid}`) {
      return res.status(403).json({ error: `Confirmation required. Pass confirmation:"RESTORE ${dashboardUid}"` });
    }
    const svc = new DashboardSnapshotService();
    const result = await svc.restoreDashboard(req.params.id, dashboardUid, { allowWrites: true });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── SPA Fallback ───
app.get('*', (req, res) => {
  const index = path.join(__dirname, '../../frontend/build/index.html');
  if (require('fs').existsSync(index)) res.sendFile(index);
  else res.json({ message: 'Heimdall API v2.0 — Frontend not built. Run: cd frontend && npm run build' });
});

app.use(errorHandler);

// ─── Start ───
server.listen(config.server.port, () => {
  logger.info(`
╔══════════════════════════════════════════════════╗
║   Heimdall v3.0 — Watchman of Observability  ║
║              by Gopal Rao                          ║
╠══════════════════════════════════════════════════╣
║  API:      http://localhost:${config.server.port}                  ║
║  Grafana:  ${config.grafana.url.padEnd(38)}║
║  Auth:     ${config.grafana.token ? 'Token configured' : 'No token'}${''.padEnd(config.grafana.token ? 23 : 28)}║
║  Categories: ${engine.getCategories().length} test categories               ║
╚══════════════════════════════════════════════════╝
  `);
});

module.exports = { app, server, io };
