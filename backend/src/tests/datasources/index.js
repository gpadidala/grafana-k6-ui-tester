module.exports = async function datasourceTests(client) {
  const results = [];
  const res = await client.getDatasources();
  if (!res.ok || !Array.isArray(res.data)) {
    results.push({ name: 'Fetch Datasources', status: 'FAIL', detail: `API error: HTTP ${res.status}`, ms: res.ms });
    return results;
  }

  const dsList = res.data;
  results.push({ name: 'Fetch Datasources', status: 'PASS', detail: `Found ${dsList.length} datasource(s)`, ms: res.ms });

  // Default DS check
  const defaultDs = dsList.find(d => d.isDefault);
  results.push({
    name: 'Default Datasource', status: defaultDs ? 'PASS' : 'WARN',
    detail: defaultDs ? `Default: ${defaultDs.name} (${defaultDs.type})` : 'No default datasource configured',
  });

  // Health check each DS
  for (const ds of dsList) {
    const h = await client.getDatasourceHealth(ds.uid);
    const ok = h.ok && h.data?.status === 'OK';
    results.push({
      name: `DS Health: ${ds.name}`, status: ok ? 'PASS' : 'FAIL', uid: ds.uid,
      detail: ok ? `${ds.type} — healthy (${h.ms}ms)` : `${ds.type} — ${h.data?.message || h.error || `HTTP ${h.status}`}`,
      ms: h.ms,
    });
  }

  // Config validation
  for (const ds of dsList) {
    const issues = [];
    if (ds.type === 'prometheus' && !ds.url) issues.push('No URL configured');
    if (ds.type === 'loki' && !ds.url) issues.push('No URL configured');
    if (ds.access === 'direct') issues.push('Using "Browser" access mode (insecure)');
    results.push({
      name: `DS Config: ${ds.name}`, status: issues.length ? 'WARN' : 'PASS', uid: ds.uid,
      detail: issues.length ? issues.join('; ') : `${ds.type} — config valid`,
    });
  }

  return results;
};
