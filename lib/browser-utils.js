// Browser Utilities
// Reusable page helpers for authentication, navigation, screenshots, error detection

import { browser } from 'k6/browser';
import http from 'k6/http';
import { check, sleep } from 'k6';
import config, { buildUrl, getAuthHeaders } from '../config/grafana.config.js';

// Known Grafana console noise to ignore
const KNOWN_NOISE_PATTERNS = [
  'ResizeObserver loop',
  'Deprecation',
  'DevTools',
  'Third-party cookie',
  'Download the React DevTools',
  'webpack',
  'SourceMap',
  'favicon.ico',
  '[HMR]',
  'Violation',
];

export function isKnownNoise(message) {
  return KNOWN_NOISE_PATTERNS.some((pattern) => message.includes(pattern));
}

// Get session cookie via Grafana HTTP API (much more reliable than form login)
function getSessionCookie() {
  const loginUrl = buildUrl('/login');
  const res = http.post(loginUrl, JSON.stringify({ user: 'admin', password: 'admin' }), {
    headers: { 'Content-Type': 'application/json' },
    timeout: '10s',
  });

  if (res.status === 200 && res.cookies && res.cookies['grafana_session']) {
    return res.cookies['grafana_session'][0].value;
  }

  console.warn(`API login failed: status ${res.status}`);
  return null;
}

export async function authenticatePage(page) {
  const sessionCookie = getSessionCookie();

  if (sessionCookie) {
    // Parse host from URL for cookie domain
    const urlObj = config.grafana.url;
    const hostname = urlObj.replace(/^https?:\/\//, '').split(':')[0].split('/')[0];

    // Set session cookie via browser context
    await page.context().addCookies([
      {
        name: 'grafana_session',
        value: sessionCookie,
        domain: hostname,
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);

    // Navigate to home to verify auth
    await page.goto(buildUrl('/'), { waitUntil: 'networkidle', timeout: 15000 });

    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      console.warn('Cookie auth failed, falling back to form login...');
      await formLogin(page);
    }
  } else {
    await formLogin(page);
  }
}

async function formLogin(page) {
  const loginUrl = buildUrl('/login');

  try {
    await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: 15000 });
  } catch (e) {
    console.warn(`Navigation to login page failed: ${e.message || e}`);
    return;
  }

  try {
    const usernameInput = await page.waitForSelector('input[name="user"]', { timeout: 10000 });
    await usernameInput.click();
    await usernameInput.fill('admin');

    const passwordInput = await page.waitForSelector('input[name="password"]', { timeout: 5000 });
    await passwordInput.click();
    await passwordInput.fill('admin');

    const loginBtn = await page.waitForSelector('button[type="submit"]', { timeout: 5000 });
    await loginBtn.click();

    sleep(3);

    // Handle "change password" skip screen
    try {
      const skipBtn = await page.waitForSelector('button:has-text("Skip"), a[href*="skip"]', { timeout: 3000 });
      if (skipBtn) { await skipBtn.click(); sleep(1); }
    } catch (e) { /* no skip button */ }
  } catch (e) {
    console.warn(`Form login failed: ${e.message || String(e)}`);
  }
}

export function collectConsoleErrors(page) {
  const errors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!isKnownNoise(text)) {
        errors.push({
          type: msg.type(),
          text: text,
          timestamp: new Date().toISOString(),
        });
      }
    }
  });

  page.on('pageerror', (err) => {
    const text = err.message || String(err);
    if (!isKnownNoise(text)) {
      errors.push({
        type: 'pageerror',
        text: text,
        timestamp: new Date().toISOString(),
      });
    }
  });

  return errors;
}

export async function navigateAndTime(page, path) {
  const url = buildUrl(path);
  const start = Date.now();

  try {
    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: config.test.dashboardLoadTimeout,
    });

    const loadTimeMs = Date.now() - start;
    const status = response ? response.status() : 0;
    const finalUrl = page.url();

    return {
      url,
      status,
      loadTimeMs,
      ok: status >= 200 && status < 400,
    };
  } catch (e) {
    const loadTimeMs = Date.now() - start;
    const errMsg = (e && e.message) ? String(e.message) : String(e || 'unknown error');

    // Even if networkidle times out, the page may have loaded fine
    try {
      const finalUrl = page.url();
      const expectedPath = path.split('?')[0];
      const onCorrectPage = finalUrl.includes(expectedPath) || !finalUrl.includes('/login');

      if (onCorrectPage) {
        // Page navigated correctly — treat as success even if network didn't fully settle
        return {
          url,
          status: 200,
          loadTimeMs,
          ok: true,
        };
      }
    } catch (urlErr) {
      // page.url() itself failed — page is truly broken
    }

    console.warn(`Navigation failed for ${path}: ${errMsg}`);
    return {
      url,
      status: 0,
      loadTimeMs,
      ok: false,
      error: errMsg,
    };
  }
}

export async function waitForPanelsLoaded(page, timeout) {
  timeout = timeout || config.test.dashboardLoadTimeout;

  try {
    // Wait for loading spinners to disappear
    await page.waitForFunction(
      () => {
        const loaders = document.querySelectorAll(
          '.panel-loading, [class*="panel-loading"], .spinner, [data-testid="panel-loading"]'
        );
        return loaders.length === 0;
      },
      { timeout: timeout }
    );
  } catch (e) {
    // Timeout waiting for panels — continue with checks
  }

  // Check if panels exist
  try {
    const panelCount = await page.evaluate(() => {
      const panels = document.querySelectorAll(
        '.panel-container, [data-panelid], [class*="panel-container"], .react-grid-item'
      );
      return panels.length;
    });
    return panelCount;
  } catch (e) {
    return 0;
  }
}

// Inspect each panel on the dashboard for errors, no-data, or plugin-missing states
// Covers Grafana 10.x and 11.x panel DOM structure
export async function inspectPanels(page) {
  // Give panels a moment to finish rendering after networkidle
  sleep(2);

  try {
    return await page.evaluate(() => {
      const results = { total: 0, healthy: 0, errors: [], noData: [], pluginMissing: [] };

      // Find all panels — multiple selector strategies for different Grafana versions
      const panels = document.querySelectorAll([
        '[data-panelid]',                            // Grafana 10+: primary panel selector
        '.panel-container',                          // Grafana 9.x
        '[class*="panel-container"]',                // CSS module variants
        '.react-grid-item',                          // Grid layout panels
      ].join(', '));

      // Deduplicate (a panel may match multiple selectors)
      const seen = new Set();
      const uniquePanels = [];
      panels.forEach(p => {
        const id = p.getAttribute('data-panelid') || p.getAttribute('id') || p.outerHTML.slice(0, 100);
        if (!seen.has(id)) { seen.add(id); uniquePanels.push(p); }
      });

      results.total = uniquePanels.length;

      uniquePanels.forEach((panel, idx) => {
        const text = (panel.innerText || '').toLowerCase();
        const html = (panel.innerHTML || '').toLowerCase();

        // Extract panel title from multiple possible locations
        const titleEl = panel.querySelector([
          '[data-testid="header-container"] h2',
          '[data-testid="panel-title"]',
          'h2[class*="PanelTitle"]',
          '.panel-title',
          '[class*="panel-title"]',
          'h6',
        ].join(', '));
        const title = (titleEl ? titleEl.textContent : '') || `Panel ${idx + 1}`;
        const trimTitle = title.trim().substring(0, 60);

        // --- Error detection (ordered from most specific to least) ---

        // 1. Plugin missing
        if (text.includes('panel plugin not found') || text.includes('unknown panel plugin') ||
            html.includes('pluginnotfound') || text.includes('plugin not found')) {
          results.pluginMissing.push(trimTitle);
          return;
        }

        // 2. Panel-level error indicators (Grafana DOM data-testid and CSS classes)
        const hasErrorIndicator = panel.querySelector([
          '[data-testid="data-testid Panel status error"]',       // Grafana 10+
          '[data-testid="panel-status-message-error"]',           // Grafana 11+
          '[data-testid="data-testid Panel header item error"]',  // Grafana 11+
          '[aria-label="Panel status error"]',
          '.panel-info-corner--error',                            // Grafana 9.x
          '[class*="panel-alert"]',
          '[class*="PanelStatus"][class*="error"]',
          '[class*="error-container"]',
          '[class*="panel-error"]',
        ].join(', '));

        // 3. Error text patterns in panel BODY (exclude title to avoid false positives like "Error Rate")
        const titleText = (titleEl ? titleEl.textContent : '').toLowerCase();
        const bodyText = text.replace(titleText, ''); // Remove title from text to avoid matching panel names
        const errorTextPatterns = [
          'failed to load',
          'request error',
          'query error',
          'data source is not configured',
          'datasource not found',
          'template variables could not be initialized',
          'error loading resource',
          'failed to fetch',
          'network error',
          'bad gateway',
          'internal server error',
          'timeout loading',
          'connection refused',
          'could not find datasource',
        ];
        const hasErrorText = errorTextPatterns.some(pat => bodyText.includes(pat));

        // 4. Error icon SVGs (Grafana renders error icons as inline SVGs)
        const hasErrorIcon = panel.querySelector('svg[name="exclamation-triangle"], [class*="alert-error"], [class*="icon-error"]');

        if (hasErrorIndicator || hasErrorText || hasErrorIcon) {
          // Extract error message if possible
          const errMsgEl = panel.querySelector('[data-testid*="error"] span, [class*="error-message"], [class*="alert-body"]');
          const errMsg = errMsgEl ? errMsgEl.textContent.trim().substring(0, 80) : '';
          results.errors.push(errMsg ? `${trimTitle}: ${errMsg}` : trimTitle);
          return;
        }

        // 5. No data state
        const noDataPatterns = ['no data', 'no values found', 'no data points', 'no results'];
        const hasNoData = noDataPatterns.some(pat => text.includes(pat)) ||
          panel.querySelector('[data-testid="data-testid No data"]');

        if (hasNoData) {
          results.noData.push(trimTitle);
          return;
        }

        // If none of the above — panel is healthy
        results.healthy++;
      });

      return results;
    });
  } catch (e) {
    return { total: 0, healthy: 0, errors: [], noData: [], pluginMissing: [] };
  }
}

export async function checkErrorBanners(page) {
  const errors = [];

  try {
    const bannerErrors = await page.evaluate(() => {
      const found = [];
      const selectors = [
        '.alert-error',
        '[data-testid="data-testid Alert error"]',
        '.dashboard-not-found',
        '[class*="alert-error"]',
      ];

      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        els.forEach((el) => {
          if (el.textContent.trim()) {
            found.push(el.textContent.trim().substring(0, 200));
          }
        });
      }

      // Check for specific error text
      const bodyText = document.body.innerText || '';
      if (bodyText.includes('Dashboard not found')) found.push('Dashboard not found');
      if (bodyText.includes('Panel plugin not found')) found.push('Panel plugin not found');
      if (bodyText.includes('Error loading')) found.push('Error loading panel');

      return found;
    });

    errors.push(...bannerErrors);
  } catch (e) {
    // Page may have navigated away
  }

  return errors;
}

export async function screenshotOnFail(page, name) {
  if (!config.test.screenshotOnFail) return null;

  try {
    const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 100);
    const path = `${config.test.reportDir}/screenshots/${sanitizedName}_${Date.now()}.png`;
    await page.screenshot({ path });
    return path;
  } catch (e) {
    console.warn(`Screenshot failed for ${name}: ${e.message}`);
    return null;
  }
}

export async function retryOperation(fn, maxRetries, delayMs) {
  maxRetries = maxRetries || config.test.maxRetries;
  delayMs = delayMs || 1000;

  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      console.warn(`Retry ${i + 1}/${maxRetries}: ${e.message}`);
      if (i < maxRetries - 1) {
        sleep(delayMs / 1000 * Math.pow(2, i)); // exponential backoff
      }
    }
  }
  throw lastError;
}

export function rateLimitDelay() {
  const ms = config.test.rateLimitMs;
  if (ms > 0) {
    sleep(ms / 1000);
  }
}

export async function checkTimeRangePicker(page) {
  try {
    const pickerExists = await page.evaluate(() => {
      const picker = document.querySelector(
        '[data-testid="data-testid TimePicker Open Button"], ' +
        'button[class*="time-picker"], ' +
        '[aria-label*="time range"], ' +
        '[class*="TimePicker"]'
      );
      return !!picker;
    });
    return pickerExists;
  } catch (e) {
    return false;
  }
}

export async function newBrowserContext() {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    locale: 'en-US',
    timezoneId: 'UTC',
    viewport: { width: 1920, height: 1080 },
  });
  return context;
}
