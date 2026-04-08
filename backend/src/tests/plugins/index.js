module.exports = async function pluginTests(client) {
  const results = [];
  const res = await client.getPlugins();
  if (!res.ok || !Array.isArray(res.data)) {
    results.push({ name: 'Fetch Plugins', status: 'FAIL', detail: `HTTP ${res.status}`, ms: res.ms });
    return results;
  }

  const plugins = res.data;
  results.push({ name: 'Fetch Plugins', status: 'PASS', detail: `${plugins.length} plugin(s)`, ms: res.ms });

  // Signature check
  const unsigned = plugins.filter(p => p.signature !== 'internal' && p.signature !== 'grafana' && p.signatureType !== 'grafana');
  if (unsigned.length > 0) {
    results.push({
      name: 'Plugin Signatures', status: 'WARN',
      detail: `${unsigned.length} non-internal plugin(s): ${unsigned.map(p => `${p.id} (${p.signature || 'unknown'})`).join(', ')}`,
    });
  } else {
    results.push({ name: 'Plugin Signatures', status: 'PASS', detail: 'All plugins have valid signatures' });
  }

  // Check top plugins for health
  const dsPlugins = plugins.filter(p => p.type === 'datasource').slice(0, 10);
  const panelPlugins = plugins.filter(p => p.type === 'panel');
  const appPlugins = plugins.filter(p => p.type === 'app');

  results.push({ name: 'Plugin Types', status: 'PASS', detail: `DS: ${dsPlugins.length}, Panel: ${panelPlugins.length}, App: ${appPlugins.length}` });

  // Version info
  for (const p of plugins.filter(p => p.type === 'app' || (p.info?.version && p.hasUpdate)).slice(0, 10)) {
    results.push({
      name: `Plugin: ${p.name}`, status: p.hasUpdate ? 'WARN' : 'PASS', uid: p.id,
      detail: p.hasUpdate ? `v${p.info?.version} — update available` : `v${p.info?.version || 'built-in'} — up to date`,
    });
  }

  return results;
};
