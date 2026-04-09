const { v4: uuid } = require('uuid');
const fs = require('fs');
const path = require('path');
const GrafanaClient = require('./grafanaClient');
const logger = require('../utils/logger');
const config = require('../config');
const { ops } = require('../db');

const CATEGORIES = [
  { id: 'api-health',         name: 'API Health',          icon: '💚',  runner: require('../tests/api-health') },
  { id: 'datasources',        name: 'Data Sources',        icon: '🔌',  runner: require('../tests/datasources') },
  { id: 'folders',            name: 'Folders',             icon: '📁',  runner: require('../tests/folders') },
  { id: 'dashboards',         name: 'Dashboards',          icon: '📊',  runner: require('../tests/dashboards') },
  { id: 'panels',             name: 'Panels',              icon: '🔲',  runner: require('../tests/panels') },
  { id: 'alerts',             name: 'Alerts',              icon: '🔔',  runner: require('../tests/alerts') },
  { id: 'plugins',            name: 'Plugins',             icon: '🧩',  runner: require('../tests/plugins') },
  { id: 'app-plugins',        name: 'App Plugins',         icon: '📦',  runner: require('../tests/app-plugins') },
  { id: 'users',              name: 'Users & Access',      icon: '👥',  runner: require('../tests/users') },
  { id: 'links',              name: 'Links',               icon: '🔗',  runner: require('../tests/links') },
  { id: 'annotations',        name: 'Annotations',         icon: '📝',  runner: require('../tests/annotations') },
  { id: 'query-latency',      name: 'Query Latency',       icon: '⏱️',  runner: require('../tests/query-latency') },
  { id: 'config-audit',       name: 'Config Audit',        icon: '🔒',  runner: require('../tests/config-audit') },
  { id: 'provisioning',       name: 'Provisioning',        icon: '📄',  runner: require('../tests/provisioning') },
  { id: 'data-freshness',     name: 'Data Freshness',      icon: '🕐',  runner: require('../tests/data-freshness') },
  { id: 'capacity-planning',  name: 'Capacity Planning',   icon: '📈',  runner: require('../tests/capacity-planning') },
  { id: 'k8s-dashboards',     name: 'K8s Dashboards',      icon: '☸️',  runner: require('../tests/k8s-dashboards') },
  { id: 'plugin-upgrade',     name: 'Plugin Upgrade',      icon: '🔄',  runner: require('../tests/plugin-upgrade') },
  { id: 'multi-org',          name: 'Multi-Org',           icon: '🏢',  runner: require('../tests/multi-org') },
  { id: 'baseline-regression', name: 'Baseline Regression', icon: '🔍',  runner: require('../tests/baseline-regression') },
  { id: 'post-deployment',    name: 'Post-Deployment',     icon: '🚀',  runner: require('../tests/post-deployment') },
];

class TestEngine {
  constructor() {
    this.reportsDir = path.resolve(config.paths.reports);
    if (!fs.existsSync(this.reportsDir)) fs.mkdirSync(this.reportsDir, { recursive: true });
  }

  getCategories() {
    return CATEGORIES.map(c => ({ id: c.id, name: c.name, icon: c.icon }));
  }

  async runCategories(categoryIds, grafanaUrl, token, onProgress, options = {}) {
    const client = new GrafanaClient(grafanaUrl, token);
    const runId = uuid();
    const startedAt = new Date().toISOString();

    await ops.insertRun(runId, options.envId || null, options.strategy || 'full', options.mode || 'isolated', 'running', startedAt, grafanaUrl, '{}', options.trigger || 'manual');

    const report = {
      id: runId, grafanaUrl, startedAt, completedAt: null, status: 'running',
      categories: [],
      summary: { total: 0, passed: 0, failed: 0, warnings: 0, pass_rate: '0%' },
    };

    const health = await client.getHealth();
    report.grafanaVersion = health.data?.version || 'unknown';

    for (const catId of categoryIds) {
      const cat = CATEGORIES.find(c => c.id === catId);
      if (!cat) continue;

      if (onProgress) onProgress({ type: 'category_start', categoryId: catId, categoryName: cat.name, icon: cat.icon });

      const catStart = Date.now();
      try {
        const testResults = await cat.runner(client, null, { runId, ...options });

        for (const t of testResults) {
          if (onProgress) onProgress({ type: 'test_result', categoryId: catId, categoryName: cat.name, icon: cat.icon, test: t });
          await ops.insertTestResult(uuid(), runId, catId, t.name, t.status, t.priority || 'P2', JSON.stringify(t.tags || []), t.detail || null, t.error ? JSON.stringify(t.error) : null, t.screenshot || null, t.metadata ? JSON.stringify(t.metadata) : null, t.uid || null, t.ms || 0);
        }

        const passed = testResults.filter(r => r.status === 'PASS').length;
        const failed = testResults.filter(r => r.status === 'FAIL').length;
        const warns = testResults.filter(r => r.status === 'WARN').length;
        const catDuration = Date.now() - catStart;

        const catResult = {
          id: catId, name: cat.name, icon: cat.icon,
          status: failed > 0 ? 'FAIL' : warns > 0 ? 'WARN' : 'PASS',
          tests: testResults,
          summary: { total: testResults.length, passed, failed, warnings: warns },
          duration_ms: catDuration,
        };

        await ops.insertCatResult(`${runId}:${catId}`, runId, catId, cat.name, cat.icon, catResult.status, JSON.stringify(catResult.summary), catDuration);

        report.categories.push(catResult);
        report.summary.total += testResults.length;
        report.summary.passed += passed;
        report.summary.failed += failed;
        report.summary.warnings += warns;

        if (onProgress) onProgress({ type: 'category_done', categoryId: catId, result: catResult });
      } catch (err) {
        logger.error(`Category ${catId} failed`, { error: err.message });
        const catResult = {
          id: catId, name: cat.name, icon: cat.icon, status: 'FAIL',
          tests: [{ name: `${cat.name} Error`, status: 'FAIL', detail: err.message }],
          summary: { total: 1, passed: 0, failed: 1, warnings: 0 },
        };
        report.categories.push(catResult);
        report.summary.total += 1;
        report.summary.failed += 1;
        if (onProgress) onProgress({ type: 'category_done', categoryId: catId, result: catResult });
      }
    }

    report.completedAt = new Date().toISOString();
    const duration = new Date(report.completedAt) - new Date(report.startedAt);
    report.summary.pass_rate = report.summary.total > 0
      ? `${((report.summary.passed / report.summary.total) * 100).toFixed(1)}%` : '0%';
    report.status = parseFloat(report.summary.pass_rate) >= 90 ? 'passed' : 'failed';

    const base = `report-${runId.slice(0, 8)}-${new Date().toISOString().split('T')[0]}`;
    fs.writeFileSync(path.join(this.reportsDir, `${base}.json`), JSON.stringify(report, null, 2));
    report.htmlFile = `${base}.html`;

    await ops.updateRun(runId, report.completedAt, duration, report.status, JSON.stringify(report.summary), report.grafanaVersion, report.htmlFile);

    if (onProgress) onProgress({ type: 'run_complete', report });
    return report;
  }

  async getReports(limit = 50) { return ops.listRuns(limit); }
  async getReport(fileOrId) {
    try {
      const fp = path.join(this.reportsDir, fileOrId);
      if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf-8'));
    } catch {}
    return ops.getRun(fileOrId);
  }
  async deleteReport(id) { await ops.deleteRun(id); return true; }
  async deleteAllReports() { await ops.deleteAllRuns(); return true; }
}

module.exports = TestEngine;
