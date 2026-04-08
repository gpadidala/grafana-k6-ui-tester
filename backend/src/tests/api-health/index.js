module.exports = async function apiHealthTests(client) {
  const results = [];

  // 1. Basic connectivity
  const health = await client.health();
  results.push({
    name: 'API Connectivity', status: health.ok ? 'PASS' : 'FAIL',
    detail: health.ok ? `Grafana reachable — ${health.ms}ms` : `Connection failed: ${health.error || `HTTP ${health.status}`}`,
    ms: health.ms,
  });

  // 2. Auth validation
  const user = await client.get('/api/user');
  results.push({
    name: 'Auth Validation', status: user.ok ? 'PASS' : 'FAIL',
    detail: user.ok ? `Authenticated as: ${user.data?.login || 'unknown'} (orgId: ${user.data?.orgId})` : `Auth failed: HTTP ${user.status}`,
    ms: user.ms,
  });

  // 3. Response time SLA
  const sla = health.ms < 2000;
  results.push({
    name: 'Response Time < 2s', status: sla ? 'PASS' : 'WARN',
    detail: `Health endpoint responded in ${health.ms}ms`,
    ms: health.ms,
  });

  // 4. Version / build info
  const info = await client.buildInfo();
  const version = health.data?.version || 'unknown';
  results.push({
    name: 'Build Info', status: info.ok ? 'PASS' : 'WARN',
    detail: `Grafana ${version}, DB: ${health.data?.database || 'unknown'}`,
    ms: info.ms,
  });

  // 5. Org access
  const org = await client.get('/api/org');
  results.push({
    name: 'Org Access', status: org.ok ? 'PASS' : 'FAIL',
    detail: org.ok ? `Org: ${org.data?.name || 'unknown'} (id: ${org.data?.id})` : `Org access failed: HTTP ${org.status}`,
    ms: org.ms,
  });

  return results;
};
