// Test 01: Login & Authentication
import { browser } from 'k6/browser';
import { check, group } from 'k6';
import config, { buildUrl } from '../config/grafana.config.js';
import { authenticatePage, newBrowserContext } from '../lib/browser-utils.js';

export default async function loginTests() {
  const context = await newBrowserContext();
  const page = await context.newPage();

  try {
    await group('Login Page', async () => {
      const res = await page.goto(buildUrl('/login'), { waitUntil: 'networkidle', timeout: 10000 });
      check(page, {
        'login page loads': () => res && res.status() < 400,
        'login form visible': () => page.locator('input[name="user"], input[aria-label="Username input field"]').isVisible(),
        'password field visible': () => page.locator('input[name="password"], input[aria-label="Password input field"]').isVisible(),
        'login button exists': () => page.locator('button[type="submit"]').isVisible(),
      });
    });

    await group('Authentication', async () => {
      await authenticatePage(page);
      const currentUrl = page.url();
      check(null, {
        'redirected after login': () => !currentUrl.includes('/login'),
        'landed on home or dashboard': () => currentUrl.includes('/') || currentUrl.includes('/d/'),
      });
    });

    await group('Session Validation', async () => {
      await page.goto(buildUrl('/api/user'), { waitUntil: 'networkidle', timeout: 5000 });
      const bodyText = await page.locator('body').textContent();
      check(null, {
        'session is valid': () => bodyText.includes('"id"') || bodyText.includes('"login"'),
        'not unauthorized': () => !bodyText.includes('Unauthorized'),
      });
    });
  } finally {
    await page.close();
    await context.close();
  }
}
