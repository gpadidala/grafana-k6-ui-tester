// Test 05: Explore Page
import { browser } from 'k6/browser';
import { check, group } from 'k6';
import { authenticatePage, navigateAndTime, newBrowserContext } from '../lib/browser-utils.js';

export default async function exploreTests() {
  const context = await newBrowserContext();
  const page = await context.newPage();

  try {
    await authenticatePage(page);

    await group('Explore Page', async () => {
      const nav = await navigateAndTime(page, '/explore');
      check(null, {
        'explore page loads': () => nav.ok,
        'explore load time < 5s': () => nav.loadTimeMs < 5000,
      });

      check(page, {
        'datasource selector visible': () => {
          const sel = page.locator('[data-testid="data-testid Select a data source"], [class*="datasource-picker"], [class*="DataSourcePicker"]');
          return sel.isVisible();
        },
        'query editor area exists': () => {
          const editor = page.locator('[class*="query-editor"], [class*="QueryEditor"], textarea, [class*="CodeEditor"]');
          return editor.isVisible();
        },
      });
    });
  } finally {
    await page.close();
    await context.close();
  }
}
