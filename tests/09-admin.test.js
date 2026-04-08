// Test 09: Admin Pages (graceful skip on 403)
import { browser } from 'k6/browser';
import { check, group } from 'k6';
import { authenticatePage, navigateAndTime, newBrowserContext } from '../lib/browser-utils.js';

const ADMIN_PAGES = [
  { path: '/admin/orgs', name: 'Organizations' },
  { path: '/admin/stats', name: 'Server Stats' },
  { path: '/admin/settings', name: 'Server Settings' },
  { path: '/admin/users', name: 'Server Users' },
  { path: '/admin/ldap', name: 'LDAP' },
  { path: '/admin/storage', name: 'Storage' },
];

export default async function adminTests() {
  const context = await newBrowserContext();
  const page = await context.newPage();

  try {
    await authenticatePage(page);

    for (const adminPage of ADMIN_PAGES) {
      await group(`Admin: ${adminPage.name}`, async () => {
        const nav = await navigateAndTime(page, adminPage.path);

        if (nav.status === 403 || nav.status === 401) {
          console.log(`SKIP: ${adminPage.path} requires elevated permissions (${nav.status})`);
          check(null, {
            [`${adminPage.name} — accessible or graceful deny`]: () => true,
          });
        } else {
          check(null, {
            [`${adminPage.name} — page loads`]: () => nav.ok,
            [`${adminPage.name} — load time < 5s`]: () => nav.loadTimeMs < 5000,
          });
        }
      });
    }
  } finally {
    await page.close();
    await context.close();
  }
}
