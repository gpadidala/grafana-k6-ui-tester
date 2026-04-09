module.exports = async function(page, grafanaUrl) {
  const results = [];
  const start = Date.now();
  try {
    await page.goto(`${grafanaUrl}/admin/users`, { waitUntil: 'load', timeout: 30000 });
    const url = page.url();
    if (url.includes('/admin/users') || url.includes('/org/users')) {
      const rows = await page.locator('table tbody tr, [class*="user"]').count();
      results.push({ name: 'Admin Users Page', status: 'PASS', detail: `Page loaded, ${rows} users visible`, ms: Date.now() - start });
    } else {
      results.push({ name: 'Admin Users Page', status: 'WARN', detail: `Redirected to ${url} (may need server admin)`, ms: Date.now() - start });
    }
  } catch (e) {
    results.push({ name: 'Admin Users Page', status: 'FAIL', detail: e.message, ms: Date.now() - start });
  }
  return results;
};
