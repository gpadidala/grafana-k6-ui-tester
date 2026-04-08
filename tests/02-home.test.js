// Test 02: Home Page & Navigation
import { browser } from 'k6/browser';
import { check } from 'k6';
import { buildUrl } from '../config/grafana.config.js';
import { authenticatePage, navigateAndTime, newBrowserContext } from '../lib/browser-utils.js';

export const results = [];

export default async function homeTests() {
  const context = await newBrowserContext();
  const page = await context.newPage();

  try {
    await authenticatePage(page);

    // Home Page
    {
      const result = { category: 'home', name: 'Home Page', uid: '', status: 'PASS', loadTimeMs: 0, error: null };
      try {
        const nav = await navigateAndTime(page, '/');
        result.loadTimeMs = nav.loadTimeMs;
        check(null, {
          'home page loads': () => nav.ok,
          'home page load time < 5s': () => nav.loadTimeMs < 5000,
        });
        if (!nav.ok) { result.status = 'FAIL'; result.error = 'Home page failed to load'; }
      } catch (e) { result.status = 'FAIL'; result.error = e.message; }
      results.push(result);
    }

    // Dashboard Browser
    {
      const result = { category: 'home', name: 'Dashboard Browser', uid: '', status: 'PASS', loadTimeMs: 0, error: null };
      try {
        const nav = await navigateAndTime(page, '/dashboards');
        result.loadTimeMs = nav.loadTimeMs;
        check(null, {
          'dashboard browser loads': () => nav.ok,
          'dashboard browser load time < 5s': () => nav.loadTimeMs < 5000,
        });
        if (!nav.ok) { result.status = 'FAIL'; result.error = 'Dashboard browser failed to load'; }
      } catch (e) { result.status = 'FAIL'; result.error = e.message; }
      results.push(result);
    }
  } finally {
    await page.close();
    await context.close();
  }
}
