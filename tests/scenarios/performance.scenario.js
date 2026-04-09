/**
 * tests/scenarios/performance.scenario.js — Load time benchmarking across all pages and dashboards.
 * k6 browser ES module.
 */

import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { navigate } from '../helpers/page-actions.js';
import { waitForPanels, waitForAppReady } from '../helpers/wait-strategies.js';

const BASE_URL  = __ENV.GRAFANA_URL   || 'http://localhost:3000';
const API_TOKEN = __ENV.GRAFANA_TOKEN || '';

// Per-page load time metrics
const timeHome   = new Trend('sentinel_perf_home_ms',      true);
const timeAlert  = new Trend('sentinel_perf_alerting_ms',  true);
const timeExpl   = new Trend('sentinel_perf_explore_ms',   true);
const timeDash   = new Trend('sentinel_perf_dashboard_ms', true);
const timeApi    = new Trend('sentinel_perf_api_ms',       true);
const slaRate    = new Rate('sentinel_perf_sla_rate');

const SLA = {
  home:       3000,
  alerting:   4000,
  explore:    5000,
  dashboard:  8000,
  api:        500,
};

export const options = {
  scenarios: {
    performance: {
      executor:    'shared-iterations',
      vus:         1,
      iterations:  1,
      maxDuration: '30m',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: {
    sentinel_perf_home_ms:      [`p(95)<${SLA.home}`],
    sentinel_perf_alerting_ms:  [`p(95)<${SLA.alerting}`],
    sentinel_perf_explore_ms:   [`p(95)<${SLA.explore}`],
    sentinel_perf_dashboard_ms: [`p(95)<${SLA.dashboard}`],
    sentinel_perf_api_ms:       [`p(99)<${SLA.api}`],
    sentinel_perf_sla_rate:     ['rate>0.8'],
    checks: ['rate>0.8'],
  },
};

export default async function performanceScenario() {
  const page = await browser.newPage();

  try {
    // Repeat each measurement 3x for stable results
    for (let i = 0; i < 3; i++) {
      await measureHome(page);
      await measureAlerting(page);
      await measureExplore(page);
      sleep(0.5);
    }

    // All dashboards — load time benchmark
    const dashboards = await fetchDashboards();
    console.log(`Performance: benchmarking ${dashboards.length} dashboards`);

    for (const dash of dashboards) {
      await measureDashboard(page, dash);
      sleep(0.3);
    }

    // API response times
    await measureApiEndpoints();

  } finally {
    await page.close();
  }
}

async function measureHome(page) {
  const start = Date.now();
  await navigate(page, `${BASE_URL}/`, 15000);
  await waitForAppReady(page);
  const ms = Date.now() - start;
  timeHome.add(ms);
  slaRate.add(ms <= SLA.home);
  check(null, { [`perf: home < ${SLA.home}ms`]: () => ms <= SLA.home });
  sleep(0.3);
}

async function measureAlerting(page) {
  const start = Date.now();
  await navigate(page, `${BASE_URL}/alerting/list`, 15000);
  await waitForAppReady(page);
  const ms = Date.now() - start;
  timeAlert.add(ms);
  slaRate.add(ms <= SLA.alerting);
  check(null, { [`perf: alerting < ${SLA.alerting}ms`]: () => ms <= SLA.alerting });
  sleep(0.3);
}

async function measureExplore(page) {
  const start = Date.now();
  await navigate(page, `${BASE_URL}/explore`, 15000);
  await waitForAppReady(page);
  const ms = Date.now() - start;
  timeExpl.add(ms);
  slaRate.add(ms <= SLA.explore);
  check(null, { [`perf: explore < ${SLA.explore}ms`]: () => ms <= SLA.explore });
  sleep(0.3);
}

async function measureDashboard(page, dash) {
  const start = Date.now();
  await navigate(page, `${BASE_URL}/d/${dash.uid}?kiosk=tv`);
  await waitForPanels(page, 30000);
  const ms = Date.now() - start;
  timeDash.add(ms, { title: dash.title, uid: dash.uid });
  slaRate.add(ms <= SLA.dashboard);

  const slaOk = ms <= SLA.dashboard;
  check(null, { [`perf: ${dash.title} < ${SLA.dashboard}ms`]: () => slaOk });

  console.log(JSON.stringify({
    type: 'perf_dashboard',
    uid:  dash.uid,
    title: dash.title,
    ms,
    sla_ok: slaOk,
  }));
}

async function measureApiEndpoints() {
  const endpoints = [
    '/api/health',
    '/api/search?type=dash-db&limit=10',
    '/api/datasources',
    '/api/alertmanager/grafana/api/v2/status',
  ];

  for (const ep of endpoints) {
    const start = Date.now();
    await fetch(`${BASE_URL}${ep}`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    }).catch(() => {});
    const ms = Date.now() - start;
    timeApi.add(ms, { endpoint: ep });
    slaRate.add(ms <= SLA.api);
    check(null, { [`perf: API ${ep} < ${SLA.api}ms`]: () => ms <= SLA.api });
  }
}

async function fetchDashboards() {
  try {
    const res = await fetch(`${BASE_URL}/api/search?type=dash-db&limit=5000`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    return res.ok ? res.json() : [];
  } catch { return []; }
}
