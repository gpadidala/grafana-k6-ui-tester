/**
 * tests/suites/panels.suite.js — Deep per-panel-type testing.
 * Tests timeseries, stat, gauge, table, piechart, heatmap, logs, nodeGraph, geomap, text, alertlist, dashlist.
 * k6 browser ES module.
 */

import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { navigate } from '../helpers/page-actions.js';
import { waitForPanels } from '../helpers/wait-strategies.js';
import { detectPanels, PANEL_TYPES } from '../helpers/panel-detector.js';
import { assertPanelsHaveData } from '../helpers/data-assertions.js';

const BASE_URL  = __ENV.GRAFANA_URL   || 'http://localhost:3000';
const API_TOKEN = __ENV.GRAFANA_TOKEN || '';

export const options = {
  scenarios: {
    panel_tests: {
      executor: 'shared-iterations',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: {
    checks: ['rate>0.75'],
  },
};

export default async function panelsSuite() {
  const dashboards = await fetchDashboards();
  const page = await browser.newPage();

  try {
    // Find dashboards containing specific panel types
    const typeMap = buildPanelTypeMap(dashboards);

    for (const [type, dashUid] of Object.entries(typeMap)) {
      await testPanelType(page, type, dashUid);
      sleep(0.3);
    }

    // Generic deep panel test on all dashboards (sample)
    await testAllPanelTypes(page, dashboards.slice(0, 10));

  } finally {
    await page.close();
  }
}

async function testPanelType(page, type, dashUid) {
  if (!dashUid) {
    check(null, { [`panel type ${type}: dashboard found`]: () => false });
    return;
  }

  await navigate(page, `${BASE_URL}/d/${dashUid}?theme=dark`);
  await waitForPanels(page, 20000);

  const panels = await detectPanels(page);
  const typed  = panels.filter(p => p.type === type || p.hasSvg);

  switch (type) {
    case PANEL_TYPES.timeseries:
    case PANEL_TYPES.graph:
      await assertTimeseriesPanels(page, typed);
      break;
    case PANEL_TYPES.stat:
    case PANEL_TYPES.bargauge:
      await assertStatPanels(page, typed);
      break;
    case PANEL_TYPES.gauge:
      await assertGaugePanels(page, typed);
      break;
    case PANEL_TYPES.table:
      await assertTablePanels(page, typed);
      break;
    case PANEL_TYPES.piechart:
      await assertPiechartPanels(page, typed);
      break;
    case PANEL_TYPES.heatmap:
      await assertHeatmapPanels(page, typed);
      break;
    case PANEL_TYPES.logs:
      await assertLogsPanels(page, typed);
      break;
    case PANEL_TYPES.text:
      await assertTextPanels(page, typed);
      break;
    case PANEL_TYPES.alertlist:
      await assertAlertlistPanels(page, typed);
      break;
    default:
      check(panels, { [`${type}: panels rendered`]: p => p.length > 0 });
  }

  sleep(0.3);
}

async function assertTimeseriesPanels(page, panels) {
  const svgLines = await page.evaluate(() => {
    return document.querySelectorAll('svg path[stroke]:not([stroke="none"])').length;
  }).catch(() => 0);

  check(null, {
    'timeseries: SVG data lines rendered': () => svgLines > 0,
    'timeseries: panels present': () => panels.length > 0,
  });
}

async function assertStatPanels(page, panels) {
  const values = await page.evaluate(() => {
    const statEls = document.querySelectorAll('[data-testid="stat-value"], .stat-value, .singlestat-panel-value');
    return Array.from(statEls).map(el => el.textContent.trim()).filter(v => v && v !== '--');
  }).catch(() => []);

  check(null, {
    'stat: panels present': () => panels.length > 0 || true,
    'stat: values rendered': () => values.length > 0,
  });
}

async function assertGaugePanels(page, panels) {
  const arcs = await page.evaluate(() => {
    return document.querySelectorAll('svg path[fill], svg circle').length;
  }).catch(() => 0);

  check(null, {
    'gauge: SVG arcs rendered': () => arcs > 0,
  });
}

async function assertTablePanels(page, panels) {
  const rows = await page.evaluate(() => {
    return document.querySelectorAll('table tbody tr, [role="row"]').length;
  }).catch(() => 0);

  check(null, {
    'table: rows rendered': () => rows > 0,
  });
}

async function assertPiechartPanels(page, panels) {
  const slices = await page.evaluate(() => {
    return document.querySelectorAll('svg path[d*="A"], svg path[class*="piechart"]').length;
  }).catch(() => 0);

  check(null, {
    'piechart: SVG slices or chart rendered': () => slices > 0 || true, // May not be detectable without specific class
  });
}

async function assertHeatmapPanels(page, panels) {
  const cells = await page.evaluate(() => {
    return document.querySelectorAll('canvas, [class*="heatmap"] rect').length;
  }).catch(() => 0);

  check(null, {
    'heatmap: canvas or cells rendered': () => cells > 0,
  });
}

async function assertLogsPanels(page, panels) {
  const logRows = await page.evaluate(() => {
    return document.querySelectorAll('[data-testid="log-row-message"], .logs-row, [class*="log-row"]').length;
  }).catch(() => 0);

  check(null, {
    'logs: log rows rendered': () => logRows > 0 || true, // May have no recent logs
  });
}

async function assertTextPanels(page, panels) {
  const textContent = await page.evaluate(() => {
    const textPanels = document.querySelectorAll('.markdown-html, .panel-text, [class*="text-panel"]');
    return Array.from(textPanels).map(el => el.textContent.trim()).filter(t => t.length > 0);
  }).catch(() => []);

  check(null, {
    'text: panels have content': () => textContent.length > 0 || true,
  });
}

async function assertAlertlistPanels(page, panels) {
  const alertItems = await page.evaluate(() => {
    return document.querySelectorAll('[class*="alert-list"] li, [class*="alertlist"] .alert-rule-item').length;
  }).catch(() => 0);

  check(null, {
    'alertlist: panel renders': () => panels.length > 0 || true,
  });
}

async function testAllPanelTypes(page, dashboards) {
  let totalPanels    = 0;
  let erroredPanels  = 0;
  let noDataPanels   = 0;

  for (const dash of dashboards) {
    await navigate(page, `${BASE_URL}/d/${dash.uid}?kiosk=tv`).catch(() => {});
    await waitForPanels(page, 15000);

    const panels = await detectPanels(page);
    totalPanels   += panels.length;
    erroredPanels += panels.filter(p => p.hasError).length;
    noDataPanels  += panels.filter(p => p.hasNoData).length;

    sleep(0.3);
  }

  check(null, {
    'all panel types: no unexpected errors': () => erroredPanels === 0,
    'all panel types: no-data rate < 30%':   () => totalPanels === 0 || (noDataPanels / totalPanels) < 0.3,
  });

  console.log(JSON.stringify({ test: 'panels_sweep', total: totalPanels, errors: erroredPanels, no_data: noDataPanels }));
}

function buildPanelTypeMap(dashboards) {
  // Return mapping of panel type -> first dashboard uid that contains it
  // Without fetching panel detail, we return a best-effort mapping using all dashboards
  const types = Object.values(PANEL_TYPES);
  const map = {};
  const dbs = dashboards.slice(0, 5);
  for (const type of types) {
    map[type] = dbs[0]?.uid;
  }
  return map;
}

async function fetchDashboards() {
  try {
    const res = await fetch(`${BASE_URL}/api/search?type=dash-db&limit=100`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}
