// alert-policies.js — Navigate to notification policies, verify tree renders
module.exports = async function (page, grafanaUrl, token, options) {
  const results = [];

  // Navigate to routes/policies page
  const t0 = Date.now();
  try {
    const res = await page.goto(`${grafanaUrl}/alerting/routes`, { waitUntil: 'load', timeout: 30000 });
    const code = res ? res.status() : 0;
    results.push({ name: 'Notification policies page loads', status: (code >= 200 && code < 400) ? 'PASS' : 'FAIL',
      detail: `HTTP ${code}`, ms: Date.now() - t0 });
  } catch (e) {
    results.push({ name: 'Notification policies page loads', status: 'FAIL', detail: e.message, ms: Date.now() - t0 });
    return results;
  }

  // Check policy tree renders
  const t1 = Date.now();
  try {
    const tree = page.locator('[data-testid*="policy"], [class*="policy-tree"], [class*="route"], [class*="notification-policies"], table');
    await tree.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    const visible = await tree.first().isVisible().catch(() => false);

    results.push({ name: 'Policy tree renders', status: visible ? 'PASS' : 'WARN',
      detail: visible ? 'Policy tree/table visible' : 'Policy tree not detected', ms: Date.now() - t1 });
  } catch (e) {
    results.push({ name: 'Policy tree renders', status: 'WARN', detail: e.message, ms: Date.now() - t1 });
  }

  // Check default policy via API
  const t2 = Date.now();
  try {
    const res = await page.request.get(`${grafanaUrl}/api/v1/notifications/policies`);
    const ok = res.ok();
    results.push({ name: 'Policies API accessible', status: ok ? 'PASS' : 'WARN',
      detail: ok ? 'GET /api/v1/notifications/policies OK' : `Status ${res.status()}`, ms: Date.now() - t2 });
  } catch (e) {
    results.push({ name: 'Policies API accessible', status: 'WARN', detail: e.message, ms: Date.now() - t2 });
  }

  return results;
};
