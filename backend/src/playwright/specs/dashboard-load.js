// dashboard-load.js — Load first 10 dashboards, check panels render without errors
module.exports = async function (page, grafanaUrl, token, options) {
  const results = [];

  // Fetch dashboard list
  let dashboards = [];
  const t0 = Date.now();
  try {
    const res = await page.request.get(`${grafanaUrl}/api/search?type=dash-db&limit=20`);
    dashboards = await res.json();
    results.push({ name: 'Fetch dashboard list', status: 'PASS',
      detail: `Found ${dashboards.length} dashboards`, ms: Date.now() - t0 });
  } catch (e) {
    results.push({ name: 'Fetch dashboard list', status: 'FAIL', detail: e.message, ms: Date.now() - t0 });
    return results;
  }

  if (dashboards.length === 0) {
    results.push({ name: 'Dashboards exist', status: 'WARN', detail: 'No dashboards found', ms: 0 });
    return results;
  }

  // Test first 10
  const toTest = dashboards.slice(0, 10);
  for (const db of toTest) {
    const start = Date.now();
    const testName = `Dashboard: ${db.title || db.uid}`;
    try {
      await page.goto(`${grafanaUrl}/d/${db.uid}`, { waitUntil: 'load', timeout: 30000 });

      // Wait for panel loading spinners to disappear
      try {
        await page.locator('.panel-loading').first().waitFor({ state: 'hidden', timeout: 15000 });
      } catch {} // no spinners is fine

      // Check for error panels
      const errorPanels = page.locator('[class*="panel-error"], [data-testid*="panel-error"], .alert-error');
      const errorCount = await errorPanels.count();

      let screenshot;
      if (errorCount > 0) {
        try { screenshot = (await page.screenshot()).toString('base64'); } catch {}
      }

      results.push({ name: testName, status: errorCount === 0 ? 'PASS' : 'WARN',
        detail: errorCount === 0 ? 'All panels loaded' : `${errorCount} error panel(s)`,
        ms: Date.now() - start, ...(screenshot && { screenshot }) });
    } catch (e) {
      let screenshot;
      try { screenshot = (await page.screenshot()).toString('base64'); } catch {}
      results.push({ name: testName, status: 'FAIL', detail: e.message,
        ms: Date.now() - start, ...(screenshot && { screenshot }) });
    }
  }

  return results;
};
