const logger = require('../../utils/logger');

const CAT = 'dashboards';

function result(name, status, detail, ms = 0, metadata = {}, uid = null) {
  return { name, status, detail, uid, ms, metadata };
}

const DEPRECATED_PANEL_TYPES = new Set([
  'graph', 'table-old', 'singlestat', 'alertlist-old',
  'grafana-piechart-panel', 'grafana-worldmap-panel',
]);

function flattenPanels(panels) {
  const flat = [];
  if (!Array.isArray(panels)) return flat;
  for (const p of panels) {
    if (p.type === 'row' && Array.isArray(p.panels)) {
      flat.push(...p.panels);
    } else {
      flat.push(p);
    }
  }
  return flat;
}

function extractDatasourceRefs(panels) {
  const refs = new Set();
  for (const p of panels) {
    if (p.datasource) {
      const uid = typeof p.datasource === 'string' ? p.datasource : p.datasource?.uid;
      if (uid && uid !== '-- Mixed --' && uid !== '-- Dashboard --' && uid !== '-- Grafana --') {
        refs.add(uid);
      }
    }
    // Also scan targets
    if (Array.isArray(p.targets)) {
      for (const t of p.targets) {
        const tuid = t.datasource?.uid;
        if (tuid && tuid !== '-- Mixed --' && tuid !== '-- Dashboard --' && tuid !== '-- Grafana --') {
          refs.add(tuid);
        }
      }
    }
  }
  return [...refs];
}

async function run(client, _depGraph, _options) {
  const results = [];

  // ── Fetch dashboard list ──
  const searchRes = await client.searchDashboards();
  if (!searchRes.ok) {
    results.push(result('Dashboard search', 'FAIL', `Cannot list dashboards: ${searchRes.error}`, searchRes.ms));
    return results;
  }

  const dashList = Array.isArray(searchRes.data) ? searchRes.data : [];
  results.push(result(
    'Dashboard inventory',
    dashList.length > 0 ? 'PASS' : 'WARN',
    `Found ${dashList.length} dashboard(s)`,
    searchRes.ms,
    { count: dashList.length }
  ));

  // ── Fetch all datasources for cross-reference ──
  const dsRes = await client.getDataSources();
  const knownDsUids = new Set();
  if (dsRes.ok && Array.isArray(dsRes.data)) {
    dsRes.data.forEach(d => { knownDsUids.add(d.uid); knownDsUids.add(d.name); });
  }

  // ── Per-dashboard checks ──
  for (const dash of dashList) {
    const uid = dash.uid;
    const title = dash.title || uid;
    const prefix = `[${title}]`;

    const dbRes = await client.getDashboardByUid(uid);
    if (!dbRes.ok) {
      results.push(result(`${prefix} Load`, 'FAIL', `Cannot load dashboard: ${dbRes.error}`, dbRes.ms, {}, uid));
      continue;
    }

    const model = dbRes.data?.dashboard || {};
    const meta = dbRes.data?.meta || {};
    const panels = flattenPanels(model.panels || []);
    const id = model.id;

    // Panel count
    results.push(result(
      `${prefix} Panel count`,
      panels.length > 100 ? 'WARN' : 'PASS',
      `${panels.length} panel(s)${panels.length > 100 ? ' — consider splitting' : ''}`,
      dbRes.ms,
      { panelCount: panels.length },
      uid
    ));

    // Deprecated panel types
    const deprecated = panels.filter(p => DEPRECATED_PANEL_TYPES.has(p.type));
    if (deprecated.length > 0) {
      const types = [...new Set(deprecated.map(p => p.type))];
      results.push(result(
        `${prefix} Deprecated panels`,
        'WARN',
        `${deprecated.length} deprecated panel(s): ${types.join(', ')}`,
        0,
        { deprecatedTypes: types, count: deprecated.length },
        uid
      ));
    } else {
      results.push(result(`${prefix} Deprecated panels`, 'PASS', 'No deprecated panel types', 0, {}, uid));
    }

    // Datasource references — check validity
    const dsRefs = extractDatasourceRefs(panels);
    const unknownDs = dsRefs.filter(ref => !knownDsUids.has(ref));
    if (unknownDs.length > 0) {
      results.push(result(
        `${prefix} DS references`,
        'WARN',
        `${unknownDs.length} unresolvable DS ref(s): ${unknownDs.join(', ')}`,
        0,
        { unknown: unknownDs, total: dsRefs.length },
        uid
      ));
    } else {
      results.push(result(
        `${prefix} DS references`,
        'PASS',
        `${dsRefs.length} datasource ref(s) — all valid`,
        0,
        { total: dsRefs.length },
        uid
      ));
    }

    // Template variables — check and optionally execute var queries
    const templating = model.templating?.list || [];
    if (templating.length > 0) {
      const varIssues = [];
      for (const v of templating) {
        if (v.type === 'query' && (!v.query || (typeof v.query === 'string' && v.query.trim() === ''))) {
          varIssues.push(`${v.name}: empty query`);
        }
        if (v.type === 'query' && v.datasource) {
          const vdsUid = typeof v.datasource === 'string' ? v.datasource : v.datasource?.uid;
          if (vdsUid && !knownDsUids.has(vdsUid)) {
            varIssues.push(`${v.name}: references unknown DS ${vdsUid}`);
          }
        }
      }

      // Execute variable queries (best-effort)
      let execFailures = 0;
      for (const v of templating) {
        if (v.type !== 'query' || !v.datasource) continue;
        const vdsUid = typeof v.datasource === 'string' ? v.datasource : v.datasource?.uid;
        const vdsType = typeof v.datasource === 'string' ? null : v.datasource?.type;
        if (!vdsUid) continue;
        try {
          const now = Date.now();
          const from = now - 60 * 60 * 1000;
          const queryExpr = typeof v.query === 'string' ? v.query : v.query?.query || '';
          if (!queryExpr) continue;

          const body = {
            queries: [{
              refId: 'V',
              datasource: { uid: vdsUid, type: vdsType || 'prometheus' },
              expr: queryExpr,
              instant: true,
            }],
            from: String(from),
            to: String(now),
          };
          const qr = await client.queryViaProxy(body);
          if (!qr.ok) execFailures++;
        } catch {
          execFailures++;
        }
      }

      if (varIssues.length > 0) {
        results.push(result(
          `${prefix} Template variables`,
          'WARN',
          `${templating.length} var(s), issues: ${varIssues.join('; ')}`,
          0,
          { varCount: templating.length, issues: varIssues, execFailures },
          uid
        ));
      } else {
        results.push(result(
          `${prefix} Template variables`,
          execFailures > 0 ? 'WARN' : 'PASS',
          `${templating.length} variable(s)${execFailures > 0 ? `, ${execFailures} query exec failure(s)` : ' — all valid'}`,
          0,
          { varCount: templating.length, execFailures },
          uid
        ));
      }
    } else {
      results.push(result(`${prefix} Template variables`, 'PASS', 'No template variables', 0, {}, uid));
    }

    // Permissions
    if (id) {
      const permRes = await client.getDashboardPermissions(id);
      if (permRes.ok) {
        const perms = Array.isArray(permRes.data) ? permRes.data : [];
        const hasViewer = perms.some(p => p.role === 'Viewer' || p.permission === 1);
        const hasEditor = perms.some(p => p.role === 'Editor' || p.permission === 2);
        const hasAdmin = perms.some(p => p.role === 'Admin' || p.permission === 4);
        results.push(result(
          `${prefix} Permissions`,
          'PASS',
          `${perms.length} permission rule(s) — Viewer:${hasViewer} Editor:${hasEditor} Admin:${hasAdmin}`,
          permRes.ms,
          { permissionCount: perms.length, hasViewer, hasEditor, hasAdmin },
          uid
        ));
      } else {
        results.push(result(`${prefix} Permissions`, 'WARN', `Could not fetch permissions: ${permRes.error}`, permRes.ms, {}, uid));
      }
    }

    // Provisioning detection
    const isProvisioned = meta.provisioned === true || meta.provisionedExternalId != null;
    results.push(result(
      `${prefix} Provisioning`,
      'PASS',
      isProvisioned ? `Provisioned (source: ${meta.provisionedExternalId || 'file'})` : 'Not provisioned (manual)',
      0,
      { provisioned: isProvisioned, provisionedExternalId: meta.provisionedExternalId || null },
      uid
    ));

    // Schema version
    const schemaVersion = model.schemaVersion || 0;
    results.push(result(
      `${prefix} Schema version`,
      schemaVersion < 30 ? 'WARN' : 'PASS',
      `Schema version: ${schemaVersion}${schemaVersion < 30 ? ' — consider re-saving to upgrade' : ''}`,
      0,
      { schemaVersion },
      uid
    ));

    // Version count (edit history)
    if (id) {
      const verRes = await client.getDashboardVersions(id);
      if (verRes.ok) {
        const versions = Array.isArray(verRes.data) ? verRes.data : [];
        results.push(result(
          `${prefix} Version history`,
          'PASS',
          `${versions.length} version(s) on record`,
          verRes.ms,
          { versionCount: versions.length },
          uid
        ));
      } else {
        results.push(result(`${prefix} Version history`, 'WARN', `Cannot fetch versions: ${verRes.error}`, verRes.ms, {}, uid));
      }
    }

    // Tag check
    const tags = model.tags || dash.tags || [];
    if (tags.length === 0) {
      results.push(result(`${prefix} Tags`, 'WARN', 'Dashboard has no tags — consider adding for organization', 0, {}, uid));
    } else {
      results.push(result(`${prefix} Tags`, 'PASS', `Tags: ${tags.join(', ')}`, 0, { tags }, uid));
    }
  }

  logger.info(`${CAT}: completed ${results.length} checks across ${dashList.length} dashboards`, { category: CAT });
  return results;
}

module.exports = { run };
