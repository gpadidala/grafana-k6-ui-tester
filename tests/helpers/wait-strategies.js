/**
 * tests/helpers/wait-strategies.js — Smart wait strategies for Grafana UI elements.
 * ES Module for use in k6 browser tests.
 */

/**
 * Wait for all Grafana panels to finish loading.
 * Polls until the loading bar count drops to 0.
 */
export async function waitForPanels(page, timeout = 30000) {
  const start    = Date.now();
  const deadline = start + timeout;

  while (Date.now() < deadline) {
    const loading = await page.evaluate(() => {
      const bars = document.querySelectorAll(
        '[data-testid="panel-loading-bar"], .panel-loading-spinner, [aria-label="Panel loading bar"]',
      );
      return bars.length;
    }).catch(() => 0);

    if (loading === 0) {
      // Confirm stable for 500ms
      await new Promise(r => setTimeout(r, 500));
      const stable = await page.evaluate(() => {
        return document.querySelectorAll('[data-testid="panel-loading-bar"]').length;
      }).catch(() => 0);
      if (stable === 0) return { waited_ms: Date.now() - start, panels_stable: true };
    }

    await new Promise(r => setTimeout(r, 300));
  }

  return { waited_ms: Date.now() - start, panels_stable: false, timed_out: true };
}

/**
 * Wait for query execution to complete (Grafana query spinner disappears).
 */
export async function waitForQueries(page, timeout = 20000) {
  const start = Date.now();
  try {
    await page.waitForSelector(
      '[data-testid="query-editor-row"] .spinning, .spin, [aria-label="Query editor row is loading"]',
      { state: 'hidden', timeout },
    );
  } catch {
    // Spinner might not appear at all (fast query) — that's OK
  }
  return Date.now() - start;
}

/**
 * Wait for Grafana page skeleton/spinner to disappear (initial app load).
 */
export async function waitForAppReady(page, timeout = 20000) {
  const start = Date.now();
  try {
    // Wait for the main content area to appear
    await page.waitForSelector(
      '[data-testid="main-view"], .main-view, #reactRoot .page-body, [aria-label="Main content"]',
      { timeout },
    );
  } catch {
    // Some pages don't have these selectors
  }
  // Also wait for any global loading indicators
  try {
    await page.waitForSelector('.preloader, [class*="preloader"]', { state: 'hidden', timeout: 5000 });
  } catch {
    // No preloader shown
  }
  return Date.now() - start;
}

/**
 * Wait for a toast notification to appear.
 * Returns the toast text, or null if timed out.
 */
export async function waitForToast(page, timeout = 8000) {
  try {
    const el = await page.waitForSelector(
      '[data-testid="alert-success"], [data-testid="alert-error"], [data-testid="alert-warning"], .toast, .grafana-info-box',
      { timeout },
    );
    return el ? el.innerText() : null;
  } catch {
    return null;
  }
}

/**
 * Wait for a specific alert rule state to appear.
 */
export async function waitForAlertState(page, ruleName, state, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = await page.evaluate((name, targetState) => {
      const rows = document.querySelectorAll('[data-testid="alert-rule-row"]');
      for (const row of rows) {
        if (row.textContent.includes(name)) {
          return row.textContent.toLowerCase().includes(targetState.toLowerCase());
        }
      }
      return false;
    }, ruleName, state).catch(() => false);

    if (found) return true;
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

/**
 * Wait for animation to finish (e.g. sidebar transitions).
 */
export async function waitForAnimation(page, ms = 400) {
  await new Promise(r => setTimeout(r, ms));
}

/**
 * Wait for data-testid attribute to appear.
 */
export async function waitForTestId(page, testId, timeout = 10000) {
  return page.waitForSelector(`[data-testid="${testId}"]`, { timeout });
}

/**
 * Wait for Grafana variable dropdowns to load options.
 */
export async function waitForVariables(page, timeout = 15000) {
  const start = Date.now();
  try {
    // Variables show a loading spinner while fetching options
    await page.waitForSelector(
      '[data-testid="variable-option-loading"]',
      { state: 'hidden', timeout },
    );
  } catch {
    // No variable spinners shown — OK
  }
  return Date.now() - start;
}

/**
 * Poll a condition function until it returns truthy or timeout.
 */
export async function pollUntil(condition, timeout = 15000, interval = 500) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise(r => setTimeout(r, interval));
  }
  return false;
}
