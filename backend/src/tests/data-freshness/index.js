'use strict';

const config = require('../../config');
const logger = require('../../utils/logger');

const CAT = 'data-freshness';

function flattenPanels(panels) {
  const result = [];
  for (const p of panels) {
    if (p.type === 'row' && Array.isArray(p.panels)) result.push(...p.panels);
    else if (p.type !== 'row') result.push(p);
  }
  return result;
}

/**
 * Extract the latest timestamp from query response frames.
 * Grafana /api/ds/query returns results.{refId}.frames[] where each frame
 * has schema.fields[] and data.values[]. Time fields are typically index 0.
 */
function extractLatestTimestamp(queryData) {
  if (!queryData || !queryData.results) return null;

  let latest = null;

  for (const refId of Object.keys(queryData.results)) {
    const frames = queryData.results[refId]?.frames || [];
    for (const frame of frames) {
      const fields = frame.schema?.fields || [];
      const values = frame.data?.values || [];

      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (field.type === 'time' && Array.isArray(values[i]) && values[i].length > 0) {
          const timestamps = values[i];
          const maxTs = Math.max(...timestamps);
          if (latest === null || maxTs > latest) latest = maxTs;
        }
      }
    }
  }

  return latest;
}

async function run(client, _depGraph, options = {}) {
  const results = [];
  const {
    maxDashboards = 50,
    staleThresholdMs = config.thresholds.staleDataThresholdMs,
  } = options;
  const now = Date.now();

  // Fetch dashboards
  const searchRes = await client.searchDashboards();
  if (!searchRes.ok) {
    results.push({ name: `${CAT}:search`, status: 'FAIL', detail: `Dashboard search failed: ${searchRes.error}`, uid: null, ms: searchRes.ms, metadata: {} });
    return results;
  }

  const dashboards = (searchRes.data || []).slice(0, maxDashboards);
  let totalPanelsChecked = 0;
  let stalePanelCount = 0;
  let freshPanelCount = 0;
  let noDataPanelCount = 0;

  for (const dash of dashboards) {
    const dashRes = await client.getDashboardByUid(dash.uid);
    if (!dashRes.ok) continue;

    const model = dashRes.data?.dashboard;
    if (!model || !Array.isArray(model.panels)) continue;

    const panels = flattenPanels(model.panels);
    const dashStale = [];
    const dashFresh = [];

    for (const panel of panels) {
      const targets = panel.targets || [];
      if (targets.length === 0) continue;

      // Take first target with a datasource UID
      const target = targets[0];
      const dsUid = target.datasource?.uid || panel.datasource?.uid;
      if (!dsUid) continue;

      const body = {
        queries: [
          {
            refId: target.refId || 'A',
            datasource: { uid: dsUid },
            expr: target.expr || undefined,
            rawSql: target.rawSql || undefined,
            query: target.query || undefined,
            range: true,
            intervalMs: 60000,
            maxDataPoints: 10,
          },
        ],
        from: String(now - 3600000),
        to: String(now),
      };

      try {
        const qRes = await client.queryViaProxy(body);
        totalPanelsChecked++;

        if (!qRes.ok) {
          noDataPanelCount++;
          continue;
        }

        const latestTs = extractLatestTimestamp(qRes.data);
        if (latestTs === null) {
          noDataPanelCount++;
          continue;
        }

        const ageMs = now - latestTs;
        const ageMins = Math.round(ageMs / 60000);

        if (ageMs > staleThresholdMs) {
          stalePanelCount++;
          dashStale.push({ panelId: panel.id, panelTitle: panel.title, ageMs, ageMins });
        } else {
          freshPanelCount++;
          dashFresh.push({ panelId: panel.id, panelTitle: panel.title, ageMs, ageMins });
        }
      } catch (err) {
        noDataPanelCount++;
      }
    }

    // Per-dashboard result
    if (dashStale.length > 0) {
      results.push({
        name: `${CAT}:stale:${dash.uid}`,
        status: 'FAIL',
        detail: `${dashStale.length} stale panel(s) in "${model.title || dash.title}": ${dashStale.map(p => `"${p.panelTitle}" (${p.ageMins}m old)`).join(', ')}`,
        uid: dash.uid,
        ms: 0,
        metadata: {
          dashboardTitle: model.title || dash.title,
          stalePanels: dashStale,
          freshPanels: dashFresh.length,
          thresholdMs: staleThresholdMs,
        },
      });
    } else if (dashFresh.length > 0) {
      results.push({
        name: `${CAT}:fresh:${dash.uid}`,
        status: 'PASS',
        detail: `All ${dashFresh.length} queried panel(s) in "${model.title || dash.title}" have fresh data`,
        uid: dash.uid,
        ms: 0,
        metadata: {
          dashboardTitle: model.title || dash.title,
          freshPanels: dashFresh.length,
          thresholdMs: staleThresholdMs,
        },
      });
    }
  }

  // Summary
  const staleThresholdMins = Math.round(staleThresholdMs / 60000);
  results.push({
    name: `${CAT}:summary`,
    status: stalePanelCount > 0 ? 'FAIL' : 'PASS',
    detail: `${totalPanelsChecked} panels checked — ${freshPanelCount} fresh, ${stalePanelCount} stale (>${staleThresholdMins}m), ${noDataPanelCount} no-data`,
    uid: null,
    ms: 0,
    metadata: {
      dashboardsScanned: dashboards.length,
      totalPanelsChecked,
      freshCount: freshPanelCount,
      staleCount: stalePanelCount,
      noDataCount: noDataPanelCount,
      staleThresholdMs,
    },
  });

  logger.info(`[${CAT}] Completed: ${totalPanelsChecked} panels, ${stalePanelCount} stale`, { category: CAT });
  return results;
}

module.exports = { run };
