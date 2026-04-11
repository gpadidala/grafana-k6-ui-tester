'use strict';

const logger = require('../../utils/logger');

const CAT = 'pre-deployment';

/**
 * Pre-deployment readiness orchestrator.
 *
 * Runs BEFORE a change lands, to answer: "is the system in a safe state
 * to deploy into?" Different from post-deployment, which verifies the
 * change itself — this is about the baseline health of the target env.
 *
 * Based on options.deploymentType, selects which checks to run:
 *   - plugin-upgrade: current plugin state + dashboards that depend on it
 *   - grafana-upgrade: full health + deprecated schema/panel detection
 *   - datasource-add: existing DS stable + folder perms + query capacity
 *   - dashboard-deploy: folder exists + existing dashboards healthy
 *   - alert-config: current alert pipeline working + contact points reachable
 *   - general: health + datasources + no active incidents
 */

function loadModule(name) {
  try {
    return require(`../${name}`);
  } catch (err) {
    logger.warn(`[${CAT}] Could not load test module "${name}": ${err.message}`, { category: CAT });
    return null;
  }
}

const DEPLOYMENT_PROFILES = {
  'plugin-upgrade': {
    description: 'Plugin upgrade coming — baseline plugin health and impacted dashboards',
    categories: ['api-health', 'plugins', 'dashboards', 'panels'],
  },
  'grafana-upgrade': {
    description: 'Grafana version upgrade coming — full readiness check + deprecated schema scan',
    categories: [
      'api-health', 'config-audit', 'dashboards', 'panels', 'datasources',
      'alerts', 'plugins', 'provisioning', 'query-latency',
    ],
  },
  'datasource-add': {
    description: 'New datasource coming — verify existing DS stable and folder capacity',
    categories: ['api-health', 'datasources', 'folders', 'query-latency'],
  },
  'dashboard-deploy': {
    description: 'Dashboards about to be deployed — verify baseline folders and existing boards',
    categories: ['api-health', 'folders', 'dashboards', 'provisioning'],
  },
  'alert-config': {
    description: 'Alert config change coming — verify current alert pipeline working',
    categories: ['api-health', 'alerts', 'alert-pipeline-e2e'],
  },
  general: {
    description: 'General pre-deployment readiness — API health, datasources, active alerts',
    categories: ['api-health', 'datasources', 'alerts'],
  },
};

async function run(client, depGraph, options = {}) {
  const results = [];
  const deploymentType = options.deploymentType || 'general';
  const profile = DEPLOYMENT_PROFILES[deploymentType] || DEPLOYMENT_PROFILES.general;

  results.push({
    name: `${CAT}:profile`,
    status: 'PASS',
    detail: `Deployment type: "${deploymentType}" — ${profile.description}`,
    uid: null,
    ms: 0,
    metadata: { deploymentType, categories: profile.categories, description: profile.description },
  });

  const categoryResults = {};
  let totalTests = 0;
  let totalPass = 0;
  let totalFail = 0;
  let totalWarn = 0;

  for (const catName of profile.categories) {
    const mod = loadModule(catName);
    if (!mod || typeof mod.run !== 'function') {
      results.push({
        name: `${CAT}:skip:${catName}`,
        status: 'WARN',
        detail: `Test category "${catName}" not available — module not found or missing run()`,
        uid: null,
        ms: 0,
        metadata: { category: catName },
      });
      continue;
    }

    const start = Date.now();
    try {
      const catResults = await mod.run(client, depGraph, options);
      const elapsed = Date.now() - start;
      const arrResults = Array.isArray(catResults) ? catResults : [];

      const pass = arrResults.filter(r => r.status === 'PASS').length;
      const fail = arrResults.filter(r => r.status === 'FAIL').length;
      const warn = arrResults.filter(r => r.status === 'WARN').length;

      totalTests += arrResults.length;
      totalPass += pass;
      totalFail += fail;
      totalWarn += warn;

      const catStatus = fail > 0 ? 'FAIL' : warn > 0 ? 'WARN' : 'PASS';
      categoryResults[catName] = { count: arrResults.length, pass, fail, warn, status: catStatus, ms: elapsed };

      results.push({
        name: `${CAT}:category:${catName}`,
        status: catStatus,
        detail: `${catName}: ${arrResults.length} tests — ${pass} pass, ${fail} fail, ${warn} warn (${elapsed}ms)`,
        uid: null,
        ms: elapsed,
        metadata: { category: catName, total: arrResults.length, pass, fail, warn },
      });

      // Surface the first 10 failures from each sub-category so the user
      // sees them directly in the pre-deployment report without having to
      // drill into individual categories.
      const failures = arrResults.filter(r => r.status === 'FAIL');
      for (const f of failures.slice(0, 10)) {
        results.push({
          name: `${CAT}:failure:${catName}:${f.name}`,
          status: 'FAIL',
          detail: f.detail,
          uid: f.uid,
          ms: f.ms,
          metadata: { ...f.metadata, sourceCategory: catName },
        });
      }
    } catch (err) {
      const elapsed = Date.now() - start;
      totalFail++;
      results.push({
        name: `${CAT}:error:${catName}`,
        status: 'FAIL',
        detail: `Category "${catName}" threw an error: ${err.message}`,
        uid: null,
        ms: elapsed,
        metadata: { category: catName, error: err.message },
      });
    }
  }

  // Readiness verdict: if ANYTHING failed pre-deploy, the env is not ready.
  // Warnings are advisory but don't block.
  const overallStatus = totalFail > 0 ? 'FAIL' : totalWarn > 0 ? 'WARN' : 'PASS';
  const verdict = overallStatus === 'FAIL'
    ? 'NOT READY — fix failures before deploying'
    : overallStatus === 'WARN'
    ? 'READY with warnings — review before deploying'
    : 'READY — safe to deploy';

  results.push({
    name: `${CAT}:verdict`,
    status: overallStatus,
    detail: `${verdict}. ${profile.categories.length} categories, ${totalTests} tests — ${totalPass} pass, ${totalFail} fail, ${totalWarn} warn`,
    uid: null,
    ms: 0,
    metadata: {
      deploymentType,
      verdict,
      ready: overallStatus !== 'FAIL',
      categoriesRun: profile.categories.length,
      totalTests,
      totalPass,
      totalFail,
      totalWarn,
      categoryResults,
    },
  });

  logger.info(`[${CAT}] Pre-deployment "${deploymentType}" ${verdict}: ${totalTests} tests, ${totalFail} failures`, { category: CAT });
  return results;
}

module.exports = { run };
