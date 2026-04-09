const { stmts } = require('../../db');

module.exports = async function queryLatencyTests(client, depGraph, options = {}) {
  const results = [];
  const runId = options.runId || 'unknown';
  const threshold = options.queryThresholdMs || 5000;

  const dashRes = await client.searchDashboards();
  if (!dashRes.ok) {
    results.push({ name: 'Fetch Dashboards', status: 'FAIL', detail: `HTTP ${dashRes.status}` });
    return results;
  }

  const dashboards = (dashRes.data || []).slice(0, options.maxDashboards || 50);
  let totalQueries = 0, slowQueries = 0, errorQueries = 0, totalMs = 0;
  const slowest = [];

  for (const d of dashboards) {
    const detail = await client.getDashboard(d.uid);
    if (!detail.ok) continue;

    const panels = flattenPanels(detail.data?.dashboard?.panels || []);
    let dashTotalMs = 0, dashQueryCount = 0;

    for (const panel of panels) {
      const targets = panel.targets || [];
      if (targets.length === 0) continue;

      const ds = panel.datasource;
      const dsUid = ds ? (typeof ds === 'object' ? ds.uid : String(ds)) : null;
      if (!dsUid || dsUid.startsWith('$') || dsUid === '-- Mixed --') continue;

      // Execute query via Grafana proxy
      const queryPayload = {
        queries: targets.map(t => ({ ...t, datasource: { uid: dsUid, type: typeof ds === 'object' ? ds.type : undefined } })),
        from: 'now-1h',
        to: 'now',
      };

      const start = Date.now();
      const qRes = await client.post('/api/ds/query', queryPayload);
      const ms = Date.now() - start;

      totalQueries++;
      dashQueryCount++;
      dashTotalMs += ms;
      totalMs += ms;

      // Store latency measurement
      try {
        stmts.insertLatency.run(runId, d.uid, d.title, panel.id || 0, panel.title || 'untitled', dsUid, ms, 0, qRes.ok ? 'success' : 'error');
      } catch (e) { /* ignore db errors */ }

      if (!qRes.ok) {
        errorQueries++;
        slowest.push({ dashboard: d.title, panel: panel.title, ms, status: 'error', dsUid });
      } else if (ms > threshold) {
        slowQueries++;
        slowest.push({ dashboard: d.title, panel: panel.title, ms, status: 'slow', dsUid });
      }
    }

    if (dashQueryCount > 0) {
      const avgMs = Math.round(dashTotalMs / dashQueryCount);
      const dashStatus = dashTotalMs > 10000 ? 'WARN' : 'PASS';
      results.push({
        name: `Dashboard: ${d.title}`, status: dashStatus, uid: d.uid,
        detail: `${dashQueryCount} queries, total ${dashTotalMs}ms, avg ${avgMs}ms${dashTotalMs > 10000 ? ' — SLOW aggregate' : ''}`,
        ms: dashTotalMs,
      });
    }
  }

  // Top 10 slowest
  slowest.sort((a, b) => b.ms - a.ms);
  for (const s of slowest.slice(0, 10)) {
    results.push({
      name: `Slow: ${s.panel} (${s.dashboard})`, status: s.status === 'error' ? 'FAIL' : 'WARN',
      detail: `${s.ms}ms — ${s.status === 'error' ? 'query error' : 'exceeds threshold'} (ds: ${s.dsUid})`,
      ms: s.ms,
    });
  }

  // Summary
  const avgMs = totalQueries > 0 ? Math.round(totalMs / totalQueries) : 0;
  results.unshift({
    name: 'Query Latency Summary',
    status: errorQueries > 0 ? 'FAIL' : slowQueries > 0 ? 'WARN' : 'PASS',
    detail: `${totalQueries} queries across ${dashboards.length} dashboards — avg ${avgMs}ms, ${slowQueries} slow (>${threshold}ms), ${errorQueries} errors`,
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
