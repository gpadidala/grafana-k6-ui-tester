/**
 * tests/scenarios/upgrade-post.scenario.js — Post-upgrade comparison.
 * Captures current state and diffs against pre-upgrade snapshot.
 * Node.js script — run with: node tests/scenarios/upgrade-post.scenario.js --before <pre-label>
 */

'use strict';

const path = require('path');
const { GrafanaClient }    = require('../../core/grafana-client');
const { SnapshotManager }  = require('../../core/snapshot-manager');
const { loadConfig }       = require('../../core/config');

async function capturePostAndCompare(flags = {}) {
  const config   = loadConfig(flags);
  const { url, token } = config.grafana;
  const beforeLabel = flags.before;

  if (!url || !token) {
    console.error('ERROR: GRAFANA_URL and GRAFANA_TOKEN are required');
    process.exit(1);
  }
  if (!beforeLabel) {
    console.error('ERROR: --before <label> is required (the pre-upgrade snapshot label)');
    process.exit(1);
  }

  const client  = new GrafanaClient(url, token);
  const manager = new SnapshotManager(flags.output || config.snapshots.output_dir);

  const health = await client.getHealth();
  if (!health.ok) {
    console.error(`ERROR: Cannot reach Grafana: ${health.error}`);
    process.exit(1);
  }

  const version = await client.getVersion();
  console.log(`\n[Sentinel] Post-upgrade comparison — ${url}`);
  console.log(`[Sentinel] Grafana version: ${version}`);
  console.log(`[Sentinel] Comparing against snapshot: ${beforeLabel}\n`);

  // Capture post state
  console.log('[1/3] Capturing post-upgrade state...');
  const { capturePreUpgradeSnapshot } = require('./upgrade-pre.scenario');
  const afterLabel = flags.label || `post-upgrade-${version}-${timestamp()}`;
  await capturePreUpgradeSnapshot({ ...flags, label: afterLabel });

  // Diff
  console.log('[2/3] Computing diff...');
  const diff = manager.diff(beforeLabel, afterLabel);

  // Report
  console.log('[3/3] Generating upgrade report...\n');
  printDiffReport(diff, version);

  // Write JSON report
  const reportPath = flags.report || `./reports/upgrade-diff-${timestamp()}.json`;
  const fs = require('fs');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(diff, null, 2));
  console.log(`\n[Sentinel] Full diff report saved: ${reportPath}`);

  return diff;
}

function printDiffReport(diff, newVersion) {
  const { dashboards: d, datasources: ds, alert_rules: ar, plugins: p } = diff;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  GRAFANA SENTINEL — UPGRADE DIFF REPORT');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Before: ${diff.before.version} (${diff.before.created_at})`);
  console.log(`  After:  ${newVersion} (${diff.after.created_at})`);
  console.log('───────────────────────────────────────────────────────────────');

  // Dashboards
  console.log('\n📊 DASHBOARDS');
  console.log(`  Total: ${d.total_before} → ${d.total_after}`);
  if (d.added > 0)    console.log(`  ✅ Added:    ${d.added_list.map(x => x.title).join(', ')}`);
  if (d.removed > 0)  console.log(`  ❌ Removed:  ${d.removed_list.map(x => x.title).join(', ')}`);
  if (d.modified > 0) {
    console.log(`  ⚠️  Modified: ${d.modified}`);
    for (const m of d.modified_list.slice(0, 10)) {
      console.log(`     - ${m.title}: ${m.changes.map(c => c.type).join(', ')}`);
    }
  }
  if (d.unchanged > 0) console.log(`  ✓  Unchanged: ${d.unchanged}`);

  // Datasources
  console.log('\n🔌 DATASOURCES');
  if (ds.added.length)    console.log(`  ✅ Added:    ${ds.added.map(x => x.name).join(', ')}`);
  if (ds.removed.length)  console.log(`  ❌ Removed:  ${ds.removed.map(x => x.name).join(', ')}`);
  if (ds.modified.length) console.log(`  ⚠️  Modified: ${ds.modified.map(x => `${x.name}(${x.changes.map(c => c.field).join(',')})`).join(', ')}`);

  // Alert Rules
  console.log('\n🔔 ALERT RULES');
  if (ar.added > 0)   console.log(`  ✅ Added:   ${ar.added_names.join(', ')}`);
  if (ar.removed > 0) console.log(`  ❌ Removed: ${ar.removed_names.join(', ')}`);

  // Plugins
  console.log('\n🧩 PLUGINS');
  if (p.added.length)    console.log(`  ✅ Added:    ${p.added.map(x => x.id).join(', ')}`);
  if (p.removed.length)  console.log(`  ❌ Removed:  ${p.removed.map(x => x.id).join(', ')}`);
  if (p.upgraded.length) console.log(`  ⬆️  Upgraded: ${p.upgraded.map(x => `${x.id}(${x.from}→${x.to})`).join(', ')}`);

  // Risk assessment
  const risks = [];
  if (d.modified_list.some(m => m.changes.some(c => c.type === 'datasource_ref_changed')))
    risks.push('DATASOURCE REFERENCES CHANGED — panels may show no data');
  if (ds.removed.length > 0)
    risks.push(`DATASOURCES REMOVED: ${ds.removed.map(x => x.name).join(', ')}`);
  if (p.removed.length > 0)
    risks.push(`PLUGINS REMOVED: ${p.removed.map(x => x.id).join(', ')}`);

  if (risks.length) {
    console.log('\n⚠️  UPGRADE RISKS:');
    risks.forEach(r => console.log(`   • ${r}`));
  } else {
    console.log('\n✅ No high-risk changes detected');
  }
  console.log('═══════════════════════════════════════════════════════════════\n');
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

if (require.main === module) {
  const flags = {};
  const args  = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    flags[key] = args[i + 1];
  }
  capturePostAndCompare(flags).catch(err => {
    console.error('[Sentinel] Fatal error:', err.message);
    process.exit(1);
  });
}

module.exports = { capturePostAndCompare };
