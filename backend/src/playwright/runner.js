const { chromium } = require('playwright');
const logger = require('../utils/logger');
const config = require('../config');

const SUITES = {
  smoke: { name: 'Smoke Tests', icon: '🔥', specs: ['login', 'navigation', 'health-check'] },
  dashboards: { name: 'Dashboard E2E', icon: '📊', specs: ['dashboard-load', 'dashboard-variables', 'dashboard-time-picker'] },
  panels: { name: 'Panel Rendering', icon: '📱', specs: ['panel-rendering', 'panel-errors'] },
  alerting: { name: 'Alerting E2E', icon: '🔔', specs: ['alert-rules', 'alert-contacts', 'alert-policies'] },
  plugins: { name: 'Plugin Pages', icon: '🧩', specs: ['plugin-catalog', 'plugin-config'] },
  datasources: { name: 'Datasource E2E', icon: '🔌', specs: ['datasource-config', 'datasource-test'] },
  admin: { name: 'Admin Pages', icon: '👥', specs: ['users', 'teams', 'server-settings'] },
  explore: { name: 'Explore', icon: '🔍', specs: ['explore-query'] },
  visual: { name: 'Visual Regression', icon: '📸', specs: ['dashboard-screenshots'] },
  performance: { name: 'Performance', icon: '⚡', specs: ['dashboard-web-vitals'] },
  security: { name: 'Security', icon: '🔒', specs: ['unauthorized-access', 'session-check'] },
  k8s: { name: 'Kubernetes E2E', icon: '☸️', specs: ['k8s-dashboard-load'] },
};

class PlaywrightRunner {
  constructor(grafanaUrl, token) {
    this.grafanaUrl = grafanaUrl || config.grafana.url;
    this.token = token || config.grafana.token;
    this.browser = null;
  }

  getSuites() {
    return Object.entries(SUITES).map(([id, s]) => ({ id, ...s, specCount: s.specs.length }));
  }

  async launch() {
    if (this.browser) return this.browser;
    this.browser = await chromium.launch({ headless: true });
    return this.browser;
  }

  async close() {
    if (this.browser) { await this.browser.close(); this.browser = null; }
  }

  async createAuthContext() {
    const browser = await this.launch();
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();

    // Login via API cookie
    try {
      const loginRes = await page.request.post(`${this.grafanaUrl}/login`, {
        data: { user: 'admin', password: 'admin' },
      });
      if (loginRes.ok()) {
        logger.info('[Playwright] Logged in via API');
      }
    } catch (e) {
      logger.warn('[Playwright] API login failed, trying form login');
    }

    // Navigate to verify session
    await page.goto(this.grafanaUrl, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2000);

    // If on login page, do form login
    if (page.url().includes('/login')) {
      try {
        await page.fill('input[name="user"]', 'admin');
        await page.fill('input[name="password"]', 'admin');
        await page.click('button[type="submit"]');
        await page.waitForURL('**/*', { timeout: 15000 });
        // Skip change password
        try {
          const skip = page.locator('a[href*="skip"], button:has-text("Skip")');
          if (await skip.isVisible({ timeout: 3000 })) await skip.click();
        } catch {}
      } catch (e) {
        logger.warn('[Playwright] Form login failed:', e.message);
      }
    }

    return { context, page };
  }

  async runSuites(suiteIds, onProgress) {
    const results = [];
    const { context, page } = await this.createAuthContext();

    try {
      for (const suiteId of suiteIds) {
        const suite = SUITES[suiteId];
        if (!suite) continue;

        if (onProgress) onProgress({ type: 'pw_suite_start', suiteId, suiteName: suite.name, icon: suite.icon });

        const suiteResults = [];
        for (const specName of suite.specs) {
          try {
            const specFn = require(`./specs/${specName}`);
            const specResults = await specFn(page, this.grafanaUrl, this.token, { onProgress, suiteId });
            suiteResults.push(...specResults);

            for (const r of specResults) {
              if (onProgress) onProgress({ type: 'pw_test_result', suiteId, test: r });
            }
          } catch (e) {
            suiteResults.push({ name: `${specName} Error`, status: 'FAIL', detail: e.message });
            if (onProgress) onProgress({ type: 'pw_test_result', suiteId, test: { name: `${specName} Error`, status: 'FAIL', detail: e.message } });
          }
        }

        const passed = suiteResults.filter(r => r.status === 'PASS').length;
        const failed = suiteResults.filter(r => r.status === 'FAIL').length;
        const warns = suiteResults.filter(r => r.status === 'WARN').length;

        const suiteResult = {
          id: suiteId, name: suite.name, icon: suite.icon,
          status: failed > 0 ? 'FAIL' : warns > 0 ? 'WARN' : 'PASS',
          tests: suiteResults,
          summary: { total: suiteResults.length, passed, failed, warnings: warns },
        };

        results.push(suiteResult);
        if (onProgress) onProgress({ type: 'pw_suite_done', suiteId, result: suiteResult });
      }
    } finally {
      await context.close();
    }

    return results;
  }
}

module.exports = PlaywrightRunner;
