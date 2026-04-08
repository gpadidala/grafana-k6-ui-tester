module.exports = async function alertTests(client) {
  const results = [];

  // Alert rules
  const rules = await client.getAlertRules();
  if (rules.ok && Array.isArray(rules.data)) {
    results.push({ name: 'Fetch Alert Rules', status: 'PASS', detail: `${rules.data.length} rule(s)`, ms: rules.ms });
    for (const r of rules.data.slice(0, 20)) {
      const issues = [];
      if (!r.condition) issues.push('No condition set');
      if (!r.folderUID) issues.push('No folder assigned');
      results.push({
        name: `Rule: ${r.title}`, status: issues.length ? 'WARN' : 'PASS', uid: r.uid,
        detail: issues.length ? issues.join('; ') : `Group: ${r.ruleGroup}, Folder: ${r.folderUID}`,
      });
    }
  } else {
    // Try legacy endpoint
    const legacy = await client.get('/api/ruler/grafana/api/v1/rules');
    results.push({
      name: 'Fetch Alert Rules', status: legacy.ok ? 'PASS' : 'FAIL',
      detail: legacy.ok ? 'Rules fetched via legacy endpoint' : `Failed: HTTP ${rules.status}`, ms: rules.ms,
    });
  }

  // Contact points
  const cp = await client.getContactPoints();
  if (cp.ok && Array.isArray(cp.data)) {
    results.push({ name: 'Contact Points', status: 'PASS', detail: `${cp.data.length} contact point(s)`, ms: cp.ms });
    if (cp.data.length === 0) {
      results.push({ name: 'Contact Points Config', status: 'WARN', detail: 'No contact points configured — alerts won\'t send notifications' });
    }
    for (const c of cp.data) {
      results.push({
        name: `Contact: ${c.name}`, status: 'PASS', uid: c.uid,
        detail: `Type: ${c.type}, Disable resolve: ${c.disableResolveMessage || false}`,
      });
    }
  } else {
    results.push({ name: 'Contact Points', status: 'FAIL', detail: `HTTP ${cp.status}`, ms: cp.ms });
  }

  // Notification policies
  const np = await client.getNotificationPolicies();
  results.push({
    name: 'Notification Policies', status: np.ok ? 'PASS' : 'FAIL',
    detail: np.ok ? `Policy tree loaded — receiver: ${np.data?.receiver || 'default'}` : `HTTP ${np.status}`, ms: np.ms,
  });

  // Mute timings
  const mt = await client.getMuteTimings();
  if (mt.ok && Array.isArray(mt.data)) {
    results.push({ name: 'Mute Timings', status: 'PASS', detail: `${mt.data.length} mute timing(s)` });
  }

  return results;
};
