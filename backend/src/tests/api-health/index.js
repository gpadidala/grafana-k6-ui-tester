const logger = require('../../utils/logger');
const config = require('../../config');

const CAT = 'api-health';

function result(name, status, detail, ms = 0, metadata = {}, uid = null) {
  return { name, status, detail, uid, ms, metadata };
}

async function run(client, _depGraph, _options) {
  const results = [];

  // ── 1. Health endpoint ──
  const health = await client.getHealth();
  if (health.ok) {
    const db = health.data?.database || 'unknown';
    results.push(result(
      'Grafana health endpoint',
      db === 'ok' ? 'PASS' : 'WARN',
      `Health responded ${health.status} — database: ${db}`,
      health.ms,
      { database: db, version: health.data?.version }
    ));
  } else {
    results.push(result('Grafana health endpoint', 'FAIL', `Health check failed: ${health.error}`, health.ms));
  }

  // ── 2. Auth / current user ──
  const user = await client.getCurrentUser();
  if (user.ok) {
    results.push(result(
      'Authentication (current user)',
      'PASS',
      `Authenticated as ${user.data?.login || user.data?.email || 'unknown'} (role: ${user.data?.orgRole || user.data?.role || 'N/A'})`,
      user.ms,
      { login: user.data?.login, role: user.data?.orgRole || user.data?.role, isGrafanaAdmin: user.data?.isGrafanaAdmin }
    ));
  } else {
    results.push(result(
      'Authentication (current user)',
      user.status === 401 ? 'FAIL' : 'WARN',
      `Auth check returned ${user.status}: ${user.error}`,
      user.ms,
      { status: user.status }
    ));
  }

  // ── 3. Response time profiling: p50 / p95 over 10 requests ──
  const latencies = [];
  for (let i = 0; i < 10; i++) {
    const ping = await client.getHealth();
    latencies.push(ping.ms);
  }
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const avg = Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length);
  const slowThreshold = config.thresholds.slowQueryThresholdMs || 5000;

  results.push(result(
    'API response time (10-sample)',
    p95 > slowThreshold ? 'WARN' : 'PASS',
    `p50=${p50}ms  p95=${p95}ms  avg=${avg}ms  min=${latencies[0]}ms  max=${latencies[latencies.length - 1]}ms`,
    avg,
    { p50, p95, avg, min: latencies[0], max: latencies[latencies.length - 1], samples: latencies.length }
  ));

  // ── 4. Build info / frontend settings ──
  const build = await client.getBuildInfo();
  if (build.ok) {
    const bi = build.data?.buildInfo || build.data || {};
    const version = bi.version || build.data?.version || 'unknown';
    const edition = bi.edition || build.data?.edition || 'unknown';
    results.push(result(
      'Build info',
      'PASS',
      `Grafana ${version} (${edition})`,
      build.ms,
      { version, edition, commit: bi.commit, env: bi.env }
    ));
  } else {
    results.push(result('Build info', 'WARN', `Could not retrieve build info: ${build.error}`, build.ms));
  }

  // ── 5. Current org access ──
  const org = await client.getCurrentOrg();
  if (org.ok) {
    results.push(result(
      'Current org access',
      'PASS',
      `Org: ${org.data?.name || 'unknown'} (id: ${org.data?.id || 'N/A'})`,
      org.ms,
      { orgId: org.data?.id, orgName: org.data?.name }
    ));
  } else {
    results.push(result(
      'Current org access',
      org.status === 403 ? 'WARN' : 'FAIL',
      `Org access returned ${org.status}: ${org.error}`,
      org.ms
    ));
  }

  // ── 6. Admin stats ──
  const stats = await client.getAdminStats();
  if (stats.ok) {
    const d = stats.data || {};
    results.push(result(
      'Admin stats',
      'PASS',
      `Users: ${d.users ?? '?'}, Dashboards: ${d.dashboards ?? '?'}, DataSources: ${d.datasources ?? '?'}, Orgs: ${d.orgs ?? '?'}, Alerts: ${d.alerts ?? d.activeAlerts ?? '?'}`,
      stats.ms,
      { users: d.users, dashboards: d.dashboards, datasources: d.datasources, orgs: d.orgs, alerts: d.alerts ?? d.activeAlerts }
    ));
  } else {
    // Admin stats requires admin role — downgrade to WARN
    results.push(result(
      'Admin stats',
      stats.status === 403 ? 'WARN' : 'FAIL',
      `Admin stats not available (${stats.status}): ${stats.error || 'requires admin privileges'}`,
      stats.ms,
      { status: stats.status }
    ));
  }

  logger.info(`${CAT}: completed ${results.length} checks`, { category: CAT });
  return results;
}

module.exports = { run };
