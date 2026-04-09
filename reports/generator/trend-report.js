'use strict';
/**
 * reports/generator/trend-report.js — Historical trend charts using ASCII + HTML sparklines.
 */

const fs   = require('fs');
const path = require('path');

function generateTrendReport(trendData, outputPath = null) {
  const { grafana_url, trends = [], baseline_7d, baseline_30d, current_score } = trendData;

  const scores   = trends.map(t => t.score);
  const maxScore = Math.max(...scores, 100);
  const minScore = Math.min(...scores, 0);

  const sparkPoints = scores.map((s, i) => {
    const x = (i / Math.max(scores.length - 1, 1)) * 800;
    const y = 150 - ((s - minScore) / Math.max(maxScore - minScore, 1)) * 140;
    return `${x},${y}`;
  }).join(' ');

  const rowsHtml = trends.map(t => `
    <tr>
      <td>${t.recorded_at}</td>
      <td style="font-weight:700;color:${scoreColor(t.score)}">${t.score}</td>
      <td style="color:#888">${t.grade || '—'}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<title>Grafana Sentinel — Trend Report</title>
<style>
  body{font-family:-apple-system,sans-serif;background:#0f0f0f;color:#e0e0e0;padding:2rem;max-width:900px;margin:auto}
  h1,h2{color:#fff}
  table{width:100%;border-collapse:collapse;background:#1a1a1a;border-radius:8px}
  th{background:#222;padding:0.75rem 1rem;text-align:left;color:#aaa}
  td{padding:0.75rem 1rem;border-bottom:1px solid #222}
  .stat{display:inline-block;background:#222;border-radius:8px;padding:1rem;margin:0.5rem;min-width:120px;text-align:center}
  .stat-val{font-size:2rem;font-weight:700}
</style></head><body>
<h1>🛡 Grafana Sentinel — Trend Report</h1>
<p style="color:#888">${grafana_url} &nbsp;|&nbsp; ${new Date().toLocaleString()}</p>

<h2>Score Trend (${trends.length} data points)</h2>
<svg viewBox="0 0 800 160" style="width:100%;background:#1a1a1a;border-radius:8px;margin:1rem 0">
  <defs>
    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2eb67d" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#2eb67d" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <!-- Threshold lines -->
  <line x1="0" y1="${150 - (80/100)*140}" x2="800" y2="${150 - (80/100)*140}" stroke="#ecb22e" stroke-width="1" stroke-dasharray="4"/>
  <line x1="0" y1="${150 - (60/100)*140}" x2="800" y2="${150 - (60/100)*140}" stroke="#e01e5a" stroke-width="1" stroke-dasharray="4"/>
  ${sparkPoints ? `<polyline points="${sparkPoints}" fill="none" stroke="#2eb67d" stroke-width="2.5"/>` : ''}
</svg>

<div>
  ${baseline_7d ? `<div class="stat"><div class="stat-val" style="color:#2eb67d">${Math.round(baseline_7d.mean)}</div><div>7-day avg</div></div>` : ''}
  ${baseline_30d ? `<div class="stat"><div class="stat-val" style="color:#888">${Math.round(baseline_30d.mean)}</div><div>30-day avg</div></div>` : ''}
  ${current_score !== undefined ? `<div class="stat"><div class="stat-val" style="color:${scoreColor(current_score)}">${current_score}</div><div>Current</div></div>` : ''}
</div>

<h2>History</h2>
<table><thead><tr><th>Timestamp</th><th>Score</th><th>Grade</th></tr></thead>
<tbody>${rowsHtml}</tbody></table>

<footer style="margin-top:2rem;color:#555;font-size:0.8rem;text-align:center">Grafana Sentinel V3</footer>
</body></html>`;

  const outPath = outputPath || `./reports/trend-${Date.now()}.html`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  return outPath;
}

function scoreColor(s) {
  if (s >= 90) return '#2eb67d';
  if (s >= 70) return '#ecb22e';
  return '#e01e5a';
}

module.exports = { generateTrendReport };
