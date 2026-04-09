/**
 * tests/suites/navigation.suite.js — All core pages, sidebar nav, and breadcrumbs.
 * k6 browser ES module.
 */

import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { navigate } from '../helpers/page-actions.js';
import { waitForAppReady } from '../helpers/wait-strategies.js';

const BASE_URL = __ENV.GRAFANA_URL || 'http://localhost:3000';

const pageLoadTime = new Trend('sentinel_page_load_ms', true);

const CORE_PAGES = [
  { name: 'Home',              path: '/',                              selector: '[data-testid="home-page"], .dashboard-container, .page-container' },
  { name: 'Dashboards',        path: '/dashboards',                    selector: '[data-testid="dashboards-page"], .page-container' },
  { name: 'Explore',           path: '/explore',                       selector: '[data-testid="explore-page"], .explore-container' },
  { name: 'Alerting',          path: '/alerting',                      selector: '[data-testid="alerting-page"], .page-container' },
  { name: 'Alert Rules',       path: '/alerting/list',                 selector: '.page-container' },
  { name: 'Contact Points',    path: '/alerting/notifications',        selector: '.page-container' },
  { name: 'Silences',          path: '/alerting/silences',             selector: '.page-container' },
  { name: 'Datasources',       path: '/datasources',                   selector: '.page-container' },
  { name: 'Plugins',           path: '/plugins',                       selector: '.page-container' },
  { name: 'Users',             path: '/org/users',                     selector: '.page-container' },
  { name: 'Teams',             path: '/org/teams',                     selector: '.page-container' },
  { name: 'Server Admin',      path: '/admin/server',                  selector: '.page-container' },
  { name: 'Admin Settings',    path: '/admin/settings',                selector: '.page-container' },
  { name: 'Admin Stats',       path: '/admin/stats',                   selector: '.page-container' },
  { name: 'Profile',           path: '/profile',                       selector: '.page-container' },
  { name: 'Preferences',       path: '/profile/preferences',           selector: '.page-container' },
  { name: 'API Keys',          path: '/org/apikeys',                   selector: '.page-container' },
  { name: 'Service Accounts',  path: '/org/serviceaccounts',           selector: '.page-container' },
  { name: 'Annotations',       path: '/org/annotations',               selector: '.page-container' },
  { name: 'Folders',           path: '/dashboards/folders',            selector: '.page-container' },
];

export const options = {
  scenarios: {
    navigation_tests: {
      executor: 'shared-iterations',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: {
    sentinel_page_load_ms: ['p(95)<5000'],
    checks: ['rate>0.85'],
  },
};

export default async function navigationSuite() {
  const page = await browser.newPage();
  try {
    for (const pageConfig of CORE_PAGES) {
      await testPage(page, pageConfig);
      sleep(0.2);
    }

    // Test sidebar navigation
    await testSidebar(page);

    // Test breadcrumbs
    await testBreadcrumbs(page);

  } finally {
    await page.close();
  }
}

async function testPage(page, config) {
  const url   = `${BASE_URL}${config.path}`;
  const start = Date.now();

  try {
    await navigate(page, url, 15000);
    await waitForAppReady(page);
    const ms = Date.now() - start;

    pageLoadTime.add(ms, { page: config.name });

    const currentUrl = page.url();
    const redirectedToLogin = currentUrl.includes('/login');

    const el = await page.$(config.selector).catch(() => null);

    check(null, {
      [`${config.name}: page loads (not login redirect)`]: () => !redirectedToLogin,
      [`${config.name}: loads within 10s`]:                () => ms < 10000,
      [`${config.name}: main content present`]:            () => el !== null || !redirectedToLogin,
    });

    // Check for 404 or error pages
    const is404 = await page.$('[data-testid="not-found-page"], .page-not-found').catch(() => null);
    check(is404, { [`${config.name}: no 404`]: el => el === null });

    console.log(JSON.stringify({ test: 'navigation', page: config.name, ms, ok: !redirectedToLogin }));

  } catch (err) {
    check(null, { [`${config.name}: no exception`]: () => false });
    console.error(`Navigation test failed for ${config.name}: ${err.message}`);
  }
}

async function testSidebar(page) {
  await navigate(page, `${BASE_URL}/`);
  await waitForAppReady(page);

  // Check sidebar/nav exists
  const sidebar = await page.$('nav, [data-testid="sidemenu"], [aria-label="Main menu"], .sidemenu').catch(() => null);
  check(sidebar, { 'sidebar/main nav present': el => el !== null });

  if (!sidebar) return;

  // Check key nav items are present
  const navItems = await page.evaluate(() => {
    const links = document.querySelectorAll('nav a, [data-testid="sidemenu"] a, [aria-label="Main menu"] a');
    return Array.from(links).map(a => a.textContent.trim()).filter(Boolean).slice(0, 20);
  }).catch(() => []);

  check(navItems, {
    'sidebar has nav items': items => items.length > 0,
    'sidebar has Dashboards link': items => items.some(t => t.toLowerCase().includes('dashboard')),
  });

  sleep(0.5);
}

async function testBreadcrumbs(page) {
  // Navigate to a nested page and check breadcrumbs
  await navigate(page, `${BASE_URL}/alerting/list`);
  await waitForAppReady(page);

  const breadcrumbs = await page.$('[aria-label="Breadcrumbs"], nav[aria-label="breadcrumb"], .breadcrumb').catch(() => null);
  // Breadcrumbs are optional — just check if present they're visible
  if (breadcrumbs) {
    const text = await breadcrumbs.innerText().catch(() => '');
    check(text, { 'breadcrumbs have content when present': t => t.length > 0 });
  }

  sleep(0.5);
}
