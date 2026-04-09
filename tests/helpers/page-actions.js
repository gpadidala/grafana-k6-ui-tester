/**
 * tests/helpers/page-actions.js — k6 browser page action helpers
 * ES Module for use in k6 browser tests.
 */

import { expect } from 'https://jslib.k6.io/k6chaijs/4.3.4.3/index.js';

/**
 * Navigate to a URL and wait for network idle.
 * @param {Page} page
 * @param {string} url
 * @param {number} [timeout] ms
 */
export async function navigate(page, url, timeout = 30000) {
  await page.goto(url, { waitUntil: 'networkidle', timeout });
}

/**
 * Click a selector (with wait).
 */
export async function click(page, selector, timeout = 10000) {
  await page.waitForSelector(selector, { timeout });
  await page.click(selector);
}

/**
 * Fill a form input.
 */
export async function fill(page, selector, value, timeout = 10000) {
  await page.waitForSelector(selector, { timeout });
  await page.fill(selector, value);
}

/**
 * Select an option from a <select> element.
 */
export async function selectOption(page, selector, value) {
  await page.selectOption(selector, value);
}

/**
 * Assert that text is visible somewhere on the page.
 */
export async function assertText(page, text, timeout = 10000) {
  await page.waitForSelector(`text=${text}`, { timeout });
}

/**
 * Assert a selector is visible.
 */
export async function assertVisible(page, selector, timeout = 10000) {
  const el = await page.waitForSelector(selector, { timeout });
  expect(el, `Expected ${selector} to be visible`).not.toBeNull();
}

/**
 * Assert page title contains a substring.
 */
export async function assertTitle(page, substring) {
  const title = await page.title();
  expect(title.toLowerCase()).to.include(substring.toLowerCase());
}

/**
 * Assert no error toast is visible after an action.
 */
export async function assertNoErrorToast(page) {
  const errorSelectors = [
    '[data-testid="alert-error"]',
    '.alert-error',
    '[aria-label="Error alert"]',
  ];
  for (const sel of errorSelectors) {
    const el = await page.$(sel);
    if (el) {
      const text = await el.innerText().catch(() => '');
      throw new Error(`Error toast found: "${text.slice(0, 200)}"`);
    }
  }
}

/**
 * Wait for a selector to disappear (e.g. loading spinner).
 */
export async function waitForHidden(page, selector, timeout = 15000) {
  await page.waitForSelector(selector, { state: 'hidden', timeout });
}

/**
 * Get text content of a selector.
 */
export async function getText(page, selector) {
  const el = await page.$(selector);
  return el ? el.innerText() : null;
}

/**
 * Scroll to element and click (for offscreen elements).
 */
export async function scrollAndClick(page, selector) {
  await page.$eval(selector, el => el.scrollIntoView());
  await page.click(selector);
}

/**
 * Take a screenshot with a descriptive name.
 */
export async function screenshot(page, name) {
  await page.screenshot({ path: `./screenshots/${name}_${Date.now()}.png` });
}
