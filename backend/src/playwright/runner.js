const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

  async runSuites(suiteIds, onProgress, options = {}) {
    const results = [];
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const { context, page } = await this.createAuthContext();

    // Pre-resolve the datasource filter to a concrete DS record so specs
    // can scope their dashboard iteration. Specs that don't look at this
    // option simply ignore it.
    let scopedDs = null;
    if (options.datasourceFilter && (options.datasourceFilter.uid || options.datasourceFilter.name)) {
      try {
        const axios = require('axios');
        const headers = this.token ? { Authorization: `Bearer ${this.token}` } : {};
        const r = await axios.get(`${this.grafanaUrl}/api/datasources`, { headers, timeout: 10000, validateStatus: () => true });
        if (r.status === 200 && Array.isArray(r.data)) {
          const needleUid = (options.datasourceFilter.uid || '').toLowerCase();
          const needleName = (options.datasourceFilter.name || '').toLowerCase();
          scopedDs = r.data.find((d) =>
            (needleUid && String(d.uid).toLowerCase() === needleUid) ||
            (needleName && String(d.name).toLowerCase() === needleName)
          );
        }
      } catch (_) { /* ignore — specs will see scopedDs=null */ }
    }

    try {
      for (const suiteId of suiteIds) {
        const suite = SUITES[suiteId];
        if (!suite) continue;

        if (onProgress) onProgress({ type: 'pw_suite_start', suiteId, suiteName: suite.name, icon: suite.icon });

        const suiteResults = [];
        for (const specName of suite.specs) {
          const pageUrlBefore = (() => { try { return page.url(); } catch { return ''; } })();
          try {
            const specFn = require(`./specs/${specName}`);
            const specResults = await specFn(page, this.grafanaUrl, this.token, {
              onProgress,
              suiteId,
              runId,
              datasourceFilter: options.datasourceFilter || null,
              scopedDs,
            });

            // Enrich each test result with the current page URL (helps user
            // click through to the Grafana page where the test ran) and a
            // source spec name for debugging.
            const pageUrlAfter = (() => { try { return page.url(); } catch { return ''; } })();
            for (const r of specResults) {
              if (!r.url) r.url = pageUrlAfter || pageUrlBefore || this.grafanaUrl;
              if (!r.spec) r.spec = specName;
            }

            suiteResults.push(...specResults);

            for (const r of specResults) {
              if (onProgress) onProgress({ type: 'pw_test_result', suiteId, test: r });
            }
          } catch (e) {
            const pageUrlAtError = (() => { try { return page.url(); } catch { return ''; } })();
            const errTest = {
              name: `${specName} Error`,
              status: 'FAIL',
              detail: e.message,
              error: e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e.message,
              url: pageUrlAtError || this.grafanaUrl,
              spec: specName,
            };
            suiteResults.push(errTest);
            if (onProgress) onProgress({ type: 'pw_test_result', suiteId, test: errTest });
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

    // Persist a JSON report file in the same shape as K6 reports so the
    // existing /api/reports/html/:file endpoint renders Playwright runs
    // with the same template (Dashboard info banners + screenshot links).
    const completedAt = new Date().toISOString();
    const allTests = results.flatMap((s) => s.tests || []);
    const totalPassed = allTests.filter((t) => t.status === 'PASS').length;
    const totalFailed = allTests.filter((t) => t.status === 'FAIL').length;
    const totalWarns = allTests.filter((t) => t.status === 'WARN').length;
    const total = allTests.length;
    const passRate = total > 0 ? `${((totalPassed / total) * 100).toFixed(1)}%` : '0%';

    const report = {
      id: runId,
      grafanaUrl: this.grafanaUrl,
      grafanaVersion: 'unknown',
      startedAt,
      completedAt,
      status: totalFailed > 0 ? 'failed' : 'passed',
      engine: 'playwright',
      categories: results.map((s) => ({
        id: s.id,
        name: s.name,
        icon: s.icon,
        status: s.status,
        tests: s.tests,
        summary: s.summary,
      })),
      summary: { total, passed: totalPassed, failed: totalFailed, warnings: totalWarns, pass_rate: passRate },
    };

    try {
      const reportsDir = path.resolve(config.paths.reports);
      if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
      const base = `report-pw-${runId.slice(0, 8)}-${new Date().toISOString().split('T')[0]}`;
      const file = path.join(reportsDir, `${base}.json`);
      fs.writeFileSync(file, JSON.stringify(report, null, 2));
      report.htmlFile = `${base}.html`;
      logger.info('Playwright report persisted', { file, runId });
    } catch (err) {
      logger.warn('Failed to persist Playwright report', { error: err.message });
    }

    // Return the structure the existing WS handler expects, plus runId
    // and reportFile so the frontend can link to the HTML report.
    return {
      runId,
      reportFile: report.htmlFile,
      results,
      report,
    };
  }
}

module.exports = PlaywrightRunner;
