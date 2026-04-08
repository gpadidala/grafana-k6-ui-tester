// Report Generator
// Produces JSON and interactive HTML reports with baseline comparison

export function generateRunId() {
  const chars = 'abcdef0123456789';
  let id = '';
  for (let i = 0; i < 32; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
    if ([8, 12, 16, 20].includes(i)) id += '-';
  }
  return id;
}

export function generateJsonReport(results, manifest, config) {
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const warnings = results.filter((r) => r.status === 'WARN').length;
  const total = results.length;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) + '%' : '0%';

  return {
    run_id: generateRunId(),
    grafana_url: config.grafana.url,
    grafana_version: manifest ? manifest.version : 'unknown',
    timestamp: new Date().toISOString(),
    test_level: config.test.level,
    summary: {
      total,
      passed,
      failed,
      warnings,
      pass_rate: passRate,
    },
    results: results.map((r) => ({
      category: r.category || 'unknown',
      name: r.name || 'unnamed',
      uid: r.uid || '',
      url: r.url || '',
      status: r.status,
      load_time_ms: r.loadTimeMs || 0,
      checks: r.checks || {},
      screenshot: r.screenshot || null,
      error: r.error || null,
    })),
  };
}

export function generateHtmlReport(jsonReport, baselineReport) {
  const { summary, results, grafana_url, grafana_version, timestamp, test_level, run_id } =
    jsonReport;

  const passAngle = (summary.passed / Math.max(summary.total, 1)) * 360;
  const failAngle = (summary.failed / Math.max(summary.total, 1)) * 360;
  const warnAngle = (summary.warnings / Math.max(summary.total, 1)) * 360;

  // Build comparison section if baseline exists
  let comparisonHtml = '';
  if (baselineReport) {
    const regressions = [];
    const resolved = [];
    const newTests = [];

    const baseMap = {};
    (baselineReport.results || []).forEach((r) => {
      baseMap[r.uid || r.name] = r;
    });

    results.forEach((r) => {
      const key = r.uid || r.name;
      const base = baseMap[key];
      if (base) {
        if (base.status === 'PASS' && r.status === 'FAIL') {
          regressions.push({ name: r.name, uid: r.uid, was: 'PASS', now: 'FAIL' });
        } else if (base.status === 'FAIL' && r.status === 'PASS') {
          resolved.push({ name: r.name, uid: r.uid, was: 'FAIL', now: 'PASS' });
        }
      } else {
        newTests.push({ name: r.name, uid: r.uid, status: r.status });
      }
    });

    const dashDiff = results.length - (baselineReport.results || []).length;

    comparisonHtml = `
    <div class="comparison-section">
      <h2>Version Upgrade Comparison</h2>
      <p>Baseline: ${baselineReport.grafana_version || 'unknown'} &rarr; Current: ${grafana_version}</p>
      <p>Dashboard count change: ${dashDiff >= 0 ? '+' : ''}${dashDiff}</p>
      <p>Baseline pass rate: ${baselineReport.summary ? baselineReport.summary.pass_rate : 'N/A'} &rarr; Current: ${summary.pass_rate}</p>
      ${
        regressions.length > 0
          ? `<h3 class="text-red">Regressions (${regressions.length})</h3>
        <table><tr><th>Name</th><th>UID</th><th>Was</th><th>Now</th></tr>
        ${regressions.map((r) => `<tr><td>${r.name}</td><td>${r.uid}</td><td class="status-pass">${r.was}</td><td class="status-fail">${r.now}</td></tr>`).join('')}
        </table>`
          : '<p class="text-green">No regressions detected!</p>'
      }
      ${
        resolved.length > 0
          ? `<h3 class="text-green">Resolved Issues (${resolved.length})</h3>
        <table><tr><th>Name</th><th>UID</th><th>Was</th><th>Now</th></tr>
        ${resolved.map((r) => `<tr><td>${r.name}</td><td>${r.uid}</td><td class="status-fail">${r.was}</td><td class="status-pass">${r.now}</td></tr>`).join('')}
        </table>`
          : ''
      }
    </div>`;
  }

  const categoryGroups = {};
  results.forEach((r) => {
    if (!categoryGroups[r.category]) categoryGroups[r.category] = [];
    categoryGroups[r.category].push(r);
  });

  // Build Grafana deep-link for each result
  function grafanaLink(r) {
    const base = grafana_url;
    switch (r.category) {
      case 'dashboards':
        return r.uid ? `${base}/d/${r.uid}` : '';
      case 'alerts':
        if (r.uid) return `${base}/alerting/${r.uid}/edit`;
        if (r.name === 'Alert Rules List') return `${base}/alerting/list`;
        if (r.name === 'Silences Page') return `${base}/alerting/silences`;
        if (r.name === 'Contact Points') return `${base}/alerting/notifications`;
        if (r.name === 'Notification Policies') return `${base}/alerting/routes`;
        return `${base}/alerting/list`;
      case 'datasources':
        if (r.uid) return `${base}/datasources/edit/${r.uid}`;
        return `${base}/datasources`;
      case 'plugins':
        if (r.uid) return `${base}/plugins/${r.uid}`;
        return `${base}/plugins`;
      case 'explore':
        return `${base}/explore`;
      case 'home':
        if (r.name === 'Dashboard Browser') return `${base}/dashboards`;
        return `${base}/`;
      case 'login':
        return `${base}/login`;
      case 'users':
        if (r.name === 'Admin Users') return `${base}/admin/users`;
        if (r.name === 'Org Users') return `${base}/org/users`;
        if (r.name === 'Teams') return `${base}/org/teams`;
        if (r.name === 'Profile') return `${base}/profile`;
        return `${base}/admin/users`;
      case 'admin':
        if (r.name.includes('Organizations')) return `${base}/admin/orgs`;
        if (r.name.includes('Server Stats')) return `${base}/admin/stats`;
        if (r.name.includes('Server Settings')) return `${base}/admin/settings`;
        if (r.name.includes('Server Users')) return `${base}/admin/users`;
        return `${base}/admin`;
      default:
        return r.url ? `${base}${r.url}` : '';
    }
  }

  const resultsRows = results
    .map(
      (r, i) => {
        const link = grafanaLink(r);
        const nameCell = link
          ? `<a href="${link}" target="_blank" style="color:#60a5fa;text-decoration:none;" title="Open in Grafana">${r.name}</a>`
          : r.name;
        const linkCell = link
          ? `<a href="${link}" target="_blank" style="color:#60a5fa;text-decoration:none;" title="Open in Grafana">Open ↗</a>`
          : '-';
        return `
    <tr class="result-row" data-status="${r.status}" data-category="${r.category}">
      <td>${i + 1}</td>
      <td>${r.category}</td>
      <td>${nameCell}</td>
      <td>${r.uid || '-'}</td>
      <td><span class="badge status-${r.status.toLowerCase()}">${r.status}</span></td>
      <td>${r.load_time_ms}ms</td>
      <td>${r.error || '-'}</td>
      <td>${linkCell}</td>
      <td>
        ${r.screenshot ? `<a href="${r.screenshot}" target="_blank">View</a>` : '-'}
      </td>
    </tr>`;
      }
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Grafana UI Test Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1419; color: #e1e8ed; padding: 20px; }
    .header { text-align: center; padding: 30px; background: linear-gradient(135deg, #1a1f2e 0%, #2d3748 100%); border-radius: 12px; margin-bottom: 24px; }
    .header h1 { font-size: 28px; margin-bottom: 8px; color: #fff; }
    .header .meta { color: #8899a6; font-size: 14px; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .summary-card { background: #1a1f2e; border-radius: 10px; padding: 20px; text-align: center; border: 1px solid #2d3748; }
    .summary-card .value { font-size: 36px; font-weight: bold; margin: 8px 0; }
    .summary-card .label { color: #8899a6; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
    .text-green { color: #22c55e; }
    .text-red { color: #ef4444; }
    .text-yellow { color: #eab308; }
    .text-blue { color: #3b82f6; }
    .donut-container { display: flex; justify-content: center; margin: 24px 0; }
    .controls { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
    .controls input, .controls select { background: #1a1f2e; border: 1px solid #2d3748; color: #e1e8ed; padding: 8px 12px; border-radius: 6px; font-size: 14px; }
    .controls input { flex: 1; min-width: 200px; }
    table { width: 100%; border-collapse: collapse; background: #1a1f2e; border-radius: 10px; overflow: hidden; }
    th { background: #2d3748; padding: 12px 16px; text-align: left; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #8899a6; }
    td { padding: 10px 16px; border-bottom: 1px solid #2d3748; font-size: 14px; }
    tr:hover { background: #232a3b; }
    a { color: #60a5fa; text-decoration: none; }
    a:hover { text-decoration: underline; color: #93bbfc; }
    .badge { padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .status-pass { background: #064e3b; color: #22c55e; }
    .status-fail { background: #450a0a; color: #ef4444; }
    .status-warn { background: #422006; color: #eab308; }
    .verdict { text-align: center; padding: 20px; margin: 24px 0; border-radius: 12px; font-size: 24px; font-weight: bold; }
    .verdict-pass { background: linear-gradient(135deg, #064e3b, #065f46); color: #22c55e; border: 2px solid #22c55e; }
    .verdict-fail { background: linear-gradient(135deg, #450a0a, #7f1d1d); color: #ef4444; border: 2px solid #ef4444; }
    .comparison-section { background: #1a1f2e; border-radius: 10px; padding: 24px; margin: 24px 0; border: 1px solid #2d3748; }
    .comparison-section h2 { margin-bottom: 16px; }
    .comparison-section h3 { margin: 16px 0 8px; }
    .category-summary { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
    .cat-badge { background: #2d3748; padding: 6px 14px; border-radius: 20px; font-size: 13px; }
    .footer { text-align: center; padding: 20px; color: #8899a6; font-size: 12px; margin-top: 24px; }
    .footer .author { color: #60a5fa; font-weight: 600; }
    .watermark { position: fixed; bottom: 20px; right: 20px; color: rgba(96,165,250,0.08); font-size: 48px; font-weight: 900; letter-spacing: 2px; transform: rotate(-15deg); pointer-events: none; z-index: 0; user-select: none; }
    .header .author-badge { display: inline-block; margin-top: 10px; background: rgba(96,165,250,0.15); color: #60a5fa; padding: 4px 14px; border-radius: 20px; font-size: 12px; font-weight: 600; letter-spacing: 0.5px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Grafana UI Test Report</h1>
    <div class="meta">
      Run ID: ${run_id} | Grafana: ${grafana_version} | Level: ${test_level} | ${new Date(timestamp).toLocaleString()}
    </div>
    <div class="meta">${grafana_url}</div>
    <div class="author-badge">Built by Gopal Rao</div>
  </div>

  <div class="summary-grid">
    <div class="summary-card">
      <div class="label">Total Tests</div>
      <div class="value text-blue">${summary.total}</div>
    </div>
    <div class="summary-card">
      <div class="label">Passed</div>
      <div class="value text-green">${summary.passed}</div>
    </div>
    <div class="summary-card">
      <div class="label">Failed</div>
      <div class="value text-red">${summary.failed}</div>
    </div>
    <div class="summary-card">
      <div class="label">Warnings</div>
      <div class="value text-yellow">${summary.warnings}</div>
    </div>
    <div class="summary-card">
      <div class="label">Pass Rate</div>
      <div class="value ${parseFloat(summary.pass_rate) >= 90 ? 'text-green' : 'text-red'}">${summary.pass_rate}</div>
    </div>
  </div>

  <div class="donut-container">
    <svg width="200" height="200" viewBox="0 0 200 200">
      <circle cx="100" cy="100" r="80" fill="none" stroke="#2d3748" stroke-width="30"/>
      <circle cx="100" cy="100" r="80" fill="none" stroke="#22c55e" stroke-width="30"
        stroke-dasharray="${(summary.passed / Math.max(summary.total, 1)) * 502.65} 502.65"
        stroke-dashoffset="0" transform="rotate(-90 100 100)"/>
      <circle cx="100" cy="100" r="80" fill="none" stroke="#ef4444" stroke-width="30"
        stroke-dasharray="${(summary.failed / Math.max(summary.total, 1)) * 502.65} 502.65"
        stroke-dashoffset="${-(summary.passed / Math.max(summary.total, 1)) * 502.65}" transform="rotate(-90 100 100)"/>
      <text x="100" y="95" text-anchor="middle" fill="#fff" font-size="28" font-weight="bold">${summary.pass_rate}</text>
      <text x="100" y="115" text-anchor="middle" fill="#8899a6" font-size="12">pass rate</text>
    </svg>
  </div>

  <div class="verdict ${parseFloat(summary.pass_rate) >= 90 ? 'verdict-pass' : 'verdict-fail'}">
    ${parseFloat(summary.pass_rate) >= 90 ? 'PASSED' : 'FAILED'} — ${summary.pass_rate} pass rate
  </div>

  <div class="category-summary">
    ${Object.entries(categoryGroups)
      .map(
        ([cat, items]) =>
          `<span class="cat-badge">${cat}: ${items.filter((i) => i.status === 'PASS').length}/${items.length}</span>`
      )
      .join('')}
  </div>

  ${comparisonHtml}

  <div class="controls">
    <input type="text" id="searchBox" placeholder="Search tests..." oninput="filterTable()">
    <select id="statusFilter" onchange="filterTable()">
      <option value="">All Statuses</option>
      <option value="PASS">PASS</option>
      <option value="FAIL">FAIL</option>
      <option value="WARN">WARN</option>
    </select>
    <select id="categoryFilter" onchange="filterTable()">
      <option value="">All Categories</option>
      ${Object.keys(categoryGroups)
        .map((c) => `<option value="${c}">${c}</option>`)
        .join('')}
    </select>
  </div>

  <table>
    <thead>
      <tr>
        <th>#</th><th>Category</th><th>Name</th><th>UID</th><th>Status</th><th>Load Time</th><th>Error</th><th>Grafana</th><th>Screenshot</th>
      </tr>
    </thead>
    <tbody id="resultsBody">
      ${resultsRows}
    </tbody>
  </table>

  <div class="footer">
    <span class="author">Gopal Rao</span> | Grafana k6 UI Tester | ${new Date(timestamp).toISOString()}
  </div>

  <div class="watermark">GOPAL RAO</div>

  <script>
    function filterTable() {
      const search = document.getElementById('searchBox').value.toLowerCase();
      const status = document.getElementById('statusFilter').value;
      const category = document.getElementById('categoryFilter').value;
      document.querySelectorAll('.result-row').forEach(row => {
        const text = row.textContent.toLowerCase();
        const rowStatus = row.dataset.status;
        const rowCategory = row.dataset.category;
        const show = text.includes(search) && (!status || rowStatus === status) && (!category || rowCategory === category);
        row.style.display = show ? '' : 'none';
      });
    }
  </script>
</body>
</html>`;
}

export default { generateJsonReport, generateHtmlReport, generateRunId };
