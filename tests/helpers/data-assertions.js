/**
 * tests/helpers/data-assertions.js — Assertions for Grafana panel data states.
 * ES Module for use in k6 browser tests.
 */

import { check } from 'k6';

/**
 * Assert that all panels on the page show actual data (not "No data").
 * Returns { passed, noDataPanels, totalPanels }
 */
export async function assertPanelsHaveData(page, allowedNoDataPct = 10) {
  const result = await page.evaluate(() => {
    const allPanels    = document.querySelectorAll('[data-panelid], [class*="panel-container"]');
    const noDataPanels = document.querySelectorAll(
      '[data-testid="no-data-panel"], .no-results-container, [data-testid="empty-panel"]',
    );

    const noDataTitles = [];
    for (const el of noDataPanels) {
      const titleEl = el.closest('[data-panelid]')?.querySelector('[data-testid="panel-title"]');
      noDataTitles.push(titleEl ? titleEl.textContent.trim() : 'unknown');
    }

    return {
      totalPanels:    allPanels.length,
      noDataCount:    noDataPanels.length,
      noDataTitles,
    };
  }).catch(() => ({ totalPanels: 0, noDataCount: 0, noDataTitles: [] }));

  const noDataPct = result.totalPanels > 0
    ? (result.noDataCount / result.totalPanels) * 100
    : 0;

  const passed = noDataPct <= allowedNoDataPct;

  check(null, {
    [`no-data panels <= ${allowedNoDataPct}%`]: () => passed,
  });

  return {
    passed,
    noDataCount:   result.noDataCount,
    totalPanels:   result.totalPanels,
    noDataPct:     Math.round(noDataPct * 10) / 10,
    noDataTitles:  result.noDataTitles,
  };
}

/**
 * Assert a stat panel shows a numeric value (not "--" or "N/A").
 */
export async function assertStatHasValue(page, panelTitle) {
  const value = await page.evaluate((title) => {
    const panels = document.querySelectorAll('[data-testid="panel-title"]');
    for (const el of panels) {
      if (el.textContent.trim().toLowerCase().includes(title.toLowerCase())) {
        const container = el.closest('[data-panelid]');
        const valueEl   = container?.querySelector('[data-testid="stat-value"], .stat-value, .singlestat-panel-value');
        return valueEl ? valueEl.textContent.trim() : null;
      }
    }
    return null;
  }, panelTitle).catch(() => null);

  const hasValue = value !== null && value !== '--' && value !== 'N/A' && value !== '';
  check(null, { [`stat panel "${panelTitle}" has a value`]: () => hasValue });
  return { passed: hasValue, value };
}

/**
 * Assert a timeseries panel has rendered SVG paths (actual data lines).
 */
export async function assertTimeseriesHasLines(page, panelTitle) {
  const lineCount = await page.evaluate((title) => {
    const panels = document.querySelectorAll('[data-testid="panel-title"]');
    for (const el of panels) {
      if (el.textContent.trim().toLowerCase().includes(title.toLowerCase())) {
        const container = el.closest('[data-panelid]');
        const lines     = container?.querySelectorAll('svg path[stroke]') || [];
        return lines.length;
      }
    }
    return 0;
  }, panelTitle).catch(() => 0);

  const passed = lineCount > 0;
  check(null, { [`timeseries "${panelTitle}" has data lines`]: () => passed });
  return { passed, lineCount };
}

/**
 * Assert a table panel has at least N rows.
 */
export async function assertTableHasRows(page, panelTitle, minRows = 1) {
  const rowCount = await page.evaluate((title, min) => {
    const panels = document.querySelectorAll('[data-testid="panel-title"]');
    for (const el of panels) {
      if (el.textContent.trim().toLowerCase().includes(title.toLowerCase())) {
        const container = el.closest('[data-panelid]');
        const rows      = container?.querySelectorAll('table tbody tr, [role="row"]') || [];
        return rows.length;
      }
    }
    return 0;
  }, panelTitle, minRows).catch(() => 0);

  const passed = rowCount >= minRows;
  check(null, { [`table "${panelTitle}" has >= ${minRows} rows`]: () => passed });
  return { passed, rowCount };
}

/**
 * Assert a gauge panel has a rendered SVG arc (data is present).
 */
export async function assertGaugeHasValue(page, panelTitle) {
  const hasArc = await page.evaluate((title) => {
    const panels = document.querySelectorAll('[data-testid="panel-title"]');
    for (const el of panels) {
      if (el.textContent.trim().toLowerCase().includes(title.toLowerCase())) {
        const container = el.closest('[data-panelid]');
        return !!(container?.querySelector('svg path, svg circle'));
      }
    }
    return false;
  }, panelTitle).catch(() => false);

  check(null, { [`gauge "${panelTitle}" has SVG arc`]: () => hasArc });
  return { passed: hasArc };
}

/**
 * Assert that logs panel shows log entries.
 */
export async function assertLogsHaveEntries(page, panelTitle) {
  const logCount = await page.evaluate((title) => {
    const panels = document.querySelectorAll('[data-testid="panel-title"]');
    for (const el of panels) {
      if (el.textContent.trim().toLowerCase().includes(title.toLowerCase())) {
        const container = el.closest('[data-panelid]');
        return (container?.querySelectorAll('[data-testid="log-row-message"], .logs-row') || []).length;
      }
    }
    return 0;
  }, panelTitle).catch(() => 0);

  const passed = logCount > 0;
  check(null, { [`logs "${panelTitle}" has entries`]: () => passed });
  return { passed, logCount };
}

/**
 * Run all relevant data assertions for visible panels.
 * Returns summary: { totalChecked, passed, failed }
 */
export async function runDataAssertions(page) {
  const results = await page.evaluate(() => {
    const summary = { totalPanels: 0, noData: 0, errors: 0, loaded: 0 };
    const panels  = document.querySelectorAll('[data-panelid]');
    summary.totalPanels = panels.length;
    for (const panel of panels) {
      if (panel.querySelector('[data-testid="no-data-panel"], .no-results-container')) summary.noData++;
      else if (panel.querySelector('[data-testid="panel-error"], .panel-info-corner--error')) summary.errors++;
      else summary.loaded++;
    }
    return summary;
  }).catch(() => ({ totalPanels: 0, noData: 0, errors: 0, loaded: 0 }));

  const passed = results.errors === 0;
  check(null, {
    'no panel errors': () => results.errors === 0,
    'panels have data': () => results.noData / Math.max(results.totalPanels, 1) < 0.5,
  });
  return { ...results, passed };
}
