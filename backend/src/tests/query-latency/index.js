'use strict';

const config = require('../../config');
const logger = require('../../utils/logger');

const CAT = 'query-latency';

function flattenPanels(panels) {
  const result = [];
  for (const p of panels) {
    if (p.type === 'row' && Array.isArray(p.panels)) result.push(...p.panels);
    else if (p.type !== 'row') result.push(p);
  }
  return result;
}

/**
 * Build a /api/ds/query body from a panel target.
 * Returns null when there is not enough info to form a valid query.
 */
function buildQueryBody(target, dsUid, panelDatasource) {
  const uid = target.datasource?.uid || dsUid || panelDatasource?.uid;
  if (!uid) return null;

  const now = Date.now();
  const from = now - 3600000; // 1 h window

  return {
    queries: [
      {
        refId: target.refId || 'A',
        datasource: { uid },
        expr: target.expr || undefined,
        rawSql: target.rawSql || undefined,
        query: target.query || undefined,
        range: target.range !== undefined ? target.range : true,
        intervalMs: 15000,
        maxDataPoints: 100,
      },
    ],
    from: String(from),
    to: String(now),
  };
}

async function run(client, _depGraph, options = {}) {
  const results = [];
  const {
    maxDashboards = 50,
    queryThresholdMs = config.thresholds.slowQueryThresholdMs,
    runId,
  } = options;

  // 1. Fetch dashboards
  const searchRes = await client.searchDashboards();
  if (!searchRes.ok) {
    results.push({ name: 'query-latency:search', status: 'FAIL', detail: `Dashboard search failed: ${searchRes.error}`, uid: null, ms: searchRes.ms, metadata: {} });
    return results;
  }

  const dashboards = (searchRes.data || []).slice(0, maxDashboards);
  const allLatencies = []; // {dashUid, dashTitle, panelId, panelTitle, dsUid, ms}

  for (const dash of dashboards) {
    const dashRes = await client.getDashboardByUid(dash.uid);
    if (!dashRes.ok) continue;

    const model = dashRes.data?.dashboard;
    if (!model || !Array.isArray(model.panels)) continue;

    const panels = flattenPanels(model.panels);
    const dashLatencies = [];

    for (const panel of panels) {
      const targets = panel.targets || [];
      if (targets.length === 0) continue;

      for (const target of targets) {
        const body = buildQueryBody(target, null, panel.datasource);
        if (!body) continue;

        const dsUid = body.queries[0]?.datasource?.uid || 'unknown';
        const start = Date.now();
        let queryMs = 0;
        let queryStatus = 'success';

        try {
          const qRes = await client.queryViaProxy(body);
          queryMs = qRes.ms || (Date.now() - start);
          if (!qRes.ok) queryStatus = 'error';
        } catch (err) {
          queryMs = Date.now() - start;
          queryStatus = 'error';
        }

        const entry = {
          dashUid: dash.uid,
          dashTitle: model.title || dash.title,
          panelId: panel.id,
          panelTitle: panel.title || `Panel ${panel.id}`,
          dsUid,
          ms: queryMs,
          status: queryStatus,
        };
        dashLatencies.push(entry);
        allLatencies.push(entry);
      }
    }

    // Per-dashboard aggregate
    if (dashLatencies.length > 0) {
      const times = dashLatencies.map(l => l.ms);
      const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
      const max = Math.max(...times);
      const slow = dashLatencies.filter(l => l.ms > queryThresholdMs);

      const status = slow.length > 0 ? 'WARN' : 'PASS';
      results.push({
        name: `query-latency:dashboard:${dash.uid}`,
        status,
        detail: `${dashLatencies.length} queries — avg ${avg}ms, max ${max}ms, ${slow.length} slow (>${queryThresholdMs}ms)`,
        uid: dash.uid,
        ms: times.reduce((a, b) => a + b, 0),
        metadata: {
          dashboardTitle: model.title || dash.title,
          queryCount: dashLatencies.length,
          avgMs: avg,
          maxMs: max,
          slowCount: slow.length,
        },
      });
    }
  }

  // Flag individual slow queries
  const slowQueries = allLatencies.filter(l => l.ms > queryThresholdMs);
  for (const sq of slowQueries) {
    results.push({
      name: `query-latency:slow:${sq.dashUid}:panel-${sq.panelId}`,
      status: 'FAIL',
      detail: `Slow query ${sq.ms}ms on "${sq.panelTitle}" in "${sq.dashTitle}" (threshold ${queryThresholdMs}ms)`,
      uid: sq.dashUid,
      ms: sq.ms,
      metadata: {
        panelId: sq.panelId,
        panelTitle: sq.panelTitle,
        dashboardTitle: sq.dashTitle,
        datasourceUid: sq.dsUid,
        responseTimeMs: sq.ms,
        threshold: queryThresholdMs,
      },
    });
  }

  // Top 10 slowest
  const top10 = [...allLatencies].sort((a, b) => b.ms - a.ms).slice(0, 10);
  results.push({
    name: 'query-latency:top10-slowest',
    status: top10.length > 0 && top10[0].ms > queryThresholdMs ? 'WARN' : 'PASS',
    detail: top10.map((q, i) => `${i + 1}. ${q.ms}ms — "${q.panelTitle}" in "${q.dashTitle}"`).join('\n'),
    uid: null,
    ms: 0,
    metadata: {
      top10: top10.map(q => ({
        dashUid: q.dashUid,
        panelId: q.panelId,
        panelTitle: q.panelTitle,
        dashTitle: q.dashTitle,
        ms: q.ms,
      })),
      totalQueries: allLatencies.length,
      totalSlow: slowQueries.length,
    },
  });

  // Summary
  if (allLatencies.length > 0) {
    const allTimes = allLatencies.map(l => l.ms);
    const globalAvg = Math.round(allTimes.reduce((a, b) => a + b, 0) / allTimes.length);
    results.push({
      name: 'query-latency:summary',
      status: slowQueries.length > 0 ? 'WARN' : 'PASS',
      detail: `${allLatencies.length} total queries across ${dashboards.length} dashboards — avg ${globalAvg}ms, ${slowQueries.length} slow`,
      uid: null,
      ms: 0,
      metadata: { totalQueries: allLatencies.length, dashboardsScanned: dashboards.length, globalAvgMs: globalAvg, slowCount: slowQueries.length },
    });
  } else {
    results.push({
      name: 'query-latency:summary',
      status: 'PASS',
      detail: 'No executable panel queries found',
      uid: null,
      ms: 0,
      metadata: { totalQueries: 0, dashboardsScanned: dashboards.length },
    });
  }

  logger.info(`[${CAT}] Completed: ${allLatencies.length} queries, ${slowQueries.length} slow`, { category: CAT });
  return results;
}

module.exports = { run };
