// Test 07: Users, Teams, Profile
import { browser } from 'k6/browser';
import { check, group } from 'k6';
import { authenticatePage, navigateAndTime, newBrowserContext } from '../lib/browser-utils.js';

export default async function usersTeamsTests() {
  const context = await newBrowserContext();
  const page = await context.newPage();

  try {
    await authenticatePage(page);

    await group('Admin Users', async () => {
      const nav = await navigateAndTime(page, '/admin/users');
      check(null, {
        'admin users page loads': () => nav.ok || nav.status === 403,
      });
      if (nav.status === 403) {
        console.log('SKIP: /admin/users requires server admin — got 403');
      }
    });

    await group('Org Users', async () => {
      const nav = await navigateAndTime(page, '/org/users');
      check(null, {
        'org users page loads': () => nav.ok || nav.status === 403,
      });
    });

    await group('Teams', async () => {
      const nav = await navigateAndTime(page, '/org/teams');
      check(null, {
        'teams page loads': () => nav.ok || nav.status === 403,
      });
    });

    await group('Profile', async () => {
      const nav = await navigateAndTime(page, '/profile');
      check(null, {
        'profile page loads': () => nav.ok,
      });
    });
  } finally {
    await page.close();
    await context.close();
  }
}
