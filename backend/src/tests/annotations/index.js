const logger = require('../../utils/logger');

const CAT = 'annotations';

function result(name, status, detail, ms = 0, metadata = {}, uid = null) {
  return { name, status, detail, uid, ms, metadata };
}

async function run(client, _depGraph, _options) {
  const results = [];

  // ── Fetch annotations ──
  const annRes = await client.getAnnotations({ limit: 500 });
  if (!annRes.ok) {
    results.push(result('Annotations fetch', 'FAIL', `Cannot fetch annotations: ${annRes.error}`, annRes.ms));
    return results;
  }

  const annotations = Array.isArray(annRes.data) ? annRes.data : [];

  // ── 1. Volume check ──
  const VOLUME_WARN_THRESHOLD = 200;
  results.push(result(
    'Annotation volume',
    annotations.length >= 500 ? 'WARN' : 'PASS',
    `${annotations.length} annotation(s) returned${annotations.length >= 500 ? ' (limit reached — may be more)' : ''}`,
    annRes.ms,
    { count: annotations.length, limitReached: annotations.length >= 500 }
  ));

  if (annotations.length >= VOLUME_WARN_THRESHOLD) {
    results.push(result(
      'Annotation volume — high',
      'WARN',
      `${annotations.length} annotations is above the recommended threshold of ${VOLUME_WARN_THRESHOLD} — high volume may impact dashboard performance`,
      0,
      { count: annotations.length, threshold: VOLUME_WARN_THRESHOLD }
    ));
  }

  // ── Fetch dashboard list for orphan detection ──
  const dashRes = await client.searchDashboards();
  const dashIdSet = new Set();
  const dashUidSet = new Set();
  if (dashRes.ok && Array.isArray(dashRes.data)) {
    for (const d of dashRes.data) {
      if (d.id) dashIdSet.add(d.id);
      if (d.uid) dashUidSet.add(d.uid);
    }
  }

  // ── 2. Orphan detection (annotations on deleted dashboards) ──
  const orphanAnnotations = [];
  const dashAnnotations = annotations.filter(a => a.dashboardId && a.dashboardId > 0);
  const globalAnnotations = annotations.filter(a => !a.dashboardId || a.dashboardId === 0);

  for (const ann of dashAnnotations) {
    if (!dashIdSet.has(ann.dashboardId)) {
      orphanAnnotations.push(ann);
    }
  }

  if (orphanAnnotations.length > 0) {
    // Group orphans by dashboardId
    const orphanByDash = {};
    for (const o of orphanAnnotations) {
      orphanByDash[o.dashboardId] = (orphanByDash[o.dashboardId] || 0) + 1;
    }
    const orphanDashIds = Object.keys(orphanByDash);

    results.push(result(
      'Orphan annotations',
      'WARN',
      `${orphanAnnotations.length} annotation(s) reference ${orphanDashIds.length} deleted/missing dashboard(s)`,
      0,
      {
        orphanCount: orphanAnnotations.length,
        affectedDashboards: orphanDashIds.length,
        distribution: orphanByDash,
      }
    ));
  } else if (dashAnnotations.length > 0) {
    results.push(result(
      'Orphan annotations',
      'PASS',
      `All ${dashAnnotations.length} dashboard annotation(s) reference existing dashboards`,
      0,
      { dashAnnotationCount: dashAnnotations.length }
    ));
  } else {
    results.push(result(
      'Orphan annotations',
      'PASS',
      `No dashboard-scoped annotations to check`,
      0
    ));
  }

  // Global annotations
  results.push(result(
    'Global annotations',
    'PASS',
    `${globalAnnotations.length} global/organization-scoped annotation(s)`,
    0,
    { globalCount: globalAnnotations.length }
  ));

  // ── 3. Integrity: annotations without text or tags ──
  const noText = annotations.filter(a => !a.text || a.text.trim() === '');
  const noTags = annotations.filter(a => !a.tags || (Array.isArray(a.tags) && a.tags.length === 0));
  const noTextOrTags = annotations.filter(a =>
    (!a.text || a.text.trim() === '') && (!a.tags || (Array.isArray(a.tags) && a.tags.length === 0))
  );

  if (noTextOrTags.length > 0) {
    results.push(result(
      'Annotation integrity — no text or tags',
      'WARN',
      `${noTextOrTags.length} annotation(s) have neither text nor tags — may be noise`,
      0,
      {
        noTextOrTags: noTextOrTags.length,
        sampleIds: noTextOrTags.slice(0, 5).map(a => a.id),
      }
    ));
  } else {
    results.push(result(
      'Annotation integrity — no text or tags',
      'PASS',
      'All annotations have at least text or tags',
      0
    ));
  }

  if (noText.length > 0) {
    results.push(result(
      'Annotation integrity — missing text',
      noText.length > annotations.length * 0.5 ? 'WARN' : 'PASS',
      `${noText.length}/${annotations.length} annotation(s) have no text`,
      0,
      { noTextCount: noText.length, total: annotations.length }
    ));
  }

  if (noTags.length > 0 && noTags.length > annotations.length * 0.5) {
    results.push(result(
      'Annotation integrity — missing tags',
      'WARN',
      `${noTags.length}/${annotations.length} annotation(s) have no tags — consider tagging for filterability`,
      0,
      { noTagsCount: noTags.length, total: annotations.length }
    ));
  }

  // ── 4. Rate analysis ──
  if (annotations.length >= 2) {
    // Sort by time
    const sorted = [...annotations].sort((a, b) => (a.time || a.created || 0) - (b.time || b.created || 0));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const firstTs = first.time || first.created || 0;
    const lastTs = last.time || last.created || 0;

    if (firstTs > 0 && lastTs > 0 && lastTs > firstTs) {
      const spanMs = lastTs - firstTs;
      const spanHours = spanMs / (1000 * 60 * 60);
      const spanDays = spanHours / 24;
      const ratePerDay = spanDays > 0 ? (annotations.length / spanDays) : annotations.length;
      const ratePerHour = spanHours > 0 ? (annotations.length / spanHours) : annotations.length;

      results.push(result(
        'Annotation rate',
        ratePerDay > 100 ? 'WARN' : 'PASS',
        `~${ratePerDay.toFixed(1)} annotations/day (~${ratePerHour.toFixed(1)}/hour) over ${spanDays.toFixed(1)} day(s)${ratePerDay > 100 ? ' — high rate may impact performance' : ''}`,
        0,
        {
          ratePerDay: Math.round(ratePerDay * 10) / 10,
          ratePerHour: Math.round(ratePerHour * 10) / 10,
          spanDays: Math.round(spanDays * 10) / 10,
          totalAnnotations: annotations.length,
        }
      ));

      // Burst detection: check for clusters of >10 annotations within 1 minute
      let burstCount = 0;
      const BURST_WINDOW_MS = 60 * 1000; // 1 min
      const BURST_THRESHOLD = 10;
      for (let i = 0; i < sorted.length; i++) {
        const windowStart = sorted[i].time || sorted[i].created || 0;
        let j = i;
        while (j < sorted.length && ((sorted[j].time || sorted[j].created || 0) - windowStart) <= BURST_WINDOW_MS) {
          j++;
        }
        if (j - i >= BURST_THRESHOLD) {
          burstCount++;
          i = j - 1; // skip past the burst
        }
      }

      if (burstCount > 0) {
        results.push(result(
          'Annotation bursts',
          'WARN',
          `${burstCount} burst(s) detected (${BURST_THRESHOLD}+ annotations within 1 minute) — may indicate runaway alerting or automation`,
          0,
          { burstCount, threshold: BURST_THRESHOLD, windowMs: BURST_WINDOW_MS }
        ));
      }
    }
  }

  // ── 5. Source / type breakdown ──
  const sources = {};
  for (const a of annotations) {
    const source = a.source || (a.alertId ? 'alert' : 'manual');
    sources[source] = (sources[source] || 0) + 1;
  }

  if (Object.keys(sources).length > 0) {
    results.push(result(
      'Annotation sources',
      'PASS',
      `Sources: ${Object.entries(sources).map(([k, v]) => `${k}(${v})`).join(', ')}`,
      0,
      { sources }
    ));
  }

  logger.info(`${CAT}: completed ${results.length} checks on ${annotations.length} annotations`, { category: CAT });
  return results;
}

module.exports = { run };
