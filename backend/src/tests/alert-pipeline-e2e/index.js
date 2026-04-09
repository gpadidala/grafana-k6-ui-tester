'use strict';

const logger = require('../../utils/logger');

const CAT = 'alert-pipeline-e2e';

/**
 * Validate contact point has the required fields for its type.
 */
function validateContactPoint(cp) {
  const issues = [];
  const type = cp.type || 'unknown';
  const settings = cp.settings || {};

  switch (type) {
    case 'email':
      if (!settings.addresses && !settings.to) {
        issues.push('Email contact point missing "addresses" or "to" field');
      }
      break;
    case 'slack':
      if (!settings.url && !settings.recipient) {
        issues.push('Slack contact point missing "url" (webhook) or "recipient" field');
      }
      break;
    case 'webhook':
      if (!settings.url) {
        issues.push('Webhook contact point missing "url" field');
      }
      break;
    case 'pagerduty':
      if (!settings.integrationKey && !settings.routingKey) {
        issues.push('PagerDuty contact point missing "integrationKey" or "routingKey"');
      }
      break;
    case 'opsgenie':
      if (!settings.apiKey && !settings.apiUrl) {
        issues.push('OpsGenie contact point missing "apiKey"');
      }
      break;
    case 'teams':
    case 'msteams':
      if (!settings.url) {
        issues.push('MS Teams contact point missing "url"');
      }
      break;
    case 'telegram':
      if (!settings.bottoken || !settings.chatid) {
        issues.push('Telegram contact point missing "bottoken" or "chatid"');
      }
      break;
    case 'victorops':
      if (!settings.url) {
        issues.push('VictorOps contact point missing "url"');
      }
      break;
    case 'discord':
      if (!settings.url) {
        issues.push('Discord contact point missing "url"');
      }
      break;
    default:
      // Unknown type — no validation rules
      break;
  }

  return issues;
}

/**
 * Extract data source UIDs from alert rule queries, excluding expression nodes.
 */
function extractRuleDataQueries(rule) {
  const data = rule.data || rule.grafana_alert?.data || [];
  if (!Array.isArray(data)) return [];

  return data.filter(d => {
    const dsUid = d.datasourceUid || d.datasource?.uid;
    return dsUid && dsUid !== '__expr__' && dsUid !== '-100';
  });
}

async function run(client, _depGraph, options = {}) {
  const results = [];

  // ═══════════════════════════════════════════════
  // 1. Alert Rules — validate data queries
  // ═══════════════════════════════════════════════
  const rulesRes = await client.getAlertRules();
  let allRules = [];

  if (rulesRes.ok) {
    const raw = rulesRes.data;
    if (Array.isArray(raw)) {
      // Could be flat array or grouped format
      if (raw.length > 0 && raw[0].rules) {
        // Grouped (ruler) format: {name, rules[]}
        for (const group of raw) {
          for (const rule of (group.rules || [])) {
            allRules.push({ ...rule, _groupName: group.name, _folder: group.file || group.folderTitle });
          }
        }
      } else {
        allRules = raw;
      }
    } else if (raw && typeof raw === 'object') {
      // Namespace-grouped format: { "folder": [{name, rules[]}] }
      for (const folder of Object.keys(raw)) {
        for (const group of (raw[folder] || [])) {
          for (const rule of (group.rules || [])) {
            allRules.push({ ...rule, _groupName: group.name, _folder: folder });
          }
        }
      }
    }
  }

  if (allRules.length === 0) {
    results.push({
      name: `${CAT}:no-alert-rules`,
      status: 'WARN',
      detail: `No alert rules found${!rulesRes.ok ? ` (API returned ${rulesRes.status})` : ''}`,
      uid: null,
      ms: rulesRes.ms,
      metadata: { apiStatus: rulesRes.status },
    });
  } else {
    results.push({
      name: `${CAT}:rules-count`,
      status: 'PASS',
      detail: `Found ${allRules.length} alert rule(s)`,
      uid: null,
      ms: rulesRes.ms,
      metadata: { ruleCount: allRules.length },
    });
  }

  // Fetch known datasource UIDs for validation
  const dsRes = await client.getDataSources();
  const knownDsUids = new Set();
  if (dsRes.ok) {
    for (const ds of (dsRes.data || [])) {
      knownDsUids.add(ds.uid);
    }
  }

  let rulesWithInvalidDs = 0;
  let rulesWithNoQueries = 0;

  for (const rule of allRules) {
    const ruleTitle = rule.title || rule.grafana_alert?.title || rule.name || 'Unnamed';
    const ruleUid = rule.uid || rule.grafana_alert?.uid || null;
    const dataQueries = extractRuleDataQueries(rule);

    if (dataQueries.length === 0) {
      rulesWithNoQueries++;
      results.push({
        name: `${CAT}:rule-no-query:${ruleUid || ruleTitle}`,
        status: 'WARN',
        detail: `Alert rule "${ruleTitle}" has no data queries (only expressions?)`,
        uid: ruleUid,
        ms: 0,
        metadata: { ruleTitle, ruleUid },
      });
      continue;
    }

    // Validate each data query references a known datasource
    for (const dq of dataQueries) {
      const dsUid = dq.datasourceUid || dq.datasource?.uid;
      if (knownDsUids.size > 0 && !knownDsUids.has(dsUid)) {
        rulesWithInvalidDs++;
        results.push({
          name: `${CAT}:rule-invalid-ds:${ruleUid || ruleTitle}:${dsUid}`,
          status: 'FAIL',
          detail: `Alert rule "${ruleTitle}" references unknown datasource UID "${dsUid}"`,
          uid: ruleUid,
          ms: 0,
          metadata: { ruleTitle, ruleUid, datasourceUid: dsUid, refId: dq.refId },
        });
      }
    }
  }

  results.push({
    name: `${CAT}:rules-validation`,
    status: rulesWithInvalidDs > 0 ? 'FAIL' : rulesWithNoQueries > 0 ? 'WARN' : 'PASS',
    detail: `${allRules.length} rules validated — ${rulesWithInvalidDs} with invalid datasource, ${rulesWithNoQueries} with no data queries`,
    uid: null,
    ms: 0,
    metadata: { totalRules: allRules.length, invalidDs: rulesWithInvalidDs, noQueries: rulesWithNoQueries },
  });

  // ═══════════════════════════════════════════════
  // 2. Contact Points — required fields
  // ═══════════════════════════════════════════════
  const cpRes = await client.getContactPoints();
  let contactPoints = [];

  if (cpRes.ok) {
    contactPoints = Array.isArray(cpRes.data) ? cpRes.data : [];
    // Handle nested format (receivers with grafana_managed_receiver_configs)
    if (contactPoints.length > 0 && contactPoints[0].grafana_managed_receiver_configs) {
      const flattened = [];
      for (const receiver of contactPoints) {
        for (const config of (receiver.grafana_managed_receiver_configs || [])) {
          flattened.push({ ...config, _receiverName: receiver.name });
        }
      }
      contactPoints = flattened;
    }
  }

  if (contactPoints.length === 0) {
    results.push({
      name: `${CAT}:no-contact-points`,
      status: 'WARN',
      detail: `No contact points found${!cpRes.ok ? ` (API returned ${cpRes.status})` : ''}`,
      uid: null,
      ms: cpRes.ms,
      metadata: {},
    });
  } else {
    results.push({
      name: `${CAT}:contact-points-count`,
      status: 'PASS',
      detail: `Found ${contactPoints.length} contact point(s)`,
      uid: null,
      ms: cpRes.ms,
      metadata: { count: contactPoints.length },
    });
  }

  let cpIssueCount = 0;
  const cpTypeStats = {};

  for (const cp of contactPoints) {
    const cpName = cp.name || cp._receiverName || 'Unnamed';
    const cpType = cp.type || 'unknown';
    cpTypeStats[cpType] = (cpTypeStats[cpType] || 0) + 1;

    const issues = validateContactPoint(cp);
    if (issues.length > 0) {
      cpIssueCount++;
      results.push({
        name: `${CAT}:contact-point-issue:${cpName}:${cpType}`,
        status: 'FAIL',
        detail: `Contact point "${cpName}" (${cpType}): ${issues.join('; ')}`,
        uid: cp.uid || null,
        ms: 0,
        metadata: { cpName, cpType, issues, uid: cp.uid },
      });
    }
  }

  results.push({
    name: `${CAT}:contact-points-validation`,
    status: cpIssueCount > 0 ? 'FAIL' : 'PASS',
    detail: `${contactPoints.length} contact points validated — ${cpIssueCount} with issues. Types: ${Object.entries(cpTypeStats).map(([t, c]) => `${t}:${c}`).join(', ')}`,
    uid: null,
    ms: 0,
    metadata: { totalCPs: contactPoints.length, issueCount: cpIssueCount, typeStats: cpTypeStats },
  });

  // ═══════════════════════════════════════════════
  // 3. Notification Policy — chain resolution
  // ═══════════════════════════════════════════════
  const policyRes = await client.getNotificationPolicies();
  if (policyRes.ok) {
    const policy = policyRes.data || {};
    const receiver = policy.receiver || policy.route?.receiver;
    const routes = policy.routes || policy.route?.routes || [];

    // Validate the root receiver exists in contact points
    const cpNames = new Set(contactPoints.map(cp => cp.name || cp._receiverName));
    const rootReceiverValid = !receiver || cpNames.size === 0 || cpNames.has(receiver);

    results.push({
      name: `${CAT}:notification-policy-root`,
      status: rootReceiverValid ? 'PASS' : 'FAIL',
      detail: rootReceiverValid
        ? `Root notification policy receiver: "${receiver || 'default'}" — valid`
        : `Root notification policy receiver "${receiver}" not found in contact points`,
      uid: null,
      ms: policyRes.ms,
      metadata: { rootReceiver: receiver, valid: rootReceiverValid },
    });

    // Check child routes
    let invalidRoutes = 0;
    let totalRoutes = 0;

    function validateRoutes(routeArr, depth) {
      for (const route of routeArr) {
        totalRoutes++;
        const routeReceiver = route.receiver;
        if (routeReceiver && cpNames.size > 0 && !cpNames.has(routeReceiver)) {
          invalidRoutes++;
          results.push({
            name: `${CAT}:invalid-route-receiver:${routeReceiver}`,
            status: 'FAIL',
            detail: `Notification route at depth ${depth} references receiver "${routeReceiver}" which is not a known contact point`,
            uid: null,
            ms: 0,
            metadata: { receiver: routeReceiver, depth, matchers: route.matchers || route.match || route.object_matchers },
          });
        }

        // Recurse into nested routes
        if (Array.isArray(route.routes)) {
          validateRoutes(route.routes, depth + 1);
        }
      }
    }

    validateRoutes(routes, 1);

    results.push({
      name: `${CAT}:notification-routes`,
      status: invalidRoutes > 0 ? 'FAIL' : 'PASS',
      detail: `${totalRoutes} notification route(s) — ${invalidRoutes} referencing unknown receivers`,
      uid: null,
      ms: 0,
      metadata: { totalRoutes, invalidRoutes },
    });
  } else {
    results.push({
      name: `${CAT}:notification-policy`,
      status: 'WARN',
      detail: `Could not fetch notification policies (${policyRes.status})`,
      uid: null,
      ms: policyRes.ms,
      metadata: { status: policyRes.status },
    });
  }

  // ═══════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════
  const failures = results.filter(r => r.status === 'FAIL');
  const warnings = results.filter(r => r.status === 'WARN');
  results.push({
    name: `${CAT}:summary`,
    status: failures.length > 0 ? 'FAIL' : warnings.length > 0 ? 'WARN' : 'PASS',
    detail: `Alert pipeline E2E: ${allRules.length} rules, ${contactPoints.length} contact points — ${failures.length} failures, ${warnings.length} warnings`,
    uid: null,
    ms: 0,
    metadata: {
      ruleCount: allRules.length,
      contactPointCount: contactPoints.length,
      failureCount: failures.length,
      warningCount: warnings.length,
    },
  });

  logger.info(`[${CAT}] Completed: ${allRules.length} rules, ${contactPoints.length} CPs, ${failures.length} failures`, { category: CAT });
  return results;
}

module.exports = { run };
