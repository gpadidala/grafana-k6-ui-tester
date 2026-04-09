const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const config = require('./config');
const TestEngine = require('./services/testEngine');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

const engine = new TestEngine();

// ─── REST API ───

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', author: 'Gopal Rao' });
});

app.get('/api/config', (req, res) => {
  res.json({
    grafanaUrl: config.grafanaUrl,
    hasToken: !!config.grafanaToken,
    orgId: config.grafanaOrgId,
  });
});

// Test connection to a Grafana instance (proxy to avoid CORS)
app.post('/api/test-connection', async (req, res) => {
  const { grafanaUrl, token } = req.body;
  const url = (grafanaUrl && grafanaUrl.trim()) ? grafanaUrl.trim() : config.grafanaUrl;
  const tok = (token && token.trim()) ? token.trim() : config.grafanaToken;

  const GrafanaClient = require('./services/grafanaClient');
  const client = new GrafanaClient(url, tok);
  const health = await client.health();
  const user = await client.get('/api/user');

  if (health.ok) {
    res.json({
      ok: true,
      version: health.data?.version || 'unknown',
      database: health.data?.database || 'unknown',
      user: user.ok ? (user.data?.login || 'anonymous') : 'anonymous',
      ms: health.ms,
    });
  } else {
    res.json({
      ok: false,
      error: health.error || `HTTP ${health.status}`,
      ms: health.ms,
    });
  }
});

app.get('/api/tests/categories', (req, res) => {
  res.json(engine.getCategories());
});

// Run all tests
app.post('/api/tests/run', async (req, res) => {
  const { grafanaUrl, token, categories } = req.body;
  const url = (grafanaUrl && grafanaUrl.trim()) ? grafanaUrl.trim() : config.grafanaUrl;
  const tok = (token && token.trim()) ? token.trim() : config.grafanaToken;

  const report = await engine.runCategories(
    categories || engine.getCategories().map(c => c.id),
    url, tok,
    (evt) => io.emit('test-progress', evt)
  );

  res.json(report);
});

// Run single category
app.post('/api/tests/run-category/:id', async (req, res) => {
  const { grafanaUrl, token } = req.body;
  const url = grafanaUrl || config.grafanaUrl;
  const tok = token || config.grafanaToken;

  const report = await engine.runCategory(
    req.params.id, url, tok,
    (evt) => io.emit('test-progress', evt)
  );

  res.json(report);
});

// Reports
app.get('/api/reports', (req, res) => {
  res.json(engine.getReports());
});

app.get('/api/reports/:file', (req, res) => {
  const report = engine.getReport(req.params.file);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  res.json(report);
});

// Delete single report
app.delete('/api/reports/:file', (req, res) => {
  const ok = engine.deleteReport(req.params.file);
  if (!ok) return res.status(404).json({ error: 'Report not found' });
  res.json({ deleted: true });
});

// Delete all reports
app.delete('/api/reports', (req, res) => {
  const count = engine.deleteAllReports();
  res.json({ deleted: count });
});

// ─── Socket.IO ───
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('run-tests', async (data) => {
    const { grafanaUrl, token, categories } = data || {};
    const url = (grafanaUrl && grafanaUrl.trim()) ? grafanaUrl.trim() : config.grafanaUrl;
    const tok = (token && token.trim()) ? token.trim() : config.grafanaToken;
    console.log(`Run request — URL: ${url}, Auth: ${tok ? 'token' : 'none'}, Categories: ${categories || 'all'}`);

    const report = await engine.runCategories(
      categories || engine.getCategories().map(c => c.id),
      url, tok,
      (evt) => socket.emit('test-progress', evt)
    );

    socket.emit('test-complete', report);
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// ─── Start ───
server.listen(config.port, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   Grafana k6 UI Tester — Backend             ║
║              by Gopal Rao                     ║
╠══════════════════════════════════════════════╣
║  API:     http://localhost:${config.port}              ║
║  Grafana: ${config.grafanaUrl.padEnd(34)}║
║  Auth:    ${config.grafanaToken ? 'Token configured' : 'No token'}${''.padEnd(config.grafanaToken ? 19 : 28)}║
╚══════════════════════════════════════════════╝
  `);
});
