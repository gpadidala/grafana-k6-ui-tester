/**
 * tests/helpers/error-detector.js — Detect all Grafana error patterns in the browser.
 * ES Module for use in k6 browser tests.
 */

export const ERROR_TYPES = {
  DASHBOARD_NOT_FOUND:  'dashboard_not_found',
  PANEL_ERROR:          'panel_error',
  PLUGIN_NOT_FOUND:     'plugin_not_found',
  DATASOURCE_ERROR:     'datasource_error',
  QUERY_ERROR:          'query_error',
  NO_DATA:              'no_data',
  LOADING_TIMEOUT:      'loading_timeout',
  CONSOLE_ERROR:        'console_error',
  NETWORK_ERROR:        'network_error',
  AUTH_EXPIRED:         'auth_expired',
  PERMISSION_DENIED:    'permission_denied',
};

/** DOM selectors for each error type */
const ERROR_SELECTORS = {
  panel_error:       '[data-testid="panel-error"], .panel-info-corner--error, [aria-label*="panel error"]',
  datasource_error:  '[data-testid="panel-error-message"], .query-error-text',
  no_data:           '[data-testid="no-data-panel"], .no-results-container, [data-testid="empty-panel"]',
  permission_denied: '[data-testid="access-denied"], .alert-warning:has-text("You do not have")',
};

/** Text patterns for page-level errors */
const PAGE_ERROR_PATTERNS = [
  { pattern: /dashboard not found/i,             type: ERROR_TYPES.DASHBOARD_NOT_FOUND },
  { pattern: /plugin .* not installed/i,         type: ERROR_TYPES.PLUGIN_NOT_FOUND },
  { pattern: /plugin .* is not available/i,      type: ERROR_TYPES.PLUGIN_NOT_FOUND },
  { pattern: /datasource .* not found/i,         type: ERROR_TYPES.DATASOURCE_ERROR },
  { pattern: /error connecting to datasource/i,  type: ERROR_TYPES.DATASOURCE_ERROR },
  { pattern: /failed to query datasource/i,      type: ERROR_TYPES.QUERY_ERROR },
  { pattern: /query failed/i,                    type: ERROR_TYPES.QUERY_ERROR },
  { pattern: /session expired/i,                 type: ERROR_TYPES.AUTH_EXPIRED },
  { pattern: /your token has expired/i,          type: ERROR_TYPES.AUTH_EXPIRED },
  { pattern: /access denied/i,                   type: ERROR_TYPES.PERMISSION_DENIED },
  { pattern: /you do not have permission/i,      type: ERROR_TYPES.PERMISSION_DENIED },
  { pattern: /403 forbidden/i,                   type: ERROR_TYPES.PERMISSION_DENIED },
  { pattern: /404 not found/i,                   type: ERROR_TYPES.DASHBOARD_NOT_FOUND },
];

/**
 * Scan the current page for all error patterns.
 * Returns array of { type, message, selector? }
 */
export async function detectErrors(page) {
  const errors = [];

  // Check DOM selectors
  const domErrors = await page.evaluate((selectors) => {
    const found = [];
    for (const [type, selector] of Object.entries(selectors)) {
      const els = document.querySelectorAll(selector);
      for (const el of els) {
        found.push({ type, message: el.textContent.trim().slice(0, 200), selector });
      }
    }
    return found;
  }, ERROR_SELECTORS).catch(() => []);

  errors.push(...domErrors);

  // Check page text for patterns
  const bodyText = await page.evaluate(() => document.body.innerText || '').catch(() => '');
  for (const { pattern, type } of PAGE_ERROR_PATTERNS) {
    if (pattern.test(bodyText)) {
      const match = bodyText.match(pattern);
      if (!errors.find(e => e.type === type)) {
        errors.push({ type, message: match ? match[0] : type });
      }
    }
  }

  return errors;
}

/**
 * Collect browser console errors during a page interaction.
 * Returns an array of { level, text } for each console error/warning.
 */
export function collectConsoleErrors(page) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      const text = msg.text();
      // Filter out known benign noise
      if (!isNoiseMessage(text)) {
        errors.push({ level: msg.type(), text: text.slice(0, 500) });
      }
    }
  });
  return errors;
}

/**
 * Collect failed network requests (4xx, 5xx).
 */
export function collectNetworkErrors(page) {
  const errors = [];
  page.on('response', async response => {
    const status = response.status();
    if (status >= 400) {
      errors.push({
        type:   ERROR_TYPES.NETWORK_ERROR,
        status,
        url:    response.url(),
      });
    }
  });
  return errors;
}

/**
 * Comprehensive page health check — runs all detectors.
 */
export async function pageHealthCheck(page) {
  const domErrors     = await detectErrors(page);
  const networkFailed = await page.evaluate(() => {
    return window.__sentinelNetworkErrors || [];
  }).catch(() => []);

  return {
    healthy:       domErrors.length === 0,
    errors:        domErrors,
    network_errors: networkFailed,
    total_errors:  domErrors.length + networkFailed.length,
  };
}

function isNoiseMessage(text) {
  const noise = [
    'ResizeObserver loop',
    'Non-passive event listener',
    'DevTools',
    'favicon.ico',
    'Source map',
  ];
  return noise.some(n => text.includes(n));
}
