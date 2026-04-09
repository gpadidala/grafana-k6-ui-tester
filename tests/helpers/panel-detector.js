/**
 * tests/helpers/panel-detector.js — Detect panel types, loading state, and errors.
 * ES Module for use in k6 browser tests.
 */

/** All known Grafana panel type identifiers */
export const PANEL_TYPES = {
  timeseries:   'timeseries',
  stat:         'stat',
  gauge:        'gauge',
  barchart:     'barchart',
  bargauge:     'bargauge',
  table:        'table',
  piechart:     'piechart',
  heatmap:      'heatmap',
  logs:         'logs',
  nodeGraph:    'nodeGraph',
  geomap:       'geomap',
  canvas:       'canvas',
  text:         'text',
  alertlist:    'alertlist',
  dashlist:     'dashlist',
  news:         'news',
  histogram:    'histogram',
  // Legacy (deprecated)
  graph:        'graph',
  singlestat:   'singlestat',
  'table-old':  'table-old',
};

/**
 * Detect all panel elements currently rendered on the page.
 * Returns array of { type, title, hasData, hasError, loadTimeMs }
 */
export async function detectPanels(page) {
  const panelData = await page.evaluate(() => {
    const panels = document.querySelectorAll('[data-panelid], [class*="panel-container"]');
    return Array.from(panels).map(el => {
      const titleEl  = el.querySelector('[data-testid="panel-title"], .panel-title, h2');
      const loadBar  = el.querySelector('[data-testid="panel-loading-bar"]');
      const errorEl  = el.querySelector('[data-testid="panel-error"], .panel-info-corner--error');
      const noDataEl = el.querySelector('[data-testid="no-data-panel"], .no-results-container');
      const svgEl    = el.querySelector('svg');
      const canvasEl = el.querySelector('canvas');
      const tableEl  = el.querySelector('table');
      const textEl   = el.querySelector('.markdown-html, .panel-text');

      // Detect panel type from class names or data attributes
      let type = el.dataset?.type || null;
      if (!type) {
        const classes = el.className || '';
        if (classes.includes('timeseries')) type = 'timeseries';
        else if (classes.includes('stat'))    type = 'stat';
        else if (classes.includes('gauge'))   type = 'gauge';
        else if (classes.includes('table'))   type = 'table';
        else if (tableEl)                     type = 'table';
        else if (svgEl)                       type = 'timeseries';
        else if (canvasEl)                    type = 'heatmap';
        else if (textEl)                      type = 'text';
      }

      return {
        panelId:    el.dataset?.panelid || null,
        type:       type || 'unknown',
        title:      titleEl ? titleEl.textContent.trim() : null,
        isLoading:  !!loadBar,
        hasError:   !!errorEl,
        hasNoData:  !!noDataEl,
        hasSvg:     !!svgEl,
        hasCanvas:  !!canvasEl,
        hasTable:   !!tableEl,
      };
    });
  }).catch(() => []);

  return panelData;
}

/**
 * Wait until all visible panels have finished loading.
 * Returns the number of panels that loaded without errors.
 */
export async function waitForPanelsLoaded(page, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let lastCount = -1;

  while (Date.now() < deadline) {
    const loadingCount = await page.evaluate(() => {
      return document.querySelectorAll('[data-testid="panel-loading-bar"]').length;
    }).catch(() => 0);

    if (loadingCount === 0 && lastCount === 0) break;
    lastCount = loadingCount;
    await new Promise(r => setTimeout(r, 500));
  }

  const panels = await detectPanels(page);
  return {
    total:   panels.length,
    loaded:  panels.filter(p => !p.isLoading).length,
    errors:  panels.filter(p => p.hasError).length,
    noData:  panels.filter(p => p.hasNoData).length,
  };
}

/**
 * Check if a specific panel type is present and rendered.
 */
export async function isPanelTypeRendered(page, type) {
  const panels = await detectPanels(page);
  return panels.some(p => p.type === type && !p.isLoading);
}

/**
 * Get panels that have "No data" state.
 */
export async function getNoDataPanels(page) {
  const panels = await detectPanels(page);
  return panels.filter(p => p.hasNoData);
}

/**
 * Get panels that have error state.
 */
export async function getErrorPanels(page) {
  const panels = await detectPanels(page);
  return panels.filter(p => p.hasError);
}

/**
 * Assert a panel by title is present and loaded without error.
 */
export async function assertPanelLoaded(page, titleSubstring) {
  const panels = await detectPanels(page);
  const found  = panels.find(p => p.title && p.title.toLowerCase().includes(titleSubstring.toLowerCase()));
  if (!found) throw new Error(`Panel "${titleSubstring}" not found on page`);
  if (found.hasError) throw new Error(`Panel "${titleSubstring}" has an error`);
  if (found.isLoading) throw new Error(`Panel "${titleSubstring}" is still loading`);
  return found;
}
