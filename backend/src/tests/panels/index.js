const logger = require('../../utils/logger');
const config = require('../../config');
const { dashboardUsesDatasource, normalizeFilter } = require('../utils/dsFilter');

const CAT = 'panels';

function result(name, status, detail, ms = 0, metadata = {}, uid = null) {
  return { name, status, detail, uid, ms, metadata };
}

const DEPRECATED_PANEL_TYPES = new Set([
  'graph', 'table-old', 'singlestat', 'alertlist-old',
  'grafana-piechart-panel', 'grafana-worldmap-panel',
]);

const KNOWN_PANEL_TYPES = new Set([
  'timeseries', 'stat', 'gauge', 'bargauge', 'table', 'text', 'row',
  'heatmap', 'histogram', 'piechart', 'barchart', 'news', 'logs',
  'nodeGraph', 'traces', 'flamegraph', 'geomap', 'canvas', 'dashlist',
  'alertlist', 'annolist', 'state-timeline', 'status-history', 'trend',
  'candlestick', 'xychart', 'datagrid',
  // Legacy but still recognized
  'graph', 'table-old', 'singlestat',
  'grafana-piechart-panel', 'grafana-worldmap-panel',
]);

function flattenPanels(panels) {
  const flat = [];
  if (!Array.isArray(panels)) return flat;
  for (const p of panels) {
    if (p.type === 'row' && Array.isArray(p.panels)) {
      flat.push(...p.panels);
    } else if (p.type !== 'row') {
      flat.push(p);
    }
  }
  return flat;
}

async function run(client, _depGraph, options = {}) {
  const results = [];
  const dsFilter = normalizeFilter(options.datasourceFilter);

  // ── Fetch datasources for validation ──
  const dsRes = await client.getDataSources();
  const dsMap = {};
  if (dsRes.ok && Array.isArray(dsRes.data)) {
    for (const ds of dsRes.data) {
      dsMap[ds.uid] = ds;
      dsMap[ds.name] = ds;
    }
  }

  // ── Fetch library panels ──
  const libRes = await client.getLibraryPanels();
  const libraryPanelUids = new Set();
  if (libRes.ok) {
    const elements = libRes.data?.result?.elements || libRes.data?.elements || [];
    if (Array.isArray(elements)) {
      elements.forEach(lp => libraryPanelUids.add(lp.uid));
    }
  }

  // ── Fetch dashboards ──
  const searchRes = await client.searchDashboards();
  if (!searchRes.ok) {
    results.push(result('Dashboard search', 'FAIL', `Cannot list dashboards: ${searchRes.error}`, searchRes.ms));
    return results;
  }

  const dashList = Array.isArray(searchRes.data) ? searchRes.data : [];
  let totalPanels = 0;

  for (const dash of dashList) {
    const uid = dash.uid;
    const dashTitle = dash.title || uid;

    const dbRes = await client.getDashboardByUid(uid);
    if (!dbRes.ok) continue;

    const model = dbRes.data?.dashboard || {};

    // Skip dashboards that don't reference the target datasource
    if (dsFilter && !dashboardUsesDatasource(model, dsFilter)) continue;

    const panels = flattenPanels(model.panels || []);
    totalPanels += panels.length;

    for (const panel of panels) {
      const pid = panel.id || '?';
      const pTitle = panel.title || `panel-${pid}`;
      const prefix = `[${dashTitle}] ${pTitle}`;
      const panelType = panel.type || 'unknown';

      // 1. Type exists — is it a known panel type?
      if (!KNOWN_PANEL_TYPES.has(panelType) && !panelType.startsWith('grafana-') && !panelType.includes('-')) {
        results.push(result(
          `${prefix} Type check`,
          'WARN',
          `Unknown panel type: ${panelType}`,
          0,
          { panelId: pid, panelType, dashUid: uid },
          uid
        ));
      } else {
        results.push(result(
          `${prefix} Type check`,
          'PASS',
          `Panel type: ${panelType}`,
          0,
          { panelId: pid, panelType, dashUid: uid },
          uid
        ));
      }

      // 2. DS ref valid
      const pds = panel.datasource;
      const pdsUid = typeof pds === 'string' ? pds : pds?.uid;
      if (pdsUid && pdsUid !== '-- Mixed --' && pdsUid !== '-- Dashboard --' && pdsUid !== '-- Grafana --') {
        if (dsMap[pdsUid]) {
          results.push(result(
            `${prefix} DS ref`,
            'PASS',
            `Datasource: ${dsMap[pdsUid].name} (${dsMap[pdsUid].type})`,
            0,
            { panelId: pid, dsUid: pdsUid, dashUid: uid },
            uid
          ));
        } else {
          results.push(result(
            `${prefix} DS ref`,
            'WARN',
            `Datasource ref "${pdsUid}" not found in configured datasources`,
            0,
            { panelId: pid, dsUid: pdsUid, dashUid: uid },
            uid
          ));
        }
      }

      // 3. Query validation + execution via proxy
      const targets = Array.isArray(panel.targets) ? panel.targets : [];
      if (targets.length > 0) {
        for (let ti = 0; ti < targets.length; ti++) {
          const target = targets[ti];
          const refId = target.refId || String.fromCharCode(65 + ti);
          const tdsUid = target.datasource?.uid || pdsUid;
          const tdsType = target.datasource?.type || (dsMap[tdsUid]?.type) || null;

          // Empty expression check
          const expr = target.expr || target.expression || target.query || target.rawSql || '';
          if (typeof expr === 'string' && expr.trim() === '' && !target.hide) {
            results.push(result(
              `${prefix} Query ${refId} — empty`,
              'WARN',
              `Target ${refId} has an empty expression`,
              0,
              { panelId: pid, refId, dashUid: uid },
              uid
            ));
            continue;
          }

          // Execute via proxy (best-effort)
          if (tdsUid && tdsType && !target.hide) {
            try {
              const now = Date.now();
              const from = now - 5 * 60 * 1000;
              const body = {
                queries: [{
                  ...target,
                  refId,
                  datasource: { uid: tdsUid, type: tdsType },
                }],
                from: String(from),
                to: String(now),
              };
              const qr = await client.queryViaProxy(body);
              if (qr.ok) {
                const slowMs = config.thresholds.slowQueryThresholdMs || 5000;
                results.push(result(
                  `${prefix} Query ${refId}`,
                  qr.ms > slowMs ? 'WARN' : 'PASS',
                  `Query OK in ${qr.ms}ms${qr.ms > slowMs ? ' (slow)' : ''}`,
                  qr.ms,
                  { panelId: pid, refId, dashUid: uid, latencyMs: qr.ms },
                  uid
                ));
              } else {
                results.push(result(
                  `${prefix} Query ${refId}`,
                  'WARN',
                  `Query failed (${qr.status}): ${qr.error || 'error'}`,
                  qr.ms,
                  { panelId: pid, refId, dashUid: uid },
                  uid
                ));
              }
            } catch (err) {
              results.push(result(
                `${prefix} Query ${refId}`,
                'WARN',
                `Query execution error: ${err.message}`,
                0,
                { panelId: pid, refId, dashUid: uid },
                uid
              ));
            }
          }
        }
      }

      // 4. Deprecated type
      if (DEPRECATED_PANEL_TYPES.has(panelType)) {
        results.push(result(
          `${prefix} Deprecated type`,
          'WARN',
          `Panel uses deprecated type "${panelType}" — migrate to modern equivalent`,
          0,
          { panelId: pid, panelType, dashUid: uid },
          uid
        ));
      }

      // 5. Library panel check
      const libPanel = panel.libraryPanel;
      if (libPanel) {
        const libUid = libPanel.uid;
        const found = libraryPanelUids.has(libUid);
        results.push(result(
          `${prefix} Library panel`,
          found ? 'PASS' : 'WARN',
          found
            ? `Library panel "${libPanel.name || libUid}" linked`
            : `Library panel uid "${libUid}" not found in library`,
          0,
          { panelId: pid, libraryPanelUid: libUid, dashUid: uid },
          uid
        ));
      }
    }
  }

  results.unshift(result(
    'Panel inventory',
    'PASS',
    `Scanned ${totalPanels} panel(s) across ${dashList.length} dashboard(s)`,
    0,
    { totalPanels, dashboardCount: dashList.length }
  ));

  logger.info(`${CAT}: completed ${results.length} checks across ${totalPanels} panels`, { category: CAT });
  return results;
}

module.exports = { run };
