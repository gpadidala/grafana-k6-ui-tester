module.exports = async function configAuditTests(client) {
  const results = [];

  // Frontend settings (exposes config without needing admin)
  const settings = await client.buildInfo();
  if (!settings.ok) {
    results.push({ name: 'Fetch Settings', status: 'FAIL', detail: `HTTP ${settings.status}`, ms: settings.ms });
    return results;
  }

  const cfg = settings.data || {};

  // Grafana edition
  results.push({
    name: 'Grafana Edition', status: 'PASS',
    detail: `${cfg.buildInfo?.edition || 'unknown'} v${cfg.buildInfo?.version || '?'} (commit: ${(cfg.buildInfo?.commit || '?').slice(0, 8)})`,
  });

  // Anonymous access
  const anonEnabled = cfg.authProxyAutoSignUp !== undefined || cfg.disableLoginForm;
  const authAnon = cfg.auth?.anonymous?.enabled;
  if (authAnon) {
    results.push({ name: 'Anonymous Access', status: 'WARN', detail: 'Anonymous access is ENABLED — security risk in production' });
  } else {
    results.push({ name: 'Anonymous Access', status: 'PASS', detail: 'Anonymous access disabled' });
  }

  // Auth providers
  const authProviders = [];
  if (cfg.oauth) Object.keys(cfg.oauth).forEach(k => { if (cfg.oauth[k]?.enabled) authProviders.push(k); });
  if (cfg.ldapEnabled) authProviders.push('LDAP');
  if (cfg.samlEnabled) authProviders.push('SAML');
  if (cfg.authProxyEnabled) authProviders.push('Auth Proxy');
  results.push({
    name: 'Auth Providers', status: authProviders.length > 0 ? 'PASS' : 'WARN',
    detail: authProviders.length > 0 ? `Configured: ${authProviders.join(', ')}` : 'Only basic auth — consider SSO for production',
  });

  // Feature toggles
  const toggles = cfg.featureToggles || {};
  const enabledToggles = Object.entries(toggles).filter(([k, v]) => v === true).map(([k]) => k);
  if (enabledToggles.length > 0) {
    results.push({
      name: 'Feature Toggles', status: 'PASS',
      detail: `${enabledToggles.length} enabled: ${enabledToggles.slice(0, 10).join(', ')}${enabledToggles.length > 10 ? '...' : ''}`,
    });
  }

  // Unified alerting
  const unifiedAlerting = cfg.unifiedAlertingEnabled;
  results.push({
    name: 'Unified Alerting', status: unifiedAlerting ? 'PASS' : 'WARN',
    detail: unifiedAlerting ? 'Unified Alerting enabled' : 'Legacy alerting — consider migrating to Unified Alerting',
  });

  // Default org role
  const defaultRole = cfg.defaultRole || 'Viewer';
  results.push({
    name: 'Default Org Role', status: defaultRole === 'Viewer' ? 'PASS' : 'WARN',
    detail: `Default role: ${defaultRole}${defaultRole !== 'Viewer' ? ' — should be Viewer for least privilege' : ''}`,
  });

  // Explore enabled
  results.push({
    name: 'Explore Enabled', status: 'PASS',
    detail: cfg.exploreEnabled !== false ? 'Explore is enabled' : 'Explore is disabled',
  });

  // Alerting config
  const adminStats = await client.get('/api/admin/stats');
  if (adminStats.ok && adminStats.data) {
    const stats = adminStats.data;
    results.push({
      name: 'Instance Stats', status: 'PASS',
      detail: `Dashboards: ${stats.dashboards || '?'}, Datasources: ${stats.datasources || '?'}, Users: ${stats.users || '?'}, Orgs: ${stats.orgs || '?'}, Alerts: ${stats.alerts || '?'}`,
    });
  }

  return results;
};
