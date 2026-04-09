/**
 * tests/scenarios/regression.scenario.js — Compare two Sentinel run results for regressions.
 * Node.js script — run with: node tests/scenarios/regression.scenario.js --before <run-id> --after <run-id>
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { loadConfig } = require('../../core/config');

async function runRegression(flags = {}) {
  const config = loadConfig(flags);
  const beforeId = flags.before;
  const afterId  = flags.after  || 'latest';
  const reportDir = flags.reportDir || config.reports.output_dir;

  if (!beforeId) {
    console.error('ERROR: --before <run-id> is required');
    process.exit(1);
  }

  console.log(`\n[Sentinel] Regression comparison: ${beforeId} → ${afterId}`);

  const beforeReport = loadReport(reportDir, beforeId);
  const afterReport  = afterId === 'latest'
    ? loadLatestReport(reportDir)
    : loadReport(reportDir, afterId);

  if (!beforeReport) { console.error(`ERROR: Report not found: ${beforeId}`); process.exit(1); }
  if (!afterReport)  { console.error(`ERROR: Report not found: ${afterId}`); process.exit(1); }

  const diff = compareReports(beforeReport, afterReport);
  printRegressionReport(diff);

  const outPath = `${reportDir}/regression-${Date.now()}.json`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(diff, null, 2));
  console.log(`\n[Sentinel] Regression report saved: ${outPath}`);

  return diff;
}

function compareReports(before, after) {
  const beforeCats = {};
  const afterCats  = {};

  for (const c of (before.categories || [])) beforeCats[c.id] = c;
  for (const c of (after.categories  || [])) afterCats[c.id]  = c;

  const regressions = [];
  const improvements = [];
  const new_failures = [];
  const fixed = [];

  const allCatIds = new Set([...Object.keys(beforeCats), ...Object.keys(afterCats)]);

  for (const catId of allCatIds) {
    const b = beforeCats[catId];
    const a = afterCats[catId];

    if (!b && a) {
      // New category
      if (a.status === 'FAIL') new_failures.push({ category: catId, type: 'new_category_failed' });
      continue;
    }
    if (b && !a) continue; // Category removed

    // Compare pass rates
    const bPass = passRate(b.tests || []);
    const aPass = passRate(a.tests  || []);
    const delta = aPass - bPass;

    if (delta < -10) {
      regressions.push({ category: catId, before_pct: bPass, after_pct: aPass, delta });
    } else if (delta > 10) {
      improvements.push({ category: catId, before_pct: bPass, after_pct: aPass, delta });
    }

    // Find newly failed tests
    const bFailed = new Set((b.tests || []).filter(t => t.status !== 'PASS').map(t => t.name));
    const aFailed = new Set((a.tests || []).filter(t => t.status !== 'PASS').map(t => t.name));

    for (const name of aFailed) {
      if (!bFailed.has(name)) {
        new_failures.push({ category: catId, test: name, type: 'newly_failed' });
      }
    }
    for (const name of bFailed) {
      if (!aFailed.has(name)) {
        fixed.push({ category: catId, test: name, type: 'newly_fixed' });
      }
    }
  }

  const beforeSummary = before.summary || {};
  const afterSummary  = after.summary  || {};
  const overallDelta  = (afterSummary.pass_rate || 0) - (beforeSummary.pass_rate || 0);

  return {
    before: { id: before.id, run_at: before.startedAt, pass_rate: beforeSummary.pass_rate },
    after:  { id: after.id,  run_at: after.startedAt,  pass_rate: afterSummary.pass_rate },
    overall_delta: overallDelta,
    regressions,
    improvements,
    new_failures,
    fixed,
    has_regressions: regressions.length > 0 || new_failures.length > 0,
  };
}

function passRate(tests) {
  if (!tests.length) return 100;
  const passed = tests.filter(t => t.status === 'PASS').length;
  return Math.round((passed / tests.length) * 100);
}

function printRegressionReport(diff) {
  const statusIcon = diff.has_regressions ? '❌' : '✅';
  console.log('\n══════════════════════════════════════════════');
  console.log(`  REGRESSION REPORT  ${statusIcon}`);
  console.log('══════════════════════════════════════════════');
  console.log(`  Before: ${diff.before.pass_rate}% pass rate`);
  console.log(`  After:  ${diff.after.pass_rate}% pass rate`);
  const deltaStr = diff.overall_delta >= 0 ? `+${diff.overall_delta}` : `${diff.overall_delta}`;
  console.log(`  Delta:  ${deltaStr}%`);
  console.log('──────────────────────────────────────────────');

  if (diff.regressions.length) {
    console.log('\n❌ CATEGORY REGRESSIONS:');
    diff.regressions.forEach(r =>
      console.log(`   ${r.category}: ${r.before_pct}% → ${r.after_pct}% (${r.delta}%)`));
  }
  if (diff.new_failures.length) {
    console.log('\n⚠️  NEW FAILURES:');
    diff.new_failures.forEach(f =>
      console.log(`   [${f.category}] ${f.test || f.type}`));
  }
  if (diff.fixed.length) {
    console.log('\n✅ FIXED:');
    diff.fixed.forEach(f => console.log(`   [${f.category}] ${f.test}`));
  }
  if (diff.improvements.length) {
    console.log('\n📈 IMPROVEMENTS:');
    diff.improvements.forEach(i =>
      console.log(`   ${i.category}: ${i.before_pct}% → ${i.after_pct}% (+${i.delta}%)`));
  }
  console.log('══════════════════════════════════════════════\n');
}

function loadReport(dir, id) {
  const jsonPath = path.join(dir, `report-${id}.json`);
  if (!fs.existsSync(jsonPath)) return null;
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
}

function loadLatestReport(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith('report-') && f.endsWith('.json'))
    .sort()
    .reverse();
  if (!files.length) return null;
  return JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
}

if (require.main === module) {
  const flags = {};
  const args  = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    flags[key] = args[i + 1];
  }
  runRegression(flags).catch(err => {
    console.error('[Sentinel] Fatal error:', err.message);
    process.exit(1);
  });
}

module.exports = { runRegression };
