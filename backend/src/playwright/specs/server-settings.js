module.exports = async function(page, grafanaUrl) {
  const results = [];
  const pages = [
    { path: '/admin/settings', name: 'Server Settings' },
    { path: '/admin/stats', name: 'Server Stats' },
    { path: '/admin/orgs', name: 'Organizations' },
  ];
  for (const p of pages) {
    const start = Date.now();
    try {
      await page.goto(`${grafanaUrl}${p.path}`, { waitUntil: 'load', timeout: 20000 });
      results.push({ name: p.name, status: 'PASS', detail: `Loaded`, ms: Date.now() - start });
    } catch (e) {
      results.push({ name: p.name, status: page.url().includes('/login') ? 'WARN' : 'FAIL', detail: e.message, ms: Date.now() - start });
    }
  }
  return results;
};
