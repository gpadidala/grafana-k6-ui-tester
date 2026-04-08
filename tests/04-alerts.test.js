// Test 04: Alert Rules, Silences, Contact Points, Notification Policies
import { browser } from 'k6/browser';
import { check, group } from 'k6';
import { discoverAll } from '../lib/grafana-api.js';
import { authenticatePage, navigateAndTime, newBrowserContext } from '../lib/browser-utils.js';

export default async function alertTests() {
  const manifest = discoverAll();
  const context = await newBrowserContext();
  const page = await context.newPage();

  try {
    await authenticatePage(page);

    await group('Alert Rules List', async () => {
      const nav = await navigateAndTime(page, '/alerting/list');
      check(null, {
        'alert rules page loads': () => nav.ok,
        'alert rules load time < 5s': () => nav.loadTimeMs < 5000,
      });

      if (manifest.alertRules.length > 0) {
        check(page, {
          'alert rules visible on page': () => {
            const content = page.locator('main, [class*="page"]').textContent() || '';
            return content.length > 100;
          },
        });
      }
    });

    await group('Alert Rule Detail Pages', async () => {
      for (const rule of manifest.alertRules.slice(0, 5)) {
        if (rule.uid) {
          const nav = await navigateAndTime(page, `/alerting/${rule.uid}/edit`);
          check(null, {
            [`alert rule "${rule.title || rule.uid}" loads`]: () => nav.ok || nav.status === 403,
          });
        }
      }
    });

    await group('Silences Page', async () => {
      const nav = await navigateAndTime(page, '/alerting/silences');
      check(null, {
        'silences page loads': () => nav.ok,
      });
    });

    await group('Contact Points', async () => {
      const nav = await navigateAndTime(page, '/alerting/notifications');
      check(null, {
        'contact points page loads': () => nav.ok || nav.status === 403,
      });
    });

    await group('Notification Policies', async () => {
      const nav = await navigateAndTime(page, '/alerting/routes');
      check(null, {
        'notification policies page loads': () => nav.ok || nav.status === 403,
      });
    });
  } finally {
    await page.close();
    await context.close();
  }
}
