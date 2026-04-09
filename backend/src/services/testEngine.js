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

    // Save JSON report
    const base = `report-${runId.slice(0, 8)}-${new Date().toISOString().split('T')[0]}`;
    fs.writeFileSync(path.join(this.reportsDir, `${base}.json`), JSON.stringify(report, null, 2));

    // Save HTML report
    const htmlContent = this.generateHtml(report);
    fs.writeFileSync(path.join(this.reportsDir, `${base}.html`), htmlContent);
    report.htmlFile = `${base}.html`;

    if (onProgress) onProgress({ type: 'run_complete', report });

    return report;
  }

  generateHtml(report) {
    const s = report.summary;
    const passColor = parseFloat(s.pass_rate) >= 90 ? '#22c55e' : '#ef4444';
    const catRows = (report.categories || []).map(c => {
      const testRows = (c.tests || []).map((t, i) => {
        const sc = t.status === 'PASS' ? '#064e3b' : t.status === 'FAIL' ? '#450a0a' : '#422006';
        const tc = t.status === 'PASS' ? '#22c55e' : t.status === 'FAIL' ? '#ef4444' : '#eab308';
        return `<tr style="border-bottom:1px solid #2d3748">
          <td style="padding:6px 12px;color:#8899a6">${i + 1}</td>
          <td style="padding:6px 12px;color:#e1e8ed">${t.name}</td>
          <td style="padding:6px 12px"><span style="background:${sc};color:${tc};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">${t.status}</span></td>
          <td style="padding:6px 12px;color:#8899a6;font-size:12px">${t.ms ? t.ms + 'ms' : ''}</td>
          <td style="padding:6px 12px;color:#8899a6;font-size:12px;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.detail || '-'}</td>
        </tr>`;
      }).join('');

      const cc = c.status === 'PASS' ? '#22c55e' : c.status === 'FAIL' ? '#ef4444' : '#eab308';
      return `<div style="margin-bottom:24px">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#1a1f2e;border-radius:8px;margin-bottom:4px">
          <span style="font-size:15px"><span style="margin-right:8px">${c.icon}</span><strong style="color:#fff">${c.name}</strong> <span style="color:#8899a6;font-size:12px;margin-left:8px">${c.summary?.passed}/${c.summary?.total}</span></span>
          <span style="color:${cc};font-weight:600;font-size:13px">${c.status}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">${testRows}</table>
      </div>`;
    }).join('');

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Grafana Test Report</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f1419;color:#e1e8ed;padding:24px}</style></head><body>
<div style="text-align:center;padding:30px;background:linear-gradient(135deg,#1a1f2e,#2d3748);border-radius:12px;margin-bottom:24px">
  <h1 style="font-size:24px;color:#fff;margin-bottom:8px">Grafana UI Test Report</h1>
  <p style="color:#8899a6;font-size:13px">${report.grafanaUrl} | ${new Date(report.startedAt).toLocaleString()}</p>
  <p style="color:#8899a6;font-size:11px;margin-top:6px">by Gopal Rao</p>
</div>
<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:24px">
  <div style="background:#1a1f2e;border:1px solid #2d3748;border-radius:10px;padding:16px;text-align:center"><p style="color:#8899a6;font-size:11px;text-transform:uppercase;letter-spacing:1px">Total</p><p style="font-size:28px;font-weight:bold;color:#3b82f6">${s.total}</p></div>
  <div style="background:#1a1f2e;border:1px solid #2d3748;border-radius:10px;padding:16px;text-align:center"><p style="color:#8899a6;font-size:11px;text-transform:uppercase;letter-spacing:1px">Passed</p><p style="font-size:28px;font-weight:bold;color:#22c55e">${s.passed}</p></div>
  <div style="background:#1a1f2e;border:1px solid #2d3748;border-radius:10px;padding:16px;text-align:center"><p style="color:#8899a6;font-size:11px;text-transform:uppercase;letter-spacing:1px">Failed</p><p style="font-size:28px;font-weight:bold;color:#ef4444">${s.failed}</p></div>
  <div style="background:#1a1f2e;border:1px solid #2d3748;border-radius:10px;padding:16px;text-align:center"><p style="color:#8899a6;font-size:11px;text-transform:uppercase;letter-spacing:1px">Warnings</p><p style="font-size:28px;font-weight:bold;color:#eab308">${s.warnings}</p></div>
  <div style="background:#1a1f2e;border:1px solid #2d3748;border-radius:10px;padding:16px;text-align:center"><p style="color:#8899a6;font-size:11px;text-transform:uppercase;letter-spacing:1px">Pass Rate</p><p style="font-size:28px;font-weight:bold;color:${passColor}">${s.pass_rate}</p></div>
</div>
<div style="text-align:center;padding:16px;border-radius:10px;font-size:20px;font-weight:bold;margin-bottom:24px;${parseFloat(s.pass_rate) >= 90 ? 'background:linear-gradient(135deg,#064e3b,#065f46);color:#22c55e;border:2px solid #22c55e' : 'background:linear-gradient(135deg,#450a0a,#7f1d1d);color:#ef4444;border:2px solid #ef4444'}">
  ${parseFloat(s.pass_rate) >= 90 ? 'PASSED' : 'FAILED'} — ${s.pass_rate} pass rate
</div>
${catRows}
<div style="text-align:center;padding:16px;color:#8899a6;font-size:11px;margin-top:24px">
  <span style="color:#60a5fa;font-weight:600">Gopal Rao</span> | Grafana k6 UI Tester | ${new Date(report.completedAt || report.startedAt).toISOString()}
</div>
</body></html>`;
  }

  getReports() {
    try {
      return fs.readdirSync(this.reportsDir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(this.reportsDir, f), 'utf-8'));
            const htmlFile = f.replace('.json', '.html');
            const hasHtml = fs.existsSync(path.join(this.reportsDir, htmlFile));
            return { file: f, htmlFile: hasHtml ? htmlFile : null, id: data.id, status: data.status, startedAt: data.startedAt, summary: data.summary, grafanaUrl: data.grafanaUrl };
          } catch { return { file: f, htmlFile: null, id: f, status: 'unknown', startedAt: '' }; }
        })
        .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
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
      // Also delete matching HTML
      const htmlFile = file.replace('.json', '.html');
      const htmlPath = path.join(this.reportsDir, htmlFile);
      if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);
      return true;
    } catch { return false; }
  }

  deleteAllReports() {
    try {
      const files = fs.readdirSync(this.reportsDir).filter(f => f.endsWith('.json') || f.endsWith('.html'));
      files.forEach(f => fs.unlinkSync(path.join(this.reportsDir, f)));
      return files.length;
    } catch { return 0; }
  }
}

module.exports = TestEngine;
