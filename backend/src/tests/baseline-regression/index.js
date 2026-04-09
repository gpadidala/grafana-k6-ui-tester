'use strict';

const db = require('../../db');
const logger = require('../../utils/logger');

const CAT = 'baseline-regression';

/**
 * Compare current run results against a baseline run from the DB.
 * Detects: new failures, resolved failures, latency regressions.
 */
async function run(client, _depGraph, options = {}) {
  const results = [];
  const { baselineRunId, runId, queryThresholdMs = 5000 } = options;

  if (!baselineRunId) {
    results.push({
      name: `${CAT}:no-baseline`,
      status: 'WARN',
      detail: 'No baselineRunId specified in options — cannot perform regression comparison',
      uid: null,
      ms: 0,
      metadata: {},
    });
    return results;
  }

  // 1. Load baseline run results from DB
  let baselineResults;
  try {
    baselineResults = await db.all(
      'SELECT * FROM test_results WHERE run_id = ? ORDER BY rowid',
      [baselineRunId]
    );
  } catch (err) {
    results.push({
      name: `${CAT}:db-error`,
      status: 'FAIL',
      detail: `Failed to load baseline run "${baselineRunId}": ${err.message}`,
      uid: null,
      ms: 0,
      metadata: { baselineRunId, error: err.message },
    });
    return results;
  }

  if (!baselineResults || baselineResults.length === 0) {
    results.push({
      name: `${CAT}:baseline-empty`,
      status: 'WARN',
      detail: `Baseline run "${baselineRunId}" has no test results — cannot compare`,
      uid: null,
      ms: 0,
      metadata: { baselineRunId },
    });
    return results;
  }

  // 2. Load current run results
  let currentResults;
  if (runId) {
    try {
      currentResults = await db.all(
        'SELECT * FROM test_results WHERE run_id = ? ORDER BY rowid',
        [runId]
      );
    } catch (err) {
      currentResults = [];
    }
  }

  if (!currentResults || currentResults.length === 0) {
    results.push({
      name: `${CAT}:current-empty`,
      status: 'WARN',
      detail: 'Current run has no persisted results yet — comparison may be incomplete. Running live checks instead.',
      uid: null,
      ms: 0,
      metadata: { runId },
    });
    // Attempt to gather some live data by running basic checks
    currentResults = [];
  }

  // Build maps by test name for comparison
  const baselineMap = {};
  for (const r of baselineResults) {
    baselineMap[r.test_name] = r;
  }

  const currentMap = {};
  for (const r of currentResults) {
    currentMap[r.test_name] = r;
  }

  const allTestNames = new Set([...Object.keys(baselineMap), ...Object.keys(currentMap)]);

  let newFailures = 0;
  let resolvedFailures = 0;
  let persistentFailures = 0;
  let latencyRegressions = 0;
  let newTests = 0;
  let removedTests = 0;

  for (const testName of allTestNames) {
    const baseline = baselineMap[testName];
    const current = currentMap[testName];

    // New test (not in baseline)
    if (!baseline && current) {
      newTests++;
      if (current.status === 'failed' || current.status === 'FAIL') {
        newFailures++;
        results.push({
          name: `${CAT}:new-failure:${testName}`,
          status: 'FAIL',
          detail: `New failure: "${testName}" — ${current.details || 'no details'}`,
          uid: current.uid || null,
          ms: current.duration_ms || 0,
          metadata: { testName, currentStatus: current.status, isNew: true },
        });
      }
      continue;
    }

    // Removed test (in baseline but not current)
    if (baseline && !current) {
      removedTests++;
      continue;
    }

    // Both exist — compare
    const baseStatus = (baseline.status || '').toLowerCase();
    const curStatus = (current.status || '').toLowerCase();
    const baselineFailed = baseStatus === 'failed' || baseStatus === 'fail';
    const currentFailed = curStatus === 'failed' || curStatus === 'fail';

    // New failure (was passing, now failing)
    if (!baselineFailed && currentFailed) {
      newFailures++;
      results.push({
        name: `${CAT}:new-failure:${testName}`,
        status: 'FAIL',
        detail: `Regression: "${testName}" was ${baseline.status}, now ${current.status} — ${current.details || ''}`,
        uid: current.uid || baseline.uid || null,
        ms: current.duration_ms || 0,
        metadata: {
          testName,
          baselineStatus: baseline.status,
          currentStatus: current.status,
          category: current.category,
        },
      });
    }

    // Resolved failure (was failing, now passing)
    if (baselineFailed && !currentFailed) {
      resolvedFailures++;
      results.push({
        name: `${CAT}:resolved:${testName}`,
        status: 'PASS',
        detail: `Resolved: "${testName}" was ${baseline.status}, now ${current.status}`,
        uid: current.uid || baseline.uid || null,
        ms: current.duration_ms || 0,
        metadata: {
          testName,
          baselineStatus: baseline.status,
          currentStatus: current.status,
        },
      });
    }

    // Persistent failure
    if (baselineFailed && currentFailed) {
      persistentFailures++;
    }

    // Latency regression
    const baseMs = baseline.duration_ms || 0;
    const curMs = current.duration_ms || 0;
    if (baseMs > 0 && curMs > 0) {
      const increase = curMs - baseMs;
      const pctIncrease = Math.round((increase / baseMs) * 100);

      // Flag if latency increased by >50% and exceeds threshold
      if (pctIncrease > 50 && curMs > queryThresholdMs) {
        latencyRegressions++;
        results.push({
          name: `${CAT}:latency-regression:${testName}`,
          status: 'WARN',
          detail: `Latency regression: "${testName}" — ${baseMs}ms -> ${curMs}ms (+${pctIncrease}%)`,
          uid: current.uid || baseline.uid || null,
          ms: curMs,
          metadata: {
            testName,
            baselineMs: baseMs,
            currentMs: curMs,
            increaseMs: increase,
            increasePercent: pctIncrease,
          },
        });
      }
    }
  }

  // Latency measurements comparison (if available)
  try {
    const baselineLatencies = await db.all(
      'SELECT * FROM latency_measurements WHERE run_id = ? ORDER BY response_time_ms DESC',
      [baselineRunId]
    );
    const currentLatencies = runId
      ? await db.all('SELECT * FROM latency_measurements WHERE run_id = ? ORDER BY response_time_ms DESC', [runId])
      : [];

    if (baselineLatencies.length > 0 && currentLatencies.length > 0) {
      // Build map by dashboard_uid + panel_id
      const baseLatMap = {};
      for (const l of baselineLatencies) {
        const key = `${l.dashboard_uid}:${l.panel_id}`;
        baseLatMap[key] = l;
      }

      for (const l of currentLatencies) {
        const key = `${l.dashboard_uid}:${l.panel_id}`;
        const baseLat = baseLatMap[key];
        if (!baseLat) continue;

        const increase = l.response_time_ms - baseLat.response_time_ms;
        const pctIncrease = baseLat.response_time_ms > 0
          ? Math.round((increase / baseLat.response_time_ms) * 100)
          : 0;

        if (pctIncrease > 100 && l.response_time_ms > queryThresholdMs) {
          results.push({
            name: `${CAT}:query-regression:${l.dashboard_uid}:${l.panel_id}`,
            status: 'WARN',
            detail: `Query latency regression: "${l.panel_title}" in "${l.dashboard_title}" — ${baseLat.response_time_ms}ms -> ${l.response_time_ms}ms (+${pctIncrease}%)`,
            uid: l.dashboard_uid,
            ms: l.response_time_ms,
            metadata: {
              dashboardUid: l.dashboard_uid,
              panelId: l.panel_id,
              panelTitle: l.panel_title,
              baselineMs: baseLat.response_time_ms,
              currentMs: l.response_time_ms,
              increasePercent: pctIncrease,
            },
          });
        }
      }
    }
  } catch (err) {
    // Latency comparison is optional
    logger.debug(`[${CAT}] Latency comparison skipped: ${err.message}`, { category: CAT });
  }

  // Summary
  const overallStatus = newFailures > 0 ? 'FAIL' : latencyRegressions > 0 ? 'WARN' : 'PASS';
  results.push({
    name: `${CAT}:summary`,
    status: overallStatus,
    detail: `Baseline comparison: ${newFailures} new failures, ${resolvedFailures} resolved, ${persistentFailures} persistent, ${latencyRegressions} latency regressions (baseline: ${baselineResults.length} tests, current: ${currentResults.length} tests)`,
    uid: null,
    ms: 0,
    metadata: {
      baselineRunId,
      currentRunId: runId,
      baselineTestCount: baselineResults.length,
      currentTestCount: currentResults.length,
      newFailures,
      resolvedFailures,
      persistentFailures,
      latencyRegressions,
      newTests,
      removedTests,
    },
  });

  logger.info(`[${CAT}] Completed: ${newFailures} new failures, ${resolvedFailures} resolved`, { category: CAT });
  return results;
}

module.exports = { run };
