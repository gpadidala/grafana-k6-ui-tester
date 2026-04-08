// Test 01: Login & Authentication
import { browser } from 'k6/browser';
import { check } from 'k6';
import config, { buildUrl } from '../config/grafana.config.js';
import { authenticatePage, newBrowserContext } from '../lib/browser-utils.js';

export const results = [];

export default async function loginTests() {
  const context = await newBrowserContext();
  const page = await context.newPage();

  try {
    // Login Page
    {
      const result = { category: 'login', name: 'Login Page', uid: '', status: 'PASS', loadTimeMs: 0, error: null };
      try {
        const start = Date.now();
        const res = await page.goto(buildUrl('/login'), { waitUntil: 'networkidle', timeout: 10000 });
        result.loadTimeMs = Date.now() - start;
        const ok = res && res.status() < 400;
        check(null, { 'login page loads': () => ok });
        if (!ok) { result.status = 'FAIL'; result.error = 'Login page failed to load'; }
      } catch (e) { result.status = 'FAIL'; result.error = e.message; }
      results.push(result);
    }

    // Authentication
    {
      const result = { category: 'login', name: 'Authentication', uid: '', status: 'PASS', loadTimeMs: 0, error: null };
      try {
        const start = Date.now();
        await authenticatePage(page);
        result.loadTimeMs = Date.now() - start;
        const currentUrl = page.url();
        const ok = !currentUrl.includes('/login');
        check(null, { 'redirected after login': () => ok });
        if (!ok) { result.status = 'FAIL'; result.error = 'Still on login page after auth'; }
      } catch (e) { result.status = 'FAIL'; result.error = e.message; }
      results.push(result);
    }

    // Session Validation
    {
      const result = { category: 'login', name: 'Session Validation', uid: '', status: 'PASS', loadTimeMs: 0, error: null };
      try {
        await page.goto(buildUrl('/api/user'), { waitUntil: 'networkidle', timeout: 5000 });
        const bodyText = await page.locator('body').textContent();
        const valid = bodyText.includes('"id"') || bodyText.includes('"login"');
        check(null, { 'session is valid': () => valid });
        if (!valid) { result.status = 'FAIL'; result.error = 'Session not valid'; }
      } catch (e) { result.status = 'FAIL'; result.error = e.message; }
      results.push(result);
    }
  } finally {
    await page.close();
    await context.close();
  }
}
