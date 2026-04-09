// health-check.js — Footer version, console errors, resource loading
module.exports = async function (page, grafanaUrl, token, options) {
  const results = [];
  const consoleErrors = [];
  const failedResources = [];

  // Collect console errors and failed requests
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('response', res => { if (res.status() === 404) failedResources.push(res.url()); });

  // Load home page
  const t0 = Date.now();
  try {
    await page.goto(grafanaUrl, { waitUntil: 'load', timeout: 30000 });
    results.push({ name: 'Home page loads', status: 'PASS', detail: 'Loaded successfully', ms: Date.now() - t0 });
  } catch (e) {
    results.push({ name: 'Home page loads', status: 'FAIL', detail: e.message, ms: Date.now() - t0 });
    return results;
  }

  // Check footer version
  const t1 = Date.now();
  try {
    const footer = page.locator('footer, [class*="footer"], [class*="Footer"]');
    const visible = await footer.first().isVisible({ timeout: 5000 });
    const text = visible ? await footer.first().innerText() : '';
    const hasVersion = /v?\d+\.\d+/.test(text);
    results.push({ name: 'Footer version visible', status: hasVersion ? 'PASS' : 'WARN',
      detail: hasVersion ? text.trim().substring(0, 80) : 'Version not found in footer', ms: Date.now() - t1 });
  } catch (e) {
    results.push({ name: 'Footer version visible', status: 'WARN', detail: e.message, ms: Date.now() - t1 });
  }

  // Console errors check
  const t2 = Date.now();
  const errCount = consoleErrors.length;
  results.push({ name: 'No console errors', status: errCount === 0 ? 'PASS' : 'WARN',
    detail: errCount === 0 ? 'No JS errors detected' : `${errCount} error(s): ${consoleErrors[0]?.substring(0, 80)}`, ms: Date.now() - t2 });

  // 404 resources check
  const t3 = Date.now();
  const notFound = failedResources.length;
  results.push({ name: 'No 404 resources', status: notFound === 0 ? 'PASS' : 'FAIL',
    detail: notFound === 0 ? 'All CSS/JS loaded' : `${notFound} 404(s): ${failedResources[0]?.substring(0, 80)}`, ms: Date.now() - t3 });

  // Remove listeners
  page.removeAllListeners('console');
  page.removeAllListeners('response');

  return results;
};
