'use strict';

const logger = require('../../utils/logger');

const CAT = 'post-deployment';

/**
 * Post-deployment test orchestrator.
 *
 * Based on options.deploymentType, selects which test categories to run:
 *   - plugin-upgrade: plugins + impacted dashboards
 *   - grafana-upgrade: all categories (full suite)
 *   - datasource-add: datasource health + dashboards
 *   - dashboard-deploy: dashboards + panels + query-latency
 *   - alert-config: alert-pipeline-e2e
 *   - general: health + dashboards + datasources
 */

// Lazy-load sibling test modules
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
    description: 'Plugin was upgraded — verify plugin health and impacted dashboards',
    categories: ['plugins', 'plugin-upgrade', 'dashboards', 'panels'],
  },
  'grafana-upgrade': {
    description: 'Grafana version upgrade — run full validation suite',
    categories: [
      'api-health', 'dashboards', 'panels', 'datasources', 'alerts',
      'plugins', 'folders', 'users', 'annotations', 'config-audit',
      'query-latency',
    ],
  },
  'datasource-add': {
    description: 'New data source added — verify DS health and dependent dashboards',
    categories: ['datasources', 'dashboards', 'query-latency', 'data-freshness'],
  },
  'dashboard-deploy': {
    description: 'Dashboards deployed/updated — verify rendering and queries',
    categories: ['dashboards', 'panels', 'query-latency', 'provisioning'],
  },
  'alert-config': {
    description: 'Alert configuration changed — verify alert pipeline',
    categories: ['alerts', 'alert-pipeline-e2e'],
  },
  general: {
    description: 'General deployment — basic health checks',
    categories: ['api-health', 'dashboards', 'datasources'],
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

      // Include individual failures from sub-categories for visibility
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

  // Overall summary
  const overallStatus = totalFail > 0 ? 'FAIL' : totalWarn > 0 ? 'WARN' : 'PASS';
  results.push({
    name: `${CAT}:summary`,
    status: overallStatus,
    detail: `Post-deployment "${deploymentType}": ${profile.categories.length} categories, ${totalTests} tests — ${totalPass} pass, ${totalFail} fail, ${totalWarn} warn`,
    uid: null,
    ms: 0,
    metadata: {
      deploymentType,
      categoriesRun: profile.categories.length,
      totalTests,
      totalPass,
      totalFail,
      totalWarn,
      categoryResults,
    },
  });

  logger.info(`[${CAT}] Post-deployment "${deploymentType}" completed: ${totalTests} tests, ${totalFail} failures`, { category: CAT });
  return results;
}

module.exports = { run };
