'use strict';

/**
 * Shared datasource-scoping helper.
 *
 * When a test run is scoped to a specific datasource (e.g. "I just upgraded
 * node-exporter — test only the dashboards and alerts that use this DS"),
 * runners call these helpers in their per-resource loops to skip anything
 * that doesn't reference the target DS.
 *
 * Matching is lenient: the target may be specified by `uid`, by `name`, or
 * both. We compare case-insensitively and accept either side matching.
 */

/**
 * Normalize a user-supplied filter into { uid, name } (both lowercased).
 * Returns null if no filter is set → runners should treat this as "no filter
 * → include everything".
 */
function normalizeFilter(filter) {
  if (!filter || typeof filter !== 'object') return null;
  const uid = (filter.uid || '').trim().toLowerCase();
  const name = (filter.name || '').trim().toLowerCase();
  if (!uid && !name) return null;
  return { uid, name };
}

/**
 * Extract every datasource reference from a dashboard's panels.
 * Looks at both panel.datasource and panel.targets[].datasource.
 * Returns a Set of lowercase identifiers (both uids and names).
 */
function collectDashboardDsRefs(dashboard) {
  const refs = new Set();
  if (!dashboard) return refs;
  const panels = flattenPanels(dashboard.panels || []);
  for (const p of panels) {
    if (p.datasource) {
      if (typeof p.datasource === 'string') {
        refs.add(p.datasource.toLowerCase());
      } else {
        if (p.datasource.uid) refs.add(String(p.datasource.uid).toLowerCase());
        if (p.datasource.type) refs.add(String(p.datasource.type).toLowerCase());
      }
    }
    if (Array.isArray(p.targets)) {
      for (const t of p.targets) {
        if (!t.datasource) continue;
        if (typeof t.datasource === 'string') {
          refs.add(t.datasource.toLowerCase());
        } else {
          if (t.datasource.uid) refs.add(String(t.datasource.uid).toLowerCase());
          if (t.datasource.type) refs.add(String(t.datasource.type).toLowerCase());
        }
      }
    }
  }
  // Template variables can also reference datasources
  const vars = (dashboard.templating && dashboard.templating.list) || [];
  for (const v of vars) {
    if (!v.datasource) continue;
    if (typeof v.datasource === 'string') refs.add(v.datasource.toLowerCase());
    else if (v.datasource.uid) refs.add(String(v.datasource.uid).toLowerCase());
  }
  return refs;
}

function flattenPanels(panels) {
  const out = [];
  if (!Array.isArray(panels)) return out;
  for (const p of panels) {
    if (p.type === 'row' && Array.isArray(p.panels)) out.push(...p.panels);
    else out.push(p);
  }
  return out;
}

/**
 * Does the given dashboard (already-loaded full JSON) reference the filter?
 * Returns true when no filter is set (pass-through mode).
 */
function dashboardUsesDatasource(dashboard, filter) {
  const norm = normalizeFilter(filter);
  if (!norm) return true;
  const refs = collectDashboardDsRefs(dashboard);
  return (norm.uid && refs.has(norm.uid)) || (norm.name && refs.has(norm.name));
}

/**
 * Does a Grafana alert rule reference the filter?
 * Grafana alert rules have a `data[]` array where each entry has
 * `datasourceUid`. We also fall back to checking inside `model` for the
 * older schema.
 */
function alertRuleUsesDatasource(rule, filter) {
  const norm = normalizeFilter(filter);
  if (!norm) return true;
  if (!rule) return false;

  const data = rule.data || rule.conditions || [];
  for (const q of data) {
    const dsUid = (q.datasourceUid || q.datasource_uid || '').toLowerCase();
    if (dsUid && norm.uid && dsUid === norm.uid) return true;
    // Some schemas nest the ref inside model.datasource
    const model = q.model || {};
    const modelUid = (model.datasource && (model.datasource.uid || model.datasource)) || '';
    if (modelUid && norm.uid && String(modelUid).toLowerCase() === norm.uid) return true;
    if (q.datasourceUid && norm.name && String(q.datasourceUid).toLowerCase() === norm.name) return true;
  }
  return false;
}

/**
 * Match a datasource record (from /api/datasources) against the filter.
 */
function datasourceMatches(ds, filter) {
  const norm = normalizeFilter(filter);
  if (!norm) return true;
  if (!ds) return false;
  const uid = String(ds.uid || '').toLowerCase();
  const name = String(ds.name || '').toLowerCase();
  return (norm.uid && uid === norm.uid) || (norm.name && name === norm.name);
}

/**
 * Convenience: return a filtered list of dashboards (from a search result)
 * by fetching each one and keeping only those that reference the filter.
 * Runners that already fetch the dashboard body should use
 * dashboardUsesDatasource directly instead — this is for runners that only
 * operate on the search hit metadata.
 *
 * `loadFullDash` should be an async function (uid) => full dashboard JSON
 */
async function filterDashboardsByDatasource(searchHits, filter, loadFullDash) {
  const norm = normalizeFilter(filter);
  if (!norm) return searchHits;
  const kept = [];
  for (const hit of searchHits) {
    if (!hit.uid) continue;
    try {
      const dash = await loadFullDash(hit.uid);
      if (dashboardUsesDatasource(dash, filter)) kept.push(hit);
    } catch {
      /* skip on error */
    }
  }
  return kept;
}

module.exports = {
  normalizeFilter,
  collectDashboardDsRefs,
  dashboardUsesDatasource,
  alertRuleUsesDatasource,
  datasourceMatches,
  filterDashboardsByDatasource,
};
