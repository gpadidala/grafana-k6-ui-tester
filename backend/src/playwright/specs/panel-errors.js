// panel-errors.js — Detect "Panel plugin not found" and error text in panels
module.exports = async function (page, grafanaUrl, token, options) {
  const results = [];

  let dashboards = [];
  try {
    const res = await page.request.get(`${grafanaUrl}/api/search?type=dash-db&limit=20`);
    dashboards = await res.json();
  } catch (e) {
    results.push({ name: 'Fetch dashboards', status: 'FAIL', detail: e.message, ms: 0 });
    return results;
  }

  if (dashboards.length === 0) {
    results.push({ name: 'Dashboards available', status: 'WARN', detail: 'No dashboards found', ms: 0 });
    return results;
  }

  const toTest = dashboards.slice(0, 10);
  for (const db of toTest) {
    const start = Date.now();
    const testName = `Panel errors: ${db.title || db.uid}`;
    try {
      await page.goto(`${grafanaUrl}/d/${db.uid}`, { waitUntil: 'load', timeout: 30000 });

      // Search for known error patterns
      const body = await page.locator('body').innerText({ timeout: 5000 });
      const pluginNotFound = (body.match(/Panel plugin not found/gi) || []).length;
      const queryErrors = (body.match(/error/gi) || []).length;

      // More targeted: look for error elements inside panel bodies
      const errorPanels = page.locator('[class*="panel-error"], [class*="alert-error"], [data-testid*="panel-status-error"]');
      const errorElCount = await errorPanels.count();

      if (pluginNotFound > 0) {
        results.push({ name: testName, status: 'FAIL',
          detail: `${pluginNotFound} "Panel plugin not found" occurrence(s)`, ms: Date.now() - start });
      } else if (errorElCount > 0) {
        results.push({ name: testName, status: 'WARN',
          detail: `${errorElCount} error element(s) in panels`, ms: Date.now() - start });
      } else {
        results.push({ name: testName, status: 'PASS',
          detail: 'No panel errors detected', ms: Date.now() - start });
      }
    } catch (e) {
      results.push({ name: testName, status: 'FAIL', detail: e.message, ms: Date.now() - start });
    }
  }

  return results;
};
