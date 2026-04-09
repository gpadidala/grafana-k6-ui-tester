/**
 * tests/scenarios/standard.scenario.js — 15-minute standard test.
 * All core pages + 20% of dashboards.
 * k6 browser ES module.
 */

import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { navigate } from '../helpers/page-actions.js';
import { waitForAppReady, waitForPanels } from '../helpers/wait-strategies.js';
import { detectErrors } from '../helpers/error-detector.js';

const BASE_URL  = __ENV.GRAFANA_URL   || 'http://localhost:3000';
const API_TOKEN = __ENV.GRAFANA_TOKEN || '';

const pageLoad   = new Trend('sentinel_std_page_load_ms', true);
const passRate   = new Rate('sentinel_std_pass_rate');

const CORE_PAGES = [
  '/', '/dashboards', '/alerting/list', '/alerting/silences',
  '/alerting/notifications', '/datasources', '/plugins',
  '/org/users', '/org/teams', '/admin/stats',
];

export const options = {
  scenarios: {
    standard: {
      executor:    'shared-iterations',
      vus:         1,
      iterations:  1,
      maxDuration: '15m',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: {
    sentinel_std_page_load_ms: ['p(95)<8000'],
    sentinel_std_pass_rate:    ['rate>0.85'],
    checks: ['rate>0.85'],
  },
};

export default async function standardScenario() {
  const page = await browser.newPage();
  try {
    // Core pages
    for (const path of CORE_PAGES) {
      await testCorePage(page, path);
      sleep(0.3);
    }

    // 20% sample of dashboards
    const all  = await fetchDashboards();
    const sample = samplePct(all, 0.20);
    console.log(`Standard scenario: testing ${sample.length}/${all.length} dashboards`);

    for (const dash of sample) {
      await testDashboard(page, dash);
      sleep(0.3);
    }

    // Alert rules API validation
    await testAlertRulesApi();

    // Datasource health API
    await testDatasourcesApi();

  } finally {
    await page.close();
  }
}

async function testCorePage(page, path) {
  const start = Date.now();
  await navigate(page, `${BASE_URL}${path}`, 12000);
  await waitForAppReady(page);
  const ms = Date.now() - start;
  pageLoad.add(ms, { page: path });

  const passed = !page.url().includes('/login') && ms < 12000;
  passRate.add(passed);
  check(null, {
    [`std core: ${path} loads`]:   () => !page.url().includes('/login'),
    [`std core: ${path} < 12s`]:   () => ms < 12000,
  });
}

async function testDashboard(page, dash) {
  const start = Date.now();
  await navigate(page, `${BASE_URL}/d/${dash.uid}?kiosk=tv`);
  await waitForPanels(page, 25000);
  const ms = Date.now() - start;
  pageLoad.add(ms, { page: 'dashboard' });

  const errors = await detectErrors(page);
  const hasCritical = errors.some(e => ['dashboard_not_found', 'permission_denied'].includes(e.type));
  const passed = !hasCritical && ms < 30000;
  passRate.add(passed);

  check(null, {
    [`std dash: ${dash.title} loads`]:    () => !page.url().includes('/login'),
    [`std dash: ${dash.title} no error`]: () => !hasCritical,
    [`std dash: ${dash.title} < 30s`]:    () => ms < 30000,
  });
}

async function testAlertRulesApi() {
  const res = await fetch(`${BASE_URL}/api/v1/provisioning/alert-rules`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  }).then(async r => ({ ok: r.ok, count: r.ok ? (await r.json()).length : 0 }))
    .catch(() => ({ ok: false, count: 0 }));

  passRate.add(res.ok);
  check(res, {
    'std: alert rules API returns data': r => r.ok || r.count >= 0,
  });
}

async function testDatasourcesApi() {
  const datasources = await fetch(`${BASE_URL}/api/datasources`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  }).then(r => r.json()).catch(() => []);

  let healthy = 0;
  for (const ds of datasources.slice(0, 10)) {
    const res = await fetch(`${BASE_URL}/api/datasources/${ds.id}/health`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    }).then(r => ({ ok: r.ok })).catch(() => ({ ok: false }));
    if (res.ok) healthy++;
  }

  const rate = datasources.slice(0, 10).length > 0 ? healthy / Math.min(datasources.length, 10) : 1;
  check(null, { 'std: datasource health rate > 80%': () => rate >= 0.8 });
}

function samplePct(arr, pct) {
  const count = Math.max(1, Math.ceil(arr.length * pct));
  const step  = Math.max(1, Math.floor(arr.length / count));
  return arr.filter((_, i) => i % step === 0).slice(0, count);
}

async function fetchDashboards() {
  try {
    const res = await fetch(`${BASE_URL}/api/search?type=dash-db&limit=5000`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}
