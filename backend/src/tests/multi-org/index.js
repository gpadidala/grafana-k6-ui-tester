'use strict';

const logger = require('../../utils/logger');

const CAT = 'multi-org';

async function run(client, _depGraph, options = {}) {
  const results = [];

  // 1. Enumerate orgs
  const orgsRes = await client.getOrgs();
  if (!orgsRes.ok) {
    // May require admin privileges
    results.push({
      name: `${CAT}:orgs-fetch`,
      status: orgsRes.status === 403 || orgsRes.status === 401 ? 'WARN' : 'FAIL',
      detail: `Cannot enumerate orgs (${orgsRes.status}) — requires server admin privileges`,
      uid: null,
      ms: orgsRes.ms,
      metadata: { status: orgsRes.status, error: orgsRes.error },
    });
    return results;
  }

  const orgs = Array.isArray(orgsRes.data) ? orgsRes.data : [];
  if (orgs.length === 0) {
    results.push({
      name: `${CAT}:no-orgs`,
      status: 'WARN',
      detail: 'No organizations found',
      uid: null,
      ms: orgsRes.ms,
      metadata: {},
    });
    return results;
  }

  results.push({
    name: `${CAT}:org-count`,
    status: 'PASS',
    detail: `Found ${orgs.length} organization(s)`,
    uid: null,
    ms: orgsRes.ms,
    metadata: { orgCount: orgs.length, orgs: orgs.map(o => ({ id: o.id, name: o.name })) },
  });

  const orgSummaries = [];

  // 2. Per-org checks
  for (const org of orgs) {
    const orgId = org.id;
    const orgName = org.name || `Org ${orgId}`;
    const orgClient = client.withOrg(orgId);

    let healthOk = false;
    let dsCount = 0;
    let dashCount = 0;
    let userCount = 0;

    // Health check
    const healthRes = await orgClient.getHealth();
    if (healthRes.ok) {
      healthOk = true;
      const healthData = healthRes.data || {};
      const dbStatus = healthData.database || 'unknown';
      results.push({
        name: `${CAT}:health:${orgId}`,
        status: dbStatus === 'ok' ? 'PASS' : 'WARN',
        detail: `Org "${orgName}" (id=${orgId}) health: DB=${dbStatus}`,
        uid: null,
        ms: healthRes.ms,
        metadata: { orgId, orgName, health: healthData },
      });
    } else {
      results.push({
        name: `${CAT}:health:${orgId}`,
        status: 'FAIL',
        detail: `Org "${orgName}" (id=${orgId}) health check failed: ${healthRes.error || healthRes.status}`,
        uid: null,
        ms: healthRes.ms,
        metadata: { orgId, orgName, status: healthRes.status },
      });
    }

    // Data source count
    const dsRes = await orgClient.getDataSources();
    if (dsRes.ok) {
      dsCount = (dsRes.data || []).length;
      const dsTypes = {};
      for (const ds of (dsRes.data || [])) {
        dsTypes[ds.type] = (dsTypes[ds.type] || 0) + 1;
      }
      results.push({
        name: `${CAT}:datasources:${orgId}`,
        status: dsCount === 0 ? 'WARN' : 'PASS',
        detail: `Org "${orgName}": ${dsCount} data source(s)${dsCount > 0 ? ` — ${Object.entries(dsTypes).map(([t, c]) => `${t}:${c}`).join(', ')}` : ''}`,
        uid: null,
        ms: dsRes.ms,
        metadata: { orgId, orgName, dsCount, dsTypes },
      });
    }

    // Dashboard count
    const dashRes = await orgClient.searchDashboards();
    if (dashRes.ok) {
      dashCount = (dashRes.data || []).length;
      results.push({
        name: `${CAT}:dashboards:${orgId}`,
        status: 'PASS',
        detail: `Org "${orgName}": ${dashCount} dashboard(s)`,
        uid: null,
        ms: dashRes.ms,
        metadata: { orgId, orgName, dashCount },
      });
    }

    // User count
    const usersRes = await orgClient.getOrgUsers();
    if (usersRes.ok) {
      userCount = (usersRes.data || []).length;
      const roles = {};
      for (const u of (usersRes.data || [])) {
        const role = u.role || 'unknown';
        roles[role] = (roles[role] || 0) + 1;
      }
      results.push({
        name: `${CAT}:users:${orgId}`,
        status: userCount === 0 ? 'WARN' : 'PASS',
        detail: `Org "${orgName}": ${userCount} user(s)${userCount > 0 ? ` — ${Object.entries(roles).map(([r, c]) => `${r}:${c}`).join(', ')}` : ''}`,
        uid: null,
        ms: usersRes.ms,
        metadata: { orgId, orgName, userCount, roles },
      });
    }

    orgSummaries.push({
      orgId,
      orgName,
      healthOk,
      dsCount,
      dashCount,
      userCount,
    });
  }

  // Detect empty/abandoned orgs
  const emptyOrgs = orgSummaries.filter(o => o.dsCount === 0 && o.dashCount === 0);
  if (emptyOrgs.length > 0) {
    results.push({
      name: `${CAT}:empty-orgs`,
      status: 'WARN',
      detail: `${emptyOrgs.length} org(s) with no dashboards and no datasources: ${emptyOrgs.map(o => `"${o.orgName}" (id=${o.orgId})`).join(', ')}`,
      uid: null,
      ms: 0,
      metadata: { emptyOrgs },
    });
  }

  // Detect orgs with no users
  const noUserOrgs = orgSummaries.filter(o => o.userCount === 0);
  if (noUserOrgs.length > 0) {
    results.push({
      name: `${CAT}:no-user-orgs`,
      status: 'WARN',
      detail: `${noUserOrgs.length} org(s) with no users: ${noUserOrgs.map(o => `"${o.orgName}" (id=${o.orgId})`).join(', ')}`,
      uid: null,
      ms: 0,
      metadata: { noUserOrgs },
    });
  }

  // Summary
  const unhealthy = orgSummaries.filter(o => !o.healthOk);
  const overallStatus = unhealthy.length > 0 ? 'FAIL' : emptyOrgs.length > 0 ? 'WARN' : 'PASS';
  results.push({
    name: `${CAT}:summary`,
    status: overallStatus,
    detail: `${orgs.length} org(s) — ${orgSummaries.filter(o => o.healthOk).length} healthy, ${emptyOrgs.length} empty, total ${orgSummaries.reduce((a, o) => a + o.dashCount, 0)} dashboards / ${orgSummaries.reduce((a, o) => a + o.dsCount, 0)} datasources / ${orgSummaries.reduce((a, o) => a + o.userCount, 0)} users`,
    uid: null,
    ms: 0,
    metadata: {
      orgCount: orgs.length,
      orgSummaries,
      totalDashboards: orgSummaries.reduce((a, o) => a + o.dashCount, 0),
      totalDatasources: orgSummaries.reduce((a, o) => a + o.dsCount, 0),
      totalUsers: orgSummaries.reduce((a, o) => a + o.userCount, 0),
    },
  });

  logger.info(`[${CAT}] Completed: ${orgs.length} orgs audited`, { category: CAT });
  return results;
}

module.exports = { run };
