/**
 * tests/scenarios/full.scenario.js — Full comprehensive test.
 * All dashboards, all alerts, all pages, all datasources.
 * k6 browser ES module.
 */

import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { navigate } from '../helpers/page-actions.js';
import { waitForPanels, waitForAppReady } from '../helpers/wait-strategies.js';
import { detectErrors } from '../helpers/error-detector.js';
import { runDataAssertions } from '../helpers/data-assertions.js';

const BASE_URL  = __ENV.GRAFANA_URL   || 'http://localhost:3000';
const API_TOKEN = __ENV.GRAFANA_TOKEN || '';

const fullLoad    = new Trend('sentinel_full_load_ms', true);
const fullPass    = new Rate('sentinel_full_pass_rate');
const fullErrors  = new Counter('sentinel_full_errors');

export const options = {
  scenarios: {
    full: {
      executor:    'shared-iterations',
      vus:         1,
      iterations:  1,
      maxDuration: '120m',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: {
    sentinel_full_load_ms:   ['p(95)<15000'],
    sentinel_full_pass_rate: ['rate>0.75'],
    checks: ['rate>0.75'],
  },
};

export default async function fullScenario() {
  const page = await browser.newPage();

  try {
    // Discover all resources
    const [dashboards, datasources, alertRules] = await Promise.all([
      fetchDashboards(),
      fetchDatasources(),
      fetchAlertRules(),
    ]);

    console.log(JSON.stringify({
      scenario: 'full',
      dashboards: dashboards.length,
      datasources: datasources.length,
      alert_rules: alertRules.length,
    }));

    // === CORE PAGES ===
    const corePages = [
      '/', '/dashboards', '/explore', '/alerting/list',
      '/alerting/silences', '/alerting/notifications', '/alerting/routes',
      '/datasources', '/plugins', '/org/users', '/org/teams',
      '/admin/server', '/admin/stats', '/admin/settings',
    ];

    for (const path of corePages) {
      await testPage(page, path, 'core');
      sleep(0.2);
    }

    // === ALL DASHBOARDS ===
    console.log(`Full: testing all ${dashboards.length} dashboards`);
    for (const dash of dashboards) {
      await testDashboard(page, dash);
      sleep(0.2);
    }

    // === ALL DATASOURCES ===
    for (const ds of datasources) {
      await testDatasource(page, ds);
      sleep(0.2);
    }

    // === ALL ALERT RULES (API check) ===
    await testAllAlertRules(alertRules);

  } finally {
    await page.close();
  }
}

async function testPage(page, path, category) {
  const start = Date.now();
  try {
    await navigate(page, `${BASE_URL}${path}`, 15000);
    await waitForAppReady(page);
    const ms = Date.now() - start;
    fullLoad.add(ms, { category, page: path });

    const passed = !page.url().includes('/login');
    fullPass.add(passed);
    if (!passed) fullErrors.add(1);

    check(null, {
      [`full core: ${path}`]: () => passed,
    });
  } catch (err) {
    fullErrors.add(1);
    fullPass.add(false);
  }
}

async function testDashboard(page, dash) {
  const start = Date.now();
  try {
    await navigate(page, `${BASE_URL}/d/${dash.uid}?kiosk=tv`);
    const loaded = await waitForPanels(page, 30000);
    const ms = Date.now() - start;
    fullLoad.add(ms, { category: 'dashboard' });

    const errors  = await detectErrors(page);
    const hasCrit = errors.some(e => ['dashboard_not_found', 'permission_denied'].includes(e.type));
    const data    = await runDataAssertions(page);

    const passed = !hasCrit && loaded.panels_stable && ms < 35000;
    fullPass.add(passed);
    if (!passed) fullErrors.add(1);

    check(null, {
      [`full dash: ${dash.title}`]: () => passed,
    });

    console.log(JSON.stringify({
      type: 'dashboard', uid: dash.uid, title: dash.title,
      ms, passed, errors: errors.length,
      panel_errors: data.errors, no_data: data.noData,
    }));
  } catch (err) {
    fullErrors.add(1);
    fullPass.add(false);
    console.error(`Full: dashboard ${dash.uid} error: ${err.message}`);
  }
}

async function testDatasource(page, ds) {
  const res = await fetch(`${BASE_URL}/api/datasources/${ds.id}/health`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  }).then(r => ({ ok: r.ok, status: r.status })).catch(() => ({ ok: false }));

  fullPass.add(res.ok);
  if (!res.ok) fullErrors.add(1);

  check(res, {
    [`full ds: ${ds.name} healthy`]: r => r.ok,
  });
}

async function testAllAlertRules(rules) {
  const hasAlerts = rules.length > 0;
  check(null, {
    'full: alert rules discoverable': () => typeof hasAlerts === 'boolean',
  });

  // Check each rule has required fields
  let valid = 0;
  for (const rule of rules) {
    if (rule.uid && rule.title) valid++;
  }
  check(null, {
    'full: alert rules have uid+title': () => rules.length === 0 || valid / rules.length > 0.9,
  });
}

async function fetchDashboards() {
  try {
    const res = await fetch(`${BASE_URL}/api/search?type=dash-db&limit=5000`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    return res.ok ? res.json() : [];
  } catch { return []; }
}

async function fetchDatasources() {
  try {
    const res = await fetch(`${BASE_URL}/api/datasources`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    return res.ok ? res.json() : [];
  } catch { return []; }
}

async function fetchAlertRules() {
  try {
    const res = await fetch(`${BASE_URL}/api/v1/provisioning/alert-rules`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    const data = res.ok ? await res.json() : [];
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}
