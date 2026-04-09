// plugin-config.js — Navigate to plugins, click first plugin, verify detail page
module.exports = async function (page, grafanaUrl, token, options) {
  const results = [];

  // Get first plugin via API for reliable navigation
  let pluginId = null;
  const t0 = Date.now();
  try {
    const res = await page.request.get(`${grafanaUrl}/api/plugins`);
    const plugins = await res.json();
    if (Array.isArray(plugins) && plugins.length > 0) {
      pluginId = plugins[0].id;
    }
    results.push({ name: 'Fetch plugin list', status: pluginId ? 'PASS' : 'WARN',
      detail: pluginId ? `First plugin: ${pluginId}` : 'No plugins found', ms: Date.now() - t0 });
  } catch (e) {
    results.push({ name: 'Fetch plugin list', status: 'FAIL', detail: e.message, ms: Date.now() - t0 });
    return results;
  }

  if (!pluginId) return results;

  // Navigate to plugin detail page
  const t1 = Date.now();
  try {
    const res = await page.goto(`${grafanaUrl}/plugins/${pluginId}`, { waitUntil: 'load', timeout: 30000 });
    const code = res ? res.status() : 0;
    const ok = code >= 200 && code < 400;
    results.push({ name: 'Plugin detail page loads', status: ok ? 'PASS' : 'FAIL',
      detail: `HTTP ${code} for /plugins/${pluginId}`, ms: Date.now() - t1 });
  } catch (e) {
    results.push({ name: 'Plugin detail page loads', status: 'FAIL', detail: e.message, ms: Date.now() - t1 });
    return results;
  }

  // Check detail content visible
  const t2 = Date.now();
  try {
    const content = page.locator('[class*="plugin"], h1, h2, [data-testid*="plugin"]');
    const visible = await content.first().isVisible({ timeout: 5000 });
    results.push({ name: 'Plugin detail content', status: visible ? 'PASS' : 'WARN',
      detail: visible ? 'Detail content rendered' : 'No plugin content visible', ms: Date.now() - t2 });
  } catch (e) {
    results.push({ name: 'Plugin detail content', status: 'WARN', detail: e.message, ms: Date.now() - t2 });
  }

  return results;
};
