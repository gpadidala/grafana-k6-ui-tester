module.exports = async function linkTests(client) {
  const results = [];
  const dashRes = await client.searchDashboards();
  if (!dashRes.ok) { results.push({ name: 'Fetch Dashboards', status: 'FAIL', detail: `HTTP ${dashRes.status}` }); return results; }

  let totalLinks = 0, brokenLinks = 0;

  for (const d of (dashRes.data || []).slice(0, 30)) {
    const detail = await client.getDashboard(d.uid);
    if (!detail.ok) continue;

    const links = detail.data?.dashboard?.links || [];
    for (const link of links) {
      totalLinks++;
      const issues = [];

      if (link.type === 'link' && link.url) {
        // Check if URL is reachable (internal links only)
        if (link.url.startsWith('/') || link.url.includes(client.baseUrl)) {
          const check = await client.get(link.url.replace(client.baseUrl, ''));
          if (!check.ok && check.status !== 302) {
            issues.push(`Broken link: ${link.url} — HTTP ${check.status}`);
            brokenLinks++;
          }
        }
      }

      if (link.type === 'dashboards' && (!link.tags || link.tags.length === 0)) {
        issues.push('Dashboard link has no tags filter — will match all dashboards');
      }

      if (issues.length > 0) {
        results.push({
          name: `Link: ${link.title || link.url || 'untitled'} (${d.title})`, status: 'WARN', uid: d.uid,
          detail: issues.join('; '),
        });
      }
    }
  }

  results.unshift({
    name: 'Dashboard Links', status: brokenLinks > 0 ? 'WARN' : 'PASS',
    detail: `${totalLinks} link(s) found, ${brokenLinks} broken`,
  });

  // Snapshots
  const snap = await client.getSnapshots();
  if (snap.ok && Array.isArray(snap.data)) {
    results.push({ name: 'Snapshots', status: 'PASS', detail: `${snap.data.length} snapshot(s)`, ms: snap.ms });
    const expired = snap.data.filter(s => s.expires && new Date(s.expires) < new Date());
    if (expired.length > 0) {
      results.push({ name: 'Expired Snapshots', status: 'WARN', detail: `${expired.length} expired snapshot(s) — consider cleanup` });
    }
  }

  return results;
};
