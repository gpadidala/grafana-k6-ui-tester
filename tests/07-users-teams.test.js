// Test 07: Users, Teams, Profile
import { browser } from 'k6/browser';
import { check } from 'k6';
import { authenticatePage, navigateAndTime, newBrowserContext } from '../lib/browser-utils.js';

export const results = [];

export default async function usersTeamsTests() {
  const context = await newBrowserContext();
  const page = await context.newPage();

  try {
    await authenticatePage(page);

    // Admin Users
    {
      const result = { category: 'users', name: 'Admin Users', uid: '', status: 'PASS', loadTimeMs: 0, error: null };
      try {
        const nav = await navigateAndTime(page, '/admin/users');
        result.loadTimeMs = nav.loadTimeMs;
        check(null, { 'admin users page loads': () => nav.ok || nav.status === 403 });
        if (!nav.ok && nav.status !== 403) { result.status = 'FAIL'; result.error = `Failed: status ${nav.status}`; }
      } catch (e) { result.status = 'FAIL'; result.error = e.message; }
      results.push(result);
    }

    // Org Users
    {
      const result = { category: 'users', name: 'Org Users', uid: '', status: 'PASS', loadTimeMs: 0, error: null };
      try {
        const nav = await navigateAndTime(page, '/org/users');
        result.loadTimeMs = nav.loadTimeMs;
        check(null, { 'org users page loads': () => nav.ok || nav.status === 403 });
        if (!nav.ok && nav.status !== 403) { result.status = 'FAIL'; result.error = `Failed: status ${nav.status}`; }
      } catch (e) { result.status = 'FAIL'; result.error = e.message; }
      results.push(result);
    }

    // Teams
    {
      const result = { category: 'users', name: 'Teams', uid: '', status: 'PASS', loadTimeMs: 0, error: null };
      try {
        const nav = await navigateAndTime(page, '/org/teams');
        result.loadTimeMs = nav.loadTimeMs;
        check(null, { 'teams page loads': () => nav.ok || nav.status === 403 });
        if (!nav.ok && nav.status !== 403) { result.status = 'FAIL'; result.error = `Failed: status ${nav.status}`; }
      } catch (e) { result.status = 'FAIL'; result.error = e.message; }
      results.push(result);
    }

    // Profile
    {
      const result = { category: 'users', name: 'Profile', uid: '', status: 'PASS', loadTimeMs: 0, error: null };
      try {
        const nav = await navigateAndTime(page, '/profile');
        result.loadTimeMs = nav.loadTimeMs;
        check(null, { 'profile page loads': () => nav.ok });
        if (!nav.ok) { result.status = 'FAIL'; result.error = `Failed: status ${nav.status}`; }
      } catch (e) { result.status = 'FAIL'; result.error = e.message; }
      results.push(result);
    }
  } finally {
    await page.close();
    await context.close();
  }
}
