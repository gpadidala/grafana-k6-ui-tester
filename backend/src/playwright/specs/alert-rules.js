// alert-rules.js — Navigate to alerting list, check rules visible, count them
module.exports = async function (page, grafanaUrl, token, options) {
  const results = [];

  // Navigate to alerting page
  const t0 = Date.now();
  try {
    const res = await page.goto(`${grafanaUrl}/alerting/list`, { waitUntil: 'load', timeout: 30000 });
    const code = res ? res.status() : 0;
    results.push({ name: 'Alerting page loads', status: (code >= 200 && code < 400) ? 'PASS' : 'FAIL',
      detail: `HTTP ${code}`, ms: Date.now() - t0 });
  } catch (e) {
    results.push({ name: 'Alerting page loads', status: 'FAIL', detail: e.message, ms: Date.now() - t0 });
    return results;
  }

  // Check for alert rules list
  const t1 = Date.now();
  try {
    const ruleRows = page.locator('[data-testid*="rule"], [class*="alert-rule"], table tbody tr, [class*="rules-table"] tr, [class*="RulesTable"]');
    await ruleRows.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    const count = await ruleRows.count();

    if (count > 0) {
      results.push({ name: 'Alert rules visible', status: 'PASS',
        detail: `${count} rule row(s) found`, ms: Date.now() - t1 });
    } else {
      results.push({ name: 'Alert rules visible', status: 'WARN',
        detail: 'No alert rules found (may be empty)', ms: Date.now() - t1 });
    }
  } catch (e) {
    results.push({ name: 'Alert rules visible', status: 'WARN', detail: e.message, ms: Date.now() - t1 });
  }

  // Verify via API too
  const t2 = Date.now();
  try {
    const res = await page.request.get(`${grafanaUrl}/api/ruler/grafana/api/v1/rules`);
    const ok = res.ok();
    results.push({ name: 'Alert rules API', status: ok ? 'PASS' : 'WARN',
      detail: ok ? 'Ruler API accessible' : `Status ${res.status()}`, ms: Date.now() - t2 });
  } catch (e) {
    results.push({ name: 'Alert rules API', status: 'WARN', detail: e.message, ms: Date.now() - t2 });
  }

  return results;
};
