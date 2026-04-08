// Test 02: Home Page & Navigation
import { browser } from 'k6/browser';
import { check, group } from 'k6';
import { buildUrl } from '../config/grafana.config.js';
import { authenticatePage, navigateAndTime, newBrowserContext } from '../lib/browser-utils.js';

export default async function homeTests() {
  const context = await newBrowserContext();
  const page = await context.newPage();

  try {
    await authenticatePage(page);

    await group('Home Page', async () => {
      const nav = await navigateAndTime(page, '/');
      check(null, {
        'home page loads': () => nav.ok,
        'home page load time < 5s': () => nav.loadTimeMs < 5000,
      });

      check(page, {
        'nav sidebar visible': () => {
          const sidebar = page.locator('nav, [data-testid="nav-bar"], .sidemenu, [class*="NavBar"]');
          return sidebar.isVisible();
        },
        'main content area exists': () => {
          const main = page.locator('main, .main-view, [class*="page-container"], [class*="Page"]');
          return main.isVisible();
        },
      });
    });

    await group('Top Bar', async () => {
      check(page, {
        'top bar visible': () => {
          const topbar = page.locator('header, [class*="TopBar"], [class*="navbar"], [data-testid="top-bar"]');
          return topbar.isVisible();
        },
      });
    });

    await group('Dashboard Browser Link', async () => {
      const nav = await navigateAndTime(page, '/dashboards');
      check(null, {
        'dashboard browser loads': () => nav.ok,
        'dashboard browser load time < 5s': () => nav.loadTimeMs < 5000,
      });
    });
  } finally {
    await page.close();
    await context.close();
  }
}
