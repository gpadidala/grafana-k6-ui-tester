'use strict';

const logger = require('../../utils/logger');

const CAT = 'provisioning';

function flattenPanels(panels) {
  const result = [];
  for (const p of panels) {
    if (p.type === 'row' && Array.isArray(p.panels)) result.push(...p.panels);
    else if (p.type !== 'row') result.push(p);
  }
  return result;
}

async function run(client, _depGraph, options = {}) {
  const results = [];
  const { maxDashboards = 50 } = options;

  // 1. Fetch dashboards
  const searchRes = await client.searchDashboards();
  if (!searchRes.ok) {
    results.push({ name: `${CAT}:search`, status: 'FAIL', detail: `Dashboard search failed: ${searchRes.error}`, uid: null, ms: searchRes.ms, metadata: {} });
    return results;
  }

  const dashboards = (searchRes.data || []).slice(0, maxDashboards);
  let provisionedCount = 0;
  let editableProvisionedCount = 0;
  let driftCount = 0;

  for (const dash of dashboards) {
    const dashRes = await client.getDashboardByUid(dash.uid);
    if (!dashRes.ok) continue;

    const meta = dashRes.data?.meta || {};
    const model = dashRes.data?.dashboard || {};
    const isProvisioned = !!meta.provisioned || !!meta.provisionedExternalId;

    if (isProvisioned) {
      provisionedCount++;

      // Check editable flag — provisioned dashboards should NOT be editable
      const editable = model.editable !== false;
      if (editable) {
        editableProvisionedCount++;
        results.push({
          name: `${CAT}:editable-provisioned:${dash.uid}`,
          status: 'WARN',
          detail: `Provisioned dashboard "${model.title || dash.title}" is editable — UI changes will be overwritten on next provision`,
          uid: dash.uid,
          ms: 0,
          metadata: { dashboardTitle: model.title || dash.title, provisioned: true, editable: true },
        });
      }
    }

    // Check version count for drift detection
    const versionsRes = await client.getDashboardVersions(meta.id || dash.id, 50);
    if (versionsRes.ok) {
      const versions = versionsRes.data || [];
      const versionCount = versions.length;

      if (isProvisioned && versionCount > 5) {
        driftCount++;
        // Detect if there were manual edits (messages not from provisioning)
        const manualEdits = versions.filter(v => {
          const msg = (v.message || '').toLowerCase();
          return !msg.includes('provisioned') && !msg.includes('provision') && msg !== '';
        });

        results.push({
          name: `${CAT}:drift:${dash.uid}`,
          status: manualEdits.length > 0 ? 'WARN' : 'PASS',
          detail: `Provisioned dashboard "${model.title || dash.title}" has ${versionCount} versions${manualEdits.length > 0 ? ` (${manualEdits.length} potentially manual edits)` : ''}`,
          uid: dash.uid,
          ms: 0,
          metadata: {
            dashboardTitle: model.title || dash.title,
            versionCount,
            manualEditCount: manualEdits.length,
            latestVersion: versions[0]?.version,
          },
        });
      }
    }

    // Non-provisioned dashboard status
    if (!isProvisioned) {
      results.push({
        name: `${CAT}:not-provisioned:${dash.uid}`,
        status: 'PASS',
        detail: `Dashboard "${model.title || dash.title}" is managed via UI (not provisioned)`,
        uid: dash.uid,
        ms: 0,
        metadata: { dashboardTitle: model.title || dash.title, provisioned: false },
      });
    }
  }

  // 2. Data source provisioning check
  const dsRes = await client.getDataSources();
  if (dsRes.ok) {
    const dataSources = dsRes.data || [];
    let provisionedDs = 0;
    let readOnlyDs = 0;

    for (const ds of dataSources) {
      const isReadOnly = ds.readOnly === true;
      const isDsProvisioned = isReadOnly; // Provisioned DS are typically readOnly

      if (isDsProvisioned) provisionedDs++;
      if (isReadOnly) readOnlyDs++;

      if (isDsProvisioned && !isReadOnly) {
        results.push({
          name: `${CAT}:ds-not-readonly:${ds.uid}`,
          status: 'WARN',
          detail: `Data source "${ds.name}" (${ds.type}) is provisioned but not read-only`,
          uid: ds.uid,
          ms: 0,
          metadata: { dsName: ds.name, dsType: ds.type, readOnly: ds.readOnly },
        });
      }
    }

    results.push({
      name: `${CAT}:datasource-summary`,
      status: 'PASS',
      detail: `${dataSources.length} data sources — ${provisionedDs} provisioned, ${readOnlyDs} read-only`,
      uid: null,
      ms: dsRes.ms,
      metadata: { total: dataSources.length, provisioned: provisionedDs, readOnly: readOnlyDs },
    });
  }

  // 3. Provisioning reload test (only if we detect provisioned resources)
  if (provisionedCount > 0) {
    const reloadEndpoints = [
      { name: 'dashboards', path: '/api/admin/provisioning/dashboards/reload' },
      { name: 'datasources', path: '/api/admin/provisioning/datasources/reload' },
      { name: 'plugins', path: '/api/admin/provisioning/plugins/reload' },
      { name: 'notifications', path: '/api/admin/provisioning/notifications/reload' },
      { name: 'alerting', path: '/api/admin/provisioning/alerting/reload' },
    ];

    for (const ep of reloadEndpoints) {
      const reloadRes = await client.post(ep.path);
      if (reloadRes.ok) {
        results.push({
          name: `${CAT}:reload:${ep.name}`,
          status: 'PASS',
          detail: `Provisioning reload for ${ep.name} succeeded`,
          uid: null,
          ms: reloadRes.ms,
          metadata: { endpoint: ep.name },
        });
      } else if (reloadRes.status === 403 || reloadRes.status === 401) {
        results.push({
          name: `${CAT}:reload:${ep.name}`,
          status: 'WARN',
          detail: `Provisioning reload for ${ep.name} requires admin privileges (${reloadRes.status})`,
          uid: null,
          ms: reloadRes.ms,
          metadata: { endpoint: ep.name, status: reloadRes.status },
        });
      } else {
        results.push({
          name: `${CAT}:reload:${ep.name}`,
          status: 'FAIL',
          detail: `Provisioning reload for ${ep.name} failed: ${reloadRes.error || reloadRes.status}`,
          uid: null,
          ms: reloadRes.ms,
          metadata: { endpoint: ep.name, status: reloadRes.status },
        });
      }
    }
  }

  // Summary
  results.push({
    name: `${CAT}:summary`,
    status: driftCount > 0 || editableProvisionedCount > 0 ? 'WARN' : 'PASS',
    detail: `${dashboards.length} dashboards scanned — ${provisionedCount} provisioned, ${driftCount} with drift, ${editableProvisionedCount} editable+provisioned`,
    uid: null,
    ms: 0,
    metadata: {
      dashboardsScanned: dashboards.length,
      provisioned: provisionedCount,
      driftDetected: driftCount,
      editableProvisioned: editableProvisionedCount,
    },
  });

  logger.info(`[${CAT}] Completed: ${results.length} checks`, { category: CAT });
  return results;
}

module.exports = { run };
