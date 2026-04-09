/**
 * tests/suites/explore.suite.js — Explore page + all datasource exploration.
 * k6 browser ES module.
 */

import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { navigate, click } from '../helpers/page-actions.js';
import { waitForAppReady, waitForQueries } from '../helpers/wait-strategies.js';

const BASE_URL  = __ENV.GRAFANA_URL   || 'http://localhost:3000';
const API_TOKEN = __ENV.GRAFANA_TOKEN || '';

export const options = {
  scenarios: {
    explore_tests: {
      executor: 'shared-iterations',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: { checks: ['rate>0.8'] },
};

export default async function exploreSuite() {
  const datasources = await fetchDatasources();
  const page = await browser.newPage();
  try {
    await testExplorePage(page);
    for (const ds of datasources.slice(0, 5)) {
      await testExploreWithDatasource(page, ds);
      sleep(0.5);
    }
    await testExploreSplitView(page);
  } finally {
    await page.close();
  }
}

async function testExplorePage(page) {
  await navigate(page, `${BASE_URL}/explore`);
  await waitForAppReady(page);

  const exploreContainer = await page.$('[data-testid="explore-page"], .explore-container, #explore').catch(() => null);
  check(exploreContainer, { 'explore page renders': el => el !== null });

  const dsSelector = await page.$('[data-testid="data-source-picker"], [aria-label="Data source picker select container"]').catch(() => null);
  check(dsSelector, { 'datasource picker visible': el => el !== null });

  sleep(0.5);
}

async function testExploreWithDatasource(page, ds) {
  await navigate(page, `${BASE_URL}/explore?orgId=1&left={"datasource":"${encodeURIComponent(ds.uid || ds.name)}"}`);
  await waitForAppReady(page);

  const queryEditor = await page.$('[data-testid="query-editor-row"], .query-editor-row').catch(() => null);
  check(queryEditor, { [`explore with ${ds.name}: query editor loads`]: el => el !== null });

  // Try to run a default query
  const runBtn = await page.$('button:has-text("Run query"), [data-testid="run-query-button"]').catch(() => null);
  if (runBtn) {
    await runBtn.click().catch(() => {});
    await waitForQueries(page, 10000);

    const resultContainer = await page.$('[data-testid="explore-results-container"], .logs-panel, .graph-panel, canvas').catch(() => null);
    check(resultContainer, { [`explore with ${ds.name}: results area renders`]: el => el !== null });
  }

  sleep(0.5);
}

async function testExploreSplitView(page) {
  await navigate(page, `${BASE_URL}/explore`);
  await waitForAppReady(page);

  const splitBtn = await page.$('button:has-text("Split"), [data-testid="split-button"], [aria-label="Open split view"]').catch(() => null);
  if (splitBtn) {
    await splitBtn.click().catch(() => {});
    await page.waitForTimeout(1000);

    const panels = await page.$$('[data-testid="explore-pane"], .explore-pane').catch(() => []);
    check(panels, { 'explore split view shows two panes': p => p.length >= 2 });
  }

  sleep(0.5);
}

async function fetchDatasources() {
  try {
    const res = await fetch(`${BASE_URL}/api/datasources`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}
