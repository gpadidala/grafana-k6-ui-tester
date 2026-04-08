// Test 04: Alert Rules, Silences, Contact Points, Notification Policies
import { browser } from 'k6/browser';
import { check } from 'k6';
import { discoverAll } from '../lib/grafana-api.js';
import { authenticatePage, navigateAndTime, newBrowserContext } from '../lib/browser-utils.js';

export const results = [];

export default async function alertTests() {
  const manifest = discoverAll();
  const context = await newBrowserContext();
  const page = await context.newPage();

  try {
    await authenticatePage(page);

    // Alert Rules List
    {
      const result = { category: 'alerts', name: 'Alert Rules List', uid: '', status: 'PASS', loadTimeMs: 0, error: null };
      try {
        const nav = await navigateAndTime(page, '/alerting/list');
        result.loadTimeMs = nav.loadTimeMs;
        check(null, { 'alert rules page loads': () => nav.ok });
        if (!nav.ok) { result.status = 'FAIL'; result.error = `Alert rules page failed: status ${nav.status}`; }
      } catch (e) { result.status = 'FAIL'; result.error = e.message; }
      results.push(result);
    }

    // Alert Rule Details
    for (const rule of manifest.alertRules.slice(0, 5)) {
      if (rule.uid) {
        const result = { category: 'alerts', name: `Alert Rule: ${rule.title || rule.uid}`, uid: rule.uid, status: 'PASS', loadTimeMs: 0, error: null };
        try {
          const nav = await navigateAndTime(page, `/alerting/${rule.uid}/edit`);
          result.loadTimeMs = nav.loadTimeMs;
          check(null, { [`alert rule "${rule.title || rule.uid}" loads`]: () => nav.ok || nav.status === 403 });
          if (!nav.ok && nav.status !== 403) { result.status = 'FAIL'; result.error = `Failed: status ${nav.status}`; }
        } catch (e) { result.status = 'FAIL'; result.error = e.message; }
        results.push(result);
      }
    }

    // Silences
    {
      const result = { category: 'alerts', name: 'Silences Page', uid: '', status: 'PASS', loadTimeMs: 0, error: null };
      try {
        const nav = await navigateAndTime(page, '/alerting/silences');
        result.loadTimeMs = nav.loadTimeMs;
        check(null, { 'silences page loads': () => nav.ok });
        if (!nav.ok) { result.status = 'FAIL'; result.error = `Silences page failed: status ${nav.status}`; }
      } catch (e) { result.status = 'FAIL'; result.error = e.message; }
      results.push(result);
    }

    // Contact Points
    {
      const result = { category: 'alerts', name: 'Contact Points', uid: '', status: 'PASS', loadTimeMs: 0, error: null };
      try {
        const nav = await navigateAndTime(page, '/alerting/notifications');
        result.loadTimeMs = nav.loadTimeMs;
        check(null, { 'contact points page loads': () => nav.ok || nav.status === 403 });
        if (!nav.ok && nav.status !== 403) { result.status = 'FAIL'; result.error = `Contact points failed: status ${nav.status}`; }
      } catch (e) { result.status = 'FAIL'; result.error = e.message; }
      results.push(result);
    }

    // Notification Policies
    {
      const result = { category: 'alerts', name: 'Notification Policies', uid: '', status: 'PASS', loadTimeMs: 0, error: null };
      try {
        const nav = await navigateAndTime(page, '/alerting/routes');
        result.loadTimeMs = nav.loadTimeMs;
        check(null, { 'notification policies page loads': () => nav.ok || nav.status === 403 });
        if (!nav.ok && nav.status !== 403) { result.status = 'FAIL'; result.error = `Notification policies failed: status ${nav.status}`; }
      } catch (e) { result.status = 'FAIL'; result.error = e.message; }
      results.push(result);
    }
  } finally {
    await page.close();
    await context.close();
  }
}
