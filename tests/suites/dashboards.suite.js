/**
 * tests/suites/dashboards.suite.js — Iterate ALL dashboards: render, panels, errors, timing, screenshots.
 * Smart panel detection for all 15 panel types.
 * k6 browser ES module.
 */

import { browser } from 'k6/browser';
import { check, sleep, fail } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';
import { navigate } from '../helpers/page-actions.js';
import { waitForPanels } from '../helpers/wait-strategies.js';
import { detectPanels, getErrorPanels, getNoDataPanels } from '../helpers/panel-detector.js';
import { detectErrors } from '../helpers/error-detector.js';
import { runDataAssertions } from '../helpers/data-assertions.js';

const BASE_URL   = __ENV.GRAFANA_URL  || 'http://localhost:3000';
const API_TOKEN  = __ENV.GRAFANA_TOKEN || '';
const MAX_DASH   = parseInt(__ENV.MAX_DASHBOARDS || '0', 10);  // 0 = all
const SCREENSHOT = __ENV.SCREENSHOT_ON_FAIL === 'true';

// Custom metrics
const dashLoadTime  = new Trend('sentinel_dashboard_load_ms', true);
const panelErrors   = new Counter('sentinel_panel_errors_total');
const noDataPanels  = new Counter('sentinel_no_data_panels_total');
const dashFailed    = new Counter('sentinel_dashboards_failed');
const dashPassRate  = new Rate('sentinel_dashboard_pass_rate');

export const options = {
  scenarios: {
    dashboard_tests: {
      executor: 'shared-iterations',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: {
    sentinel_dashboard_load_ms: ['p(95)<8000'],
    sentinel_dashboard_pass_rate: ['rate>0.8'],
    checks: ['rate>0.8'],
  },
};

export default async function dashboardsSuite() {
  // Fetch dashboard list via API
  const dashboards = await fetchDashboards();
  if (!dashboards.length) {
    fail('No dashboards found — check GRAFANA_URL and GRAFANA_TOKEN');
  }

  const toTest = MAX_DASH > 0 ? dashboards.slice(0, MAX_DASH) : dashboards;
  const page   = await browser.newPage();

  try {
    for (const dash of toTest) {
      await testDashboard(page, dash);
      sleep(0.3);
    }
  } finally {
    await page.close();
  }
}

async function testDashboard(page, dash) {
  const url   = `${BASE_URL}/d/${dash.uid}?kiosk=tv&theme=dark`;
  const start = Date.now();

  try {
    await navigate(page, url, 30000);
    const loadResult = await waitForPanels(page, 25000);
    const loadMs     = Date.now() - start;

    dashLoadTime.add(loadMs, { dashboard: dash.title });

    // Detect panels
    const panels     = await detectPanels(page);
    const errorPanels = await getErrorPanels(page);
    const ndPanels   = await getNoDataPanels(page);

    // Track metrics
    panelErrors.add(errorPanels.length);
    noDataPanels.add(ndPanels.length);

    // Run data assertions
    const dataResult = await runDataAssertions(page);

    // Check for page-level errors
    const pageErrors = await detectErrors(page);

    const hasCriticalError = pageErrors.some(e =>
      ['dashboard_not_found', 'auth_expired', 'permission_denied'].includes(e.type),
    );

    const passed = !hasCriticalError && errorPanels.length === 0 && loadMs < 30000;

    check(null, {
      [`${dash.title}: loads without errors`]:   () => !hasCriticalError,
      [`${dash.title}: panels render`]:           () => panels.length > 0,
      [`${dash.title}: no error panels`]:         () => errorPanels.length === 0,
      [`${dash.title}: loads within 30s`]:        () => loadMs < 30000,
      [`${dash.title}: panels complete loading`]: () => loadResult.panels_stable,
    });

    if (!passed) {
      dashFailed.add(1);
      dashPassRate.add(false);
      if (SCREENSHOT) {
        await page.screenshot({ path: `./screenshots/fail_${dash.uid}_${Date.now()}.png` }).catch(() => {});
      }
    } else {
      dashPassRate.add(true);
    }

    // Log detailed panel breakdown
    console.log(JSON.stringify({
      dashboard: dash.title,
      uid:       dash.uid,
      load_ms:   loadMs,
      panels:    panels.length,
      errors:    errorPanels.length,
      no_data:   ndPanels.length,
      panel_types: countByType(panels),
      passed,
    }));

  } catch (err) {
    dashFailed.add(1);
    dashPassRate.add(false);
    check(null, { [`${dash.title}: no exception`]: () => false });
    console.error(`Dashboard ${dash.uid} failed: ${err.message}`);
  }
}

function countByType(panels) {
  const counts = {};
  for (const p of panels) {
    counts[p.type] = (counts[p.type] || 0) + 1;
  }
  return counts;
}

async function fetchDashboards() {
  try {
    const res = await fetch(`${BASE_URL}/api/search?type=dash-db&limit=5000`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}
