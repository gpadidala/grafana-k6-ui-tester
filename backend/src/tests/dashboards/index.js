module.exports = async function dashboardTests(client) {
  const results = [];
  const res = await client.searchDashboards();
  if (!res.ok || !Array.isArray(res.data)) {
    results.push({ name: 'Fetch Dashboards', status: 'FAIL', detail: `HTTP ${res.status}`, ms: res.ms });
    return results;
  }

  const dashboards = res.data;
  results.push({ name: 'Fetch Dashboards', status: 'PASS', detail: `Found ${dashboards.length} dashboard(s)`, ms: res.ms });

  for (const d of dashboards) {
    const detail = await client.getDashboard(d.uid);
    if (!detail.ok) {
      results.push({ name: `Dashboard: ${d.title}`, status: 'FAIL', uid: d.uid, detail: `Failed to load: HTTP ${detail.status}`, ms: detail.ms });
      continue;
    }

    const dash = detail.data?.dashboard;
    const meta = detail.data?.meta;
    const panels = dash?.panels || [];
    const issues = [];

    // Panel count
    if (panels.length === 0) issues.push('No panels on dashboard');

    // Deprecated panel types
    const deprecated = panels.filter(p => ['graph', 'table-old', 'singlestat'].includes(p.type));
    if (deprecated.length > 0) issues.push(`${deprecated.length} deprecated panel type(s): ${deprecated.map(p => p.type).join(', ')}`);

    // Missing datasource refs
    const badDs = panels.filter(p => {
      const ds = p.datasource;
      return ds && typeof ds === 'object' && (!ds.uid || ds.uid === '');
    });
    if (badDs.length > 0) issues.push(`${badDs.length} panel(s) with missing datasource UID`);

    // Templating vars
    const vars = dash?.templating?.list || [];
    const brokenVars = vars.filter(v => v.type === 'datasource' && !v.query);
    if (brokenVars.length > 0) issues.push(`${brokenVars.length} broken template variable(s)`);

    const status = issues.length === 0 ? 'PASS' : issues.some(i => i.includes('deprecated') || i.includes('No panels')) ? 'WARN' : 'FAIL';

    results.push({
      name: `Dashboard: ${d.title}`, status, uid: d.uid,
      detail: issues.length ? issues.join(' | ') : `${panels.length} panels, created by ${meta?.createdBy || 'unknown'}, last updated ${meta?.updated?.split('T')[0] || 'unknown'}`,
      ms: detail.ms, createdBy: meta?.createdBy, updatedBy: meta?.updatedBy, updated: meta?.updated,
    });
  }

  return results;
};
