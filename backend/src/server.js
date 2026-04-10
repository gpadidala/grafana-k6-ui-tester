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
const { ops, saveDb } = require('./db');
const crypto = require('crypto');

// Initialize DB
require('./db').getDb();

const TestEngine = require('./services/testEngine');

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
  res.json({ grafanaUrl: config.grafana.url, hasToken: !!config.grafana.token, orgId: config.grafana.orgId });
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

// ─── Run Tests ───
app.post('/api/tests/run', async (req, res) => {
  const { grafanaUrl, token, categories, strategy, mode } = req.body;
  const url = (grafanaUrl && grafanaUrl.trim()) || config.grafana.url;
  const tok = (token && token.trim()) || config.grafana.token;
  const cats = categories || engine.getCategories().map(c => c.id);

  const report = await engine.runCategories(cats, url, tok, (evt) => io.emit('test-progress', evt), { strategy, mode });
  res.json(report);
});

app.post('/api/tests/run-category/:id', async (req, res) => {
  const { grafanaUrl, token } = req.body;
  const url = (grafanaUrl && grafanaUrl.trim()) || config.grafana.url;
  const tok = (token && token.trim()) || config.grafana.token;
  const report = await engine.runCategories([req.params.id], url, tok, (evt) => io.emit('test-progress', evt));
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

// ─── HTML Report ───
app.get('/api/reports/html/:file', (req, res) => {
  const fp = path.join(config.paths.reports, req.params.file);
  if (!require('fs').existsSync(fp)) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'text/html');
  res.sendFile(path.resolve(fp));
});

// ─── Playwright E2E ───
app.get('/api/playwright/suites', (req, res) => {
  const pw = new PlaywrightRunner();
  res.json(pw.getSuites());
});

app.post('/api/playwright/run', async (req, res) => {
  const { grafanaUrl, token, suites } = req.body;
  const url = (grafanaUrl && grafanaUrl.trim()) || config.grafana.url;
  const tok = (token && token.trim()) || config.grafana.token;
  const pw = new PlaywrightRunner(url, tok);

  try {
    const results = await pw.runSuites(
      suites || pw.getSuites().map(s => s.id),
      (evt) => io.emit('pw-progress', evt)
    );

    const allTests = results.flatMap(s => s.tests || []);
    const summary = {
      total: allTests.length,
      passed: allTests.filter(t => t.status === 'PASS').length,
      failed: allTests.filter(t => t.status === 'FAIL').length,
      warnings: allTests.filter(t => t.status === 'WARN').length,
    };
    summary.pass_rate = summary.total > 0 ? `${((summary.passed / summary.total) * 100).toFixed(1)}%` : '0%';

    res.json({ status: summary.failed > 0 ? 'failed' : 'passed', summary, suites: results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await pw.close();
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
    const { grafanaUrl, token, categories } = data || {};
    const url = (grafanaUrl && grafanaUrl.trim()) || config.grafana.url;
    const tok = (token && token.trim()) || config.grafana.token;
    const cats = categories || engine.getCategories().map(c => c.id);

    const report = await engine.runCategories(cats, url, tok, (evt) => socket.emit('test-progress', evt));
    socket.emit('test-complete', report);
  });

  socket.on('run-jmeter', async (data) => {
    const { grafanaUrl, token, plans, threads, duration } = data || {};
    const url = (grafanaUrl && grafanaUrl.trim()) || config.grafana.url;
    const tok = (token && token.trim()) || config.grafana.token;
    const jm = new JMeterRunner(url, tok);
    try {
      const result = await jm.runPlans(plans || jm.getPlans().map(p => p.id), { threads: threads || 20, duration: duration || 30 }, (evt) => socket.emit('jm-progress', evt));
      socket.emit('jm-complete', result);
    } catch (e) {
      socket.emit('jm-complete', { status: 'failed', error: e.message });
    }
  });

  socket.on('run-playwright', async (data) => {
    const { grafanaUrl, token, suites } = data || {};
    const url = (grafanaUrl && grafanaUrl.trim()) || config.grafana.url;
    const tok = (token && token.trim()) || config.grafana.token;
    const pw = new PlaywrightRunner(url, tok);
    try {
      const results = await pw.runSuites(suites || pw.getSuites().map(s => s.id), (evt) => socket.emit('pw-progress', evt));
      const allTests = results.flatMap(s => s.tests || []);
      const summary = { total: allTests.length, passed: allTests.filter(t => t.status === 'PASS').length, failed: allTests.filter(t => t.status === 'FAIL').length };
      summary.pass_rate = summary.total > 0 ? `${((summary.passed / summary.total) * 100).toFixed(1)}%` : '0%';
      socket.emit('pw-complete', { status: summary.failed > 0 ? 'failed' : 'passed', summary, suites: results });
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

app.get('/api/snapshots/:id', async (req, res) => {
  try {
    const snap = await ops.getSnapshot(req.params.id);
    if (!snap) return res.status(404).json({ error: 'Not found' });
    const dashboards = await ops.listSnapshotDashboards(req.params.id);
    res.json({ ...snap, dashboards });
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

app.get('/api/snapshots/auto-detect-baseline', async (req, res) => {
  try {
    const { currentId } = req.query;
    if (!currentId) return res.status(400).json({ error: 'currentId required' });
    const svc = new DashboardSnapshotService();
    const baseline = await svc.autoDetectBaseline(currentId);
    res.json(baseline || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
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

// Diffs
app.post('/api/snapshots/diff', async (req, res) => {
  try {
    const { baselineId, currentId } = req.body;
    if (!baselineId || !currentId) return res.status(400).json({ error: 'baselineId and currentId required' });
    const baselineRow = await ops.getSnapshot(baselineId);
    const currentRow = await ops.getSnapshot(currentId);
    if (!baselineRow || !currentRow) return res.status(404).json({ error: 'Snapshot not found' });
    const baseline = { ...baselineRow, dashboards: await ops.listSnapshotDashboards(baselineId) };
    const current = { ...currentRow, dashboards: await ops.listSnapshotDashboards(currentId) };

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
    for (const item of items) {
      const itemId = crypto.randomUUID();
      await ops.insertDiffItem(
        itemId, diffId,
        item.dashboardUid, item.dashboardTitle,
        item.panelId, item.panelTitle,
        item.path, item.changeType, item.riskLevel,
        JSON.stringify(item.before), JSON.stringify(item.after),
        null, null
      );
    }
    await saveDb();
    res.json({ diffId, summary, itemCount: items.length });
  } catch (err) {
    logger.error('Diff create failed', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
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

// ─── SPA Fallback ───
app.get('*', (req, res) => {
  const index = path.join(__dirname, '../../frontend/build/index.html');
  if (require('fs').existsSync(index)) res.sendFile(index);
  else res.json({ message: 'GrafanaProbe API v2.0 — Frontend not built. Run: cd frontend && npm run build' });
});

app.use(errorHandler);

// ─── Start ───
server.listen(config.server.port, () => {
  logger.info(`
╔══════════════════════════════════════════════════╗
║   GrafanaProbe v2.0 — Enterprise Testing          ║
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
