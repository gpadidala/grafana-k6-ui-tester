// Test 06: Datasource Configuration Pages
import { browser } from 'k6/browser';
import { check } from 'k6';
import { discoverAll } from '../lib/grafana-api.js';
import { authenticatePage, navigateAndTime, rateLimitDelay, newBrowserContext } from '../lib/browser-utils.js';

export const results = [];

export default async function datasourceTests() {
  const manifest = discoverAll();
  const context = await newBrowserContext();
  const page = await context.newPage();

  try {
    await authenticatePage(page);

    // Datasources List
    {
      const result = { category: 'datasources', name: 'Datasources List', uid: '', status: 'PASS', loadTimeMs: 0, error: null };
      try {
        const nav = await navigateAndTime(page, '/datasources');
        result.loadTimeMs = nav.loadTimeMs;
        check(null, {
          'datasources page loads': () => nav.ok,
          'datasources load time < 5s': () => nav.loadTimeMs < 5000,
        });
        if (!nav.ok) { result.status = 'FAIL'; result.error = `Datasources page failed: status ${nav.status}`; }
      } catch (e) { result.status = 'FAIL'; result.error = e.message; }
      results.push(result);
    }

    // Datasource Config Pages
    for (const ds of manifest.datasources) {
      const result = { category: 'datasources', name: `Datasource: ${ds.name}`, uid: ds.uid || String(ds.id), status: 'PASS', loadTimeMs: 0, error: null };
      try {
        const nav = await navigateAndTime(page, `/datasources/edit/${ds.uid || ds.id}`);
        result.loadTimeMs = nav.loadTimeMs;
        check(null, { [`datasource "${ds.name}" config loads`]: () => nav.ok || nav.status === 403 });
        if (!nav.ok && nav.status !== 403) { result.status = 'FAIL'; result.error = `Failed: status ${nav.status}`; }
      } catch (e) { result.status = 'FAIL'; result.error = e.message; }
      results.push(result);
      rateLimitDelay();
    }
  } finally {
    await page.close();
    await context.close();
  }
}
