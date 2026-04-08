module.exports = async function appPluginTests(client) {
  const results = [];
  const res = await client.getPlugins();
  if (!res.ok) { results.push({ name: 'Fetch Plugins', status: 'FAIL', detail: `HTTP ${res.status}` }); return results; }

  const apps = (res.data || []).filter(p => p.type === 'app' && p.enabled);
  results.push({ name: 'Enabled App Plugins', status: 'PASS', detail: `${apps.length} app plugin(s) enabled` });

  for (const app of apps) {
    // Settings check
    const settings = await client.get(`/api/plugins/${app.id}/settings`);
    results.push({
      name: `App Settings: ${app.name}`, status: settings.ok ? 'PASS' : 'WARN', uid: app.id,
      detail: settings.ok ? `Enabled: ${settings.data?.enabled}, pinned: ${settings.data?.pinned}` : `Settings unavailable: HTTP ${settings.status}`,
      ms: settings.ms,
    });

    // Health check
    const health = await client.getPluginHealth(app.id);
    results.push({
      name: `App Health: ${app.name}`, status: health.ok ? 'PASS' : 'WARN', uid: app.id,
      detail: health.ok ? `Healthy (${health.ms}ms)` : `Health check failed or not supported: HTTP ${health.status}`,
      ms: health.ms,
    });
  }

  return results;
};
