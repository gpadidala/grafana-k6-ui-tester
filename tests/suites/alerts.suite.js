/**
 * tests/suites/alerts.suite.js — Alert rules, groups, silences, contacts, notification policies, mute timings.
 * k6 browser ES module.
 */

import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { navigate } from '../helpers/page-actions.js';
import { waitForAppReady } from '../helpers/wait-strategies.js';
import { detectErrors } from '../helpers/error-detector.js';

const BASE_URL  = __ENV.GRAFANA_URL   || 'http://localhost:3000';
const API_TOKEN = __ENV.GRAFANA_TOKEN || '';

export const options = {
  scenarios: {
    alerts_tests: {
      executor: 'shared-iterations',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: {
    checks: ['rate>0.85'],
  },
};

export default async function alertsSuite() {
  const page = await browser.newPage();
  try {
    await testAlertRulesPage(page);
    await testAlertGroupsPage(page);
    await testSilencesPage(page);
    await testContactPointsPage(page);
    await testNotificationPoliciesPage(page);
    await testMuteTimingsPage(page);
    await testAlertApiData(page);
  } finally {
    await page.close();
  }
}

async function testAlertRulesPage(page) {
  await navigate(page, `${BASE_URL}/alerting/list`);
  await waitForAppReady(page);

  const errors = await detectErrors(page);
  const hasContent = await page.$('[data-testid="alert-rule-list-item"], .alert-list-table, table').catch(() => null);

  check(null, {
    'alert rules page loads': () => !page.url().includes('/login'),
    'no critical errors on alert rules page': () => !errors.some(e => e.type === 'permission_denied'),
    'alert rules list renders': () => hasContent !== null,
  });

  // Count alert rules
  const ruleCount = await page.evaluate(() => {
    return document.querySelectorAll('[data-testid="alert-rule-list-item"], .alert-list-item').length;
  }).catch(() => 0);

  console.log(JSON.stringify({ test: 'alert_rules_page', rule_count: ruleCount }));
  sleep(0.5);
}

async function testAlertGroupsPage(page) {
  await navigate(page, `${BASE_URL}/alerting/groups`);
  await waitForAppReady(page);

  const hasContent = await page.$('[data-testid="alert-group-list"], .alert-groups-table').catch(() => null);
  check(null, {
    'alert groups page loads': () => !page.url().includes('/login'),
  });
  sleep(0.5);
}

async function testSilencesPage(page) {
  await navigate(page, `${BASE_URL}/alerting/silences`);
  await waitForAppReady(page);

  const errors = await detectErrors(page);
  check(null, {
    'silences page loads': () => !page.url().includes('/login'),
    'no auth errors on silences page': () => !errors.some(e => e.type === 'auth_expired'),
  });

  // Check create silence button exists (indicates proper permissions)
  const createBtn = await page.$('[data-testid="create-silence-button"], button:has-text("New silence"), a:has-text("New silence")').catch(() => null);
  check(createBtn, { 'create silence button visible (write permissions)': el => el !== null });

  sleep(0.5);
}

async function testContactPointsPage(page) {
  await navigate(page, `${BASE_URL}/alerting/notifications`);
  await waitForAppReady(page);

  const errors = await detectErrors(page);
  const tabExists = await page.$('[data-testid="tab-Contact points"], [data-testid="contact-point-tab"]').catch(() => null);

  check(null, {
    'contact points page loads': () => !page.url().includes('/login'),
    'no permission errors on contact points': () => !errors.some(e => e.type === 'permission_denied'),
  });

  // Navigate to Contact points tab if needed
  if (tabExists) {
    await tabExists.click().catch(() => {});
    await page.waitForTimeout(1000);
  }

  const cpCount = await page.evaluate(() => {
    return document.querySelectorAll('[data-testid="contact-point-list-row"], .contact-point-row').length;
  }).catch(() => 0);

  console.log(JSON.stringify({ test: 'contact_points', count: cpCount }));
  sleep(0.5);
}

async function testNotificationPoliciesPage(page) {
  await navigate(page, `${BASE_URL}/alerting/routes`);
  await waitForAppReady(page);

  check(null, {
    'notification policies page loads': () => !page.url().includes('/login'),
  });

  const policyTree = await page.$('[data-testid="notification-routing-tree"], .notification-policies-tree').catch(() => null);
  check(policyTree, { 'notification policy tree renders': el => el !== null });

  sleep(0.5);
}

async function testMuteTimingsPage(page) {
  await navigate(page, `${BASE_URL}/alerting/time-intervals`);
  await waitForAppReady(page);

  check(null, {
    'mute timings page loads': () => !page.url().includes('/login'),
  });
  sleep(0.5);
}

async function testAlertApiData(page) {
  // Validate alert rule data via API (not browser)
  const res = await page.evaluate(async (url, token) => {
    try {
      const r = await fetch(`${url}/api/v1/provisioning/alert-rules`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const data = await r.json();
        return { ok: true, count: Array.isArray(data) ? data.length : 0, status: r.status };
      }
      return { ok: false, status: r.status };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, BASE_URL, API_TOKEN);

  check(res, {
    'alert rules API returns valid response': r => r.ok || r.status === 403,
    'alert rules API count readable': r => typeof r.count === 'number',
  });

  // Check alert manager health
  const amHealth = await page.evaluate(async (url, token) => {
    try {
      const r = await fetch(`${url}/api/alertmanager/grafana/api/v2/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { ok: r.ok, status: r.status };
    } catch {
      return { ok: false };
    }
  }, BASE_URL, API_TOKEN);

  check(amHealth, {
    'alertmanager is healthy': r => r.ok,
  });

  sleep(0.5);
}
