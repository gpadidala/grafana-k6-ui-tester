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
