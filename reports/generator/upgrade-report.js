'use strict';
/**
 * reports/generator/upgrade-report.js — Pre/post upgrade diff report with visual diffs.
 */

const fs   = require('fs');
const path = require('path');

function generateUpgradeReport(diffResult, advisorResult, visualDiff = null, outputPath = null) {
  const { meta, dashboards: d, datasources: ds, alert_rules: ar, plugins: p } = diffResult;

  const riskColor = {
    low:      '#2eb67d',
    medium:   '#ecb22e',
    high:     '#ff7b00',
    critical: '#e01e5a',
  };
  const riskLevel = advisorResult?.risk_level || 'low';
  const color     = riskColor[riskLevel] || '#888';

  const actionRows = (advisorResult?.action_plan || []).map(a => `
    <tr>
      <td style="width:2rem;text-align:center">${a.step}</td>
      <td><span style="background:${riskColor[a.priority] || '#888'}22;color:${riskColor[a.priority]};padding:2px 8px;border-radius:4px;font-size:0.8rem">${a.priority.toUpperCase()}</span></td>
      <td>${a.action}</td>
    </tr>`).join('');

  const visualSection = visualDiff ? `
    <section>
      <h2>📸 Visual Diff</h2>
      <p>${visualDiff.flagged_count} / ${visualDiff.total} dashboards flagged (&gt;5% visual change)</p>
      <table>
        <thead><tr><th>Dashboard</th><th>Status</th><th>Diff%</th></tr></thead>
        <tbody>
          ${(visualDiff.results || []).map(r => `
            <tr><td>${r.key}</td>
            <td style="color:${r.status === 'ok' ? '#2eb67d' : '#ecb22e'}">${r.status}</td>
            <td>${r.diffPct !== undefined ? r.diffPct + '%' : 'N/A'}</td></tr>
          `).join('')}
        </tbody>
      </table>
    </section>` : '';

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<title>Grafana Sentinel — Upgrade Report</title>
<style>
  body{font-family:-apple-system,sans-serif;background:#0f0f0f;color:#e0e0e0;padding:2rem;max-width:1100px;margin:auto}
  h1{color:#fff}h2{color:#ddd;margin:2rem 0 1rem;border-bottom:1px solid #333;padding-bottom:0.5rem}
  .risk-banner{background:${color}22;border:2px solid ${color};border-radius:8px;padding:1.5rem;margin:1.5rem 0;font-size:1.1rem;font-weight:600;color:${color}}
  table{width:100%;border-collapse:collapse;background:#1a1a1a;border-radius:8px;overflow:hidden}
  th{background:#222;padding:0.75rem 1rem;text-align:left;color:#aaa}
  td{padding:0.75rem 1rem;border-bottom:1px solid #222}
  .badge-add{color:#2eb67d} .badge-remove{color:#e01e5a} .badge-mod{color:#ecb22e}
</style></head><body>
<h1>🛡 Grafana Sentinel — Upgrade Report</h1>
<p style="color:#888">${meta?.before_version} → ${meta?.after_version} &nbsp;|&nbsp; ${meta?.generated_at}</p>

<div class="risk-banner">Risk Level: ${riskLevel.toUpperCase()} — ${(advisorResult?.breaking_changes || []).length} breaking change(s), ${(advisorResult?.warnings || []).length} warning(s)</div>

<section>
<h2>📊 Dashboard Changes</h2>
<p>Total: ${d?.summary?.total_before} → ${d?.summary?.total_after}</p>
<table><thead><tr><th>Type</th><th>Count</th><th>Details</th></tr></thead><tbody>
<tr><td class="badge-add">Added</td><td>${d?.summary?.added}</td><td>${(d?.added || []).map(x => x.title).join(', ') || '—'}</td></tr>
<tr><td class="badge-remove">Removed</td><td>${d?.summary?.removed}</td><td>${(d?.removed || []).map(x => x.title).join(', ') || '—'}</td></tr>
<tr><td class="badge-mod">Modified</td><td>${d?.summary?.modified}</td><td>${(d?.modified || []).slice(0,5).map(x => x.title).join(', ') || '—'}</td></tr>
</tbody></table>
</section>

<section>
<h2>🔌 Datasource Changes</h2>
<table><thead><tr><th>Type</th><th>Items</th></tr></thead><tbody>
<tr><td class="badge-add">Added</td><td>${(ds?.added || []).map(x => x.name).join(', ') || '—'}</td></tr>
<tr><td class="badge-remove">Removed</td><td>${(ds?.removed || []).map(x => x.name).join(', ') || '—'}</td></tr>
<tr><td class="badge-mod">Modified</td><td>${(ds?.modified || []).map(x => x.name).join(', ') || '—'}</td></tr>
</tbody></table>
</section>

<section>
<h2>🧩 Plugin Changes</h2>
<table><thead><tr><th>Type</th><th>Plugins</th></tr></thead><tbody>
<tr><td class="badge-add">Added</td><td>${(p?.added || []).map(x => x.id).join(', ') || '—'}</td></tr>
<tr><td class="badge-remove">Removed</td><td>${(p?.removed || []).map(x => x.id).join(', ') || '—'}</td></tr>
<tr><td class="badge-mod">Upgraded</td><td>${(p?.upgraded || []).map(x => `${x.id} (${x.from}→${x.to})`).join(', ') || '—'}</td></tr>
</tbody></table>
</section>

${visualSection}

<section>
<h2>📋 Action Plan</h2>
<table><thead><tr><th>#</th><th>Priority</th><th>Action</th></tr></thead>
<tbody>${actionRows}</tbody></table>
</section>

<footer style="margin-top:3rem;color:#555;font-size:0.8rem;text-align:center">Grafana Sentinel V3</footer>
</body></html>`;

  const outPath = outputPath || `./reports/upgrade-${Date.now()}.html`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  return outPath;
}

module.exports = { generateUpgradeReport };
