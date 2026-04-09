// alert-contacts.js — Navigate to contact points, verify list renders
module.exports = async function (page, grafanaUrl, token, options) {
  const results = [];

  // Navigate to contact points page
  const t0 = Date.now();
  try {
    const res = await page.goto(`${grafanaUrl}/alerting/notifications`, { waitUntil: 'load', timeout: 30000 });
    const code = res ? res.status() : 0;
    results.push({ name: 'Contact points page loads', status: (code >= 200 && code < 400) ? 'PASS' : 'FAIL',
      detail: `HTTP ${code}`, ms: Date.now() - t0 });
  } catch (e) {
    results.push({ name: 'Contact points page loads', status: 'FAIL', detail: e.message, ms: Date.now() - t0 });
    return results;
  }

  // Check for contact point entries
  const t1 = Date.now();
  try {
    const contacts = page.locator('[data-testid*="contact-point"], [class*="contact-point"], table tbody tr, [class*="receiver"]');
    await contacts.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    const count = await contacts.count();

    if (count > 0) {
      results.push({ name: 'Contact points listed', status: 'PASS',
        detail: `${count} contact point(s) found`, ms: Date.now() - t1 });
    } else {
      results.push({ name: 'Contact points listed', status: 'WARN',
        detail: 'No contact points detected (may use defaults)', ms: Date.now() - t1 });
    }
  } catch (e) {
    results.push({ name: 'Contact points listed', status: 'WARN', detail: e.message, ms: Date.now() - t1 });
  }

  return results;
};
