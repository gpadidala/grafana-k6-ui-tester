module.exports = async function panelTests(client) {
  const results = [];
  const res = await client.searchDashboards();
  if (!res.ok) {
    results.push({ name: 'Fetch Dashboards', status: 'FAIL', detail: `HTTP ${res.status}` });
    return results;
  }

  // Get available datasource UIDs for validation
  const dsRes = await client.getDatasources();
  const dsUids = new Set((dsRes.data || []).map(d => d.uid));
  const dsNames = new Set((dsRes.data || []).map(d => d.name));

  let totalPanels = 0, errorPanels = 0, warnPanels = 0, healthyPanels = 0, libraryPanels = 0;

  for (const d of (res.data || [])) {
    const detail = await client.getDashboard(d.uid);
    if (!detail.ok) continue;

    const dashPanels = detail.data?.dashboard?.panels || [];

    // Flatten nested panels (panels inside rows)
    const allPanels = [];
    for (const p of dashPanels) {
      if (p.type === 'row') {
        // Row panels contain nested panels
        if (Array.isArray(p.panels)) {
          allPanels.push(...p.panels);
        }
        continue; // skip the row itself
      }
      allPanels.push(p);
    }

    for (const panel of allPanels) {
      totalPanels++;
      const issues = [];
      const panelTitle = panel.title || 'untitled';
      const panelType = panel.type || 'unknown';

      // Skip non-query panel types
      const noQueryTypes = ['text', 'row', 'dashlist', 'news', 'alertlist', 'welcome', 'gettingstarted', 'canvas', 'nodeGraph'];
      if (noQueryTypes.includes(panelType)) {
        healthyPanels++;
        continue;
      }

      // Library panel
      if (panel.libraryPanel) {
        libraryPanels++;
        healthyPanels++;
        continue;
      }

      // Datasource validation
      const ds = panel.datasource;
      if (ds) {
        const dsUid = typeof ds === 'object' ? (ds.uid || '') : String(ds);
        const dsType = typeof ds === 'object' ? (ds.type || '') : '';

        // Template variable datasource (e.g. ${DS_PROMETHEUS}) — check if template exists
        if (dsUid.startsWith('${') || dsUid.startsWith('$')) {
          // Template var — valid pattern, skip uid check
        } else if (dsUid === '-- Mixed --' || dsUid === 'mixed' || dsType === 'mixed') {
          // Mixed datasource — valid
        } else if (dsUid === '-- Grafana --' || dsType === 'grafana' || dsType === 'datasource') {
          // Built-in Grafana datasource — valid
        } else if (dsUid && !dsUids.has(dsUid)) {
          issues.push(`Datasource UID "${dsUid}" not found in this instance`);
        }
      } else {
        // No datasource set — uses default, which is fine
      }

      // Query validation
      const targets = panel.targets || [];
      if (targets.length === 0) {
        issues.push('No queries configured');
      }

      // Empty expressions
      for (const t of targets) {
        if (t.expr !== undefined && t.expr === '') {
          issues.push(`Empty PromQL expression (refId: ${t.refId || '?'})`);
        }
        if (t.query !== undefined && t.query === '' && panelType !== 'stat') {
          issues.push(`Empty query (refId: ${t.refId || '?'})`);
        }
      }

      // Deprecated panel types
      if (['graph', 'table-old', 'singlestat'].includes(panelType)) {
        issues.push(`Deprecated panel type: "${panelType}" — migrate to timeseries/table/stat`);
      }

      if (issues.length > 0) {
        const hasError = issues.some(i => i.includes('not found') || i.includes('No queries'));
        if (hasError) errorPanels++;
        else warnPanels++;
        results.push({
          name: `${panelTitle} (${d.title})`,
          status: hasError ? 'FAIL' : 'WARN',
          uid: d.uid,
          detail: `[${panelType}] ${issues.join(' | ')}`,
        });
      } else {
        healthyPanels++;
      }
    }
  }

  // Summary at the top
  const summaryStatus = errorPanels > 0 ? 'FAIL' : warnPanels > 0 ? 'WARN' : 'PASS';
  results.unshift({
    name: 'Panel Summary',
    status: summaryStatus,
    detail: `${totalPanels} total panels across ${(res.data || []).length} dashboards — ${healthyPanels} healthy, ${errorPanels} errors, ${warnPanels} warnings, ${libraryPanels} library`,
  });

  return results;
};
