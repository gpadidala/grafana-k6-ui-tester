// navigation.js — Verify sidebar and key page navigation
module.exports = async function (page, grafanaUrl, token, options) {
  const results = [];

  // Test sidebar exists
  const t0 = Date.now();
  try {
    await page.goto(grafanaUrl, { waitUntil: 'load', timeout: 30000 });
    const sidebar = page.locator('nav, [class*="sidemenu"], [aria-label="Main menu"], [data-testid*="nav"]');
    const visible = await sidebar.first().isVisible({ timeout: 5000 });
    results.push({ name: 'Sidebar exists', status: visible ? 'PASS' : 'WARN',
      detail: visible ? 'Navigation element found' : 'Sidebar not detected', ms: Date.now() - t0 });
  } catch (e) {
    results.push({ name: 'Sidebar exists', status: 'WARN', detail: e.message, ms: Date.now() - t0 });
  }

  // Navigate to key pages
  const pages = [
    { path: '/dashboards', name: 'Dashboards page' },
    { path: '/explore', name: 'Explore page' },
    { path: '/alerting/list', name: 'Alerting page' },
    { path: '/admin/users', name: 'Admin users page' },
    { path: '/plugins', name: 'Plugins page' },
  ];

  for (const pg of pages) {
    const start = Date.now();
    try {
      const res = await page.goto(`${grafanaUrl}${pg.path}`, { waitUntil: 'load', timeout: 30000 });
      const code = res ? res.status() : 0;
      const ok = code >= 200 && code < 400;
      results.push({ name: pg.name, status: ok ? 'PASS' : 'FAIL',
        detail: `HTTP ${code} at ${pg.path}`, ms: Date.now() - start });
    } catch (e) {
      results.push({ name: pg.name, status: 'FAIL', detail: e.message, ms: Date.now() - start });
    }
  }

  return results;
};
