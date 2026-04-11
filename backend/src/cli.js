#!/usr/bin/env node
require('dotenv').config();
const { Command } = require('commander');
const GrafanaClient = require('./services/grafanaClient');
const TestEngine = require('./services/testEngine');

const program = new Command();
program.name('heimdall').version('3.0.0').description('Heimdall — the watchman of your observability stack. By Gopal Rao.');

program
  .command('run')
  .description('Run test suite')
  .option('--url <url>', 'Grafana URL', process.env.GRAFANA_URL)
  .option('--token <token>', 'Service account token', process.env.GRAFANA_API_TOKEN)
  .option('--categories <ids>', 'Comma-separated category IDs')
  .option('--strategy <name>', 'Test strategy: smoke, sanity, full', 'full')
  .option('--output <format>', 'Output: json, text', 'text')
  .action(async (opts) => {
    if (!opts.url) { console.error('ERROR: --url or GRAFANA_URL required'); process.exit(2); }
    const engine = new TestEngine();
    const cats = opts.categories ? opts.categories.split(',') : engine.getCategories().map(c => c.id);

    console.log(`\nHeimdall v3.0 — by Gopal Rao\n`);
    console.log(`URL:        ${opts.url}`);
    console.log(`Categories: ${cats.length}`);
    console.log(`Strategy:   ${opts.strategy}\n`);

    const report = await engine.runCategories(cats, opts.url, opts.token || '', (evt) => {
      if (evt.type === 'category_done') {
        const c = evt.result;
        const icon = c.status === 'PASS' ? '✅' : c.status === 'FAIL' ? '❌' : '⚠️';
        console.log(`  ${c.icon} ${icon} ${c.name}: ${c.summary.passed}/${c.summary.total} passed`);
      }
    }, { strategy: opts.strategy });

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  Total: ${report.summary.total}  Passed: ${report.summary.passed}  Failed: ${report.summary.failed}  Rate: ${report.summary.pass_rate}`);
    console.log(`  Verdict: ${report.status === 'passed' ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`${'═'.repeat(50)}\n`);

    if (opts.output === 'json') console.log(JSON.stringify(report, null, 2));

    process.exit(report.status === 'passed' ? 0 : 1);
  });

program
  .command('smoke')
  .description('Quick smoke test (<60s)')
  .option('--url <url>', 'Grafana URL', process.env.GRAFANA_URL)
  .option('--token <token>', 'Token', process.env.GRAFANA_API_TOKEN)
  .action(async (opts) => {
    if (!opts.url) { console.error('ERROR: --url required'); process.exit(2); }
    const engine = new TestEngine();
    const smokeCats = ['api-health', 'datasources', 'dashboards', 'alerts', 'plugins'];
    const report = await engine.runCategories(smokeCats, opts.url, opts.token || '', (evt) => {
      if (evt.type === 'category_done') {
        const c = evt.result;
        console.log(`  ${c.icon} ${c.status === 'PASS' ? '✅' : '❌'} ${c.name}`);
      }
    }, { strategy: 'smoke' });
    console.log(`\nSmoke: ${report.summary.pass_rate} pass rate`);
    process.exit(report.status === 'passed' ? 0 : 1);
  });

program
  .command('plugin-updates')
  .description('Check plugins for updates')
  .option('--url <url>', 'Grafana URL', process.env.GRAFANA_URL)
  .option('--token <token>', 'Token', process.env.GRAFANA_API_TOKEN)
  .action(async (opts) => {
    const client = new GrafanaClient(opts.url, opts.token);
    const res = await client.getPlugins();
    if (!res.ok) { console.error('Failed to fetch plugins'); process.exit(3); }
    const plugins = (res.data || []).filter(p => p.hasUpdate);
    if (plugins.length === 0) { console.log('All plugins up to date'); process.exit(0); }
    console.log(`${plugins.length} plugin(s) with updates available:`);
    plugins.forEach(p => console.log(`  ${p.id}: ${p.info?.version} → update available`));
    process.exit(0);
  });

program.parse();
