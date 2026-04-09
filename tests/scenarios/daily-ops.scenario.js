/**
 * tests/scenarios/daily-ops.scenario.js — Morning health check for on-call.
 * Designed to run in < 10 minutes, produce a concise health summary.
 * k6 browser ES module.
 */

import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { navigate } from '../helpers/page-actions.js';
import { waitForAppReady, waitForPanels } from '../helpers/wait-strategies.js';

const BASE_URL  = __ENV.GRAFANA_URL   || 'http://localhost:3000';
const API_TOKEN = __ENV.GRAFANA_TOKEN || '';

const healthLoad = new Trend('sentinel_ops_load_ms', true);
const opsPass    = new Rate('sentinel_ops_pass_rate');

export const options = {
  scenarios: {
    daily_ops: {
      executor:    'shared-iterations',
      vus:         1,
      iterations:  1,
      maxDuration: '10m',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: {
    sentinel_ops_load_ms:  ['p(90)<8000'],
    sentinel_ops_pass_rate: ['rate>0.9'],
    checks: ['rate>0.9'],
  },
};

export default async function dailyOpsScenario() {
  const page = await browser.newPage();
  const report = { timestamp: new Date().toISOString(), checks: [] };

  try {
    // 1. API health
    report.checks.push(await checkApiHealth());
    // 2. Home + key dashboards
    report.checks.push(await checkHome(page));
    // 3. Critical dashboards (first 5)
    const dashes = await fetchTopDashboards(5);
    for (const d of dashes) {
      report.checks.push(await checkDashboard(page, d));
    }
    // 4. Alert manager
    report.checks.push(await checkAlertManager());
    // 5. Datasource health
    report.checks.push(await checkDatasources());
    // 6. Admin stats
    report.checks.push(await checkAdminStats());

  } finally {
    await page.close();
  }

  // Print on-call summary
  printOpsReport(report);
}

async function checkApiHealth() {
  const start = Date.now();
  const res = await fetch(`${BASE_URL}/api/health`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  }).then(r => ({ ok: r.ok, status: r.status })).catch(() => ({ ok: false, status: 0 }));

  const ms = Date.now() - start;
  opsPass.add(res.ok);
  healthLoad.add(ms, { check: 'api_health' });

  check(res, { 'ops: API health OK': r => r.ok });
  return { name: 'API Health', passed: res.ok, ms, detail: `HTTP ${res.status}` };
}

async function checkHome(page) {
  const start = Date.now();
  await navigate(page, `${BASE_URL}/`);
  await waitForAppReady(page);
  const ms = Date.now() - start;
  const passed = !page.url().includes('/login');
  opsPass.add(passed);
  healthLoad.add(ms, { check: 'home' });
  check(null, { 'ops: home loads': () => passed });
  return { name: 'Home Page', passed, ms };
}

async function checkDashboard(page, dash) {
  const start = Date.now();
  await navigate(page, `${BASE_URL}/d/${dash.uid}?kiosk=tv`);
  await waitForPanels(page, 20000);
  const ms  = Date.now() - start;
  const err = await page.$('[data-testid="panel-error"]').catch(() => null);
  const passed = !page.url().includes('/login') && err === null && ms < 25000;
  opsPass.add(passed);
  healthLoad.add(ms, { check: 'dashboard' });
  check(null, { [`ops: ${dash.title}`]: () => passed });
  sleep(0.5);
  return { name: `Dashboard: ${dash.title}`, passed, ms, uid: dash.uid };
}

async function checkAlertManager() {
  const res = await fetch(`${BASE_URL}/api/alertmanager/grafana/api/v2/status`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  }).then(r => ({ ok: r.ok, status: r.status })).catch(() => ({ ok: false }));
  opsPass.add(res.ok);
  check(res, { 'ops: alertmanager healthy': r => r.ok });
  return { name: 'Alert Manager', passed: res.ok };
}

async function checkDatasources() {
  const dsList = await fetch(`${BASE_URL}/api/datasources`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  }).then(r => r.json()).catch(() => []);

  let healthy = 0;
  const results = [];
  for (const ds of dsList.slice(0, 10)) {
    const r = await fetch(`${BASE_URL}/api/datasources/${ds.id}/health`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    }).then(r2 => ({ ok: r2.ok })).catch(() => ({ ok: false }));
    if (r.ok) healthy++;
    results.push({ name: ds.name, ok: r.ok });
  }

  const rate = dsList.length ? healthy / Math.min(dsList.length, 10) : 1;
  opsPass.add(rate >= 0.8);
  check(null, { 'ops: datasource health > 80%': () => rate >= 0.8 });
  return { name: 'Datasources', passed: rate >= 0.8, rate, results };
}

async function checkAdminStats() {
  const res = await fetch(`${BASE_URL}/api/admin/stats`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  }).then(async r => ({ ok: r.ok, data: r.ok ? await r.json() : null })).catch(() => ({ ok: false }));

  opsPass.add(res.ok);
  check(res, { 'ops: admin stats API': r => r.ok });
  return { name: 'Admin Stats', passed: res.ok, data: res.data };
}

function printOpsReport(report) {
  const passed = report.checks.filter(c => c.passed).length;
  const total  = report.checks.length;
  const pct    = Math.round((passed / total) * 100);

  console.log('\n┌─────────────────────────────────────────────┐');
  console.log('│  GRAFANA SENTINEL — DAILY OPS HEALTH CHECK  │');
  console.log('├─────────────────────────────────────────────┤');
  console.log(`│  ${report.timestamp}             │`);
  console.log(`│  Overall: ${pct}% (${passed}/${total}) ${pct >= 90 ? '✅ HEALTHY' : pct >= 70 ? '⚠️ DEGRADED' : '❌ CRITICAL'} `.padEnd(45) + '│');
  console.log('├─────────────────────────────────────────────┤');
  for (const c of report.checks) {
    const icon = c.passed ? '✅' : '❌';
    const ms   = c.ms ? ` (${c.ms}ms)` : '';
    console.log(`│  ${icon} ${(c.name + ms).slice(0, 40).padEnd(40)} │`);
  }
  console.log('└─────────────────────────────────────────────┘\n');
}

async function fetchTopDashboards(limit) {
  try {
    const res = await fetch(`${BASE_URL}/api/search?type=dash-db&limit=${limit}`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    return res.ok ? res.json() : [];
  } catch { return []; }
}
