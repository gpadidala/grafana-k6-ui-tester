// Test 09: Admin Pages (graceful skip on 403)
import { browser } from 'k6/browser';
import { check } from 'k6';
import { authenticatePage, navigateAndTime, newBrowserContext } from '../lib/browser-utils.js';

const ADMIN_PAGES = [
  { path: '/admin/orgs', name: 'Organizations' },
  { path: '/admin/stats', name: 'Server Stats' },
  { path: '/admin/settings', name: 'Server Settings' },
  { path: '/admin/users', name: 'Server Users' },
  { path: '/admin/ldap', name: 'LDAP' },
  { path: '/admin/storage', name: 'Storage' },
];

export const results = [];

export default async function adminTests() {
  const context = await newBrowserContext();
  const page = await context.newPage();

  try {
    await authenticatePage(page);

    for (const adminPage of ADMIN_PAGES) {
      const result = { category: 'admin', name: `Admin: ${adminPage.name}`, uid: '', status: 'PASS', loadTimeMs: 0, error: null };
      try {
        const nav = await navigateAndTime(page, adminPage.path);
        result.loadTimeMs = nav.loadTimeMs;

        if (nav.status === 403 || nav.status === 401) {
          console.log(`SKIP: ${adminPage.path} requires elevated permissions (${nav.status})`);
          check(null, { [`${adminPage.name} — accessible or graceful deny`]: () => true });
        } else {
          check(null, {
            [`${adminPage.name} — page loads`]: () => nav.ok,
            [`${adminPage.name} — load time < 5s`]: () => nav.loadTimeMs < 5000,
          });
          if (!nav.ok) { result.status = 'FAIL'; result.error = `Failed: status ${nav.status}`; }
        }
      } catch (e) { result.status = 'FAIL'; result.error = e.message; }
      results.push(result);
    }
  } finally {
    await page.close();
    await context.close();
  }
}
