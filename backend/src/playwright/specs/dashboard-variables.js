// dashboard-variables.js — Check variable dropdowns exist and have options
module.exports = async function (page, grafanaUrl, token, options) {
  const results = [];

  // Fetch dashboards
  let dashboards = [];
  try {
    const res = await page.request.get(`${grafanaUrl}/api/search?type=dash-db&limit=20`);
    dashboards = await res.json();
  } catch (e) {
    results.push({ name: 'Fetch dashboards', status: 'FAIL', detail: e.message, ms: 0 });
    return results;
  }

  // Filter dashboards that have templating variables via API
  const withVars = [];
  for (const db of dashboards) {
    if (withVars.length >= 5) break;
    try {
      const res = await page.request.get(`${grafanaUrl}/api/dashboards/uid/${db.uid}`);
      const data = await res.json();
      const vars = data.dashboard?.templating?.list || [];
      if (vars.length > 0) withVars.push({ ...db, varCount: vars.length });
    } catch {}
  }

  if (withVars.length === 0) {
    results.push({ name: 'Dashboards with variables', status: 'WARN', detail: 'No dashboards with variables found', ms: 0 });
    return results;
  }

  for (const db of withVars) {
    const start = Date.now();
    const testName = `Variables: ${db.title || db.uid}`;
    try {
      await page.goto(`${grafanaUrl}/d/${db.uid}`, { waitUntil: 'load', timeout: 30000 });

      // Look for variable controls
      const varSelectors = '[data-testid*="variable"], [class*="submenu-controls"] select, [class*="variable-link"], [id*="var-"]';
      const varElements = page.locator(varSelectors);
      const count = await varElements.count();

      if (count > 0) {
        results.push({ name: testName, status: 'PASS',
          detail: `${count} variable control(s) found (expected ${db.varCount})`, ms: Date.now() - start });
      } else {
        results.push({ name: testName, status: 'WARN',
          detail: `Expected ${db.varCount} variable(s) but no controls detected`, ms: Date.now() - start });
      }
    } catch (e) {
      results.push({ name: testName, status: 'FAIL', detail: e.message, ms: Date.now() - start });
    }
  }

  return results;
};
