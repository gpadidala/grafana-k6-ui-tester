const logger = require('../../utils/logger');

const CAT = 'alerts';

function result(name, status, detail, ms = 0, metadata = {}, uid = null) {
  return { name, status, detail, uid, ms, metadata };
}

async function run(client, _depGraph, _options) {
  const results = [];

  // ── 1. Alert rules ──
  const rulesRes = await client.getAlertRules();
  let allRules = [];

  if (rulesRes.ok) {
    // Handle both provisioning API (flat array) and ruler API (grouped by folder/group)
    if (Array.isArray(rulesRes.data)) {
      allRules = rulesRes.data;
    } else if (typeof rulesRes.data === 'object' && rulesRes.data !== null) {
      // Ruler format: { "folder": { "group": { rules: [...] } } }
      for (const folder of Object.values(rulesRes.data)) {
        if (Array.isArray(folder)) {
          for (const group of folder) {
            if (Array.isArray(group.rules)) {
              allRules.push(...group.rules);
            }
          }
        }
      }
    }

    results.push(result(
      'Alert rules inventory',
      allRules.length > 0 ? 'PASS' : 'WARN',
      `Found ${allRules.length} alert rule(s)`,
      rulesRes.ms,
      { ruleCount: allRules.length }
    ));

    // Per-rule checks
    for (const rule of allRules) {
      const ruleTitle = rule.title || rule.alert || rule.name || 'Unnamed';
      const ruleUid = rule.uid || null;
      const prefix = `[Rule] ${ruleTitle}`;

      // Condition check
      const hasCondition = !!(rule.condition || (Array.isArray(rule.data) && rule.data.some(d => d.model?.conditions || d.model?.expression)));
      if (!hasCondition) {
        results.push(result(`${prefix} Condition`, 'WARN', 'Rule has no condition defined', 0, { ruleUid }, ruleUid));
      } else {
        results.push(result(`${prefix} Condition`, 'PASS', 'Rule condition defined', 0, { ruleUid, condition: rule.condition }, ruleUid));
      }

      // Labels check
      const labels = rule.labels || {};
      const labelCount = Object.keys(labels).length;
      if (labelCount === 0) {
        results.push(result(`${prefix} Labels`, 'WARN', 'Rule has no labels — routing may not work', 0, { ruleUid }, ruleUid));
      } else {
        const hasSeverity = 'severity' in labels;
        results.push(result(
          `${prefix} Labels`,
          hasSeverity ? 'PASS' : 'WARN',
          `${labelCount} label(s)${hasSeverity ? '' : ' — missing "severity" label'}`,
          0,
          { ruleUid, labels, hasSeverity },
          ruleUid
        ));
      }

      // Annotations check
      const annotations = rule.annotations || {};
      const annCount = Object.keys(annotations).length;
      const hasSummary = 'summary' in annotations || 'description' in annotations;
      if (annCount === 0) {
        results.push(result(`${prefix} Annotations`, 'WARN', 'No annotations — consider adding summary/description', 0, { ruleUid }, ruleUid));
      } else {
        results.push(result(
          `${prefix} Annotations`,
          hasSummary ? 'PASS' : 'WARN',
          `${annCount} annotation(s)${hasSummary ? '' : ' — missing summary/description'}`,
          0,
          { ruleUid, annotationKeys: Object.keys(annotations) },
          ruleUid
        ));
      }
    }
  } else {
    results.push(result('Alert rules', 'FAIL', `Cannot fetch alert rules: ${rulesRes.error}`, rulesRes.ms, { status: rulesRes.status }));
  }

  // ── 2. Contact points ──
  const cpRes = await client.getContactPoints();
  let contactPoints = [];
  if (cpRes.ok) {
    contactPoints = Array.isArray(cpRes.data) ? cpRes.data : [];
    const types = contactPoints.map(cp => cp.type || 'unknown');
    const typeCounts = {};
    types.forEach(t => { typeCounts[t] = (typeCounts[t] || 0) + 1; });

    results.push(result(
      'Contact points',
      contactPoints.length > 0 ? 'PASS' : 'WARN',
      `${contactPoints.length} contact point(s): ${Object.entries(typeCounts).map(([k, v]) => `${k}(${v})`).join(', ') || 'none'}`,
      cpRes.ms,
      { count: contactPoints.length, typeCounts }
    ));

    // Check each contact point config
    for (const cp of contactPoints) {
      const cpName = cp.name || cp.uid || 'unnamed';
      const issues = [];
      if (cp.type === 'email' && !cp.settings?.addresses) issues.push('no email addresses configured');
      if (cp.type === 'slack' && !cp.settings?.url && !cp.settings?.token) issues.push('no Slack webhook URL or token');
      if (cp.type === 'pagerduty' && !cp.settings?.integrationKey) issues.push('no PagerDuty integration key');
      if (cp.type === 'webhook' && !cp.settings?.url) issues.push('no webhook URL');

      if (issues.length > 0) {
        results.push(result(`[CP] ${cpName}`, 'WARN', `Config issues: ${issues.join('; ')}`, 0, { type: cp.type, issues }));
      } else {
        results.push(result(`[CP] ${cpName}`, 'PASS', `Type: ${cp.type} — config OK`, 0, { type: cp.type }));
      }
    }
  } else {
    results.push(result('Contact points', 'WARN', `Cannot fetch contact points: ${cpRes.error}`, cpRes.ms));
  }

  // ── 3. Notification policies ──
  const npRes = await client.getNotificationPolicies();
  if (npRes.ok) {
    const policy = npRes.data || {};
    const rootReceiver = policy.receiver || null;
    const children = policy.routes || [];

    // Root receiver check
    if (rootReceiver) {
      const receiverExists = contactPoints.some(cp => cp.name === rootReceiver);
      results.push(result(
        'Notification policy — root receiver',
        receiverExists ? 'PASS' : 'WARN',
        `Root receiver: "${rootReceiver}"${receiverExists ? '' : ' — not found in contact points'}`,
        npRes.ms,
        { rootReceiver, exists: receiverExists }
      ));
    } else {
      results.push(result('Notification policy — root receiver', 'FAIL', 'No root receiver configured', npRes.ms));
    }

    // Child matchers
    if (children.length > 0) {
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const childReceiver = child.receiver || child.object_matchers?.receiver || null;
        const matchers = child.matchers || child.object_matchers || child.match || child.match_re || [];
        const hasMatchers = Array.isArray(matchers) ? matchers.length > 0 : !!matchers;

        if (!hasMatchers) {
          results.push(result(
            `Notification policy — child route ${i + 1}`,
            'WARN',
            `Child route to "${childReceiver || 'unknown'}" has no matchers — catches all`,
            0,
            { receiver: childReceiver, index: i }
          ));
        } else {
          results.push(result(
            `Notification policy — child route ${i + 1}`,
            'PASS',
            `Route to "${childReceiver || 'inherited'}" with ${Array.isArray(matchers) ? matchers.length : 1} matcher(s)`,
            0,
            { receiver: childReceiver, matcherCount: Array.isArray(matchers) ? matchers.length : 1, index: i }
          ));
        }
      }
    } else {
      results.push(result('Notification policy — child routes', 'WARN', 'No child routes — all alerts go to root receiver', 0));
    }

    // Orphan receivers: contact points not referenced in any policy
    const usedReceivers = new Set();
    if (rootReceiver) usedReceivers.add(rootReceiver);
    function collectReceivers(routes) {
      if (!Array.isArray(routes)) return;
      for (const r of routes) {
        if (r.receiver) usedReceivers.add(r.receiver);
        if (r.routes) collectReceivers(r.routes);
      }
    }
    collectReceivers(children);

    const cpNames = contactPoints.map(cp => cp.name).filter(Boolean);
    const orphanReceivers = cpNames.filter(n => !usedReceivers.has(n));
    if (orphanReceivers.length > 0) {
      results.push(result(
        'Orphan receivers',
        'WARN',
        `${orphanReceivers.length} contact point(s) not referenced in policies: ${orphanReceivers.join(', ')}`,
        0,
        { orphans: orphanReceivers }
      ));
    } else if (cpNames.length > 0) {
      results.push(result('Orphan receivers', 'PASS', 'All contact points are referenced in notification policies', 0));
    }
  } else {
    results.push(result('Notification policies', 'WARN', `Cannot fetch policies: ${npRes.error}`, npRes.ms));
  }

  // ── 4. Mute timings ──
  const muteRes = await client.getMuteTimings();
  if (muteRes.ok) {
    const mutings = Array.isArray(muteRes.data) ? muteRes.data : [];
    results.push(result(
      'Mute timings',
      'PASS',
      `${mutings.length} mute timing(s) configured`,
      muteRes.ms,
      { count: mutings.length, names: mutings.map(m => m.name) }
    ));
  } else {
    results.push(result('Mute timings', 'WARN', `Cannot fetch mute timings: ${muteRes.error}`, muteRes.ms));
  }

  // ── 5. Silences ──
  const silRes = await client.getSilences();
  if (silRes.ok) {
    const silences = Array.isArray(silRes.data) ? silRes.data : [];
    const active = silences.filter(s => s.status?.state === 'active');
    const expired = silences.filter(s => s.status?.state === 'expired');
    const pending = silences.filter(s => s.status?.state === 'pending');

    results.push(result(
      'Silences',
      active.length > 5 ? 'WARN' : 'PASS',
      `${silences.length} silence(s): ${active.length} active, ${pending.length} pending, ${expired.length} expired${active.length > 5 ? ' — many active silences' : ''}`,
      silRes.ms,
      { total: silences.length, active: active.length, pending: pending.length, expired: expired.length }
    ));

    // Check for long-running silences (>7 days)
    for (const s of active) {
      if (s.startsAt && s.endsAt) {
        const durationMs = new Date(s.endsAt) - new Date(s.startsAt);
        const durationDays = durationMs / (1000 * 60 * 60 * 24);
        if (durationDays > 7) {
          const matchers = (s.matchers || []).map(m => `${m.name}${m.isRegex ? '=~' : '='}${m.value}`).join(', ');
          results.push(result(
            `[Silence] Long-running (${Math.round(durationDays)}d)`,
            'WARN',
            `Silence by "${s.createdBy || 'unknown'}" for ${Math.round(durationDays)} days — matchers: ${matchers || 'none'}`,
            0,
            { id: s.id, durationDays: Math.round(durationDays), createdBy: s.createdBy }
          ));
        }
      }
    }
  } else {
    results.push(result('Silences', 'WARN', `Cannot fetch silences: ${silRes.error}`, silRes.ms));
  }

  // ── 6. Full chain trace: rule -> labels -> policy match -> contact point ──
  if (allRules.length > 0 && contactPoints.length > 0) {
    let chainOk = 0;
    let chainBroken = 0;

    for (const rule of allRules) {
      const ruleTitle = rule.title || rule.alert || rule.name || 'Unnamed';
      const labels = rule.labels || {};
      // Simulate basic policy routing: check if any child route matches the rule labels
      const npData = (await client.getNotificationPolicies()).data || {};
      const routes = npData.routes || [];
      let matched = false;

      for (const route of routes) {
        const matchers = route.matchers || route.object_matchers || [];
        if (!Array.isArray(matchers) || matchers.length === 0) {
          matched = true; // catch-all route
          break;
        }
        const allMatch = matchers.every(m => {
          const labelName = Array.isArray(m) ? m[0] : m.name || m.label;
          const op = Array.isArray(m) ? m[1] : m.type || '=';
          const val = Array.isArray(m) ? m[2] : m.value;
          const labelVal = labels[labelName] || '';
          if (op === '=' || op === '==') return labelVal === val;
          if (op === '!=') return labelVal !== val;
          if (op === '=~') return new RegExp(val).test(labelVal);
          if (op === '!~') return !new RegExp(val).test(labelVal);
          return false;
        });
        if (allMatch) { matched = true; break; }
      }

      // Falls through to root receiver if no match
      const finalReceiver = matched ? 'child route' : (npData.receiver || 'none');
      if (finalReceiver === 'none') {
        chainBroken++;
        results.push(result(
          `[Chain] ${ruleTitle}`,
          'FAIL',
          `Rule has no route to any receiver`,
          0,
          { ruleUid: rule.uid, labels },
          rule.uid
        ));
      } else {
        chainOk++;
      }
    }

    results.push(result(
      'Alert chain integrity',
      chainBroken > 0 ? 'WARN' : 'PASS',
      `${chainOk} rule(s) routable, ${chainBroken} rule(s) with no receiver`,
      0,
      { routable: chainOk, broken: chainBroken }
    ));
  }

  logger.info(`${CAT}: completed ${results.length} checks`, { category: CAT });
  return results;
}

module.exports = { run };
