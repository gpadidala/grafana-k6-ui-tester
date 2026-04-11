'use strict';

const logger = require('../../utils/logger');

const CAT = 'plugin-upgrade';

function flattenPanels(panels) {
  const result = [];
  for (const p of panels) {
    if (p.type === 'row' && Array.isArray(p.panels)) result.push(...p.panels);
    else if (p.type !== 'row') result.push(p);
  }
  return result;
}

/**
 * Parse semver string into {major, minor, patch}.
 * Returns null for invalid versions.
 */
function parseSemver(version) {
  if (!version) return null;
  const clean = version.replace(/^v/, '');
  const parts = clean.split('.');
  if (parts.length < 2) return null;
  return {
    major: parseInt(parts[0], 10) || 0,
    minor: parseInt(parts[1], 10) || 0,
    patch: parseInt(parts[2], 10) || 0,
  };
}

/**
 * Determine update type: major, minor, patch.
 */
function getUpdateType(fromVersion, toVersion) {
  const from = parseSemver(fromVersion);
  const to = parseSemver(toVersion);
  if (!from || !to) return 'unknown';
  if (to.major > from.major) return 'major';
  if (to.minor > from.minor) return 'minor';
  if (to.patch > from.patch) return 'patch';
  return 'none';
}

/**
 * Compute risk score 0-100 based on update type and impact breadth.
 */
function computeRiskScore(updateType, impactedDashboardCount, impactedPanelCount) {
  let base = 0;
  if (updateType === 'major') base = 70;
  else if (updateType === 'minor') base = 30;
  else if (updateType === 'patch') base = 10;

  // Scale with impact
  const impactBonus = Math.min(30, impactedDashboardCount * 3 + impactedPanelCount);
  return Math.min(100, base + impactBonus);
}

async function run(client, _depGraph, options = {}) {
  const results = [];
  const { plugins: upgradeTargets = [], maxDashboards = 200 } = options;

  if (!upgradeTargets || upgradeTargets.length === 0) {
    results.push({
      name: `${CAT}:no-targets`,
      status: 'PASS',
      detail: 'No plugin upgrade targets specified in options.plugins — skipping',
      uid: null,
      ms: 0,
      metadata: {},
    });
    return results;
  }

  // 1. Fetch installed plugins
  const pluginsRes = await client.getPlugins();
  const installedPlugins = {};
  if (pluginsRes.ok) {
    for (const p of (pluginsRes.data || [])) {
      installedPlugins[p.id] = {
        id: p.id,
        name: p.name,
        type: p.type,
        version: p.info?.version || 'unknown',
      };
    }
  }

  // 2. Fetch all dashboards and scan for plugin usage
  const searchRes = await client.searchDashboards();
  if (!searchRes.ok) {
    results.push({ name: `${CAT}:search`, status: 'FAIL', detail: `Dashboard search failed: ${searchRes.error}`, uid: null, ms: searchRes.ms, metadata: {} });
    return results;
  }

  const allDashboards = (searchRes.data || []).slice(0, maxDashboards);

  // Build plugin -> dashboard/panel mapping
  const pluginUsage = {}; // pluginId -> [{dashUid, dashTitle, panelId, panelTitle, panelType}]

  for (const dash of allDashboards) {
    const dashRes = await client.getDashboardByUid(dash.uid);
    if (!dashRes.ok) continue;

    const model = dashRes.data?.dashboard;
    if (!model || !Array.isArray(model.panels)) continue;

    const panels = flattenPanels(model.panels);
    for (const panel of panels) {
      const panelType = panel.type;
      if (!panelType) continue;

      if (!pluginUsage[panelType]) pluginUsage[panelType] = [];
      pluginUsage[panelType].push({
        dashUid: dash.uid,
        dashTitle: model.title || dash.title,
        panelId: panel.id,
        panelTitle: panel.title || `Panel ${panel.id}`,
        panelType,
      });

      // Also check datasource type
      const dsType = panel.datasource?.type;
      if (dsType) {
        if (!pluginUsage[dsType]) pluginUsage[dsType] = [];
        pluginUsage[dsType].push({
          dashUid: dash.uid,
          dashTitle: model.title || dash.title,
          panelId: panel.id,
          panelTitle: panel.title || `Panel ${panel.id}`,
          panelType: `ds:${dsType}`,
        });
      }
    }
  }

  // 3. Per-plugin upgrade analysis
  for (const target of upgradeTargets) {
    const { pluginId, toVersion } = target;
    const installed = installedPlugins[pluginId];

    if (!installed) {
      results.push({
        name: `${CAT}:not-installed:${pluginId}`,
        status: 'WARN',
        detail: `Plugin "${pluginId}" targeted for upgrade to ${toVersion} but not currently installed`,
        uid: null,
        ms: 0,
        metadata: { pluginId, toVersion },
      });
      continue;
    }

    const fromVersion = installed.version;
    const updateType = getUpdateType(fromVersion, toVersion);

    // Find impacted dashboards/panels
    const usage = pluginUsage[pluginId] || [];
    const impactedDashboards = [...new Set(usage.map(u => u.dashUid))];
    const impactedPanels = usage.length;

    const riskScore = computeRiskScore(updateType, impactedDashboards.length, impactedPanels);

    let status = 'PASS';
    if (riskScore >= 70) status = 'FAIL';
    else if (riskScore >= 30) status = 'WARN';

    results.push({
      name: `${CAT}:impact:${pluginId}`,
      status,
      detail: `${pluginId} ${fromVersion} -> ${toVersion} (${updateType}) — Risk: ${riskScore}/100, impacts ${impactedDashboards.length} dashboard(s), ${impactedPanels} panel(s)`,
      uid: null,
      ms: 0,
      metadata: {
        pluginId,
        pluginName: installed.name,
        pluginType: installed.type,
        fromVersion,
        toVersion,
        updateType,
        riskScore,
        impactedDashboardCount: impactedDashboards.length,
        impactedPanelCount: impactedPanels,
        impactedDashboards: impactedDashboards.slice(0, 20),
      },
    });

    // List impacted dashboards
    if (impactedDashboards.length > 0) {
      const dashDetails = [];
      const seen = new Set();
      for (const u of usage) {
        if (!seen.has(u.dashUid)) {
          seen.add(u.dashUid);
          const panelCount = usage.filter(x => x.dashUid === u.dashUid).length;
          dashDetails.push({ uid: u.dashUid, title: u.dashTitle, affectedPanels: panelCount });
        }
      }
      results.push({
        name: `${CAT}:impacted-dashboards:${pluginId}`,
        status: 'PASS',
        detail: dashDetails.map(d => `"${d.title}" (${d.affectedPanels} panels)`).join(', '),
        uid: null,
        ms: 0,
        metadata: { pluginId, dashboards: dashDetails },
      });
    }

    // Generate upgrade plan
    const plan = [];
    plan.push(`1. Backup: Export ${impactedDashboards.length} affected dashboard(s) as JSON`);
    plan.push(`2. Staging: Test ${pluginId} ${toVersion} in non-prod environment`);
    if (updateType === 'major') {
      plan.push(`3. Breaking changes: Review ${pluginId} changelog for breaking changes between ${fromVersion} and ${toVersion}`);
      plan.push(`4. Panel config: Manually verify panel options in ${impactedPanels} panel(s) post-upgrade`);
    }
    plan.push(`${plan.length + 1}. Deploy: Install ${pluginId}@${toVersion} via grafana-cli or provisioning`);
    plan.push(`${plan.length + 1}. Validate: Run Heimdall post-deployment checks`);
    plan.push(`${plan.length + 1}. Rollback: If issues, revert to ${pluginId}@${fromVersion}`);

    results.push({
      name: `${CAT}:upgrade-plan:${pluginId}`,
      status: 'PASS',
      detail: plan.join('\n'),
      uid: null,
      ms: 0,
      metadata: { pluginId, fromVersion, toVersion, updateType, riskScore, steps: plan },
    });
  }

  // Summary
  const highRisk = results.filter(r => r.name.startsWith(`${CAT}:impact:`) && r.status === 'FAIL');
  const medRisk = results.filter(r => r.name.startsWith(`${CAT}:impact:`) && r.status === 'WARN');
  results.push({
    name: `${CAT}:summary`,
    status: highRisk.length > 0 ? 'FAIL' : medRisk.length > 0 ? 'WARN' : 'PASS',
    detail: `${upgradeTargets.length} plugin upgrade(s) analyzed — ${highRisk.length} high risk, ${medRisk.length} medium risk`,
    uid: null,
    ms: 0,
    metadata: {
      targetsAnalyzed: upgradeTargets.length,
      highRiskCount: highRisk.length,
      medRiskCount: medRisk.length,
      dashboardsScanned: allDashboards.length,
    },
  });

  logger.info(`[${CAT}] Completed: ${upgradeTargets.length} plugins analyzed`, { category: CAT });
  return results;
}

module.exports = { run };
