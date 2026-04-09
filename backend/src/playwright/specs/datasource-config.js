// datasource-config.js — Navigate to datasources, check list, click first DS, verify config
module.exports = async function (page, grafanaUrl, token, options) {
  const results = [];

  // Navigate to datasources page
  const t0 = Date.now();
  try {
    const res = await page.goto(`${grafanaUrl}/datasources`, { waitUntil: 'load', timeout: 30000 });
    const code = res ? res.status() : 0;
    results.push({ name: 'Datasources page loads', status: (code >= 200 && code < 400) ? 'PASS' : 'FAIL',
      detail: `HTTP ${code}`, ms: Date.now() - t0 });
  } catch (e) {
    results.push({ name: 'Datasources page loads', status: 'FAIL', detail: e.message, ms: Date.now() - t0 });
    return results;
  }

  // Check list visible
  const t1 = Date.now();
  try {
    const list = page.locator('[data-testid*="datasource"], [class*="datasource"], a[href*="/datasources/edit/"], table tbody tr, li a[href*="/datasource"]');
    await list.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    const count = await list.count();
    results.push({ name: 'Datasource list visible', status: count > 0 ? 'PASS' : 'WARN',
      detail: `${count} datasource(s) found`, ms: Date.now() - t1 });
  } catch (e) {
    results.push({ name: 'Datasource list visible', status: 'WARN', detail: e.message, ms: Date.now() - t1 });
  }

  // Get first DS via API and navigate to its config
  let dsUid = null;
  const t2 = Date.now();
  try {
    const res = await page.request.get(`${grafanaUrl}/api/datasources`);
    const dsList = await res.json();
    if (Array.isArray(dsList) && dsList.length > 0) {
      dsUid = dsList[0].uid || dsList[0].id;
    }
  } catch {}

  if (!dsUid) {
    results.push({ name: 'DS config page', status: 'WARN', detail: 'No datasources to test', ms: Date.now() - t2 });
    return results;
  }

  try {
    const res = await page.goto(`${grafanaUrl}/datasources/edit/${dsUid}`, { waitUntil: 'load', timeout: 30000 });
    const code = res ? res.status() : 0;
    results.push({ name: 'DS config page loads', status: (code >= 200 && code < 400) ? 'PASS' : 'FAIL',
      detail: `HTTP ${code} for datasource ${dsUid}`, ms: Date.now() - t2 });
  } catch (e) {
    results.push({ name: 'DS config page loads', status: 'FAIL', detail: e.message, ms: Date.now() - t2 });
  }

  return results;
};
