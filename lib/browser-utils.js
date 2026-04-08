// Browser Utilities
// Reusable page helpers for authentication, navigation, screenshots, error detection

import { browser } from 'k6/browser';
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

export async function authenticatePage(page) {
  const url = buildUrl('/');
  const token = config.grafana.token;

  if (token) {
    // Set auth cookie before navigation
    await page.evaluate(
      ([grafanaUrl, grafanaToken]) => {
        document.cookie = `grafana_session=${grafanaToken}; path=/`;
        // Also try setting via localStorage for some Grafana versions
        try {
          localStorage.setItem('grafana.auth.token', grafanaToken);
        } catch (e) {
          // localStorage may not be available
        }
      },
      [config.grafana.url, token]
    );

    // Navigate with auth header
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 15000,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });

    // Check if we landed on login page (auth failed)
    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      console.log('Token auth redirect to login, attempting form login...');
      await formLogin(page);
    }
  } else {
    await formLogin(page);
  }
}

async function formLogin(page) {
  const loginUrl = buildUrl('/login');
  await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: 15000 });

  try {
    const usernameInput = await page.waitForSelector(
      'input[name="user"], input[aria-label="Username input field"]',
      { timeout: 5000 }
    );
    const passwordInput = await page.waitForSelector(
      'input[name="password"], input[aria-label="Password input field"]',
      { timeout: 5000 }
    );

    await usernameInput.fill('admin');
    await passwordInput.fill('admin');

    const loginBtn = await page.waitForSelector(
      'button[type="submit"], button[aria-label="Login button"]',
      { timeout: 5000 }
    );
    await loginBtn.click();

    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 });

    // Handle "change password" skip screen
    try {
      const skipBtn = await page.waitForSelector('a[href*="skip"], button:has-text("Skip")', {
        timeout: 3000,
      });
      if (skipBtn) await skipBtn.click();
    } catch (e) {
      // No skip button, that's fine
    }
  } catch (e) {
    console.warn(`Form login failed: ${e.message}`);
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
      extraHTTPHeaders: config.grafana.token
        ? { Authorization: `Bearer ${config.grafana.token}` }
        : {},
    });

    const loadTimeMs = Date.now() - start;
    const status = response ? response.status() : 0;

    return {
      url,
      status,
      loadTimeMs,
      ok: status >= 200 && status < 400,
    };
  } catch (e) {
    const loadTimeMs = Date.now() - start;
    return {
      url,
      status: 0,
      loadTimeMs,
      ok: false,
      error: e.message,
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
    console.warn('Timeout waiting for panel loading to complete');
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
