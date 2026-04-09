module.exports = async function capacityPlanningTests(client) {
  const results = [];

  const dashRes = await client.searchDashboards();
  const dsRes = await client.getDatasources();
  const alertRes = await client.getAlertRules();
  const pluginRes = await client.getPlugins();

  const dashboards = dashRes.ok ? (dashRes.data || []) : [];
  const datasources = dsRes.ok ? (dsRes.data || []) : [];
  const alerts = alertRes.ok && Array.isArray(alertRes.data) ? alertRes.data : [];
  const plugins = pluginRes.ok ? (pluginRes.data || []) : [];

  // Dashboard density analysis
  let totalPanels = 0, heavyDashboards = 0, totalQueries = 0;
  const panelCounts = [];
  const dsQueryCounts = {}; // dsUid → query count

  for (const d of dashboards) {
    const detail = await client.getDashboard(d.uid);
    if (!detail.ok) continue;

    const panels = flattenPanels(detail.data?.dashboard?.panels || []);
    const count = panels.length;
    totalPanels += count;
    panelCounts.push(count);

    if (count > 30) heavyDashboards++;

    for (const p of panels) {
      const targets = p.targets || [];
      totalQueries += targets.length;

      const ds = p.datasource;
      const dsUid = ds ? (typeof ds === 'object' ? ds.uid : String(ds)) : 'default';
      if (dsUid && !dsUid.startsWith('$')) {
        dsQueryCounts[dsUid] = (dsQueryCounts[dsUid] || 0) + targets.length;
      }
    }
  }

  // Dashboard density
  const avgPanels = dashboards.length > 0 ? Math.round(totalPanels / dashboards.length) : 0;
  results.push({
    name: 'Dashboard Density', status: heavyDashboards > 0 ? 'WARN' : 'PASS',
    detail: `${dashboards.length} dashboards, ${totalPanels} panels total, avg ${avgPanels}/dashboard, ${heavyDashboards} heavy (>30 panels)`,
  });

  // Heaviest dashboards
  if (panelCounts.length > 0) {
    panelCounts.sort((a, b) => b - a);
    results.push({
      name: 'Panel Distribution', status: 'PASS',
      detail: `Max: ${panelCounts[0]}, Median: ${panelCounts[Math.floor(panelCounts.length / 2)]}, Min: ${panelCounts[panelCounts.length - 1]}`,
    });
  }

  // Datasource load
  const dsByLoad = Object.entries(dsQueryCounts).sort((a, b) => b[1] - a[1]);
  for (const [uid, count] of dsByLoad.slice(0, 5)) {
    const ds = datasources.find(d => d.uid === uid);
    results.push({
      name: `DS Load: ${ds?.name || uid}`, status: count > 500 ? 'WARN' : 'PASS',
      detail: `${count} queries across all dashboards${count > 500 ? ' — high query load, consider recording rules' : ''}`,
    });
  }

  // Alert evaluation cost
  const alertsPerMinute = alerts.reduce((sum, r) => {
    const intervalSec = parseInt(r.execErrState === 'Alerting' ? '60' : r.for || '60', 10);
    return sum + (60 / Math.max(intervalSec, 10));
  }, 0);

  results.push({
    name: 'Alert Evaluation Load', status: alertsPerMinute > 100 ? 'WARN' : 'PASS',
    detail: `${alerts.length} alert rules, ~${Math.round(alertsPerMinute)} evaluations/minute`,
  });

  // Plugin count
  const externalPlugins = plugins.filter(p => p.signature !== 'internal');
  results.push({
    name: 'Plugin Count', status: externalPlugins.length > 30 ? 'WARN' : 'PASS',
    detail: `${plugins.length} total, ${externalPlugins.length} external${externalPlugins.length > 30 ? ' — consider cleanup' : ''}`,
  });

  // Total queries estimate
  results.push({
    name: 'Total Query Volume', status: totalQueries > 2000 ? 'WARN' : 'PASS',
    detail: `${totalQueries} queries configured across all dashboards — each viewer session triggers these on load`,
  });

  return results;
};

function flattenPanels(panels) {
  const result = [];
  for (const p of panels) {
    if (p.type === 'row' && Array.isArray(p.panels)) result.push(...p.panels);
    else if (p.type !== 'row') result.push(p);
  }
  return result;
}
