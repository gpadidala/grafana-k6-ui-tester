module.exports = async function panelTests(client) {
  const results = [];
  const res = await client.searchDashboards();
  if (!res.ok) {
    results.push({ name: 'Fetch Dashboards', status: 'FAIL', detail: `HTTP ${res.status}` });
    return results;
  }

  let totalPanels = 0, errorPanels = 0, libraryPanels = 0;

  for (const d of (res.data || [])) {
    const detail = await client.getDashboard(d.uid);
    if (!detail.ok) continue;

    const panels = detail.data?.dashboard?.panels || [];
    for (const panel of panels) {
      totalPanels++;
      const issues = [];

      // Query validation
      const targets = panel.targets || [];
      if (targets.length === 0 && !['text', 'row', 'dashlist', 'news', 'alertlist', 'welcome', 'gettingstarted'].includes(panel.type)) {
        issues.push('No queries configured');
      }

      // Datasource config
      const ds = panel.datasource;
      if (ds && typeof ds === 'object') {
        if (!ds.uid && !ds.type) issues.push('Datasource not set');
        else if (ds.uid === '-- Mixed --') { /* mixed is fine */ }
      }

      // Empty expressions
      for (const t of targets) {
        if (t.expr === '' && panel.type !== 'row') issues.push(`Empty query expression (refId: ${t.refId || '?'})`);
      }

      // Library panel
      if (panel.libraryPanel) {
        libraryPanels++;
        results.push({
          name: `Library Panel: ${panel.title || 'untitled'}`, status: 'PASS', uid: d.uid,
          detail: `Library: ${panel.libraryPanel.name || panel.libraryPanel.uid} in "${d.title}"`,
        });
        continue;
      }

      if (issues.length > 0) {
        errorPanels++;
        results.push({
          name: `Panel: ${panel.title || 'untitled'} (${d.title})`, status: 'WARN', uid: d.uid,
          detail: issues.join(' | '),
        });
      }
    }
  }

  results.unshift({
    name: 'Panel Summary', status: errorPanels > 0 ? 'WARN' : 'PASS',
    detail: `${totalPanels} total, ${errorPanels} with issues, ${libraryPanels} library panels`,
  });

  return results;
};
