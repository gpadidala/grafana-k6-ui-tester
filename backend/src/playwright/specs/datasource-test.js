// datasource-test.js — On DS config page, find Test/Save & test button
module.exports = async function (page, grafanaUrl, token, options) {
  const results = [];

  // Get first DS via API
  let dsUid = null;
  try {
    const res = await page.request.get(`${grafanaUrl}/api/datasources`);
    const dsList = await res.json();
    if (Array.isArray(dsList) && dsList.length > 0) {
      dsUid = dsList[0].uid || dsList[0].id;
    }
  } catch (e) {
    results.push({ name: 'Fetch datasources', status: 'FAIL', detail: e.message, ms: 0 });
    return results;
  }

  if (!dsUid) {
    results.push({ name: 'DS test button', status: 'WARN', detail: 'No datasources configured', ms: 0 });
    return results;
  }

  // Navigate to DS config page
  const t0 = Date.now();
  try {
    await page.goto(`${grafanaUrl}/datasources/edit/${dsUid}`, { waitUntil: 'load', timeout: 30000 });
    results.push({ name: 'DS config page loads', status: 'PASS',
      detail: `Loaded config for ${dsUid}`, ms: Date.now() - t0 });
  } catch (e) {
    results.push({ name: 'DS config page loads', status: 'FAIL', detail: e.message, ms: Date.now() - t0 });
    return results;
  }

  // Find Test button
  const t1 = Date.now();
  try {
    const testBtn = page.locator('button:has-text("Test"), button:has-text("Save & test"), button:has-text("Save & Test"), [data-testid*="test"]');
    await testBtn.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    const visible = await testBtn.first().isVisible().catch(() => false);

    results.push({ name: 'Test button exists', status: visible ? 'PASS' : 'WARN',
      detail: visible ? 'Save & test button found' : 'Test button not found on page', ms: Date.now() - t1 });
  } catch (e) {
    results.push({ name: 'Test button exists', status: 'WARN', detail: e.message, ms: Date.now() - t1 });
  }

  return results;
};
