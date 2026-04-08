// Test 08: Plugins
import { browser } from 'k6/browser';
import { check, group } from 'k6';
import { discoverAll } from '../lib/grafana-api.js';
import { authenticatePage, navigateAndTime, rateLimitDelay, newBrowserContext } from '../lib/browser-utils.js';

export default async function pluginTests() {
  const manifest = discoverAll();
  const context = await newBrowserContext();
  const page = await context.newPage();

  try {
    await authenticatePage(page);

    await group('Plugins List', async () => {
      const nav = await navigateAndTime(page, '/plugins');
      check(null, {
        'plugins page loads': () => nav.ok,
        'plugins load time < 5s': () => nav.loadTimeMs < 5000,
      });
    });

    await group('Plugin Detail Pages', async () => {
      for (const plugin of manifest.plugins.slice(0, 10)) {
        const nav = await navigateAndTime(page, `/plugins/${plugin.id}`);
        check(null, {
          [`plugin "${plugin.name || plugin.id}" loads`]: () => nav.ok,
        });
        rateLimitDelay();
      }
    });
  } finally {
    await page.close();
    await context.close();
  }
}
