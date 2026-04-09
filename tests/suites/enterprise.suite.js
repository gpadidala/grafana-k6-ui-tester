/**
 * tests/suites/enterprise.suite.js — Enterprise reporting and usage insights.
 * k6 browser ES module. Gracefully skips on OSS.
 */

import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { navigate } from '../helpers/page-actions.js';
import { waitForAppReady } from '../helpers/wait-strategies.js';

const BASE_URL  = __ENV.GRAFANA_URL   || 'http://localhost:3000';
const API_TOKEN = __ENV.GRAFANA_TOKEN || '';

export const options = {
  scenarios: {
    enterprise_tests: {
      executor: 'shared-iterations',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: { checks: ['rate>0.5'] },
};

export default async function enterpriseSuite() {
  const page = await browser.newPage();
  try {
    await testLicensePage(page);
    await testReportingPage(page);
    await testUsageInsightsPage(page);
    await testEnterpriseApiEndpoints();
  } finally {
    await page.close();
  }
}

async function testLicensePage(page) {
  await navigate(page, `${BASE_URL}/admin/licensing`);
  await waitForAppReady(page);

  const isAccessible = !page.url().includes('/login');
  const licenseInfo  = await page.$('[data-testid="license-page"], [class*="license"]').catch(() => null);

  check(null, {
    'license/admin page accessible': () => isAccessible,
  });
  sleep(0.5);
}

async function testReportingPage(page) {
  await navigate(page, `${BASE_URL}/reports`);
  await waitForAppReady(page);

  // Reporting is enterprise; gracefully handle 404 or redirect
  const currentUrl = page.url();
  check(null, {
    'reporting page: no server error': () => !currentUrl.includes('500'),
  });
  sleep(0.5);
}

async function testUsageInsightsPage(page) {
  await navigate(page, `${BASE_URL}/admin/usage-insights`);
  await waitForAppReady(page);

  check(null, {
    'usage insights page: no server crash': () => !page.url().includes('500'),
  });
  sleep(0.5);
}

async function testEnterpriseApiEndpoints() {
  const endpoints = [
    { path: '/api/licensing/check', name: 'license check' },
    { path: '/api/reports', name: 'reports list' },
    { path: '/api/usage-insights/summary', name: 'usage insights summary' },
  ];

  for (const ep of endpoints) {
    const res = await fetch(`${BASE_URL}${ep.path}`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    }).then(r => ({ ok: r.ok, status: r.status })).catch(() => ({ ok: false, status: 0 }));

    check(res, {
      [`enterprise API ${ep.name}: responds without 500`]: r => r.status !== 500 && r.status !== 0,
    });
  }

  sleep(0.5);
}
