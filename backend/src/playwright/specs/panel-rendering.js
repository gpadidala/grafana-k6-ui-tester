// panel-rendering.js — Count panels per dashboard, verify > 0, check no error text
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
    const testName = `Panels: ${db.title || db.uid}`;
    try {
      await page.goto(`${grafanaUrl}/d/${db.uid}`, { waitUntil: 'load', timeout: 30000 });

      // Count panel containers
      const panels = page.locator('.panel-container, [data-panelid], .react-grid-item');
      const count = await panels.count();

      if (count === 0) {
        results.push({ name: testName, status: 'WARN', detail: 'No panels detected', ms: Date.now() - start });
        continue;
      }

      // Check for error text inside panels
      const errorText = page.locator('.panel-container :text("Error"), [data-panelid] :text("Error")');
      const errorCount = await errorText.count().catch(() => 0);

      results.push({ name: testName, status: errorCount === 0 ? 'PASS' : 'WARN',
        detail: `${count} panel(s), ${errorCount} with errors`, ms: Date.now() - start });
    } catch (e) {
      results.push({ name: testName, status: 'FAIL', detail: e.message, ms: Date.now() - start });
    }
  }

  return results;
};
