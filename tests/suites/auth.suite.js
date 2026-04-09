/**
 * tests/suites/auth.suite.js — Login, SSO, session, and token validation tests.
 * k6 browser ES module.
 */

import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { navigate, fill, click, assertText, assertNoErrorToast } from '../helpers/page-actions.js';
import { waitForAppReady } from '../helpers/wait-strategies.js';

const BASE_URL = __ENV.GRAFANA_URL || 'http://localhost:3000';
const ADMIN_USER = __ENV.GRAFANA_USER || 'admin';
const ADMIN_PASS = __ENV.GRAFANA_PASS || 'admin';
const API_TOKEN  = __ENV.GRAFANA_TOKEN || '';

export const options = {
  scenarios: {
    auth_tests: {
      executor: 'shared-iterations',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: {
    browser_web_vital_lcp: ['p(75)<3000'],
    checks: ['rate>0.9'],
  },
};

export default async function authSuite() {
  const page = await browser.newPage();

  try {
    await runLoginTest(page);
    await runLogoutTest(page);
    await runTokenAuthTest(page);
    await runSessionValidationTest(page);
    await runInvalidCredentialsTest(page);
  } finally {
    await page.close();
  }
}

async function runLoginTest(page) {
  await navigate(page, `${BASE_URL}/login`);
  await waitForAppReady(page);

  const loginForm = await page.$('form[action="/login"], [data-testid="login-form"]');
  check(loginForm, { 'login form present': el => el !== null });

  if (loginForm) {
    await fill(page, 'input[name="user"], [data-testid="data-testid Username input field"]', ADMIN_USER);
    await fill(page, 'input[name="password"], [data-testid="data-testid Password input field"]', ADMIN_PASS);
    await click(page, 'button[type="submit"], [data-testid="data-testid Login button"]');

    // Wait for redirect to home after login
    await page.waitForNavigation({ timeout: 10000 }).catch(() => {});
    const currentUrl = page.url();

    check(null, {
      'redirected after login': () => !currentUrl.includes('/login'),
      'no login error': () => !currentUrl.includes('loginError'),
    });
  }

  sleep(1);
}

async function runLogoutTest(page) {
  // Ensure logged in first
  await navigate(page, `${BASE_URL}/`);
  await waitForAppReady(page);

  // Logout via API to reset state
  await page.goto(`${BASE_URL}/logout`);
  await page.waitForNavigation({ timeout: 8000 }).catch(() => {});

  const url = page.url();
  check(null, {
    'logout redirects to login': () => url.includes('/login') || url.endsWith('/'),
  });

  // Re-login for subsequent tests
  await navigate(page, `${BASE_URL}/login`);
  await fill(page, 'input[name="user"]', ADMIN_USER).catch(() => {});
  await fill(page, 'input[name="password"]', ADMIN_PASS).catch(() => {});
  await click(page, 'button[type="submit"]').catch(() => {});
  await page.waitForNavigation({ timeout: 8000 }).catch(() => {});

  sleep(1);
}

async function runTokenAuthTest(page) {
  if (!API_TOKEN) {
    check(null, { 'token auth: token configured': () => false });
    return;
  }

  // Test the API token works by hitting /api/user
  const res = await page.evaluate(async (url, token) => {
    try {
      const r = await fetch(`${url}/api/user`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { ok: r.ok, status: r.status };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, BASE_URL, API_TOKEN);

  check(res, {
    'API token is valid': r => r.ok,
    'API token returns 200': r => r.status === 200,
  });

  sleep(0.5);
}

async function runSessionValidationTest(page) {
  // Navigate to profile to validate session is active
  await navigate(page, `${BASE_URL}/profile`);
  await waitForAppReady(page);

  const currentUrl = page.url();
  check(null, {
    'session still active (not redirected to login)': () => !currentUrl.includes('/login'),
  });

  // Check profile page loaded
  const profileForm = await page.$('[data-testid="user-profile-page"], .page-container form').catch(() => null);
  check(profileForm, { 'profile page loaded': el => el !== null });

  sleep(1);
}

async function runInvalidCredentialsTest(page) {
  await navigate(page, `${BASE_URL}/login`);
  await waitForAppReady(page);

  const formExists = await page.$('input[name="user"]').catch(() => null);
  if (!formExists) { check(null, { 'invalid creds test: login form available': () => false }); return; }

  await fill(page, 'input[name="user"]', 'invalid_user_sentinel_test');
  await fill(page, 'input[name="password"]', 'wrong_password_12345');
  await click(page, 'button[type="submit"]');

  await page.waitForTimeout(2000);

  const errorEl = await page.$('[data-testid="alert-error"], .alert-error, [aria-label="Alert error"]').catch(() => null);
  const stillOnLogin = page.url().includes('/login') || page.url().includes('loginError');

  check(null, {
    'invalid login shows error or stays on login page': () => !!errorEl || stillOnLogin,
  });

  // Restore valid login
  await fill(page, 'input[name="user"]', ADMIN_USER).catch(() => {});
  await fill(page, 'input[name="password"]', ADMIN_PASS).catch(() => {});
  await click(page, 'button[type="submit"]').catch(() => {});
  await page.waitForNavigation({ timeout: 8000 }).catch(() => {});

  sleep(1);
}
