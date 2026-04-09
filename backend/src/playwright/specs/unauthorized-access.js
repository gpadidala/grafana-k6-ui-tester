module.exports = async function(page, grafanaUrl) {
  const results = [];
  // Test with a fresh context (no auth)
  const browser = page.context().browser();
  const noAuthCtx = await browser.newContext({ ignoreHTTPSErrors: true });
  const noAuthPage = await noAuthCtx.newPage();

  const protectedPaths = ['/d/test', '/explore', '/alerting/list', '/admin/users', '/datasources'];

  for (const p of protectedPaths) {
    const start = Date.now();
    try {
      await noAuthPage.goto(`${grafanaUrl}${p}`, { waitUntil: 'load', timeout: 15000 });
      const url = noAuthPage.url();
      const redirectedToLogin = url.includes('/login');
      results.push({
        name: `Unauth: ${p}`, status: redirectedToLogin ? 'PASS' : 'FAIL',
        detail: redirectedToLogin ? 'Correctly redirected to login' : `Accessible without auth at ${url}`,
        ms: Date.now() - start,
      });
    } catch (e) {
      results.push({ name: `Unauth: ${p}`, status: 'WARN', detail: e.message, ms: Date.now() - start });
    }
  }

  await noAuthCtx.close();
  return results;
};
