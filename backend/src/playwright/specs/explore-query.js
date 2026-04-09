module.exports = async function(page, grafanaUrl) {
  const results = [];
  const start = Date.now();
  try {
    await page.goto(`${grafanaUrl}/explore`, { waitUntil: 'load', timeout: 30000 });
    const url = page.url();
    if (url.includes('/explore')) {
      results.push({ name: 'Explore Page Loads', status: 'PASS', detail: `Explore page accessible`, ms: Date.now() - start });
    } else {
      results.push({ name: 'Explore Page Loads', status: 'WARN', detail: `Redirected to ${url}`, ms: Date.now() - start });
    }
  } catch (e) {
    results.push({ name: 'Explore Page Loads', status: 'FAIL', detail: e.message, ms: Date.now() - start });
  }
  return results;
};
