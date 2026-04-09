/**
 * tests/suites/admin.suite.js — Server admin, stats, settings, logs.
 * k6 browser ES module.
 */

import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { navigate } from '../helpers/page-actions.js';
import { waitForAppReady } from '../helpers/wait-strategies.js';

const BASE_URL  = __ENV.GRAFANA_URL   || 'http://localhost:3000';
const API_TOKEN = __ENV.GRAFANA_TOKEN || '';

export const options = {
  scenarios: {
    admin_tests: {
      executor: 'shared-iterations',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: { checks: ['rate>0.8'] },
};

export default async function adminSuite() {
  const page = await browser.newPage();
  try {
    await testServerAdminPage(page);
    await testAdminStatsPage(page);
    await testAdminSettingsPage(page);
    await testAdminUsersPage(page);
    await testAdminOrgsPage(page);
    await testAdminApiStats();
  } finally {
    await page.close();
  }
}

async function testServerAdminPage(page) {
  await navigate(page, `${BASE_URL}/admin/server`);
  await waitForAppReady(page);
  check(null, { 'server admin page loads': () => !page.url().includes('/login') });
  sleep(0.5);
}

async function testAdminStatsPage(page) {
  await navigate(page, `${BASE_URL}/admin/stats`);
  await waitForAppReady(page);

  const statsPage = await page.$('[data-testid="server-stats-page"], .page-container').catch(() => null);
  check(null, { 'admin stats page loads': () => !page.url().includes('/login') });

  // Check for stats cards
  const statCards = await page.$$('[class*="stats-card"], [data-testid="stat-card"]').catch(() => []);
  console.log(JSON.stringify({ test: 'admin_stats', stat_cards: statCards.length }));
  sleep(0.5);
}

async function testAdminSettingsPage(page) {
  await navigate(page, `${BASE_URL}/admin/settings`);
  await waitForAppReady(page);
  check(null, { 'admin settings page loads': () => !page.url().includes('/login') });
  sleep(0.5);
}

async function testAdminUsersPage(page) {
  await navigate(page, `${BASE_URL}/admin/users`);
  await waitForAppReady(page);

  const table = await page.$('table, [data-testid="users-list"]').catch(() => null);
  check(null, {
    'admin users page loads': () => !page.url().includes('/login'),
    'admin users table renders': () => table !== null,
  });
  sleep(0.5);
}

async function testAdminOrgsPage(page) {
  await navigate(page, `${BASE_URL}/admin/orgs`);
  await waitForAppReady(page);
  check(null, { 'admin orgs page loads': () => !page.url().includes('/login') });
  sleep(0.5);
}

async function testAdminApiStats() {
  const statsRes = await fetch(`${BASE_URL}/api/admin/stats`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  }).then(async r => ({ ok: r.ok, status: r.status, data: r.ok ? await r.json() : null }))
    .catch(() => ({ ok: false }));

  check(statsRes, {
    'admin stats API returns data': r => r.ok,
    'admin stats has total_users': r => r.ok && typeof r.data?.total_users === 'number',
    'admin stats has total_dashboards': r => r.ok && typeof r.data?.total_dashboards === 'number',
  });

  if (statsRes.ok) {
    console.log(JSON.stringify({
      test: 'admin_api_stats',
      total_users:       statsRes.data.total_users,
      total_orgs:        statsRes.data.total_orgs,
      total_dashboards:  statsRes.data.total_dashboards,
      total_datasources: statsRes.data.total_datasources,
    }));
  }

  sleep(0.5);
}
