// Full Test Suite Orchestrator
// Runs all tests sequentially, collects results, generates report
import { browser } from 'k6/browser';
import http from 'k6/http';
import { check, sleep } from 'k6';
import config, { buildUrl } from '../config/grafana.config.js';
import { discoverAll, checkDatasourceHealth, testDatasourceQuery } from '../lib/grafana-api.js';
import { generateJsonReport, generateHtmlReport } from '../lib/reporter.js';
import {
  newBrowserContext,
  navigateAndTime,
  waitForPanelsLoaded,
  inspectPanels,
  checkErrorBanners,
  checkTimeRangePicker,
  screenshotOnFail,
  collectConsoleErrors,
  rateLimitDelay,
  retryOperation,
} from '../lib/browser-utils.js';

// Shared results array — populated in VU, read in handleSummary
// Using a global that both contexts can access
const _allResults = [];

export const options = {
  scenarios: {
    full_suite: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      exec: 'runAllTests',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: {
    browser_web_vital_lcp: ['p(75)<4000'],
    browser_web_vital_fid: ['p(75)<300'],
    browser_web_vital_cls: ['p(75)<0.25'],
    http_req_duration: ['p(95)<10000'],
    checks: ['rate>0.60'],
  },
};

// Get session cookie via API
function getSessionCookie() {
  const res = http.post(buildUrl('/login'), JSON.stringify({ user: 'admin', password: 'admin' }), {
    headers: { 'Content-Type': 'application/json' },
    timeout: '10s',
  });
  if (res.status === 200 && res.cookies && res.cookies['grafana_session']) {
    return res.cookies['grafana_session'][0].value;
  }
  return null;
}

async function authenticateContext(context, page) {
  // First try: check if anonymous access is enabled (no auth needed)
  const homeUrl = buildUrl('/');
  await page.goto(homeUrl, { waitUntil: 'networkidle', timeout: 15000 });
  if (!page.url().includes('/login')) {
    console.log('Anonymous access enabled — no login needed');
    return true;
  }

  // Second try: cookie-based session via API
  const session = getSessionCookie();
  if (session) {
    const hostname = config.grafana.url.replace(/^https?:\/\//, '').split(':')[0].split('/')[0];
    await context.addCookies([{
      name: 'grafana_session',
      value: session,
      domain: hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    }]);
    await page.goto(homeUrl, { waitUntil: 'networkidle', timeout: 15000 });
    if (!page.url().includes('/login')) return true;
  }

  // Third try: form login
  console.log('Falling back to form login...');
  await page.goto(buildUrl('/login'), { waitUntil: 'networkidle', timeout: 15000 });
  try {
    const u = await page.waitForSelector('input[name="user"]', { timeout: 10000 });
    await u.fill('admin');
    const p = await page.waitForSelector('input[name="password"]', { timeout: 5000 });
    await p.fill('admin');
    const btn = await page.waitForSelector('button[type="submit"]', { timeout: 5000 });
    await btn.click();
    sleep(3);
    try { const skip = await page.waitForSelector('button:has-text("Skip")', { timeout: 3000 }); if (skip) await skip.click(); } catch(e) {}
  } catch(e) { console.warn(`Login failed: ${e.message}`); }
  return !page.url().includes('/login');
}

// Helper: create a fresh page to avoid k6 browser context exhaustion
async function freshPage(context) {
  const page = await context.newPage();
  return page;
}

export async function runAllTests() {
  const manifest = discoverAll();

  let context = await newBrowserContext();
  let page = await context.newPage();
  const authed = await authenticateContext(context, page);

  // === Phase 1: Login & Home ===
  console.log('=== Phase 1: Login & Home ===');
  {
    const result = { category: 'login', name: 'Login & Authentication', uid: '', status: 'PASS', loadTimeMs: 0, error: null };
    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      result.status = 'FAIL';
      result.error = 'Authentication failed — browser was redirected to /login. Check credentials or anonymous access config.';
    } else {
      result.error = 'OK — authenticated successfully, session active';
    }
    check(null, { 'authentication successful': () => !currentUrl.includes('/login') });
    _allResults.push(result);
  }
  {
    const result = { category: 'home', name: 'Home Page', uid: '', status: 'PASS', loadTimeMs: 0, error: null };
    try {
      const nav = await navigateAndTime(page, '/');
      result.loadTimeMs = nav.loadTimeMs;
      check(null, { 'home page loads': () => nav.ok });
      if (!nav.ok) {
        result.status = 'FAIL';
        result.error = `Home page failed to load (HTTP ${nav.status || 'timeout'}). Grafana may be down or unreachable.`;
      } else {
        result.error = `OK — home page loaded in ${nav.loadTimeMs}ms`;
      }
    } catch (e) { result.status = 'FAIL'; result.error = `Home page error: ${e.message || e}`; }
    _allResults.push(result);
  }
  {
    const result = { category: 'home', name: 'Dashboard Browser', uid: '', status: 'PASS', loadTimeMs: 0, error: null };
    try {
      const nav = await navigateAndTime(page, '/dashboards');
      result.loadTimeMs = nav.loadTimeMs;
      check(null, { 'dashboard browser loads': () => nav.ok });
      if (!nav.ok) {
        result.status = 'FAIL';
        result.error = `Dashboard browser /dashboards failed (HTTP ${nav.status || 'timeout'}). Page did not load within timeout.`;
      } else {
        result.error = `OK — dashboard list loaded in ${nav.loadTimeMs}ms`;
      }
    } catch (e) { result.status = 'FAIL'; result.error = `Dashboard browser error: ${e.message || e}`; }
    _allResults.push(result);
  }

  // Fresh page for each phase to avoid browser context exhaustion
  await page.close();
  page = await freshPage(context);

  // === Phase 2: Dashboards ===
  console.log('=== Phase 2: Dashboards ===');
  for (const dashboard of manifest.dashboards) {
    const result = { category: 'dashboards', name: dashboard.title, uid: dashboard.uid, url: dashboard.url, status: 'PASS', loadTimeMs: 0, error: null, screenshot: null, createdBy: dashboard.createdBy || '', updatedBy: dashboard.updatedBy || '', created: dashboard.created || '', updated: dashboard.updated || '' };
    try {
      const nav = await retryOperation(async () => navigateAndTime(page, `/d/${dashboard.uid}`));
      result.loadTimeMs = nav.loadTimeMs;

      // Check 1: Page loads at all
      check(null, { [`${dashboard.title} — page loads ## ${nav.ok ? 'loaded' : 'HTTP ' + (nav.status || 'timeout')}`]: () => nav.ok });
      if (!nav.ok) {
        result.status = 'FAIL';
        result.error = `Dashboard failed to load (HTTP ${nav.status || 'timeout'}). The page at /d/${dashboard.uid} returned an error or timed out.`;
        result.screenshot = await screenshotOnFail(page, `dashboard_${dashboard.uid}`);
        _allResults.push(result);
        rateLimitDelay();
        continue;
      }

      // Check 2: Load time
      const loadOk = nav.loadTimeMs < config.test.dashboardLoadTimeout;
      check(null, { [`${dashboard.title} — load < ${config.test.dashboardLoadTimeout}ms`]: () => loadOk });

      // Check 3: Panels exist
      const panelCount = await waitForPanelsLoaded(page);
      check(null, { [`${dashboard.title} — panels rendered`]: () => panelCount > 0 });

      // Check 4: Per-panel health inspection
      const panels = await inspectPanels(page);
      const panelIssues = [];

      if (panels.errors.length > 0) {
        panelIssues.push(`${panels.errors.length} panel(s) with errors: [${panels.errors.join(', ')}]`);
      }
      if (panels.pluginMissing.length > 0) {
        panelIssues.push(`${panels.pluginMissing.length} panel(s) missing plugin: [${panels.pluginMissing.join(', ')}]`);
      }
      if (panels.noData.length > 0) {
        panelIssues.push(`${panels.noData.length} panel(s) showing "No data": [${panels.noData.join(', ')}]`);
      }

      // Check 5: Error banners
      const bannerErrors = await checkErrorBanners(page);
      if (bannerErrors.length > 0) {
        panelIssues.push(`Page error banner: ${bannerErrors.join('; ')}`);
      }

      // Check 6: Time range picker
      const hasTimePicker = await checkTimeRangePicker(page);
      if (!hasTimePicker) {
        panelIssues.push('Time range picker not found');
      }

      // Build final status and detailed error message
      if (panels.errors.length > 0 || panels.pluginMissing.length > 0 || bannerErrors.length > 0) {
        result.status = 'FAIL';
        result.screenshot = await screenshotOnFail(page, `dashboard_${dashboard.uid}`);
      } else if (panelCount === 0) {
        result.status = 'FAIL';
        panelIssues.unshift('No panels found on dashboard — it may be empty or failed to render');
      } else if (panels.noData.length > 0 || !hasTimePicker || !loadOk) {
        result.status = 'WARN';
      }

      // Compose error comment
      if (panelIssues.length > 0) {
        result.error = panelIssues.join(' | ');
      } else {
        result.error = `OK — ${panels.total} panels loaded, ${panels.healthy} healthy, load time ${nav.loadTimeMs}ms`;
      }

      // Encode panel result into check name so handleSummary can read it
      const panelOk = panels.errors.length === 0 && panels.pluginMissing.length === 0;
      check(null, { [`${dashboard.title} — no panel errors ## ${result.error}`]: () => panelOk });
      check(null, { [`${dashboard.title} — time range picker`]: () => hasTimePicker });

    } catch (e) {
      result.status = 'FAIL';
      result.error = `Unexpected error testing dashboard: ${(e && e.message) ? e.message : String(e)}`;
    }
    _allResults.push(result);
    rateLimitDelay();
  }

  await page.close();
  page = await freshPage(context);

  // === Phase 3: Alerts ===
  console.log('=== Phase 3: Alerts ===');
  // Helper for common page test pattern
  // Encodes error message into check name so handleSummary can extract it
  async function testPage(path, name, category, uid, checkName) {
    const result = { category, name, uid: uid || '', status: 'PASS', loadTimeMs: 0, error: null };
    try {
      const nav = await navigateAndTime(page, path);
      result.loadTimeMs = nav.loadTimeMs;
      const ok = nav.ok || nav.status === 403;
      if (nav.status === 403) {
        result.error = `OK — access denied (HTTP 403), requires elevated permissions`;
        check(null, { [`${checkName} ## OK — access denied (HTTP 403), requires elevated permissions`]: () => ok });
      } else if (!nav.ok) {
        result.status = 'FAIL';
        result.error = `Page ${path} failed (HTTP ${nav.status || 'timeout'}). Verify page exists and Grafana is responsive.`;
        check(null, { [`${checkName} ## FAIL — ${path} returned HTTP ${nav.status || 'timeout'}`]: () => false });
      } else {
        result.error = `OK — loaded in ${nav.loadTimeMs}ms`;
        check(null, { [`${checkName} ## OK — loaded in ${nav.loadTimeMs}ms`]: () => true });
      }
    } catch (e) {
      result.status = 'FAIL';
      const errMsg = (e && e.message) ? e.message : String(e);
      result.error = `Error loading ${path}: ${errMsg}`;
      check(null, { [`${checkName} ## FAIL — ${errMsg}`]: () => false });
    }
    _allResults.push(result);
    return result;
  }

  await testPage('/alerting/list', 'Alert Rules List', 'alerts', '', 'alert rules page loads');
  for (const rule of manifest.alertRules.slice(0, 5)) {
    if (rule.uid) {
      await testPage(`/alerting/${rule.uid}/edit`, `Alert: ${rule.title || rule.uid}`, 'alerts', rule.uid, `alert "${rule.title}" loads`);
    }
  }
  await testPage('/alerting/silences', 'Silences Page', 'alerts', '', 'silences page loads');
  await testPage('/alerting/notifications', 'Contact Points', 'alerts', '', 'contact points loads');
  await testPage('/alerting/routes', 'Notification Policies', 'alerts', '', 'notification policies loads');

  await page.close();
  page = await freshPage(context);

  // === Phase 4: Explore & Datasources ===
  console.log('=== Phase 4: Explore & Datasources ===');
  await testPage('/explore', 'Explore Page', 'explore', '', 'explore page loads');
  await testPage('/datasources', 'Datasources List', 'datasources', '', 'datasources page loads');

  // Deep datasource testing: config page + API health + query test
  for (const ds of manifest.datasources) {
    const result = { category: 'datasources', name: `Datasource: ${ds.name}`, uid: ds.uid || String(ds.id), status: 'PASS', loadTimeMs: 0, error: null };
    const issues = [];

    // Test 1: Config page loads
    const nav = await navigateAndTime(page, `/datasources/edit/${ds.uid || ds.id}`);
    result.loadTimeMs = nav.loadTimeMs;
    if (!nav.ok && nav.status !== 403) {
      issues.push(`Config page failed (HTTP ${nav.status || 'timeout'})`);
    }

    // Test 2: Health check via API (/api/datasources/uid/<uid>/health)
    const health = checkDatasourceHealth(ds.uid);
    check(null, { [`datasource "${ds.name}" health`]: () => health.ok });
    if (!health.ok) {
      issues.push(`Health check: ${health.status} — ${health.message}`);
    }

    // Test 3: Query test — actually run a query against the datasource
    const query = testDatasourceQuery(ds.uid, ds.type);
    check(null, { [`datasource "${ds.name}" query test`]: () => query.ok });
    if (!query.ok && query.status !== 'SKIP') {
      issues.push(`Query test: ${query.status} — ${query.message}`);
    } else if (query.status === 'SKIP') {
      issues.push(`Query test skipped (no test query for ${ds.type})`);
    }

    // Build final status
    const hasErrors = issues.some(i => i.startsWith('Health check:') || i.startsWith('Query test: HTTP') || i.startsWith('Query test: QUERY_ERROR'));
    if (hasErrors) {
      result.status = 'FAIL';
      result.error = issues.join(' | ');
      check(null, { [`datasource "${ds.name}" loads`]: () => false });
    } else if (issues.length > 0) {
      result.status = issues.some(i => i.startsWith('Config page')) ? 'FAIL' : 'WARN';
      result.error = issues.join(' | ');
      check(null, { [`datasource "${ds.name}" loads ## ${result.error}`]: () => result.status !== 'FAIL' });
    } else {
      result.error = `OK — health: ${health.status}, query: ${query.status}, config page loaded in ${nav.loadTimeMs}ms`;
      check(null, { [`datasource "${ds.name}" loads ## ${result.error}`]: () => true });
    }

    _allResults.push(result);
    rateLimitDelay();
  }

  await page.close();
  page = await freshPage(context);

  // === Phase 5: Plugins ===
  console.log('=== Phase 5: Plugins ===');
  await testPage('/plugins', 'Plugins List', 'plugins', '', 'plugins page loads');
  for (const plugin of manifest.plugins.slice(0, 10)) {
    await testPage(`/plugins/${plugin.id}`, `Plugin: ${plugin.name || plugin.id}`, 'plugins', plugin.id, `plugin "${plugin.name || plugin.id}" loads`);
    rateLimitDelay();
  }

  await page.close();
  page = await freshPage(context);

  // === Phase 6: Users, Teams, Admin ===
  console.log('=== Phase 6: Users, Teams, Admin ===');
  await testPage('/admin/users', 'Admin Users', 'users', '', 'Admin Users loads');
  await testPage('/org/users', 'Org Users', 'users', '', 'Org Users loads');
  await testPage('/org/teams', 'Teams', 'users', '', 'Teams loads');
  await testPage('/profile', 'Profile', 'users', '', 'Profile loads');
  await testPage('/admin/orgs', 'Admin: Organizations', 'admin', '', 'Organizations — page loads');
  await testPage('/admin/stats', 'Admin: Server Stats', 'admin', '', 'Server Stats — page loads');
  await testPage('/admin/settings', 'Admin: Server Settings', 'admin', '', 'Server Settings — page loads');

  console.log(`=== All tests complete: ${_allResults.length} results ===`);

  await page.close();
  await context.close();
}

export function handleSummary(data) {
  const manifest = discoverAll();

  // Since handleSummary runs in a different context, _allResults will be empty.
  // Instead, parse results from k6's check data.
  // Extract check results from the summary data
  const checkResults = [];
  const checks = data.metrics && data.metrics.checks;

  // Build results from _allResults if available, otherwise from check metric data
  const results = _allResults.length > 0 ? _allResults : extractResultsFromChecks(data, manifest);

  console.log(`handleSummary: collected ${results.length} results`);

  const jsonReport = generateJsonReport(results, manifest, config);
  const htmlContent = generateHtmlReport(jsonReport, null);

  return {
    [`${config.test.reportDir}/report.json`]: JSON.stringify(jsonReport, null, 2),
    [`${config.test.reportDir}/report.html`]: htmlContent,
    stdout: generateSummaryOutput(jsonReport),
  };
}

function extractResultsFromChecks(data, manifest) {
  // Extract real pass/fail + error messages from k6's check data
  // Check names use format: "checkName ## error message" to carry data from VU
  const checkMap = {};
  function walkChecks(group) {
    if (group.checks) {
      for (const checkObj of Object.values(group.checks)) {
        const fullName = checkObj.name;
        const parts = fullName.split(' ## ');
        const baseName = parts[0].trim();
        const message = parts[1] || null;
        checkMap[baseName] = {
          passes: checkObj.passes,
          fails: checkObj.fails,
          passed: checkObj.fails === 0,
          message: message,
        };
        // Also store by full name for exact matches
        if (parts.length > 1) {
          checkMap[fullName] = checkMap[baseName];
        }
      }
    }
    if (group.groups) {
      for (const g of Object.values(group.groups)) {
        walkChecks(g);
      }
    }
  }
  if (data.root_group) walkChecks(data.root_group);

  console.log(`Extracted ${Object.keys(checkMap).length} check results from k6 data`);

  const results = [];

  // Helper: determine status + error message from check names
  function statusForCheck(checkName) {
    const c = checkMap[checkName];
    if (!c) return { status: 'PASS', error: null };
    return {
      status: c.passed ? 'PASS' : 'FAIL',
      error: c.message || (c.passed ? null : 'Check failed'),
    };
  }

  // Helper to build result entry
  function buildResult(category, name, uid, checkName) {
    const chk = statusForCheck(checkName);
    return { category, name, uid: uid || '', status: chk.status, loadTimeMs: 0, error: chk.error };
  }

  // Auth + Home
  results.push(buildResult('login', 'Login & Authentication', '', 'authentication successful'));
  results.push(buildResult('home', 'Home Page', '', 'home page loads'));
  results.push(buildResult('home', 'Dashboard Browser', '', 'dashboard browser loads'));

  // Dashboards — combine page load + panel health checks
  for (const d of manifest.dashboards) {
    const pageChk = statusForCheck(`${d.title} — page loads`);
    const panelChk = statusForCheck(`${d.title} — no panel errors`);
    let status, error;

    if (pageChk.status === 'FAIL') {
      status = 'FAIL';
      error = pageChk.error || `Dashboard failed to load`;
    } else if (panelChk.error && panelChk.error.startsWith('OK')) {
      // Panel check message starts with OK — dashboard is healthy
      status = 'PASS';
      error = panelChk.error;
    } else if (panelChk.status === 'FAIL') {
      // Panel errors — check if it's just "no data" (WARN) or real errors (FAIL)
      const msg = panelChk.error || '';
      if (msg.includes('panel(s) with errors') || msg.includes('plugin')) {
        status = 'FAIL';
      } else {
        status = 'WARN';
      }
      error = panelChk.error || 'Panel issues detected';
    } else {
      status = 'PASS';
      error = panelChk.error || pageChk.error || null;
    }

    results.push({ category: 'dashboards', name: d.title, uid: d.uid, status, loadTimeMs: 0, error, createdBy: d.createdBy || '', updatedBy: d.updatedBy || '', created: d.created || '', updated: d.updated || '' });
  }

  // Alerts
  results.push(buildResult('alerts', 'Alert Rules List', '', 'alert rules page loads'));
  for (const r of manifest.alertRules.slice(0, 5)) {
    results.push(buildResult('alerts', `Alert: ${r.title || r.uid}`, r.uid || '', `alert "${r.title}" loads`));
  }
  results.push(buildResult('alerts', 'Silences Page', '', 'silences page loads'));
  results.push(buildResult('alerts', 'Contact Points', '', 'contact points loads'));
  results.push(buildResult('alerts', 'Notification Policies', '', 'notification policies loads'));

  // Explore + Datasources
  results.push(buildResult('explore', 'Explore Page', '', 'explore page loads'));
  results.push(buildResult('datasources', 'Datasources List', '', 'datasources page loads'));
  for (const ds of manifest.datasources) {
    results.push(buildResult('datasources', `Datasource: ${ds.name}`, ds.uid || '', `datasource "${ds.name}" loads`));
  }

  // Plugins
  results.push(buildResult('plugins', 'Plugins List', '', 'plugins page loads'));
  for (const p of manifest.plugins.slice(0, 10)) {
    results.push(buildResult('plugins', `Plugin: ${p.name || p.id}`, p.id, `plugin "${p.name || p.id}" loads`));
  }

  // Users
  results.push(buildResult('users', 'Admin Users', '', 'Admin Users loads'));
  results.push(buildResult('users', 'Org Users', '', 'Org Users loads'));
  results.push(buildResult('users', 'Teams', '', 'Teams loads'));
  results.push(buildResult('users', 'Profile', '', 'Profile loads'));

  // Admin
  results.push(buildResult('admin', 'Admin: Organizations', '', 'Organizations — page loads'));
  results.push(buildResult('admin', 'Admin: Server Stats', '', 'Server Stats — page loads'));
  results.push(buildResult('admin', 'Admin: Server Settings', '', 'Server Settings — page loads'));

  return results;
}

function generateSummaryOutput(report) {
  const s = report.summary;
  const verdict = parseFloat(s.pass_rate) >= 90 ? 'PASSED' : 'FAILED';
  const icon = verdict === 'PASSED' ? '✅' : '❌';

  return `
╔══════════════════════════════════════════════╗
║       GRAFANA UI TEST RESULTS SUMMARY        ║
╠══════════════════════════════════════════════╣
║  Grafana:    ${report.grafana_version.padEnd(32)}║
║  Test Level: ${report.test_level.padEnd(32)}║
║  Total Tests:  ${String(s.total).padEnd(30)}║
║  ✅ Passed:    ${String(s.passed).padEnd(30)}║
║  ❌ Failed:    ${String(s.failed).padEnd(30)}║
║  ⚠️  Warnings:  ${String(s.warnings).padEnd(30)}║
║  Pass Rate:    ${s.pass_rate.padEnd(30)}║
║                                              ║
║  Verdict: ${icon} ${verdict.padEnd(33)}║
╚══════════════════════════════════════════════╝
`;
}
