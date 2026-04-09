module.exports = async function dataFreshnessTests(client, depGraph, options = {}) {
  const results = [];
  const staleThresholdMs = options.staleThresholdMs || 15 * 60 * 1000; // 15 min default

  const dashRes = await client.searchDashboards();
  if (!dashRes.ok) {
    results.push({ name: 'Fetch Dashboards', status: 'FAIL', detail: `HTTP ${dashRes.status}` });
    return results;
  }

  const dashboards = (dashRes.data || []).slice(0, options.maxDashboards || 30);
  let staleCount = 0, freshCount = 0, errorCount = 0;

  for (const d of dashboards) {
    const detail = await client.getDashboard(d.uid);
    if (!detail.ok) continue;

    const panels = flattenPanels(detail.data?.dashboard?.panels || []);
    let dashStale = false, dashError = false;

    for (const panel of panels.slice(0, 5)) { // Check first 5 panels per dashboard
      const targets = panel.targets || [];
      if (targets.length === 0) continue;

      const ds = panel.datasource;
      const dsUid = ds ? (typeof ds === 'object' ? ds.uid : String(ds)) : null;
      if (!dsUid || dsUid.startsWith('$') || dsUid === '-- Mixed --') continue;

      // Execute query for latest data
      const queryPayload = {
        queries: targets.slice(0, 1).map(t => ({
          ...t,
          datasource: { uid: dsUid, type: typeof ds === 'object' ? ds.type : undefined },
        })),
        from: 'now-1h',
        to: 'now',
      };

      const qRes = await client.post('/api/ds/query', queryPayload);
      if (!qRes.ok) { dashError = true; continue; }

      // Check most recent data point timestamp
      const frames = qRes.data?.results ? Object.values(qRes.data.results) : [];
      for (const frame of frames) {
        const series = frame?.frames || [];
        for (const s of series) {
          const values = s?.data?.values;
          if (values && values.length >= 2) {
            const timestamps = values[0]; // first column is usually time
            if (Array.isArray(timestamps) && timestamps.length > 0) {
              const latest = timestamps[timestamps.length - 1];
              if (typeof latest === 'number') {
                const gap = Date.now() - latest;
                if (gap > staleThresholdMs) {
                  dashStale = true;
                }
              }
            }
          }
        }
      }

      break; // Only check first panel with data
    }

    if (dashError) {
      errorCount++;
    } else if (dashStale) {
      staleCount++;
      results.push({
        name: `Stale: ${d.title}`, status: 'WARN', uid: d.uid,
        detail: `Data older than ${Math.round(staleThresholdMs / 60000)} minutes — data pipeline may be broken`,
      });
    } else {
      freshCount++;
    }
  }

  results.unshift({
    name: 'Data Freshness Summary',
    status: staleCount > 0 ? 'WARN' : errorCount > 0 ? 'WARN' : 'PASS',
    detail: `${dashboards.length} dashboards checked — ${freshCount} fresh, ${staleCount} stale, ${errorCount} query errors`,
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
