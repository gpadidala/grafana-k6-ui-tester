/**
 * tests/scenarios/upgrade-pre.scenario.js — Pre-upgrade snapshot capture.
 * Exports full state: dashboards, alert rules, datasources, plugins, performance baseline.
 * Run BEFORE upgrading Grafana. Compare with upgrade-post.scenario.js after.
 * Node.js script (not k6) — run with: node tests/scenarios/upgrade-pre.scenario.js
 */

'use strict';

const path = require('path');
const { GrafanaClient }    = require('../../core/grafana-client');
const { SnapshotManager }  = require('../../core/snapshot-manager');
const { loadConfig }       = require('../../core/config');

async function capturePreUpgradeSnapshot(flags = {}) {
  const config = loadConfig(flags);
  const { url, token } = config.grafana;

  if (!url || !token) {
    console.error('ERROR: GRAFANA_URL and GRAFANA_TOKEN are required');
    process.exit(1);
  }

  const client  = new GrafanaClient(url, token);
  const manager = new SnapshotManager(flags.output || config.snapshots.output_dir);

  console.log(`\n[Sentinel] Pre-upgrade snapshot — ${url}`);

  // Verify connectivity
  const health = await client.getHealth();
  if (!health.ok) {
    console.error(`ERROR: Cannot reach Grafana at ${url}: ${health.error}`);
    process.exit(1);
  }

  const version = await client.getVersion();
  console.log(`[Sentinel] Grafana version: ${version}`);
  console.log('[Sentinel] Capturing state...\n');

  // === Dashboards ===
  console.log('[1/6] Fetching all dashboards...');
  const searchRes = await client.searchDashboards('', [], 5000);
  const dashboardSummaries = searchRes.ok ? searchRes.data : [];
  console.log(`      Found ${dashboardSummaries.length} dashboards`);

  const dashboards = [];
  let i = 0;
  for (const summary of dashboardSummaries) {
    i++;
    process.stdout.write(`\r      Loading dashboard details ${i}/${dashboardSummaries.length}...`);
    const detail = await client.getDashboard(summary.uid);
    if (detail.ok) dashboards.push(detail.data);
    await new Promise(r => setTimeout(r, 50)); // Rate limit
  }
  console.log('\n      Done.');

  // === Alert Rules ===
  console.log('[2/6] Fetching alert rules...');
  const alertsRes = await client.getAlertRules();
  let alerts = [];
  if (alertsRes.ok) {
    alerts = Array.isArray(alertsRes.data) ? alertsRes.data : [];
  }
  console.log(`      Found ${alerts.length} alert rules`);

  // === Datasources ===
  console.log('[3/6] Fetching datasources...');
  const dsRes = await client.getDatasources();
  const datasources = dsRes.ok ? dsRes.data : [];
  console.log(`      Found ${datasources.length} datasources`);

  // === Plugins ===
  console.log('[4/6] Fetching installed plugins...');
  const pluginsRes = await client.getInstalledPlugins();
  const plugins = pluginsRes.ok ? pluginsRes.data : [];
  console.log(`      Found ${plugins.length} plugins`);

  // === Performance Baseline ===
  console.log('[5/6] Measuring API performance baseline...');
  const perfSamples = [];
  for (let j = 0; j < 5; j++) {
    const start = Date.now();
    await client.getHealth();
    perfSamples.push(Date.now() - start);
  }
  const perfBaseline = {
    api_health_p50_ms: percentile(perfSamples, 50),
    api_health_p95_ms: percentile(perfSamples, 95),
    sampled_at: new Date().toISOString(),
  };
  console.log(`      API health p95: ${perfBaseline.api_health_p95_ms}ms`);

  // === Save snapshot ===
  console.log('[6/6] Saving snapshot...');
  const label = flags.label || `pre-upgrade-${version}-${timestamp()}`;
  const result = manager.save(label, {
    dashboards,
    alerts,
    datasources,
    plugins,
    performance: perfBaseline,
    meta: {
      grafana_url:     url,
      grafana_version: version,
      captured_at:     new Date().toISOString(),
      purpose:         'pre-upgrade',
    },
  });

  console.log(`\n[Sentinel] ✓ Snapshot saved: ${result.dir}`);
  console.log('[Sentinel] Snapshot manifest:');
  console.log(JSON.stringify(result.manifest, null, 2));
  console.log(`\n[Sentinel] Next steps:`);
  console.log(`  1. Upgrade Grafana from ${version}`);
  console.log(`  2. Run: sentinel snapshot compare --before "${label}" --after <post-label>`);
  console.log('');

  return { label, manifest: result.manifest };
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx    = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// CLI entry point
if (require.main === module) {
  const flags = {};
  const args  = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    flags[key] = args[i + 1];
  }
  capturePreUpgradeSnapshot(flags).catch(err => {
    console.error('[Sentinel] Fatal error:', err.message);
    process.exit(1);
  });
}

module.exports = { capturePreUpgradeSnapshot };
