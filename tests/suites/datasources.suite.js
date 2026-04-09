/**
 * tests/suites/datasources.suite.js — Each datasource: health check + query test + "Test & Save".
 * k6 browser ES module.
 */

import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { navigate } from '../helpers/page-actions.js';
import { waitForAppReady, waitForToast } from '../helpers/wait-strategies.js';

const BASE_URL  = __ENV.GRAFANA_URL   || 'http://localhost:3000';
const API_TOKEN = __ENV.GRAFANA_TOKEN || '';

const dsHealthRate  = new Rate('sentinel_datasource_healthy');
const dsTestLatency = new Trend('sentinel_datasource_test_ms', true);

export const options = {
  scenarios: {
    datasource_tests: {
      executor: 'shared-iterations',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: {
    sentinel_datasource_healthy: ['rate>0.8'],
    checks: ['rate>0.8'],
  },
};

export default async function datasourcesSuite() {
  const datasources = await fetchDatasources();
  if (!datasources.length) {
    check(null, { 'datasources found': () => false });
    return;
  }

  const page = await browser.newPage();
  try {
    // Test list page
    await testDatasourceListPage(page);

    // Test each datasource
    for (const ds of datasources) {
      await testDatasource(page, ds);
      sleep(0.5);
    }
  } finally {
    await page.close();
  }
}

async function testDatasourceListPage(page) {
  await navigate(page, `${BASE_URL}/datasources`);
  await waitForAppReady(page);

  const list = await page.$('[data-testid="data-sources-list"], .page-container').catch(() => null);
  check(list, { 'datasources list page loads': el => el !== null });
  sleep(0.5);
}

async function testDatasource(page, ds) {
  const start = Date.now();

  // Navigate to datasource config page
  await navigate(page, `${BASE_URL}/datasources/edit/${ds.id}`);
  await waitForAppReady(page);

  const loaded = await page.$('[data-testid="datasource-settings-page"], form.gf-form-group').catch(() => null);
  check(loaded, { [`${ds.name}: config page loads`]: el => el !== null });

  if (!loaded) {
    dsHealthRate.add(false, { name: ds.name });
    return;
  }

  // Click "Test & Save" / "Test" button
  const testBtn = await page.$('button:has-text("Test"), button[data-testid="data-testid Test datasource settings"], [data-testid="datasource-test-connection-button"]').catch(() => null);
  if (testBtn) {
    await testBtn.click().catch(() => {});
    const toast = await waitForToast(page, 6000);

    const passed = toast && (
      toast.toLowerCase().includes('working') ||
      toast.toLowerCase().includes('success') ||
      toast.toLowerCase().includes('connected') ||
      toast.toLowerCase().includes('data source is working')
    );

    const ms = Date.now() - start;
    dsTestLatency.add(ms, { name: ds.name });
    dsHealthRate.add(!!passed, { name: ds.name });

    check(null, {
      [`${ds.name}: test connection succeeds`]: () => !!passed,
      [`${ds.name}: test responds within 10s`]:  () => ms < 10000,
    });

    console.log(JSON.stringify({ test: 'datasource', name: ds.name, type: ds.type, passed, ms, toast }));
  } else {
    // Test via API instead
    const apiResult = await testDatasourceViaApi(ds.uid || ds.id);
    dsHealthRate.add(apiResult.ok, { name: ds.name });
    dsTestLatency.add(apiResult.ms || 0, { name: ds.name });

    check(apiResult, {
      [`${ds.name}: API health check passes`]: r => r.ok,
    });
  }

  sleep(0.5);
}

async function testDatasourceViaApi(dsId) {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/datasources/${dsId}/health`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    return { ok: res.ok, status: res.status, ms: Date.now() - start };
  } catch (e) {
    return { ok: false, error: e.message, ms: Date.now() - start };
  }
}

async function fetchDatasources() {
  try {
    const res = await fetch(`${BASE_URL}/api/datasources`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}
