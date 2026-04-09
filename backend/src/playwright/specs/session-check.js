module.exports = async function(page, grafanaUrl) {
  const results = [];
  const start = Date.now();
  try {
    // Verify we're logged in
    await page.goto(`${grafanaUrl}/api/user`, { waitUntil: 'load', timeout: 15000 });
    const text = await page.textContent('body');
    const hasUser = text.includes('"login"') || text.includes('"id"');
    results.push({
      name: 'Session Active', status: hasUser ? 'PASS' : 'FAIL',
      detail: hasUser ? 'Session valid, user data returned' : 'Session expired or invalid',
      ms: Date.now() - start,
    });
  } catch (e) {
    results.push({ name: 'Session Active', status: 'FAIL', detail: e.message, ms: Date.now() - start });
  }
  return results;
};
