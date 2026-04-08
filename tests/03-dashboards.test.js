// Test 03: Dashboard Iteration (CRITICAL TEST)
// Discovers and tests every dashboard: load, panel render, errors, timing
import { browser } from 'k6/browser';
import { check, group, sleep } from 'k6';
import config from '../config/grafana.config.js';
import { discoverAll } from '../lib/grafana-api.js';
import {
  authenticatePage,
  navigateAndTime,
  waitForPanelsLoaded,
  checkErrorBanners,
  collectConsoleErrors,
  screenshotOnFail,
  rateLimitDelay,
  checkTimeRangePicker,
  retryOperation,
  newBrowserContext,
} from '../lib/browser-utils.js';

export const results = [];

export default async function dashboardTests() {
  // Discover dashboards
  const manifest = discoverAll();
  const dashboards = manifest.dashboards;

  if (dashboards.length === 0) {
    console.warn('No dashboards discovered — skipping dashboard tests');
    return;
  }

  console.log(`Testing ${dashboards.length} dashboards...`);

  const context = await newBrowserContext();
  const page = await context.newPage();

  try {
    // Authenticate once
    await authenticatePage(page);

    for (const dashboard of dashboards) {
      await group(`Dashboard: ${dashboard.title}`, async () => {
        const result = {
          category: 'dashboards',
          name: dashboard.title,
          uid: dashboard.uid,
          url: dashboard.url,
          status: 'PASS',
          loadTimeMs: 0,
          checks: {},
          screenshot: null,
          error: null,
        };

        try {
          // Collect console errors
          const consoleErrors = collectConsoleErrors(page);

          // Navigate to dashboard
          const nav = await retryOperation(async () => {
            return await navigateAndTime(page, `/d/${dashboard.uid}`);
          });

          result.loadTimeMs = nav.loadTimeMs;

          const pageLoaded = check(null, {
            [`${dashboard.title} — page loads`]: () => nav.ok,
            [`${dashboard.title} — load time < ${config.test.dashboardLoadTimeout}ms`]: () =>
              nav.loadTimeMs < config.test.dashboardLoadTimeout,
          });

          if (!nav.ok) {
            result.status = 'FAIL';
            result.error = `Page failed to load: status ${nav.status}`;
            result.screenshot = await screenshotOnFail(page, `dashboard_${dashboard.uid}`);
            results.push(result);
            rateLimitDelay();
            return;
          }

          // Wait for panels to load
          const panelCount = await waitForPanelsLoaded(page);

          check(null, {
            [`${dashboard.title} — panels rendered`]: () => panelCount > 0,
          });

          if (panelCount === 0) {
            result.status = 'WARN';
            result.error = 'No panels detected on dashboard';
          }

          // Check for error banners
          const bannerErrors = await checkErrorBanners(page);
          const noBannerErrors = check(null, {
            [`${dashboard.title} — no error banners`]: () => bannerErrors.length === 0,
          });

          if (bannerErrors.length > 0) {
            result.status = 'FAIL';
            result.error = `Error banners: ${bannerErrors.join('; ')}`;
          }

          // Check console errors
          const hasConsoleErrors = check(null, {
            [`${dashboard.title} — no console errors`]: () => consoleErrors.length === 0,
          });

          if (consoleErrors.length > 0 && result.status !== 'FAIL') {
            result.status = 'WARN';
            result.error = `Console errors: ${consoleErrors.map((e) => e.text).join('; ')}`;
          }

          // Check time range picker
          const hasTimePicker = await checkTimeRangePicker(page);
          check(null, {
            [`${dashboard.title} — time range picker exists`]: () => hasTimePicker,
          });

          // Screenshot on failure
          if (result.status === 'FAIL') {
            result.screenshot = await screenshotOnFail(page, `dashboard_${dashboard.uid}`);
          }
        } catch (e) {
          result.status = 'FAIL';
          result.error = e.message;
          result.screenshot = await screenshotOnFail(page, `dashboard_${dashboard.uid}_error`);
        }

        results.push(result);
        rateLimitDelay();
      });
    }
  } finally {
    await page.close();
    await context.close();
  }
}
