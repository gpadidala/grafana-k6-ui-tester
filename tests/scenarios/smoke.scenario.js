/**
 * tests/scenarios/smoke.scenario.js — Quick 5-minute smoke test.
 * Login + home + 3 dashboards. Pass/fail gate for CI.
 * k6 browser ES module.
 */

import { browser } from 'k6/browser';
import { check, sleep, fail } from 'k6';
import { Trend } from 'k6/metrics';
import { navigate, fill, click } from '../helpers/page-actions.js';
import { waitForAppReady, waitForPanels } from '../helpers/wait-strategies.js';

const BASE_URL  = __ENV.GRAFANA_URL   || 'http://localhost:3000';
const API_TOKEN = __ENV.GRAFANA_TOKEN || '';
const ADMIN_USER = __ENV.GRAFANA_USER || 'admin';
const ADMIN_PASS = __ENV.GRAFANA_PASS || 'admin';

const smokeLoadTime = new Trend('sentinel_smoke_load_ms', true);

export const options = {
  scenarios: {
    smoke: {
      executor:      'shared-iterations',
      vus:           1,
      iterations:    1,
      maxDuration:   '5m',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: {
    sentinel_smoke_load_ms: ['p(90)<10000'],
    checks: ['rate>0.9'],
  },
};

export default async function smokeScenario() {
  const page = await browser.newPage();

  try {
    // Step 1: Login
    const loginOk = await doLogin(page);
    if (!loginOk) fail('Smoke test: login failed — aborting');

    // Step 2: Home dashboard
    await testHome(page);

    // Step 3: 3 random dashboards
    const dashboards = await fetchDashboards();
    const sample = dashboards.slice(0, 3);
    for (const dash of sample) {
      await testDashboard(page, dash);
      sleep(0.5);
    }

    // Step 4: Basic alerting page
    await testAlerting(page);

  } finally {
    await page.close();
  }
}

async function doLogin(page) {
  await navigate(page, `${BASE_URL}/login`);
  await waitForAppReady(page);

  const formExists = await page.$('input[name="user"]').catch(() => null);
  if (!formExists) {
    // Already logged in (anonymous access)
    return true;
  }

  await fill(page, 'input[name="user"]', ADMIN_USER);
  await fill(page, 'input[name="password"]', ADMIN_PASS);
  await click(page, 'button[type="submit"]');
  await page.waitForNavigation({ timeout: 10000 }).catch(() => {});

  const loggedIn = !page.url().includes('/login');
  check(null, { 'smoke: login succeeds': () => loggedIn });
  return loggedIn;
}

async function testHome(page) {
  const start = Date.now();
  await navigate(page, `${BASE_URL}/`);
  await waitForAppReady(page);
  const ms = Date.now() - start;
  smokeLoadTime.add(ms, { page: 'home' });

  check(null, {
    'smoke: home loads': () => !page.url().includes('/login'),
    'smoke: home loads < 8s': () => ms < 8000,
  });
  sleep(0.5);
}

async function testDashboard(page, dash) {
  const start = Date.now();
  await navigate(page, `${BASE_URL}/d/${dash.uid}?kiosk=tv`);
  await waitForPanels(page, 20000);
  const ms = Date.now() - start;
  smokeLoadTime.add(ms, { page: `dashboard:${dash.uid}` });

  const hasError = await page.$('[data-testid="panel-error"]').catch(() => null);
  check(null, {
    [`smoke: ${dash.title} loads`]:         () => !page.url().includes('/login'),
    [`smoke: ${dash.title} < 20s`]:         () => ms < 20000,
    [`smoke: ${dash.title} no panel errors`]: () => hasError === null,
  });
  sleep(0.5);
}

async function testAlerting(page) {
  const start = Date.now();
  await navigate(page, `${BASE_URL}/alerting/list`);
  await waitForAppReady(page);
  const ms = Date.now() - start;

  check(null, {
    'smoke: alerting page loads': () => !page.url().includes('/login'),
    'smoke: alerting loads < 8s': () => ms < 8000,
  });
  sleep(0.5);
}

async function fetchDashboards() {
  try {
    const res = await fetch(`${BASE_URL}/api/search?type=dash-db&limit=5`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}
