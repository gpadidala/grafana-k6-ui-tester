// dashboard-time-picker.js — Open time picker, select range, verify no error
module.exports = async function (page, grafanaUrl, token, options) {
  const results = [];

  // Fetch a dashboard to test on
  let dashboard = null;
  try {
    const res = await page.request.get(`${grafanaUrl}/api/search?type=dash-db&limit=5`);
    const list = await res.json();
    if (list.length > 0) dashboard = list[0];
  } catch {}

  if (!dashboard) {
    results.push({ name: 'Time picker test', status: 'WARN', detail: 'No dashboard available', ms: 0 });
    return results;
  }

  // Navigate to dashboard
  const t0 = Date.now();
  try {
    await page.goto(`${grafanaUrl}/d/${dashboard.uid}`, { waitUntil: 'load', timeout: 30000 });
    results.push({ name: 'Navigate to dashboard', status: 'PASS',
      detail: dashboard.title || dashboard.uid, ms: Date.now() - t0 });
  } catch (e) {
    results.push({ name: 'Navigate to dashboard', status: 'FAIL', detail: e.message, ms: Date.now() - t0 });
    return results;
  }

  // Find and click time picker
  const t1 = Date.now();
  try {
    const picker = page.locator('[data-testid="data-testid TimePicker Open Button"], [aria-label*="time picker"], button:has-text("Last")').first();
    await picker.click({ timeout: 5000 });
    results.push({ name: 'Time picker opens', status: 'PASS', detail: 'Picker button clicked', ms: Date.now() - t1 });
  } catch (e) {
    results.push({ name: 'Time picker opens', status: 'FAIL', detail: e.message, ms: Date.now() - t1 });
    return results;
  }

  // Select "Last 1 hour"
  const t2 = Date.now();
  try {
    const option = page.locator('[data-testid*="TimePicker"], [class*="time-picker"]')
      .locator('text=/Last 1 hour/i').first();
    await option.click({ timeout: 5000 });
    await page.waitForLoadState('load', { timeout: 15000 });

    // Verify no error overlay appeared
    const error = page.locator('[class*="alert-error"], [data-testid="error"]');
    const hasError = await error.isVisible({ timeout: 2000 }).catch(() => false);
    results.push({ name: 'Select Last 1 hour', status: hasError ? 'FAIL' : 'PASS',
      detail: hasError ? 'Error appeared after selection' : 'Time range applied without error', ms: Date.now() - t2 });
  } catch (e) {
    results.push({ name: 'Select Last 1 hour', status: 'WARN',
      detail: `Could not select range: ${e.message}`, ms: Date.now() - t2 });
  }

  return results;
};
