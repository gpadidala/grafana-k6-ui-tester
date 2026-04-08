// Test 06: Datasource Configuration Pages
import { browser } from 'k6/browser';
import { check, group } from 'k6';
import { discoverAll } from '../lib/grafana-api.js';
import { authenticatePage, navigateAndTime, rateLimitDelay, newBrowserContext } from '../lib/browser-utils.js';

export default async function datasourceTests() {
  const manifest = discoverAll();
  const context = await newBrowserContext();
  const page = await context.newPage();

  try {
    await authenticatePage(page);

    await group('Datasources List', async () => {
      const nav = await navigateAndTime(page, '/datasources');
      check(null, {
        'datasources page loads': () => nav.ok,
        'datasources load time < 5s': () => nav.loadTimeMs < 5000,
      });
    });

    await group('Datasource Config Pages', async () => {
      for (const ds of manifest.datasources) {
        const nav = await navigateAndTime(page, `/datasources/edit/${ds.uid || ds.id}`);
        check(null, {
          [`datasource "${ds.name}" config loads`]: () => nav.ok || nav.status === 403,
        });
        rateLimitDelay();
      }
    });
  } finally {
    await page.close();
    await context.close();
  }
}
