// Test 08: Plugins
import { browser } from 'k6/browser';
import { check } from 'k6';
import { discoverAll } from '../lib/grafana-api.js';
import { authenticatePage, navigateAndTime, rateLimitDelay, newBrowserContext } from '../lib/browser-utils.js';

export const results = [];

export default async function pluginTests() {
  const manifest = discoverAll();
  const context = await newBrowserContext();
  const page = await context.newPage();

  try {
    await authenticatePage(page);

    // Plugins List
    {
      const result = { category: 'plugins', name: 'Plugins List', uid: '', status: 'PASS', loadTimeMs: 0, error: null };
      try {
        const nav = await navigateAndTime(page, '/plugins');
        result.loadTimeMs = nav.loadTimeMs;
        check(null, {
          'plugins page loads': () => nav.ok,
          'plugins load time < 5s': () => nav.loadTimeMs < 5000,
        });
        if (!nav.ok) { result.status = 'FAIL'; result.error = `Plugins page failed: status ${nav.status}`; }
      } catch (e) { result.status = 'FAIL'; result.error = e.message; }
      results.push(result);
    }

    // Plugin Detail Pages
    for (const plugin of manifest.plugins.slice(0, 10)) {
      const result = { category: 'plugins', name: `Plugin: ${plugin.name || plugin.id}`, uid: plugin.id, status: 'PASS', loadTimeMs: 0, error: null };
      try {
        const nav = await navigateAndTime(page, `/plugins/${plugin.id}`);
        result.loadTimeMs = nav.loadTimeMs;
        check(null, { [`plugin "${plugin.name || plugin.id}" loads`]: () => nav.ok });
        if (!nav.ok) { result.status = 'FAIL'; result.error = `Failed: status ${nav.status}`; }
      } catch (e) { result.status = 'FAIL'; result.error = e.message; }
      results.push(result);
      rateLimitDelay();
    }
  } finally {
    await page.close();
    await context.close();
  }
}
