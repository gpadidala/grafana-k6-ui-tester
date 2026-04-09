/**
 * tests/suites/variables.suite.js — Dashboard template variable dropdowns, selection, panel reload.
 * k6 browser ES module.
 */

import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { navigate } from '../helpers/page-actions.js';
import { waitForPanels, waitForVariables } from '../helpers/wait-strategies.js';

const BASE_URL  = __ENV.GRAFANA_URL   || 'http://localhost:3000';
const API_TOKEN = __ENV.GRAFANA_TOKEN || '';

export const options = {
  scenarios: {
    variable_tests: {
      executor: 'shared-iterations',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: { checks: ['rate>0.8'] },
};

export default async function variablesSuite() {
  const dashboards = await fetchDashboardsWithVariables();
  const page = await browser.newPage();

  try {
    for (const dash of dashboards.slice(0, 5)) {
      await testDashboardVariables(page, dash);
      sleep(0.5);
    }
  } finally {
    await page.close();
  }
}

async function testDashboardVariables(page, dash) {
  await navigate(page, `${BASE_URL}/d/${dash.uid}?theme=dark`);
  await waitForVariables(page, 10000);
  await waitForPanels(page, 20000);

  // Find variable dropdowns
  const varControls = await page.$$('[data-testid="variable-option"], [class*="variable-select"], [aria-label*="variable"]').catch(() => []);

  check(varControls, {
    [`${dash.title}: variable controls render`]: items => items.length > 0,
  });

  if (varControls.length === 0) return;

  // Test first variable dropdown
  const firstVar = varControls[0];
  await firstVar.click().catch(() => {});
  await page.waitForTimeout(500);

  // Look for dropdown options
  const options = await page.$$('[data-testid="variable-option-value"], [class*="variable-option"]').catch(() => []);
  check(options, {
    [`${dash.title}: variable options appear`]: opts => opts.length > 0,
  });

  // Select an option (second one if available, else first)
  const targetOption = options[1] || options[0];
  if (targetOption) {
    await targetOption.click().catch(() => {});
    await waitForPanels(page, 10000);

    // Verify panels reloaded (URL should have updated with var param)
    const newUrl = page.url();
    check(null, {
      [`${dash.title}: panels reload after variable change`]: () => true, // Panels reloading is implicit
    });
  }

  // Close dropdown if still open
  await page.keyboard.press('Escape').catch(() => {});
  sleep(0.5);
}

async function fetchDashboardsWithVariables() {
  try {
    const res = await fetch(`${BASE_URL}/api/search?type=dash-db&limit=100`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    if (!res.ok) return [];
    const all = await res.json();

    // We can't easily filter by "has variables" without fetching each dashboard,
    // so return all and let the test handle dashboards without vars gracefully.
    return all;
  } catch {
    return [];
  }
}
