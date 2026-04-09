#!/usr/bin/env node
'use strict';
/**
 * cli/sentinel.js — Grafana Sentinel CLI
 * Full command suite using commander.js
 */

const { Command } = require('commander');
const path  = require('path');
const fs    = require('fs');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

const program = new Command();

program
  .name('sentinel')
  .description('Grafana Sentinel V3 — Enterprise UI Testing, Upgrade Validation & Observability Platform')
  .version(pkg.version);

// ─────────────────────────────────────────────────────────────────────────────
// sentinel run
// ─────────────────────────────────────────────────────────────────────────────
program
  .command('run')
  .description('Run Sentinel tests against a Grafana instance')
  .requiredOption('-u, --url <url>', 'Grafana URL', process.env.GRAFANA_URL)
  .requiredOption('-t, --token <token>', 'Service account token', process.env.GRAFANA_TOKEN)
  .option('-l, --level <level>', 'Test level: smoke | standard | full', 'standard')
  .option('--categories <cats>', 'Comma-separated category IDs to run')
  .option('--headless', 'Run browser headless', true)
  .option('--vus <n>', 'Parallel virtual users', '1')
  .option('--report-dir <dir>', 'Report output directory', './reports')
  .option('--no-screenshot', 'Disable screenshots on failure')
  .option('--config <path>', 'Config YAML path', './config/default.yaml')
  .action(async (opts) => {
    const { loadConfig }  = require('../core/config');
    const config = loadConfig(opts).applyFlags({
      url:       opts.url,
      token:     opts.token,
      level:     opts.level,
      vus:       parseInt(opts.vus, 10),
      reportDir: opts.reportDir,
    });

    const { validation } = config.validate();
    if (!validation?.valid) {
      // loadConfig always applies sensible defaults, so skip unless url/token missing
    }

    console.log(`\n🛡 Grafana Sentinel V3`);
    console.log(`   URL:   ${opts.url}`);
    console.log(`   Level: ${opts.level}`);
    console.log(`   Token: ${opts.token.slice(0, 8)}...`);
    console.log('');

    // Dynamically require test engine (avoid loading sqlite at import)
    const { TestEngine } = require('../backend/src/services/testEngine');
    const engine = new TestEngine();

    const categories = opts.categories ? opts.categories.split(',') : null;
    const report = await engine.runCategories(categories, opts.url, opts.token, (evt) => {
      if (evt.type === 'test_result') {
        const icon = evt.status === 'PASS' ? '✅' : evt.status === 'FAIL' ? '❌' : '⚠️';
        console.log(`  ${icon} [${evt.category}] ${evt.name}`);
      } else if (evt.type === 'category_complete') {
        console.log(`\n  Category: ${evt.category} — ${evt.status}\n`);
      }
    }, config.toJSON());

    console.log('\n─────────────────────────────────────────────');
    console.log(`  PASS: ${report.summary?.passed}  FAIL: ${report.summary?.failed}  WARN: ${report.summary?.warnings}`);
    console.log(`  Pass Rate: ${report.summary?.pass_rate}%`);
    console.log('─────────────────────────────────────────────');

    process.exit(report.summary?.failed > 0 ? 1 : 0);
  });

// ─────────────────────────────────────────────────────────────────────────────
// sentinel snapshot capture
// ─────────────────────────────────────────────────────────────────────────────
const snapshotCmd = program.command('snapshot').description('Snapshot capture and comparison');

snapshotCmd
  .command('capture')
  .description('Capture full Grafana state snapshot')
  .requiredOption('-u, --url <url>', 'Grafana URL', process.env.GRAFANA_URL)
  .requiredOption('-t, --token <token>', 'Service account token', process.env.GRAFANA_TOKEN)
  .option('-o, --output <dir>', 'Output directory', './snapshots')
  .option('--label <label>', 'Snapshot label (default: timestamp)')
  .option('--screenshots', 'Include screenshots (requires puppeteer)')
  .action(async (opts) => {
    const { GrafanaClient } = require('../core/grafana-client');
    const { SnapshotCapture } = require('../snapshot/capture');

    const client  = new GrafanaClient(opts.url, opts.token);
    const capture = new SnapshotCapture(client, {
      outputDir:   opts.output,
      label:       opts.label,
      screenshots: opts.screenshots,
      onProgress:  (step, total, msg) => console.log(`[${step}/${total}] ${msg}`),
    });

    const result = await capture.capture();
    console.log(`\n✅ Snapshot saved: ${result.label}`);
    console.log(`   Dashboards: ${result.counts.dashboards}`);
    console.log(`   Datasources: ${result.counts.datasources}`);
    console.log(`   Alert Rules: ${result.counts.alerts}`);
    console.log(`   Plugins: ${result.counts.plugins}`);
  });

snapshotCmd
  .command('compare')
  .description('Compare two snapshots and generate upgrade report')
  .requiredOption('--before <label>', 'Pre-upgrade snapshot label')
  .requiredOption('--after <label>', 'Post-upgrade snapshot label')
  .option('--snapshot-dir <dir>', 'Snapshots directory', './snapshots')
  .option('--report <path>', 'Output report path')
  .action(async (opts) => {
    const { DiffEngine }       = require('../snapshot/diff-engine');
    const { MigrationAdvisor } = require('../snapshot/migration-advisor');
    const { generateUpgradeReport } = require('../reports/generator/upgrade-report');

    const diff   = new DiffEngine(opts.snapshotDir).diff(opts.before, opts.after);
    const advice = new MigrationAdvisor().analyze(diff);

    new MigrationAdvisor().print(advice);

    const reportPath = generateUpgradeReport(diff, advice, null, opts.report);
    console.log(`\n📄 Report saved: ${reportPath}`);
  });

// ─────────────────────────────────────────────────────────────────────────────
// sentinel monitor start
// ─────────────────────────────────────────────────────────────────────────────
const monitorCmd = program.command('monitor').description('Monitoring and scheduling');

monitorCmd
  .command('start')
  .description('Start the monitoring daemon with scheduled runs')
  .requiredOption('-u, --url <url>', 'Grafana URL', process.env.GRAFANA_URL)
  .requiredOption('-t, --token <token>', 'Service account token', process.env.GRAFANA_TOKEN)
  .option('--schedule <cron>', 'Cron schedule', '0 7 * * *')
  .option('--db <path>', 'SQLite database path', './data/sentinel.db')
  .action(async (opts) => {
    const Database  = require('better-sqlite3');
    const { Scheduler } = require('../monitor/scheduler');

    const db = new Database(opts.db);
    const scheduler = new Scheduler(db, async (job) => {
      console.log(`[Monitor] Running scheduled test for: ${job.grafana_url}`);
      // Trigger a standard run
    });

    scheduler.addJob({
      id:          `main-${Date.now()}`,
      name:        'Main Grafana Monitor',
      schedule:    opts.schedule,
      grafana_url: opts.url,
      token:       opts.token,
      test_level:  'standard',
    });

    console.log(`\n🛡 Sentinel Monitor started`);
    console.log(`   Schedule: ${opts.schedule}`);
    console.log(`   Press Ctrl+C to stop\n`);

    process.on('SIGINT', () => { scheduler.stopAll(); process.exit(0); });
    // Keep process alive
    setInterval(() => {}, 60000);
  });

// ─────────────────────────────────────────────────────────────────────────────
// sentinel compare
// ─────────────────────────────────────────────────────────────────────────────
program
  .command('compare')
  .description('Compare dashboards between two Grafana instances')
  .requiredOption('--source-url <url>', 'Source (e.g. staging) Grafana URL')
  .requiredOption('--source-token <token>', 'Source Grafana token')
  .requiredOption('--target-url <url>', 'Target (e.g. production) Grafana URL')
  .requiredOption('--target-token <token>', 'Target Grafana token')
  .action(async (opts) => {
    const { InstanceRegistry } = require('../multi-instance/instance-registry');
    const { CrossCompare }     = require('../multi-instance/cross-compare');

    const registry = new InstanceRegistry();
    registry.register({ id: 'source', name: 'Source', url: opts.sourceUrl, token: opts.sourceToken });
    registry.register({ id: 'target', name: 'Target', url: opts.targetUrl, token: opts.targetToken });

    const result = await new CrossCompare(registry).compareDashboards('source', 'target');

    console.log('\n📊 Cross-Instance Comparison');
    console.log(`   Source: ${result.source.count} dashboards`);
    console.log(`   Target: ${result.target.count} dashboards`);
    console.log(`   Only in source: ${result.summary.only_in_source}`);
    console.log(`   Only in target: ${result.summary.only_in_target}`);
    console.log(`   Diverged: ${result.summary.diverged}`);
    console.log(`   In sync: ${result.summary.in_sync}`);
  });

// ─────────────────────────────────────────────────────────────────────────────
// sentinel dashboard serve
// ─────────────────────────────────────────────────────────────────────────────
program
  .command('dashboard')
  .description('Web dashboard commands')
  .command('serve')
  .description('Start the Sentinel web dashboard')
  .option('-p, --port <port>', 'HTTP port', '4000')
  .action((opts) => {
    process.env.PORT = opts.port;
    console.log(`\n🛡 Starting Sentinel Dashboard on port ${opts.port}`);
    require('../backend/src/server');
  });

// ─────────────────────────────────────────────────────────────────────────────
// sentinel report
// ─────────────────────────────────────────────────────────────────────────────
const reportCmd = program.command('report').description('Report generation');

reportCmd
  .command('executive')
  .description('Generate 1-page executive summary')
  .option('--run-id <id>', 'Run ID (default: latest)', 'latest')
  .option('--report-dir <dir>', 'Reports directory', './reports')
  .option('-o, --output <path>', 'Output HTML path')
  .action(async (opts) => {
    const { generateExecutiveSummary } = require('../reports/generator/executive-summary');
    const reportDir = opts.reportDir;
    const files     = fs.readdirSync(reportDir).filter(f => f.endsWith('.json')).sort().reverse();
    if (!files.length) { console.error('No reports found'); process.exit(1); }
    const report = JSON.parse(fs.readFileSync(path.join(reportDir, files[0]), 'utf8'));
    const outPath = generateExecutiveSummary(report, null, null, opts.output);
    console.log(`\n📄 Executive summary saved: ${outPath}`);
  });

reportCmd
  .command('push')
  .description('Push metrics to Prometheus Pushgateway')
  .requiredOption('--pushgateway <url>', 'Pushgateway URL')
  .option('--run-id <id>', 'Run ID (default: latest)', 'latest')
  .option('--job <name>', 'Prometheus job name', 'grafana-sentinel')
  .action(async (opts) => {
    const { pushMetrics } = require('../integrations/grafana-pushgateway');
    // Load latest report
    const files = fs.readdirSync('./reports').filter(f => f.endsWith('.json')).sort().reverse();
    if (!files.length) { console.error('No reports found'); process.exit(1); }
    const report = JSON.parse(fs.readFileSync(path.join('./reports', files[0]), 'utf8'));
    await pushMetrics(opts.pushgateway, report, opts.job);
    console.log(`✅ Metrics pushed to ${opts.pushgateway}`);
  });

program.parse(process.argv);
