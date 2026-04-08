// Test 05: Explore Page
import { browser } from 'k6/browser';
import { check } from 'k6';
import { authenticatePage, navigateAndTime, newBrowserContext } from '../lib/browser-utils.js';

export const results = [];

export default async function exploreTests() {
  const context = await newBrowserContext();
  const page = await context.newPage();

  try {
    await authenticatePage(page);

    // Explore Page
    {
      const result = { category: 'explore', name: 'Explore Page', uid: '', status: 'PASS', loadTimeMs: 0, error: null };
      try {
        const nav = await navigateAndTime(page, '/explore');
        result.loadTimeMs = nav.loadTimeMs;
        check(null, {
          'explore page loads': () => nav.ok,
          'explore load time < 5s': () => nav.loadTimeMs < 5000,
        });
        if (!nav.ok) { result.status = 'FAIL'; result.error = `Explore page failed: status ${nav.status}`; }
      } catch (e) { result.status = 'FAIL'; result.error = e.message; }
      results.push(result);
    }
  } finally {
    await page.close();
    await context.close();
  }
}
