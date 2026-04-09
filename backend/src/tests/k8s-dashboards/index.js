'use strict';

const logger = require('../../utils/logger');

const CAT = 'k8s-dashboards';

function flattenPanels(panels) {
  const result = [];
  for (const p of panels) {
    if (p.type === 'row' && Array.isArray(p.panels)) result.push(...p.panels);
    else if (p.type !== 'row') result.push(p);
  }
  return result;
}

// Deprecated K8s metrics that have been renamed or removed
const DEPRECATED_K8S_METRICS = [
  { pattern: /kube_hpa_/, replacement: 'kube_horizontalpodautoscaler_', reason: 'Renamed in kube-state-metrics v2' },
  { pattern: /kube_pod_container_status_restarts/, replacement: 'kube_pod_container_status_restarts_total', reason: 'Renamed with _total suffix' },
  { pattern: /machine_cpu_cores/, replacement: 'machine_cpu_cores (cadvisor)', reason: 'Deprecated cadvisor metric' },
  { pattern: /machine_memory_bytes/, replacement: 'machine_memory_bytes (cadvisor)', reason: 'Deprecated cadvisor metric' },
  { pattern: /container_cpu_usage_seconds_total\{/, replacement: 'Consider container_cpu_cfs_throttled_seconds_total', reason: 'Check for unfiltered cadvisor queries' },
  { pattern: /kube_node_status_ready/, replacement: 'kube_node_status_condition', reason: 'Deprecated in favor of kube_node_status_condition' },
  { pattern: /namespace_workload_pod:kube_pod_owner:relabel/, replacement: 'namespace_workload_pod:kube_pod_owner:relabel', reason: 'Recording rule may not exist in all clusters' },
  { pattern: /kubectl_/, replacement: 'kubectl metrics removed', reason: 'kubectl metrics removed in recent versions' },
];

// K8s keywords for dashboard discovery
const K8S_KEYWORDS = ['kubernetes', 'k8s', 'kube', 'pod', 'node', 'cluster', 'namespace', 'deployment', 'daemonset', 'statefulset', 'container', 'kubelet', 'etcd', 'coredns', 'ingress'];

// Common hardcoded namespace patterns
const HARDCODED_NS_PATTERN = /(?:namespace\s*[=~!]+\s*["'])((?![\$\{])[a-z0-9-]+)(?:["'])/g;

function isK8sDashboard(dash, model) {
  const title = (model.title || dash.title || '').toLowerCase();
  const tags = (dash.tags || model.tags || []).map(t => t.toLowerCase());
  const folderTitle = (dash.folderTitle || '').toLowerCase();

  // Check by tag
  if (tags.some(t => K8S_KEYWORDS.some(kw => t.includes(kw)))) return true;
  // Check by title
  if (K8S_KEYWORDS.some(kw => title.includes(kw))) return true;
  // Check by folder
  if (K8S_KEYWORDS.some(kw => folderTitle.includes(kw))) return true;

  return false;
}

function extractTemplateVarNames(model) {
  const templating = model.templating?.list || [];
  return templating.map(v => v.name);
}

function findDeprecatedMetrics(expr) {
  const found = [];
  if (!expr) return found;
  for (const dm of DEPRECATED_K8S_METRICS) {
    if (dm.pattern.test(expr)) {
      found.push({ metric: dm.pattern.source, replacement: dm.replacement, reason: dm.reason });
    }
  }
  return found;
}

function findHardcodedNamespaces(expr) {
  if (!expr) return [];
  const matches = [];
  let match;
  // Reset regex state
  HARDCODED_NS_PATTERN.lastIndex = 0;
  while ((match = HARDCODED_NS_PATTERN.exec(expr)) !== null) {
    const ns = match[1];
    // Exclude common system namespaces that are intentionally hardcoded
    const systemNs = ['kube-system', 'kube-public', 'default', 'monitoring'];
    if (!systemNs.includes(ns)) {
      matches.push(ns);
    }
  }
  return [...new Set(matches)];
}

async function run(client, _depGraph, options = {}) {
  const results = [];
  const { maxDashboards = 200 } = options;

  // 1. Discover K8s dashboards
  const searchRes = await client.searchDashboards();
  if (!searchRes.ok) {
    results.push({ name: `${CAT}:search`, status: 'FAIL', detail: `Dashboard search failed: ${searchRes.error}`, uid: null, ms: searchRes.ms, metadata: {} });
    return results;
  }

  const allDashboards = (searchRes.data || []).slice(0, maxDashboards);
  const k8sDashboards = [];

  for (const dash of allDashboards) {
    const dashRes = await client.getDashboardByUid(dash.uid);
    if (!dashRes.ok) continue;

    const model = dashRes.data?.dashboard;
    if (!model) continue;

    if (isK8sDashboard(dash, model)) {
      k8sDashboards.push({ dash, model });
    }
  }

  results.push({
    name: `${CAT}:discovery`,
    status: 'PASS',
    detail: `Found ${k8sDashboards.length} K8s dashboards out of ${allDashboards.length} total`,
    uid: null,
    ms: searchRes.ms,
    metadata: { k8sCount: k8sDashboards.length, totalScanned: allDashboards.length },
  });

  if (k8sDashboards.length === 0) {
    results.push({
      name: `${CAT}:summary`,
      status: 'PASS',
      detail: 'No K8s dashboards found — skipping K8s-specific checks',
      uid: null,
      ms: 0,
      metadata: {},
    });
    return results;
  }

  let missingClusterVar = 0;
  let missingNamespaceVar = 0;
  let deprecatedMetricCount = 0;
  let hardcodedNsCount = 0;

  for (const { dash, model } of k8sDashboards) {
    const uid = dash.uid;
    const title = model.title || dash.title;
    const varNames = extractTemplateVarNames(model);
    const panels = flattenPanels(model.panels || []);

    // 2. Validate $cluster variable
    const hasClusterVar = varNames.some(v => ['cluster', 'datasource', 'DS_PROMETHEUS'].includes(v));
    if (!hasClusterVar) {
      missingClusterVar++;
      results.push({
        name: `${CAT}:missing-cluster-var:${uid}`,
        status: 'WARN',
        detail: `K8s dashboard "${title}" lacks $cluster or equivalent variable — not multi-cluster ready`,
        uid,
        ms: 0,
        metadata: { dashboardTitle: title, variables: varNames },
      });
    }

    // 3. Validate $namespace variable
    const hasNamespaceVar = varNames.some(v => v === 'namespace');
    if (!hasNamespaceVar) {
      missingNamespaceVar++;
      results.push({
        name: `${CAT}:missing-namespace-var:${uid}`,
        status: 'WARN',
        detail: `K8s dashboard "${title}" lacks $namespace variable`,
        uid,
        ms: 0,
        metadata: { dashboardTitle: title, variables: varNames },
      });
    }

    // Scan panel expressions
    const dashDeprecated = [];
    const dashHardcoded = [];

    for (const panel of panels) {
      for (const target of (panel.targets || [])) {
        const expr = target.expr || target.query || '';

        // 4. Deprecated metrics
        const deprecated = findDeprecatedMetrics(expr);
        for (const d of deprecated) {
          dashDeprecated.push({ panelId: panel.id, panelTitle: panel.title, ...d });
        }

        // 5. Hardcoded namespaces
        const hardcoded = findHardcodedNamespaces(expr);
        for (const ns of hardcoded) {
          dashHardcoded.push({ panelId: panel.id, panelTitle: panel.title, namespace: ns });
        }
      }
    }

    if (dashDeprecated.length > 0) {
      deprecatedMetricCount += dashDeprecated.length;
      results.push({
        name: `${CAT}:deprecated-metrics:${uid}`,
        status: 'WARN',
        detail: `"${title}" uses ${dashDeprecated.length} deprecated K8s metric(s): ${[...new Set(dashDeprecated.map(d => d.metric))].join(', ')}`,
        uid,
        ms: 0,
        metadata: { dashboardTitle: title, deprecatedMetrics: dashDeprecated },
      });
    }

    if (dashHardcoded.length > 0) {
      hardcodedNsCount += dashHardcoded.length;
      results.push({
        name: `${CAT}:hardcoded-namespaces:${uid}`,
        status: 'WARN',
        detail: `"${title}" has ${dashHardcoded.length} hardcoded namespace(s): ${[...new Set(dashHardcoded.map(h => h.namespace))].join(', ')}`,
        uid,
        ms: 0,
        metadata: { dashboardTitle: title, hardcodedNamespaces: dashHardcoded },
      });
    }

    // Per-dashboard pass if no issues
    if (!dashDeprecated.length && !dashHardcoded.length && hasClusterVar && hasNamespaceVar) {
      results.push({
        name: `${CAT}:ok:${uid}`,
        status: 'PASS',
        detail: `K8s dashboard "${title}" passes all checks`,
        uid,
        ms: 0,
        metadata: { dashboardTitle: title, variables: varNames },
      });
    }
  }

  // Summary
  const issues = missingClusterVar + missingNamespaceVar + deprecatedMetricCount + hardcodedNsCount;
  results.push({
    name: `${CAT}:summary`,
    status: issues > 0 ? 'WARN' : 'PASS',
    detail: `${k8sDashboards.length} K8s dashboards — missing $cluster: ${missingClusterVar}, missing $namespace: ${missingNamespaceVar}, deprecated metrics: ${deprecatedMetricCount}, hardcoded namespaces: ${hardcodedNsCount}`,
    uid: null,
    ms: 0,
    metadata: {
      k8sDashboards: k8sDashboards.length,
      missingClusterVar,
      missingNamespaceVar,
      deprecatedMetricCount,
      hardcodedNsCount,
    },
  });

  logger.info(`[${CAT}] Completed: ${k8sDashboards.length} K8s dashboards, ${issues} issues`, { category: CAT });
  return results;
}

module.exports = { run };
