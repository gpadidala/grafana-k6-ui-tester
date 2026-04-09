module.exports = async function(page, grafanaUrl, token) {
  const results = [];

  let dashboards = [];
  try {
    const res = await page.request.get(`${grafanaUrl}/api/search?type=dash-db&limit=5`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    dashboards = await res.json();
  } catch { return [{ name: 'Fetch Dashboards', status: 'FAIL', detail: 'API error' }]; }

  for (const d of dashboards.slice(0, 3)) {
    const start = Date.now();
    try {
      await page.goto(`${grafanaUrl}/d/${d.uid}`, { waitUntil: 'load', timeout: 30000 });

      const perf = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0] || {};
        const paint = performance.getEntriesByType('paint');
        const fcp = paint.find(p => p.name === 'first-contentful-paint');
        return {
          ttfb: Math.round(nav.responseStart || 0),
          fcp: fcp ? Math.round(fcp.startTime) : null,
          domReady: Math.round(nav.domContentLoadedEventEnd || 0),
          loadComplete: Math.round(nav.loadEventEnd || 0),
        };
      });

      const loadMs = Date.now() - start;
      const issues = [];
      if (perf.ttfb > 800) issues.push(`TTFB ${perf.ttfb}ms (>800)`);
      if (perf.fcp && perf.fcp > 1800) issues.push(`FCP ${perf.fcp}ms (>1800)`);
      if (loadMs > 5000) issues.push(`Total load ${loadMs}ms (>5s)`);

      results.push({
        name: `Perf: ${d.title}`, status: issues.length ? 'WARN' : 'PASS',
        detail: `TTFB=${perf.ttfb}ms FCP=${perf.fcp || '?'}ms Load=${loadMs}ms${issues.length ? ' | ' + issues.join(', ') : ''}`,
        ms: loadMs,
      });
    } catch (e) {
      results.push({ name: `Perf: ${d.title}`, status: 'FAIL', detail: e.message, ms: Date.now() - start });
    }
  }

  return results;
};
