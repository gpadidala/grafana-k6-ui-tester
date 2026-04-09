module.exports = async function k8sDashboardTests(client) {
  const results = [];

  const dashRes = await client.searchDashboards();
  if (!dashRes.ok) {
    results.push({ name: 'Fetch Dashboards', status: 'FAIL', detail: `HTTP ${dashRes.status}` });
    return results;
  }

  // Discover K8s-related dashboards by tag, folder, or content
  const k8sTags = ['kubernetes', 'k8s', 'kube', 'container', 'pod', 'node'];
  const k8sFolders = ['kubernetes', 'k8s', 'aks', 'eks', 'gke'];
  const k8sMetrics = ['container_', 'kube_', 'node_', 'kubelet_', 'apiserver_', 'coredns_', 'etcd_'];

  const allDash = dashRes.data || [];
  const k8sDashboards = [];

  for (const d of allDash) {
    const isTagged = (d.tags || []).some(t => k8sTags.includes(t.toLowerCase()));
    const isInFolder = k8sFolders.some(f => (d.folderTitle || '').toLowerCase().includes(f));
    const titleMatch = k8sTags.some(t => (d.title || '').toLowerCase().includes(t));

    if (isTagged || isInFolder || titleMatch) {
      k8sDashboards.push(d);
    }
  }

  results.push({
    name: 'K8s Dashboard Discovery',
    status: k8sDashboards.length > 0 ? 'PASS' : 'WARN',
    detail: `Found ${k8sDashboards.length} Kubernetes-related dashboards out of ${allDash.length} total`,
  });

  if (k8sDashboards.length === 0) return results;

  // Validate each K8s dashboard
  const requiredVars = ['cluster', 'namespace', 'datasource'];
  const k8sVarPatterns = ['cluster', 'namespace', 'pod', 'node', 'container', 'workload', 'deployment'];

  for (const d of k8sDashboards.slice(0, 20)) {
    const detail = await client.getDashboard(d.uid);
    if (!detail.ok) {
      results.push({ name: `K8s: ${d.title}`, status: 'FAIL', uid: d.uid, detail: `Load failed: HTTP ${detail.status}` });
      continue;
    }

    const dash = detail.data?.dashboard;
    const panels = flattenPanels(dash?.panels || []);
    const vars = (dash?.templating?.list || []).map(v => v.name?.toLowerCase());
    const issues = [];

    // Check required template variables
    const hasClusterVar = vars.some(v => v === 'cluster' || v === 'datasource' || v === 'ds_prometheus');
    const hasNamespaceVar = vars.includes('namespace');
    if (!hasClusterVar) issues.push('Missing $cluster or $datasource variable');
    if (!hasNamespaceVar) issues.push('Missing $namespace variable');

    // Check for hardcoded namespaces in queries
    let hardcodedNs = false;
    for (const p of panels.slice(0, 10)) {
      for (const t of (p.targets || [])) {
        const expr = t.expr || t.query || '';
        if (expr.includes('namespace="') && !expr.includes('namespace="$') && !expr.includes('namespace=~"$')) {
          hardcodedNs = true;
          break;
        }
      }
      if (hardcodedNs) break;
    }
    if (hardcodedNs) issues.push('Hardcoded namespace in queries — should use $namespace variable');

    // Check for deprecated K8s metrics
    const deprecatedMetrics = [];
    for (const p of panels.slice(0, 10)) {
      for (const t of (p.targets || [])) {
        const expr = t.expr || '';
        if (expr.includes('machine_cpu_cores')) deprecatedMetrics.push('machine_cpu_cores (use kube_node_status_capacity)');
        if (expr.includes('machine_memory_bytes')) deprecatedMetrics.push('machine_memory_bytes');
        if (expr.includes('container_cpu_cfs_throttled_seconds_total')) deprecatedMetrics.push('container_cpu_cfs_throttled_seconds_total (renamed in K8s 1.24+)');
      }
    }
    if (deprecatedMetrics.length > 0) issues.push(`Deprecated metrics: ${[...new Set(deprecatedMetrics)].join(', ')}`);

    const status = issues.length === 0 ? 'PASS' : issues.some(i => i.includes('Missing')) ? 'WARN' : 'WARN';
    results.push({
      name: `K8s: ${d.title}`, status, uid: d.uid,
      detail: issues.length > 0 ? issues.join(' | ') : `${panels.length} panels, vars: ${vars.join(', ')}`,
    });
  }

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
