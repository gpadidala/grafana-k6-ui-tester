module.exports = async function(page, grafanaUrl, token) {
  const results = [];

  let dashboards = [];
  try {
    const res = await page.request.get(`${grafanaUrl}/api/search?type=dash-db&limit=200&tag=kubernetes`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const byTag = await res.json();
    // Also search by title
    const res2 = await page.request.get(`${grafanaUrl}/api/search?type=dash-db&limit=200&query=k8s`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const byTitle = await res2.json();
    const seen = new Set();
    [...(byTag || []), ...(byTitle || [])].forEach(d => { if (!seen.has(d.uid)) { seen.add(d.uid); dashboards.push(d); } });
  } catch (e) {
    return [{ name: 'Discover K8s Dashboards', status: 'FAIL', detail: e.message }];
  }

  results.push({ name: 'K8s Dashboard Discovery', status: 'PASS', detail: `Found ${dashboards.length} K8s dashboards` });

  for (const d of dashboards.slice(0, 5)) {
    const start = Date.now();
    try {
      await page.goto(`${grafanaUrl}/d/${d.uid}`, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(2000);
      const panels = await page.locator('.panel-container, [data-panelid], .react-grid-item').count();
      results.push({
        name: `K8s: ${d.title}`, status: panels > 0 ? 'PASS' : 'WARN',
        detail: `${panels} panels rendered`, ms: Date.now() - start,
      });
    } catch (e) {
      results.push({ name: `K8s: ${d.title}`, status: 'FAIL', detail: e.message, ms: Date.now() - start });
    }
  }

  return results;
};
