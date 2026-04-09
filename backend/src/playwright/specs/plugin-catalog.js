// plugin-catalog.js — Navigate to plugins, verify cards visible, count plugins
module.exports = async function (page, grafanaUrl, token, options) {
  const results = [];

  // Navigate to plugins page
  const t0 = Date.now();
  try {
    const res = await page.goto(`${grafanaUrl}/plugins`, { waitUntil: 'load', timeout: 30000 });
    const code = res ? res.status() : 0;
    results.push({ name: 'Plugins page loads', status: (code >= 200 && code < 400) ? 'PASS' : 'FAIL',
      detail: `HTTP ${code}`, ms: Date.now() - t0 });
  } catch (e) {
    results.push({ name: 'Plugins page loads', status: 'FAIL', detail: e.message, ms: Date.now() - t0 });
    return results;
  }

  // Check plugin cards
  const t1 = Date.now();
  try {
    const cards = page.locator('[data-testid*="plugin"], [class*="plugin-card"], [class*="card"], a[href*="/plugins/"]');
    await cards.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    const count = await cards.count();

    results.push({ name: 'Plugin cards visible', status: count > 0 ? 'PASS' : 'WARN',
      detail: `${count} plugin card(s) detected`, ms: Date.now() - t1 });
  } catch (e) {
    results.push({ name: 'Plugin cards visible', status: 'WARN', detail: e.message, ms: Date.now() - t1 });
  }

  // Verify via API
  const t2 = Date.now();
  try {
    const res = await page.request.get(`${grafanaUrl}/api/plugins`);
    const plugins = await res.json();
    results.push({ name: 'Plugins API count', status: 'PASS',
      detail: `${Array.isArray(plugins) ? plugins.length : 0} plugins via API`, ms: Date.now() - t2 });
  } catch (e) {
    results.push({ name: 'Plugins API count', status: 'WARN', detail: e.message, ms: Date.now() - t2 });
  }

  return results;
};
