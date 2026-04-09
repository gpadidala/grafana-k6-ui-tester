const { v4: uuid } = require('uuid');
const fs = require('fs');
const path = require('path');
const GrafanaClient = require('./grafanaClient');
const DependencyGraph = require('./dependencyGraph');
const { stmts, db } = require('../db');

const CATEGORIES = [
  { id: 'api-health',        name: 'API Health',        icon: '💚',  runner: require('../tests/api-health') },
  { id: 'datasources',       name: 'Data Sources',      icon: '🔌',  runner: require('../tests/datasources') },
  { id: 'folders',           name: 'Folders',           icon: '📁',  runner: require('../tests/folders') },
  { id: 'dashboards',        name: 'Dashboards',        icon: '📊',  runner: require('../tests/dashboards') },
  { id: 'panels',            name: 'Panels',            icon: '🔲',  runner: require('../tests/panels') },
  { id: 'alerts',            name: 'Alerts',            icon: '🔔',  runner: require('../tests/alerts') },
  { id: 'plugins',           name: 'Plugins',           icon: '🧩',  runner: require('../tests/plugins') },
  { id: 'app-plugins',       name: 'App Plugins',       icon: '📦',  runner: require('../tests/app-plugins') },
  { id: 'users',             name: 'Users & Access',    icon: '👥',  runner: require('../tests/users') },
  { id: 'links',             name: 'Links',             icon: '🔗',  runner: require('../tests/links') },
  { id: 'annotations',       name: 'Annotations',       icon: '📝',  runner: require('../tests/annotations') },
  { id: 'query-latency',     name: 'Query Latency',     icon: '⏱️',  runner: require('../tests/query-latency') },
  { id: 'config-audit',      name: 'Config Audit',      icon: '🔒',  runner: require('../tests/config-audit') },
  { id: 'provisioning',      name: 'Provisioning',      icon: '📄',  runner: require('../tests/provisioning') },
  { id: 'data-freshness',    name: 'Data Freshness',    icon: '🕐',  runner: require('../tests/data-freshness') },
  { id: 'capacity-planning', name: 'Capacity Planning', icon: '📈',  runner: require('../tests/capacity-planning') },
  { id: 'k8s-dashboards',    name: 'K8s Dashboards',    icon: '☸️',  runner: require('../tests/k8s-dashboards') },
];

class TestEngine {
  constructor() {
    this.reportsDir = path.join(__dirname, '../../reports');
    if (!fs.existsSync(this.reportsDir)) fs.mkdirSync(this.reportsDir, { recursive: true });
    this.depGraph = new DependencyGraph();
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

  async runCategories(categoryIds, grafanaUrl, token, onProgress, options = {}) {
    const client = new GrafanaClient(grafanaUrl, token);
    const runId = uuid();
    const startedAt = new Date().toISOString();

    // Store run in SQLite
    stmts.insertRun.run(runId, startedAt, 'running', options.mode || 'isolated', options.trigger || 'manual', grafanaUrl, '{}');

    // Build dependency graph if needed
    try { await this.depGraph.build(client); } catch (e) { console.warn('[DepGraph] Build failed:', e.message); }

    const report = {
      id: runId, grafanaUrl, startedAt, completedAt: null, status: 'running',
      categories: [],
      summary: { total: 0, passed: 0, failed: 0, warnings: 0, pass_rate: '0%' },
    };

    // Detect Grafana version
    const health = await client.health();
    report.grafanaVersion = health.data?.version || 'unknown';

    for (const catId of categoryIds) {
      const cat = CATEGORIES.find(c => c.id === catId);
      if (!cat) continue;

      if (onProgress) onProgress({ type: 'category_start', categoryId: catId, categoryName: cat.name, icon: cat.icon });

      const catStart = Date.now();
      try {
        const testResults = await cat.runner(client, this.depGraph, { runId, ...options });

        // Emit each test result
        for (const t of testResults) {
          if (onProgress) onProgress({ type: 'test_result', categoryId: catId, categoryName: cat.name, icon: cat.icon, test: t });
          // Store in SQLite
          stmts.insertTestResult.run(runId, catId, t.name, t.status, t.detail || null, t.uid || null, t.ms || null, t.metadata ? JSON.stringify(t.metadata) : null);
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

        // Store category result in SQLite
        stmts.insertCategoryResult.run(`${runId}:${catId}`, runId, catId, cat.name, cat.icon, catResult.status, JSON.stringify(catResult.summary), catDuration);

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
        stmts.insertTestResult.run(runId, catId, `${cat.name} Error`, 'FAIL', err.message, null, null, null);
        if (onProgress) onProgress({ type: 'category_done', categoryId: catId, result: catResult });
      }
    }

    // Finalize
    report.completedAt = new Date().toISOString();
    const duration = new Date(report.completedAt) - new Date(report.startedAt);
    report.summary.pass_rate = report.summary.total > 0
      ? `${((report.summary.passed / report.summary.total) * 100).toFixed(1)}%` : '0%';
    report.status = parseFloat(report.summary.pass_rate) >= 90 ? 'passed' : 'failed';

    // Save JSON + HTML reports
    const base = `report-${runId.slice(0, 8)}-${new Date().toISOString().split('T')[0]}`;
    fs.writeFileSync(path.join(this.reportsDir, `${base}.json`), JSON.stringify(report, null, 2));
    const htmlContent = this.generateHtml(report);
    fs.writeFileSync(path.join(this.reportsDir, `${base}.html`), htmlContent);
    report.htmlFile = `${base}.html`;

    // Update SQLite
    stmts.updateRun.run(report.completedAt, duration, report.status, JSON.stringify(report.summary), report.grafanaVersion, `${base}.html`, runId);

    if (onProgress) onProgress({ type: 'run_complete', report });
    return report;
  }

  // ─── Dependency Graph ───
  getDepGraphStats() { return this.depGraph.getStats(); }
  getDepGraph() { return this.depGraph.getFullGraph(); }
  getImpactByDatasource(dsUid) { return this.depGraph.getImpactedByDatasource(dsUid); }
  getImpactByPlugin(pluginId) { return this.depGraph.getImpactedByPlugin(pluginId); }

  // ─── Reports (SQLite + Files) ───
  getReports(limit = 50) {
    const runs = stmts.listRuns.all(limit);
    return runs.map(r => ({
      file: r.html_file ? r.html_file.replace('.html', '.json') : null,
      htmlFile: r.html_file,
      id: r.id,
      status: r.status,
      startedAt: r.start_time,
      completedAt: r.end_time,
      duration_ms: r.duration_ms,
      grafanaUrl: r.grafana_url,
      grafanaVersion: r.grafana_version,
      summary: JSON.parse(r.summary || '{}'),
    }));
  }

  getReport(fileOrId) {
    // Try file first
    try {
      const fp = path.join(this.reportsDir, fileOrId);
      if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf-8'));
    } catch {}
    // Try SQLite by run ID
    const run = stmts.getRun.get(fileOrId);
    if (run) {
      const cats = stmts.getCategoryResults.all(run.id);
      const tests = stmts.getTestResults.all(run.id);
      return {
        id: run.id, grafanaUrl: run.grafana_url, grafanaVersion: run.grafana_version,
        startedAt: run.start_time, completedAt: run.end_time, status: run.status,
        summary: JSON.parse(run.summary || '{}'),
        categories: cats.map(c => ({
          id: c.category_id, name: c.category_name, icon: c.icon, status: c.status,
          summary: JSON.parse(c.summary || '{}'),
          tests: tests.filter(t => t.category_id === c.category_id).map(t => ({
            name: t.test_name, status: t.status, detail: t.detail, uid: t.uid, ms: t.ms,
          })),
        })),
      };
    }
    return null;
  }

  deleteReport(fileOrId) {
    // Delete files
    try {
      const json = path.join(this.reportsDir, fileOrId);
      const html = path.join(this.reportsDir, fileOrId.replace('.json', '.html'));
      if (fs.existsSync(json)) fs.unlinkSync(json);
      if (fs.existsSync(html)) fs.unlinkSync(html);
    } catch {}
    // Delete from SQLite by matching html_file
    const runs = stmts.listRuns.all(1000);
    for (const r of runs) {
      if (r.html_file === fileOrId || r.html_file === fileOrId.replace('.json', '.html') || r.id === fileOrId) {
        stmts.deleteRun.run(r.id);
        return true;
      }
    }
    return true;
  }

  deleteAllReports() {
    stmts.deleteAllRuns.run();
    try {
      const files = fs.readdirSync(this.reportsDir).filter(f => f.endsWith('.json') || f.endsWith('.html'));
      files.forEach(f => fs.unlinkSync(path.join(this.reportsDir, f)));
      return files.length;
    } catch { return 0; }
  }

  // ─── HTML Report Generator ───
  grafanaLink(baseUrl, categoryId, test) {
    const uid = test.uid;
    if (!uid) return '';
    const links = {
      'dashboards': `/d/${uid}`, 'panels': `/d/${uid}`, 'folders': `/dashboards/f/${uid}`,
      'datasources': `/datasources/edit/${uid}`, 'alerts': `/alerting/${uid}/edit`,
      'plugins': `/plugins/${uid}`, 'app-plugins': `/plugins/${uid}`, 'links': `/d/${uid}`,
      'annotations': `/d/${uid}`, 'k8s-dashboards': `/d/${uid}`, 'query-latency': `/d/${uid}`,
    };
    return links[categoryId] ? `${baseUrl}${links[categoryId]}` : '';
  }

  generateHtml(report) {
    const s = report.summary;
    const base = report.grafanaUrl || '';
    const passColor = parseFloat(s.pass_rate) >= 90 ? '#22c55e' : '#ef4444';

    const catRows = (report.categories || []).map(c => {
      const testRows = (c.tests || []).map((t, i) => {
        const sc = t.status === 'PASS' ? '#064e3b' : t.status === 'FAIL' ? '#450a0a' : '#422006';
        const tc = t.status === 'PASS' ? '#22c55e' : t.status === 'FAIL' ? '#ef4444' : '#eab308';
        const link = this.grafanaLink(base, c.id, t);
        const nameHtml = link ? `<a href="${link}" target="_blank" style="color:#60a5fa;text-decoration:none">${t.name}</a>` : t.name;
        const linkHtml = link ? `<a href="${link}" target="_blank" style="color:#60a5fa;text-decoration:none;font-size:11px">Open ↗</a>` : '';
        return `<tr style="border-bottom:1px solid #2d3748">
          <td style="padding:6px 10px;color:#8899a6;font-size:12px">${i + 1}</td>
          <td style="padding:6px 10px">${nameHtml}</td>
          <td style="padding:6px 10px"><span style="background:${sc};color:${tc};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">${t.status}</span></td>
          <td style="padding:6px 10px;color:#8899a6;font-size:12px">${t.ms ? t.ms + 'ms' : ''}</td>
          <td style="padding:6px 10px;color:#8899a6;font-size:12px;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.detail || '-'}</td>
          <td style="padding:6px 10px">${linkHtml}</td></tr>`;
      }).join('');

      const cc = c.status === 'PASS' ? '#22c55e' : c.status === 'FAIL' ? '#ef4444' : '#eab308';
      return `<div style="margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#1a1f2e;border-radius:8px;margin-bottom:2px">
          <span><span style="margin-right:6px">${c.icon}</span><strong style="color:#fff">${c.name}</strong> <span style="color:#8899a6;font-size:12px;margin-left:6px">${c.summary?.passed}/${c.summary?.total}</span>${c.duration_ms ? `<span style="color:#8899a6;font-size:11px;margin-left:8px">${c.duration_ms}ms</span>` : ''}</span>
          <span style="color:${cc};font-weight:600;font-size:13px">${c.status}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">${testRows}</table>
      </div>`;
    }).join('');

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>GrafanaProbe Report</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f1419;color:#e1e8ed;padding:24px}a{color:#60a5fa;text-decoration:none}a:hover{text-decoration:underline}</style></head><body>
<div style="text-align:center;padding:24px;background:linear-gradient(135deg,#1a1f2e,#2d3748);border-radius:12px;margin-bottom:20px">
  <h1 style="font-size:22px;color:#fff;margin-bottom:6px">GrafanaProbe — Test Report</h1>
  <p style="color:#8899a6;font-size:13px">${report.grafanaUrl} | Grafana ${report.grafanaVersion || '?'} | ${new Date(report.startedAt).toLocaleString()}</p>
  <p style="color:#8899a6;font-size:11px;margin-top:4px">by Gopal Rao</p>
</div>
<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:20px">
  <div style="background:#1a1f2e;border:1px solid #2d3748;border-radius:10px;padding:14px;text-align:center"><p style="color:#8899a6;font-size:10px;text-transform:uppercase;letter-spacing:1px">Total</p><p style="font-size:26px;font-weight:bold;color:#3b82f6">${s.total}</p></div>
  <div style="background:#1a1f2e;border:1px solid #2d3748;border-radius:10px;padding:14px;text-align:center"><p style="color:#8899a6;font-size:10px;text-transform:uppercase;letter-spacing:1px">Passed</p><p style="font-size:26px;font-weight:bold;color:#22c55e">${s.passed}</p></div>
  <div style="background:#1a1f2e;border:1px solid #2d3748;border-radius:10px;padding:14px;text-align:center"><p style="color:#8899a6;font-size:10px;text-transform:uppercase;letter-spacing:1px">Failed</p><p style="font-size:26px;font-weight:bold;color:#ef4444">${s.failed}</p></div>
  <div style="background:#1a1f2e;border:1px solid #2d3748;border-radius:10px;padding:14px;text-align:center"><p style="color:#8899a6;font-size:10px;text-transform:uppercase;letter-spacing:1px">Warnings</p><p style="font-size:26px;font-weight:bold;color:#eab308">${s.warnings}</p></div>
  <div style="background:#1a1f2e;border:1px solid #2d3748;border-radius:10px;padding:14px;text-align:center"><p style="color:#8899a6;font-size:10px;text-transform:uppercase;letter-spacing:1px">Pass Rate</p><p style="font-size:26px;font-weight:bold;color:${passColor}">${s.pass_rate}</p></div>
</div>
<div style="text-align:center;padding:14px;border-radius:10px;font-size:18px;font-weight:bold;margin-bottom:20px;${parseFloat(s.pass_rate) >= 90 ? 'background:#064e3b;color:#22c55e;border:2px solid #22c55e' : 'background:#450a0a;color:#ef4444;border:2px solid #ef4444'}">
  ${parseFloat(s.pass_rate) >= 90 ? 'PASSED' : 'FAILED'} — ${s.pass_rate} pass rate (${report.categories?.length || 0} categories)
</div>
${catRows}
<div style="text-align:center;padding:14px;color:#8899a6;font-size:11px;margin-top:20px">
  <span style="color:#60a5fa;font-weight:600">Gopal Rao</span> | GrafanaProbe v2 | ${new Date(report.completedAt || report.startedAt).toISOString()}
</div></body></html>`;
  }
}

module.exports = TestEngine;
