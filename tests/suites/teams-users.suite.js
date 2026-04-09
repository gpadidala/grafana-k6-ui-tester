/**
 * tests/suites/teams-users.suite.js — Enterprise teams, users, roles.
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
    teams_users_tests: {
      executor: 'shared-iterations',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: { checks: ['rate>0.8'] },
};

export default async function teamsUsersSuite() {
  const page = await browser.newPage();
  try {
    await testUsersPage(page);
    await testTeamsPage(page);
    await testUserApiData();
    await testTeamApiData();
    await testInvitePage(page);
  } finally {
    await page.close();
  }
}

async function testUsersPage(page) {
  await navigate(page, `${BASE_URL}/org/users`);
  await waitForAppReady(page);

  const userList = await page.$('[data-testid="users-list"], .users-table, table').catch(() => null);
  check(null, {
    'users page loads': () => !page.url().includes('/login'),
    'users list renders': () => userList !== null,
  });

  const rowCount = await page.evaluate(() => {
    return document.querySelectorAll('table tbody tr, [data-testid="user-list-row"]').length;
  }).catch(() => 0);

  check(rowCount, {
    'at least one user exists': count => count >= 1,
  });

  sleep(0.5);
}

async function testTeamsPage(page) {
  await navigate(page, `${BASE_URL}/org/teams`);
  await waitForAppReady(page);

  check(null, {
    'teams page loads': () => !page.url().includes('/login'),
  });

  const createBtn = await page.$('button:has-text("New team"), a:has-text("New team"), [data-testid="create-team"]').catch(() => null);
  check(createBtn, {
    'create team button visible': el => el !== null,
  });

  sleep(0.5);
}

async function testUserApiData() {
  const res = await fetch(`${BASE_URL}/api/users?perpage=100`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  }).then(async r => ({ ok: r.ok, data: r.ok ? await r.json() : [], status: r.status }))
    .catch(e => ({ ok: false, data: [], error: e.message }));

  check(res, {
    'users API returns data': r => r.ok,
    'users API returns array': r => Array.isArray(r.data),
    'at least one user in API': r => (r.data || []).length >= 1,
  });

  // Check admin user exists
  const users = res.data || [];
  const hasAdmin = users.some(u => u.isGrafanaAdmin || u.login === 'admin');
  check(null, { 'admin user exists': () => hasAdmin });

  console.log(JSON.stringify({ test: 'users_api', count: users.length }));
  sleep(0.5);
}

async function testTeamApiData() {
  const res = await fetch(`${BASE_URL}/api/teams/search?perpage=100`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  }).then(async r => ({ ok: r.ok, data: r.ok ? await r.json() : null }))
    .catch(() => ({ ok: false, data: null }));

  check(res, {
    'teams API returns data': r => r.ok || r.status === 403, // 403 = enterprise feature
  });

  sleep(0.5);
}

async function testInvitePage(page) {
  await navigate(page, `${BASE_URL}/org/users/invite`);
  await waitForAppReady(page);

  check(null, {
    'invite user page loads': () => !page.url().includes('/login'),
  });

  sleep(0.5);
}
