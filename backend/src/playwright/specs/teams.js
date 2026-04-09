module.exports = async function(page, grafanaUrl) {
  const results = [];
  const start = Date.now();
  try {
    await page.goto(`${grafanaUrl}/org/teams`, { waitUntil: 'load', timeout: 30000 });
    const content = await page.textContent('body');
    const hasTeams = content.includes('team') || content.includes('Team');
    results.push({ name: 'Teams Page', status: 'PASS', detail: `Page loaded`, ms: Date.now() - start });
  } catch (e) {
    results.push({ name: 'Teams Page', status: 'FAIL', detail: e.message, ms: Date.now() - start });
  }
  return results;
};
