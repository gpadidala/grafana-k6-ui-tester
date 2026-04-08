module.exports = async function annotationTests(client) {
  const results = [];

  const res = await client.getAnnotations(200);
  if (!res.ok) {
    results.push({ name: 'Fetch Annotations', status: res.status === 403 ? 'PASS' : 'FAIL', detail: `HTTP ${res.status}`, ms: res.ms });
    return results;
  }

  const annotations = Array.isArray(res.data) ? res.data : [];
  results.push({ name: 'Fetch Annotations', status: 'PASS', detail: `${annotations.length} annotation(s) (last 200)`, ms: res.ms });

  // Volume check
  if (annotations.length >= 200) {
    results.push({ name: 'Annotation Volume', status: 'WARN', detail: 'High annotation volume — consider archiving old annotations' });
  }

  // Orphan detection — annotations on dashboards that no longer exist
  const dashRes = await client.searchDashboards();
  if (dashRes.ok && Array.isArray(dashRes.data)) {
    const dashIds = new Set(dashRes.data.map(d => d.id));
    const orphans = annotations.filter(a => a.dashboardId && a.dashboardId > 0 && !dashIds.has(a.dashboardId));
    results.push({
      name: 'Orphan Annotations', status: orphans.length > 0 ? 'WARN' : 'PASS',
      detail: orphans.length > 0 ? `${orphans.length} annotation(s) on deleted dashboards` : 'No orphan annotations',
    });
  }

  // Integrity — check for annotations with missing fields
  const invalid = annotations.filter(a => !a.text && !a.tags?.length);
  if (invalid.length > 0) {
    results.push({ name: 'Annotation Integrity', status: 'WARN', detail: `${invalid.length} annotation(s) with no text or tags` });
  } else {
    results.push({ name: 'Annotation Integrity', status: 'PASS', detail: 'All annotations have text or tags' });
  }

  return results;
};
