module.exports = async function provisioningTests(client) {
  const results = [];

  const dashRes = await client.searchDashboards();
  if (!dashRes.ok) {
    results.push({ name: 'Fetch Dashboards', status: 'FAIL', detail: `HTTP ${dashRes.status}` });
    return results;
  }

  let provisioned = 0, manual = 0, provisionedEditable = 0;

  for (const d of (dashRes.data || [])) {
    const detail = await client.getDashboard(d.uid);
    if (!detail.ok) continue;

    const meta = detail.data?.meta;
    if (meta?.provisioned) {
      provisioned++;
      const extId = meta.provisionedExternalId || 'unknown';
      const issues = [];

      // Check if provisioned dashboard is editable (drift risk)
      if (meta.canSave) {
        provisionedEditable++;
        issues.push('Editable in UI — manual changes will be overwritten on next provisioning reload');
      }

      // Version count (too many = people editing provisioned dashboards)
      if (meta.version > 1) {
        issues.push(`Version ${meta.version} — has been modified ${meta.version - 1} time(s) since provisioning`);
      }

      if (issues.length > 0) {
        results.push({
          name: `Provisioned: ${d.title}`, status: 'WARN', uid: d.uid,
          detail: `Source: ${extId} | ${issues.join(' | ')}`,
        });
      }
    } else {
      manual++;
    }
  }

  results.unshift({
    name: 'Provisioning Summary',
    status: provisionedEditable > 0 ? 'WARN' : 'PASS',
    detail: `${provisioned} provisioned, ${manual} manual, ${provisionedEditable} provisioned-but-editable (drift risk)`,
  });

  // Datasource provisioning
  const dsRes = await client.getDatasources();
  if (dsRes.ok) {
    const provDs = (dsRes.data || []).filter(d => d.readOnly);
    const manualDs = (dsRes.data || []).filter(d => !d.readOnly);
    results.push({
      name: 'Datasource Provisioning', status: 'PASS',
      detail: `${provDs.length} provisioned (read-only), ${manualDs.length} manual`,
    });
  }

  // Test provisioning reload (admin only)
  const reload = await client.post('/api/admin/provisioning/dashboards/reload', {});
  results.push({
    name: 'Provisioning Reload', status: reload.ok ? 'PASS' : (reload.status === 403 ? 'PASS' : 'WARN'),
    detail: reload.ok ? 'Reload successful' : reload.status === 403 ? 'Requires admin — skipped' : `Reload failed: HTTP ${reload.status}`,
    ms: reload.ms,
  });

  return results;
};
