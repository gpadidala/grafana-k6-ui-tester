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
const AIDynamicTestGenerator = require('./services/adtg');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Initialize DB
require('./db').getDb();
const { ops } = require('./db');

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

// ─── ADTG (AI Dynamic Test Generator) ───
function getAdtg(grafanaUrl, token) {
  const url = (grafanaUrl && grafanaUrl.trim()) || config.grafana.url;
  const tok = (token && token.trim()) || config.grafana.token;
  return new AIDynamicTestGenerator(url, tok);
}

app.get('/api/adtg/status', (req, res) => {
  const adtg = getAdtg();
  res.json({
    llmConfigured: adtg.isLLMConfigured(),
    provider: process.env.LLM_PROVIDER || 'openai',
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
  });
});

// Generate plan from prompt (parse + generate in one call)
app.post('/api/adtg/generate', async (req, res) => {
  try {
    const { prompt, grafanaUrl, token } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt is required' });
    }
    const adtg = getAdtg(grafanaUrl, token);
    if (!adtg.isLLMConfigured()) {
      return res.status(400).json({ error: 'LLM not configured. Set LLM_API_KEY in backend/.env' });
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
    const { currentPlan, userMessage, grafanaUrl, token } = req.body;
    if (!currentPlan || !userMessage) {
      return res.status(400).json({ error: 'currentPlan and userMessage required' });
    }
    const adtg = getAdtg(grafanaUrl, token);
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
    const { plan, allowWrites, grafanaUrl, token } = req.body;
    const adtg = getAdtg(grafanaUrl, token);
    const validation = adtg.validatePlan(plan, { allowWrites });
    res.json(validation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Execute plan (synchronous + WebSocket)
app.post('/api/adtg/execute', async (req, res) => {
  try {
    const { plan, allowWrites, grafanaUrl, token } = req.body;
    const adtg = getAdtg(grafanaUrl, token);
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
