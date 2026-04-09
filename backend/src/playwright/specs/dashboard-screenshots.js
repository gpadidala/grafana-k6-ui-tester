const path = require('path');
const fs = require('fs');
const config = require('../../config');

module.exports = async function(page, grafanaUrl, token) {
  const results = [];
  const screenshotDir = path.resolve(config.paths.screenshots);
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

  // Fetch dashboards
  let dashboards = [];
  try {
    const res = await page.request.get(`${grafanaUrl}/api/search?type=dash-db&limit=10`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    dashboards = await res.json();
  } catch (e) {
    results.push({ name: 'Fetch Dashboards', status: 'FAIL', detail: e.message });
    return results;
  }

  for (const d of dashboards.slice(0, 5)) {
    const start = Date.now();
    try {
      await page.goto(`${grafanaUrl}/d/${d.uid}?kiosk`, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(3000); // wait for panels to render

      const filename = `screenshot-${d.uid}-${Date.now()}.png`;
      const filepath = path.join(screenshotDir, filename);
      await page.screenshot({ path: filepath, fullPage: true });

      results.push({ name: `Screenshot: ${d.title}`, status: 'PASS', detail: `Captured`, ms: Date.now() - start, screenshot: filename });
    } catch (e) {
      results.push({ name: `Screenshot: ${d.title}`, status: 'FAIL', detail: e.message, ms: Date.now() - start });
    }
  }

  return results;
};
