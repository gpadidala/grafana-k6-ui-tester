'use strict';

const logger = require('../../utils/logger');

const CAT = 'capacity-planning';

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
  const { maxDashboards = 200 } = options;

  // 1. Fetch all dashboards
  const searchRes = await client.searchDashboards();
  if (!searchRes.ok) {
    results.push({ name: `${CAT}:search`, status: 'FAIL', detail: `Dashboard search failed: ${searchRes.error}`, uid: null, ms: searchRes.ms, metadata: {} });
    return results;
  }

  const dashboards = (searchRes.data || []).slice(0, maxDashboards);
  const panelCounts = []; // panels per dashboard
  const dsQueryLoad = {};  // dsUid -> query count
  let totalPanels = 0;
  let totalQueries = 0;

  for (const dash of dashboards) {
    const dashRes = await client.getDashboardByUid(dash.uid);
    if (!dashRes.ok) continue;

    const model = dashRes.data?.dashboard;
    if (!model || !Array.isArray(model.panels)) continue;

    const panels = flattenPanels(model.panels);
    const panelCount = panels.length;
    panelCounts.push({ uid: dash.uid, title: model.title || dash.title, panelCount });
    totalPanels += panelCount;

    for (const panel of panels) {
      const targets = panel.targets || [];
      totalQueries += targets.length;
      for (const target of targets) {
        const dsUid = target.datasource?.uid || panel.datasource?.uid || '__default__';
        dsQueryLoad[dsUid] = (dsQueryLoad[dsUid] || 0) + 1;
      }
    }
  }

  // Dashboard density
  const avgPanels = dashboards.length > 0 ? Math.round(totalPanels / dashboards.length) : 0;
  const maxPanelDash = panelCounts.length > 0
    ? panelCounts.reduce((a, b) => a.panelCount > b.panelCount ? a : b)
    : null;
  const densityStatus = avgPanels > 30 ? 'WARN' : 'PASS';
  results.push({
    name: `${CAT}:dashboard-density`,
    status: densityStatus,
    detail: `${dashboards.length} dashboards, ${totalPanels} total panels, avg ${avgPanels} panels/dashboard${maxPanelDash ? `, densest: "${maxPanelDash.title}" (${maxPanelDash.panelCount})` : ''}`,
    uid: null,
    ms: 0,
    metadata: { dashboardCount: dashboards.length, totalPanels, avgPanels, maxPanelDashboard: maxPanelDash },
  });

  // Panels/dashboard histogram (buckets: 0-5, 6-10, 11-20, 21-50, 51+)
  const buckets = { '0-5': 0, '6-10': 0, '11-20': 0, '21-50': 0, '51+': 0 };
  for (const pc of panelCounts) {
    if (pc.panelCount <= 5) buckets['0-5']++;
    else if (pc.panelCount <= 10) buckets['6-10']++;
    else if (pc.panelCount <= 20) buckets['11-20']++;
    else if (pc.panelCount <= 50) buckets['21-50']++;
    else buckets['51+']++;
  }
  results.push({
    name: `${CAT}:panel-histogram`,
    status: buckets['51+'] > 0 ? 'WARN' : 'PASS',
    detail: `Panel histogram: ${Object.entries(buckets).map(([k, v]) => `${k}: ${v}`).join(', ')}`,
    uid: null,
    ms: 0,
    metadata: { histogram: buckets },
  });

  // Heavy dashboards (>50 panels)
  const heavyDashboards = panelCounts.filter(pc => pc.panelCount > 50);
  if (heavyDashboards.length > 0) {
    results.push({
      name: `${CAT}:heavy-dashboards`,
      status: 'WARN',
      detail: `${heavyDashboards.length} dashboard(s) with >50 panels: ${heavyDashboards.map(d => `"${d.title}" (${d.panelCount})`).join(', ')}`,
      uid: null,
      ms: 0,
      metadata: { heavyDashboards },
    });
  }

  // DS query load estimation
  const dsEntries = Object.entries(dsQueryLoad).sort((a, b) => b[1] - a[1]);
  results.push({
    name: `${CAT}:ds-query-load`,
    status: dsEntries.length > 0 && dsEntries[0][1] > 200 ? 'WARN' : 'PASS',
    detail: `${dsEntries.length} datasources, ${totalQueries} total queries. Top: ${dsEntries.slice(0, 5).map(([uid, count]) => `${uid}=${count}`).join(', ')}`,
    uid: null,
    ms: 0,
    metadata: { datasourceCount: dsEntries.length, totalQueries, queryLoadByDs: Object.fromEntries(dsEntries) },
  });

  // Total query volume estimate (assumes each dashboard loaded ~2x/hour by users)
  const estimatedQueriesPerHour = totalQueries * 2;
  results.push({
    name: `${CAT}:query-volume-estimate`,
    status: estimatedQueriesPerHour > 10000 ? 'WARN' : 'PASS',
    detail: `Estimated ${estimatedQueriesPerHour} queries/hour (assuming 2 loads/dashboard/hour with ${totalQueries} panel queries)`,
    uid: null,
    ms: 0,
    metadata: { totalPanelQueries: totalQueries, estimatedQueriesPerHour, assumedLoadsPerHour: 2 },
  });

  // 2. Alert eval cost
  const alertRes = await client.getAlertRules();
  let alertRuleCount = 0;
  let alertQueryCount = 0;
  if (alertRes.ok) {
    const rules = Array.isArray(alertRes.data) ? alertRes.data : [];
    // Handle both flat array and grouped format
    const flatRules = [];
    if (rules.length > 0 && rules[0].rules) {
      // Grouped format from ruler
      for (const group of rules) {
        for (const rule of (group.rules || [])) flatRules.push(rule);
      }
    } else {
      flatRules.push(...rules);
    }
    alertRuleCount = flatRules.length;
    for (const rule of flatRules) {
      const data = rule.data || rule.grafana_alert?.data || [];
      alertQueryCount += Array.isArray(data) ? data.filter(d => d.datasourceUid && d.datasourceUid !== '__expr__').length : 0;
    }
  }
  results.push({
    name: `${CAT}:alert-eval-cost`,
    status: alertQueryCount > 500 ? 'WARN' : 'PASS',
    detail: `${alertRuleCount} alert rules with ${alertQueryCount} data queries to evaluate`,
    uid: null,
    ms: alertRes.ms || 0,
    metadata: { alertRuleCount, alertQueryCount },
  });

  // 3. Plugin count
  const pluginRes = await client.getPlugins();
  let pluginCount = 0;
  let appPluginCount = 0;
  let panelPluginCount = 0;
  let dsPluginCount = 0;
  if (pluginRes.ok) {
    const plugins = pluginRes.data || [];
    pluginCount = plugins.length;
    appPluginCount = plugins.filter(p => p.type === 'app').length;
    panelPluginCount = plugins.filter(p => p.type === 'panel').length;
    dsPluginCount = plugins.filter(p => p.type === 'datasource').length;
  }
  results.push({
    name: `${CAT}:plugin-count`,
    status: pluginCount > 50 ? 'WARN' : 'PASS',
    detail: `${pluginCount} plugins installed (${appPluginCount} app, ${panelPluginCount} panel, ${dsPluginCount} datasource)`,
    uid: null,
    ms: pluginRes.ms || 0,
    metadata: { pluginCount, appPluginCount, panelPluginCount, dsPluginCount },
  });

  // Overall summary
  results.push({
    name: `${CAT}:summary`,
    status: results.some(r => r.status === 'WARN') ? 'WARN' : 'PASS',
    detail: `Capacity: ${dashboards.length} dashboards, ${totalPanels} panels, ${totalQueries} queries, ${alertRuleCount} alert rules, ${pluginCount} plugins`,
    uid: null,
    ms: 0,
    metadata: {
      dashboardCount: dashboards.length,
      totalPanels,
      totalQueries,
      alertRuleCount,
      pluginCount,
      estimatedQueriesPerHour,
    },
  });

  logger.info(`[${CAT}] Completed: ${results.length} capacity checks`, { category: CAT });
  return results;
}

module.exports = { run };
