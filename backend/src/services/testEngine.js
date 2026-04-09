const { v4: uuid } = require('uuid');
const fs = require('fs');
const path = require('path');
const GrafanaClient = require('./grafanaClient');

const CATEGORIES = [
  { id: 'api-health',   name: 'API Health',      icon: '💚', runner: require('../tests/api-health') },
  { id: 'datasources',  name: 'Data Sources',    icon: '🔌', runner: require('../tests/datasources') },
  { id: 'folders',      name: 'Folders',         icon: '📁', runner: require('../tests/folders') },
  { id: 'dashboards',   name: 'Dashboards',      icon: '📊', runner: require('../tests/dashboards') },
  { id: 'panels',       name: 'Panels',          icon: '🔲', runner: require('../tests/panels') },
  { id: 'alerts',       name: 'Alerts',          icon: '🔔', runner: require('../tests/alerts') },
  { id: 'plugins',      name: 'Plugins',         icon: '🧩', runner: require('../tests/plugins') },
  { id: 'app-plugins',  name: 'App Plugins',     icon: '📦', runner: require('../tests/app-plugins') },
  { id: 'users',        name: 'Users & Access',  icon: '👥', runner: require('../tests/users') },
  { id: 'links',        name: 'Links',           icon: '🔗', runner: require('../tests/links') },
  { id: 'annotations',  name: 'Annotations',     icon: '📝', runner: require('../tests/annotations') },
];

class TestEngine {
  constructor() {
    this.reportsDir = path.join(__dirname, '../../reports');
    if (!fs.existsSync(this.reportsDir)) fs.mkdirSync(this.reportsDir, { recursive: true });
  }

  getCategories() {
    return CATEGORIES.map(c => ({ id: c.id, name: c.name, icon: c.icon }));
  }

  async runAll(grafanaUrl, token, onProgress) {
    return this.runCategories(CATEGORIES.map(c => c.id), grafanaUrl, token, onProgress);
  }

  async runCategory(categoryId, grafanaUrl, token, onProgress) {
    return this.runCategories([categoryId], grafanaUrl, token, onProgress);
  }

  async runCategories(categoryIds, grafanaUrl, token, onProgress) {
    const client = new GrafanaClient(grafanaUrl, token);
    const runId = uuid();
    const startedAt = new Date().toISOString();

    const report = {
      id: runId,
      grafanaUrl,
      startedAt,
      completedAt: null,
      status: 'running',
      categories: [],
      summary: { total: 0, passed: 0, failed: 0, warnings: 0, pass_rate: '0%' },
    };

    for (const catId of categoryIds) {
      const cat = CATEGORIES.find(c => c.id === catId);
      if (!cat) continue;

      if (onProgress) onProgress({ type: 'category_start', categoryId: catId, categoryName: cat.name, icon: cat.icon });

      try {
        const testResults = await cat.runner(client);

        // Emit each individual test result
        for (const t of testResults) {
          if (onProgress) onProgress({
            type: 'test_result', categoryId: catId, categoryName: cat.name, icon: cat.icon,
            test: { name: t.name, status: t.status, detail: t.detail, uid: t.uid, ms: t.ms },
          });
        }

        const passed = testResults.filter(r => r.status === 'PASS').length;
        const failed = testResults.filter(r => r.status === 'FAIL').length;
        const warns = testResults.filter(r => r.status === 'WARN').length;

        const catResult = {
          id: catId,
          name: cat.name,
          icon: cat.icon,
          status: failed > 0 ? 'FAIL' : warns > 0 ? 'WARN' : 'PASS',
          tests: testResults,
          summary: { total: testResults.length, passed, failed, warnings: warns },
        };

        report.categories.push(catResult);
        report.summary.total += testResults.length;
        report.summary.passed += passed;
        report.summary.failed += failed;
        report.summary.warnings += warns;

        if (onProgress) onProgress({ type: 'category_done', categoryId: catId, result: catResult });
      } catch (err) {
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

    // Finalize
    report.completedAt = new Date().toISOString();
    report.summary.pass_rate = report.summary.total > 0
      ? `${((report.summary.passed / report.summary.total) * 100).toFixed(1)}%`
      : '0%';
    report.status = parseFloat(report.summary.pass_rate) >= 90 ? 'passed' : 'failed';

    // Save report
    const filename = `report-${runId.slice(0, 8)}-${new Date().toISOString().split('T')[0]}.json`;
    fs.writeFileSync(path.join(this.reportsDir, filename), JSON.stringify(report, null, 2));

    if (onProgress) onProgress({ type: 'run_complete', report });

    return report;
  }

  getReports() {
    try {
      return fs.readdirSync(this.reportsDir)
        .filter(f => f.endsWith('.json'))
        .sort().reverse()
        .map(f => {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(this.reportsDir, f), 'utf-8'));
            return { file: f, id: data.id, status: data.status, startedAt: data.startedAt, summary: data.summary, grafanaUrl: data.grafanaUrl };
          } catch { return { file: f, id: f, status: 'unknown' }; }
        });
    } catch { return []; }
  }

  getReport(file) {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.reportsDir, file), 'utf-8'));
    } catch { return null; }
  }

  deleteReport(file) {
    try {
      const fp = path.join(this.reportsDir, file);
      if (!fs.existsSync(fp)) return false;
      fs.unlinkSync(fp);
      return true;
    } catch { return false; }
  }

  deleteAllReports() {
    try {
      const files = fs.readdirSync(this.reportsDir).filter(f => f.endsWith('.json'));
      files.forEach(f => fs.unlinkSync(path.join(this.reportsDir, f)));
      return files.length;
    } catch { return 0; }
  }
}

module.exports = TestEngine;
