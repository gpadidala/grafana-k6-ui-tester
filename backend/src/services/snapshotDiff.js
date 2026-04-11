'use strict';

/**
 * snapshotDiff.js
 *
 * Semantic diff engine for Heimdall's Dashboard Snapshot / Upgrade Drift (DSUD) feature.
 *
 * Pure logic module: no I/O, no DB access. All inputs are plain objects; outputs are
 * plain arrays/objects. Fully unit-testable.
 *
 * Responsibilities:
 *   - Normalize Grafana dashboard JSON (strip volatile fields, stable-sort keys)
 *   - Diff two dashboards and classify each change (type + risk level)
 *   - Diff two snapshots (lists of dashboards) using a loader callback
 */

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const CHANGE_TYPES = {
  SCHEMA_MIGRATION: 'SCHEMA_MIGRATION',
  PANEL_PLUGIN_UPGRADE: 'PANEL_PLUGIN_UPGRADE',
  PANEL_TYPE_CHANGED: 'PANEL_TYPE_CHANGED',
  QUERY_REWRITE: 'QUERY_REWRITE',
  DATASOURCE_REF_CHANGE: 'DATASOURCE_REF_CHANGE',
  DATASOURCE_BROKEN: 'DATASOURCE_BROKEN',
  DEPRECATED_REMOVED: 'DEPRECATED_REMOVED',
  THRESHOLD_CHANGED: 'THRESHOLD_CHANGED',
  FIELD_CONFIG_CHANGED: 'FIELD_CONFIG_CHANGED',
  VARIABLE_CHANGED: 'VARIABLE_CHANGED',
  PANEL_ADDED: 'PANEL_ADDED',
  PANEL_REMOVED: 'PANEL_REMOVED',
  DASHBOARD_ADDED: 'DASHBOARD_ADDED',
  DASHBOARD_REMOVED: 'DASHBOARD_REMOVED',
  ALERT_RULE_ADDED: 'ALERT_RULE_ADDED',
  ALERT_RULE_REMOVED: 'ALERT_RULE_REMOVED',
  ALERT_RULE_CHANGED: 'ALERT_RULE_CHANGED',
  COSMETIC: 'COSMETIC',
  UNKNOWN: 'UNKNOWN',
};

const RISK_LEVELS = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info',
};

// Fields on the dashboard root that churn on every save and must be stripped
// before diffing so we don't drown in noise.
const VOLATILE_DASHBOARD_FIELDS = [
  'id',
  'version',
  'iteration',
  'updated',
  'updatedBy',
  'created',
  'createdBy',
  'meta',
];

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Recursively sort object keys for stable JSON output / comparison.
 * Arrays preserve order (order is semantically meaningful in Grafana for panels, targets, etc.).
 */
function sortKeys(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const out = {};
  for (const k of Object.keys(value).sort()) {
    out[k] = sortKeys(value[k]);
  }
  return out;
}

/**
 * Stable stringify for equality comparison. We deliberately use our own
 * key-sorted stringify rather than depending on fast-json-stable-stringify
 * so the module has zero runtime dependencies.
 */
function stableStringify(value) {
  return JSON.stringify(sortKeys(value));
}

/**
 * Pragmatic deep equality: stable-stringify both sides and compare.
 * Good enough for dashboard JSON which is plain data (no functions, no cycles).
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  return stableStringify(a) === stableStringify(b);
}

/**
 * Collapse runs of whitespace and trim, then compare. Used to demote
 * whitespace-only query edits from HIGH-risk QUERY_REWRITE to COSMETIC.
 */
function isWhitespaceOnlyDiff(a, b) {
  if (a == null || b == null) return false;
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}

/**
 * Find a panel by its stable `id`. Returns null if not found.
 */
function findPanelById(panels, id) {
  if (!Array.isArray(panels)) return null;
  for (const p of panels) {
    if (p && p.id === id) return p;
  }
  return null;
}

/**
 * Deep clone via JSON round-trip. Safe for dashboard JSON.
 */
function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

// --------------------------------------------------------------------------
// normalizeDashboard
// --------------------------------------------------------------------------

/**
 * Return a normalized deep copy of a dashboard suitable for diffing:
 *  - volatile fields stripped
 *  - keys recursively sorted (stable ordering)
 *
 * Returns the normalized object, NOT a string.
 */
function normalizeDashboard(dash) {
  if (!dash || typeof dash !== 'object') return dash;

  // Some callers pass the Grafana API envelope `{ dashboard, meta }` — unwrap it.
  let inner = dash;
  if (dash.dashboard && typeof dash.dashboard === 'object') {
    inner = dash.dashboard;
  }

  const copy = clone(inner);
  for (const f of VOLATILE_DASHBOARD_FIELDS) {
    delete copy[f];
  }
  return sortKeys(copy);
}

// --------------------------------------------------------------------------
// classifyChange
// --------------------------------------------------------------------------

// Pre-compiled regexes for path matching. We key off the path string so the
// diff walker and external callers can share the same classifier.
const PATH_PATTERNS = {
  schemaVersion: /^schemaVersion$/,
  panelType: /^panels\[\d+\]\.type$/,
  panelPluginVersion: /^panels\[\d+\]\.pluginVersion$/,
  panelTargetExpr: /^panels\[\d+\]\.targets\[\d+\]\.expr$/,
  panelDatasourceUid: /^panels\[\d+\]\.datasource(\.uid|\.name)?$/,
  panelThresholds: /^panels\[\d+\]\.fieldConfig\.defaults\.thresholds/,
  panelFieldConfig: /^panels\[\d+\]\.fieldConfig/,
  templating: /^templating\.list/,
  panelCosmetic: /^panels\[\d+\]\.(title|description|color)$/,
  panelInPanels: /^panels\[\d+\]/,
};

/**
 * Classify a single change by path + before/after values.
 * Returns { changeType, riskLevel }.
 *
 * context may contain:
 *   - liveDatasources: array or Set of datasource uids that currently exist
 *   - panelHasData: boolean, whether the affected panel actually rendered data
 */
function classifyChange(path, before, after, context = {}) {
  const ctx = context || {};

  // Schema migration
  if (PATH_PATTERNS.schemaVersion.test(path)) {
    return { changeType: CHANGE_TYPES.SCHEMA_MIGRATION, riskLevel: RISK_LEVELS.INFO };
  }

  // Panel type swap (e.g. graph -> timeseries). High risk: options/fieldConfig
  // are keyed to the old type and may silently lose settings.
  if (PATH_PATTERNS.panelType.test(path)) {
    return { changeType: CHANGE_TYPES.PANEL_TYPE_CHANGED, riskLevel: RISK_LEVELS.HIGH };
  }

  // Panel plugin version bump
  if (PATH_PATTERNS.panelPluginVersion.test(path)) {
    return { changeType: CHANGE_TYPES.PANEL_PLUGIN_UPGRADE, riskLevel: RISK_LEVELS.MEDIUM };
  }

  // Query rewrite — demote whitespace-only edits to COSMETIC/info
  if (PATH_PATTERNS.panelTargetExpr.test(path)) {
    if (isWhitespaceOnlyDiff(before, after)) {
      return { changeType: CHANGE_TYPES.COSMETIC, riskLevel: RISK_LEVELS.INFO };
    }
    return { changeType: CHANGE_TYPES.QUERY_REWRITE, riskLevel: RISK_LEVELS.HIGH };
  }

  // Datasource reference change — potentially broken
  if (PATH_PATTERNS.panelDatasourceUid.test(path)) {
    const liveDs = ctx.liveDatasources;
    if (liveDs && after !== undefined && after !== null) {
      const afterUid = typeof after === 'object' ? after.uid : after;
      const known = Array.isArray(liveDs)
        ? liveDs.some((d) => (typeof d === 'object' ? d.uid === afterUid : d === afterUid))
        : liveDs instanceof Set
          ? liveDs.has(afterUid)
          : false;
      if (afterUid && !known) {
        return { changeType: CHANGE_TYPES.DATASOURCE_BROKEN, riskLevel: RISK_LEVELS.CRITICAL };
      }
    }
    return { changeType: CHANGE_TYPES.DATASOURCE_REF_CHANGE, riskLevel: RISK_LEVELS.HIGH };
  }

  // Thresholds — check BEFORE generic fieldConfig
  if (PATH_PATTERNS.panelThresholds.test(path)) {
    return { changeType: CHANGE_TYPES.THRESHOLD_CHANGED, riskLevel: RISK_LEVELS.MEDIUM };
  }

  // Other fieldConfig changes
  if (PATH_PATTERNS.panelFieldConfig.test(path)) {
    return { changeType: CHANGE_TYPES.FIELD_CONFIG_CHANGED, riskLevel: RISK_LEVELS.MEDIUM };
  }

  // Template variables
  if (PATH_PATTERNS.templating.test(path)) {
    return { changeType: CHANGE_TYPES.VARIABLE_CHANGED, riskLevel: RISK_LEVELS.LOW };
  }

  // Cosmetic panel fields
  if (PATH_PATTERNS.panelCosmetic.test(path)) {
    return { changeType: CHANGE_TYPES.COSMETIC, riskLevel: RISK_LEVELS.INFO };
  }

  // Field removed entirely
  if (before !== undefined && after === undefined) {
    const inPanels = PATH_PATTERNS.panelInPanels.test(path);
    return {
      changeType: CHANGE_TYPES.DEPRECATED_REMOVED,
      riskLevel: inPanels ? RISK_LEVELS.HIGH : RISK_LEVELS.MEDIUM,
    };
  }

  // Default: unknown, flag for review
  return { changeType: CHANGE_TYPES.UNKNOWN, riskLevel: RISK_LEVELS.MEDIUM };
}

// --------------------------------------------------------------------------
// diffDashboards
// --------------------------------------------------------------------------

/**
 * Build a change item with dashboard/panel context attached.
 */
function makeItem(partial, ctx) {
  return Object.assign(
    {
      path: partial.path,
      changeType: partial.changeType,
      riskLevel: partial.riskLevel,
      before: partial.before,
      after: partial.after,
      panelId: partial.panelId !== undefined ? partial.panelId : null,
      panelTitle: partial.panelTitle || null,
      dashboardUid: (ctx && ctx.dashboardUid) || null,
      dashboardTitle: (ctx && ctx.dashboardTitle) || null,
    },
    partial.extra || {}
  );
}

/**
 * Compare simple dashboard-level metadata fields and push items for each change.
 */
function diffDashboardMeta(before, after, items, ctx) {
  // schemaVersion — tag explicitly as SCHEMA_MIGRATION
  if (!deepEqual(before.schemaVersion, after.schemaVersion)) {
    items.push(
      makeItem(
        {
          path: 'schemaVersion',
          changeType: CHANGE_TYPES.SCHEMA_MIGRATION,
          riskLevel: RISK_LEVELS.INFO,
          before: before.schemaVersion,
          after: after.schemaVersion,
        },
        ctx
      )
    );
  }

  // title / tags / refresh / timezone / time — cosmetic / low-risk metadata
  const cosmeticFields = ['title', 'tags', 'refresh', 'timezone', 'links'];
  for (const f of cosmeticFields) {
    if (!deepEqual(before[f], after[f])) {
      items.push(
        makeItem(
          {
            path: f,
            changeType: CHANGE_TYPES.COSMETIC,
            riskLevel: RISK_LEVELS.INFO,
            before: before[f],
            after: after[f],
          },
          ctx
        )
      );
    }
  }

  // time defaults — treat as info too
  if (!deepEqual(before.time, after.time)) {
    items.push(
      makeItem(
        {
          path: 'time',
          changeType: CHANGE_TYPES.COSMETIC,
          riskLevel: RISK_LEVELS.INFO,
          before: before.time,
          after: after.time,
        },
        ctx
      )
    );
  }
}

/**
 * Compare templating.list by variable name.
 */
function diffTemplating(before, after, items, ctx) {
  const beforeList = (before.templating && before.templating.list) || [];
  const afterList = (after.templating && after.templating.list) || [];

  const byName = (list) => {
    const m = new Map();
    for (const v of list) {
      if (v && v.name) m.set(v.name, v);
    }
    return m;
  };
  const bMap = byName(beforeList);
  const aMap = byName(afterList);

  // removed
  for (const [name, v] of bMap) {
    if (!aMap.has(name)) {
      items.push(
        makeItem(
          {
            path: `templating.list[${name}]`,
            changeType: CHANGE_TYPES.VARIABLE_CHANGED,
            riskLevel: RISK_LEVELS.LOW,
            before: v,
            after: undefined,
          },
          ctx
        )
      );
    }
  }
  // added or modified
  for (const [name, v] of aMap) {
    const prev = bMap.get(name);
    if (!prev) {
      items.push(
        makeItem(
          {
            path: `templating.list[${name}]`,
            changeType: CHANGE_TYPES.VARIABLE_CHANGED,
            riskLevel: RISK_LEVELS.LOW,
            before: undefined,
            after: v,
          },
          ctx
        )
      );
    } else if (!deepEqual(prev, v)) {
      items.push(
        makeItem(
          {
            path: `templating.list[${name}]`,
            changeType: CHANGE_TYPES.VARIABLE_CHANGED,
            riskLevel: RISK_LEVELS.LOW,
            before: prev,
            after: v,
          },
          ctx
        )
      );
    }
  }
}

/**
 * Compare annotations.list by name.
 */
function diffAnnotations(before, after, items, ctx) {
  const beforeList = (before.annotations && before.annotations.list) || [];
  const afterList = (after.annotations && after.annotations.list) || [];
  if (deepEqual(beforeList, afterList)) return;

  const byName = (list) => {
    const m = new Map();
    for (const a of list) {
      if (a && a.name) m.set(a.name, a);
    }
    return m;
  };
  const bMap = byName(beforeList);
  const aMap = byName(afterList);

  for (const [name, v] of bMap) {
    if (!aMap.has(name)) {
      items.push(
        makeItem(
          {
            path: `annotations.list[${name}]`,
            changeType: CHANGE_TYPES.DEPRECATED_REMOVED,
            riskLevel: RISK_LEVELS.MEDIUM,
            before: v,
            after: undefined,
          },
          ctx
        )
      );
    }
  }
  for (const [name, v] of aMap) {
    const prev = bMap.get(name);
    if (!prev) {
      items.push(
        makeItem(
          {
            path: `annotations.list[${name}]`,
            changeType: CHANGE_TYPES.COSMETIC,
            riskLevel: RISK_LEVELS.INFO,
            before: undefined,
            after: v,
          },
          ctx
        )
      );
    } else if (!deepEqual(prev, v)) {
      items.push(
        makeItem(
          {
            path: `annotations.list[${name}]`,
            changeType: CHANGE_TYPES.COSMETIC,
            riskLevel: RISK_LEVELS.INFO,
            before: prev,
            after: v,
          },
          ctx
        )
      );
    }
  }
}

/**
 * Compare a specific scalar/object field on a panel pair and push an item if different.
 * Uses classifyChange() so the rules live in one place.
 */
function compareField(panelIdx, panelId, panelTitle, field, beforeVal, afterVal, items, ctx, classifyCtx) {
  if (deepEqual(beforeVal, afterVal)) return;
  const path = `panels[${panelIdx}].${field}`;
  const { changeType, riskLevel } = classifyChange(path, beforeVal, afterVal, classifyCtx);
  items.push(
    makeItem(
      {
        path,
        changeType,
        riskLevel,
        before: beforeVal,
        after: afterVal,
        panelId,
        panelTitle,
      },
      ctx
    )
  );
}

/**
 * Compare targets[] of two panels. Aligned by refId if present, else by index.
 */
function diffPanelTargets(panelIdx, panelId, panelTitle, beforeTargets, afterTargets, items, ctx, classifyCtx) {
  const bList = Array.isArray(beforeTargets) ? beforeTargets : [];
  const aList = Array.isArray(afterTargets) ? afterTargets : [];
  const max = Math.max(bList.length, aList.length);

  // Prefer refId-based alignment when both sides have refIds
  const useRefId =
    bList.every((t) => t && t.refId) && aList.every((t) => t && t.refId);

  const pairs = [];
  if (useRefId) {
    const bMap = new Map(bList.map((t) => [t.refId, t]));
    const aMap = new Map(aList.map((t) => [t.refId, t]));
    const allRefs = new Set([...bMap.keys(), ...aMap.keys()]);
    let idx = 0;
    for (const ref of allRefs) {
      pairs.push({ idx: idx++, refId: ref, b: bMap.get(ref), a: aMap.get(ref) });
    }
  } else {
    for (let i = 0; i < max; i++) {
      pairs.push({ idx: i, b: bList[i], a: aList[i] });
    }
  }

  for (const { idx, b, a } of pairs) {
    if (deepEqual(b, a)) continue;

    // expr change → QUERY_REWRITE (or COSMETIC if whitespace-only)
    const bExpr = b && b.expr;
    const aExpr = a && a.expr;
    if (!deepEqual(bExpr, aExpr)) {
      const path = `panels[${panelIdx}].targets[${idx}].expr`;
      const { changeType, riskLevel } = classifyChange(path, bExpr, aExpr, classifyCtx);
      items.push(
        makeItem(
          {
            path,
            changeType,
            riskLevel,
            before: bExpr,
            after: aExpr,
            panelId,
            panelTitle,
          },
          ctx
        )
      );
    }

    // datasource-on-target change
    const bDs = b && b.datasource;
    const aDs = a && a.datasource;
    if (!deepEqual(bDs, aDs)) {
      const path = `panels[${panelIdx}].targets[${idx}].datasource`;
      const { changeType, riskLevel } = classifyChange(
        `panels[${panelIdx}].datasource`,
        bDs,
        aDs,
        classifyCtx
      );
      items.push(
        makeItem(
          {
            path,
            changeType,
            riskLevel,
            before: bDs,
            after: aDs,
            panelId,
            panelTitle,
          },
          ctx
        )
      );
    }

    // Target added / removed entirely
    if (b === undefined && a !== undefined) {
      items.push(
        makeItem(
          {
            path: `panels[${panelIdx}].targets[${idx}]`,
            changeType: CHANGE_TYPES.QUERY_REWRITE,
            riskLevel: RISK_LEVELS.MEDIUM,
            before: undefined,
            after: a,
            panelId,
            panelTitle,
          },
          ctx
        )
      );
    } else if (a === undefined && b !== undefined) {
      items.push(
        makeItem(
          {
            path: `panels[${panelIdx}].targets[${idx}]`,
            changeType: CHANGE_TYPES.DEPRECATED_REMOVED,
            riskLevel: RISK_LEVELS.HIGH,
            before: b,
            after: undefined,
            panelId,
            panelTitle,
          },
          ctx
        )
      );
    }
  }
}

/**
 * Deep compare two panels across the interesting fields.
 */
function diffPanelPair(panelIdx, beforePanel, afterPanel, items, ctx, classifyCtx) {
  const panelId = afterPanel.id != null ? afterPanel.id : beforePanel.id;
  const panelTitle = afterPanel.title || beforePanel.title || null;

  // Simple fields
  const simpleFields = ['type', 'pluginVersion', 'title', 'description', 'datasource'];
  for (const f of simpleFields) {
    compareField(panelIdx, panelId, panelTitle, f, beforePanel[f], afterPanel[f], items, ctx, classifyCtx);
  }

  // targets — specialized walker
  diffPanelTargets(
    panelIdx,
    panelId,
    panelTitle,
    beforePanel.targets,
    afterPanel.targets,
    items,
    ctx,
    classifyCtx
  );

  // fieldConfig.defaults.thresholds — checked before generic fieldConfig
  const bThresh = beforePanel.fieldConfig && beforePanel.fieldConfig.defaults && beforePanel.fieldConfig.defaults.thresholds;
  const aThresh = afterPanel.fieldConfig && afterPanel.fieldConfig.defaults && afterPanel.fieldConfig.defaults.thresholds;
  if (!deepEqual(bThresh, aThresh)) {
    items.push(
      makeItem(
        {
          path: `panels[${panelIdx}].fieldConfig.defaults.thresholds`,
          changeType: CHANGE_TYPES.THRESHOLD_CHANGED,
          riskLevel: RISK_LEVELS.MEDIUM,
          before: bThresh,
          after: aThresh,
          panelId,
          panelTitle,
        },
        ctx
      )
    );
  }

  // Other fieldConfig changes — compare the rest of fieldConfig with thresholds scrubbed
  const scrubThresholds = (fc) => {
    if (!fc) return fc;
    const c = clone(fc);
    if (c.defaults && c.defaults.thresholds) delete c.defaults.thresholds;
    return c;
  };
  const bFC = scrubThresholds(beforePanel.fieldConfig);
  const aFC = scrubThresholds(afterPanel.fieldConfig);
  if (!deepEqual(bFC, aFC)) {
    items.push(
      makeItem(
        {
          path: `panels[${panelIdx}].fieldConfig`,
          changeType: CHANGE_TYPES.FIELD_CONFIG_CHANGED,
          riskLevel: RISK_LEVELS.MEDIUM,
          before: bFC,
          after: aFC,
          panelId,
          panelTitle,
        },
        ctx
      )
    );
  }

  // options — generic nested object. Report as FIELD_CONFIG_CHANGED if different.
  if (!deepEqual(beforePanel.options, afterPanel.options)) {
    items.push(
      makeItem(
        {
          path: `panels[${panelIdx}].options`,
          changeType: CHANGE_TYPES.FIELD_CONFIG_CHANGED,
          riskLevel: RISK_LEVELS.MEDIUM,
          before: beforePanel.options,
          after: afterPanel.options,
          panelId,
          panelTitle,
        },
        ctx
      )
    );
  }
}

/**
 * Diff two dashboards. Returns an array of change items.
 *
 * @param {Object} before  Dashboard JSON (will be normalized internally)
 * @param {Object} after   Dashboard JSON (will be normalized internally)
 * @param {Object} context {
 *   grafanaVersionFrom, grafanaVersionTo,
 *   dashboardUid, dashboardTitle,
 *   liveDatasources   // optional: used by classifyChange to flag broken refs
 * }
 */
function diffDashboards(before, after, context = {}) {
  const items = [];
  if (!before && !after) return items;

  const b = normalizeDashboard(before) || {};
  const a = normalizeDashboard(after) || {};

  const ctx = {
    dashboardUid: (context && context.dashboardUid) || a.uid || b.uid || null,
    dashboardTitle: (context && context.dashboardTitle) || a.title || b.title || null,
  };
  const classifyCtx = {
    liveDatasources: context && context.liveDatasources,
    grafanaVersionFrom: context && context.grafanaVersionFrom,
    grafanaVersionTo: context && context.grafanaVersionTo,
  };

  // 1. Dashboard-level metadata (incl. schemaVersion)
  diffDashboardMeta(b, a, items, ctx);

  // 2. Template variables
  diffTemplating(b, a, items, ctx);

  // 3. Annotations
  diffAnnotations(b, a, items, ctx);

  // 4. Panels — match by id, fall back to index if id is missing
  const bPanels = Array.isArray(b.panels) ? b.panels : [];
  const aPanels = Array.isArray(a.panels) ? a.panels : [];

  const bHasIds = bPanels.every((p) => p && p.id != null);
  const aHasIds = aPanels.every((p) => p && p.id != null);

  const seenBefore = new Set();

  if (bHasIds && aHasIds) {
    // id-based alignment
    for (let i = 0; i < aPanels.length; i++) {
      const ap = aPanels[i];
      const bp = findPanelById(bPanels, ap.id);
      if (!bp) {
        items.push(
          makeItem(
            {
              path: `panels[${i}]`,
              changeType: CHANGE_TYPES.PANEL_ADDED,
              riskLevel: RISK_LEVELS.LOW,
              before: undefined,
              after: ap,
              panelId: ap.id,
              panelTitle: ap.title || null,
            },
            ctx
          )
        );
      } else {
        seenBefore.add(ap.id);
        diffPanelPair(i, bp, ap, items, ctx, classifyCtx);
      }
    }
    // Panels that existed before but are gone now
    for (let i = 0; i < bPanels.length; i++) {
      const bp = bPanels[i];
      if (!seenBefore.has(bp.id)) {
        items.push(
          makeItem(
            {
              path: `panels[${i}]`,
              changeType: CHANGE_TYPES.PANEL_REMOVED,
              riskLevel: RISK_LEVELS.CRITICAL,
              before: bp,
              after: undefined,
              panelId: bp.id,
              panelTitle: bp.title || null,
            },
            ctx
          )
        );
      }
    }
  } else {
    // positional fallback
    const max = Math.max(bPanels.length, aPanels.length);
    for (let i = 0; i < max; i++) {
      const bp = bPanels[i];
      const ap = aPanels[i];
      if (bp && !ap) {
        items.push(
          makeItem(
            {
              path: `panels[${i}]`,
              changeType: CHANGE_TYPES.PANEL_REMOVED,
              riskLevel: RISK_LEVELS.CRITICAL,
              before: bp,
              after: undefined,
              panelId: bp.id != null ? bp.id : null,
              panelTitle: bp.title || null,
            },
            ctx
          )
        );
      } else if (!bp && ap) {
        items.push(
          makeItem(
            {
              path: `panels[${i}]`,
              changeType: CHANGE_TYPES.PANEL_ADDED,
              riskLevel: RISK_LEVELS.LOW,
              before: undefined,
              after: ap,
              panelId: ap.id != null ? ap.id : null,
              panelTitle: ap.title || null,
            },
            ctx
          )
        );
      } else if (bp && ap) {
        diffPanelPair(i, bp, ap, items, ctx, classifyCtx);
      }
    }
  }

  return items;
}

// --------------------------------------------------------------------------
// diffSnapshots
// --------------------------------------------------------------------------

/**
 * Summarize an array of change items by risk level.
 */
function summarize(items, dashboardsChanged) {
  const summary = {
    total: items.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    dashboardsChanged,
  };
  for (const it of items) {
    switch (it.riskLevel) {
      case RISK_LEVELS.CRITICAL: summary.critical++; break;
      case RISK_LEVELS.HIGH: summary.high++; break;
      case RISK_LEVELS.MEDIUM: summary.medium++; break;
      case RISK_LEVELS.LOW: summary.low++; break;
      case RISK_LEVELS.INFO: summary.info++; break;
      default: break;
    }
  }
  return summary;
}

/**
 * Diff two snapshots. Loads only dashboards whose fingerprints differ.
 *
 * @param {Object}   baselineSnap { id, storage_path?, dashboards: [{ dashboard_uid, title, fingerprint }] }
 * @param {Object}   currentSnap  same shape as baseline
 * @param {Function} loadDashboardFn async (snapshotStoragePath, uid) => dashboard JSON
 * @param {Object}   opts         { onProgress, liveDatasources }
 */
async function diffSnapshots(baselineSnap, currentSnap, loadDashboardFn, opts = {}) {
  const onProgress = (opts && opts.onProgress) || (() => {});
  const liveDatasources = opts && opts.liveDatasources;

  const baseDashboards = (baselineSnap && baselineSnap.dashboards) || [];
  const currDashboards = (currentSnap && currentSnap.dashboards) || [];

  const baseByUid = new Map();
  for (const d of baseDashboards) {
    if (d && d.dashboard_uid) baseByUid.set(d.dashboard_uid, d);
  }
  const currByUid = new Map();
  for (const d of currDashboards) {
    if (d && d.dashboard_uid) currByUid.set(d.dashboard_uid, d);
  }

  // Pre-compute the list of dashboards we need to actually compare (for progress totals).
  // Baseline-only → DASHBOARD_REMOVED; current-only → DASHBOARD_ADDED; both w/ differing
  // fingerprints → deep compare.
  const toProcess = [];
  for (const [uid, bd] of baseByUid) {
    const cd = currByUid.get(uid);
    if (!cd) {
      toProcess.push({ kind: 'removed', uid, bd });
    } else if (bd.fingerprint && cd.fingerprint && bd.fingerprint === cd.fingerprint) {
      // Unchanged — skip
    } else {
      toProcess.push({ kind: 'changed', uid, bd, cd });
    }
  }
  for (const [uid, cd] of currByUid) {
    if (!baseByUid.has(uid)) {
      toProcess.push({ kind: 'added', uid, cd });
    }
  }

  const total = toProcess.length;
  let completed = 0;
  const items = [];
  let dashboardsChanged = 0;

  const baseStorage = baselineSnap && baselineSnap.storage_path;
  const currStorage = currentSnap && currentSnap.storage_path;

  for (const job of toProcess) {
    const title = (job.cd && job.cd.title) || (job.bd && job.bd.title) || job.uid;
    onProgress({ stage: 'diffing', total, completed, current: title });

    if (job.kind === 'removed') {
      // Load the baseline dashboard so we can enumerate its panels as PANEL_REMOVED.
      let beforeDash = null;
      try {
        beforeDash = await loadDashboardFn(baseStorage, job.uid);
      } catch (_) {
        beforeDash = null;
      }
      items.push({
        path: '',
        changeType: CHANGE_TYPES.DASHBOARD_REMOVED,
        riskLevel: RISK_LEVELS.CRITICAL,
        before: beforeDash,
        after: undefined,
        panelId: null,
        panelTitle: null,
        dashboardUid: job.uid,
        dashboardTitle: title,
      });
      // Also emit panel-level removals so downstream rendering can show them.
      const diff = diffDashboards(beforeDash, {}, {
        dashboardUid: job.uid,
        dashboardTitle: title,
        liveDatasources,
      });
      for (const it of diff) items.push(it);
      dashboardsChanged++;
    } else if (job.kind === 'added') {
      let afterDash = null;
      try {
        afterDash = await loadDashboardFn(currStorage, job.uid);
      } catch (_) {
        afterDash = null;
      }
      items.push({
        path: '',
        changeType: CHANGE_TYPES.DASHBOARD_ADDED,
        riskLevel: RISK_LEVELS.LOW,
        before: undefined,
        after: afterDash,
        panelId: null,
        panelTitle: null,
        dashboardUid: job.uid,
        dashboardTitle: title,
      });
      dashboardsChanged++;
    } else {
      // changed
      let beforeDash = null;
      let afterDash = null;
      try {
        beforeDash = await loadDashboardFn(baseStorage, job.uid);
      } catch (_) {
        beforeDash = null;
      }
      try {
        afterDash = await loadDashboardFn(currStorage, job.uid);
      } catch (_) {
        afterDash = null;
      }
      const diff = diffDashboards(beforeDash, afterDash, {
        dashboardUid: job.uid,
        dashboardTitle: title,
        liveDatasources,
      });
      if (diff.length > 0) dashboardsChanged++;
      for (const it of diff) items.push(it);
    }

    completed++;
    onProgress({ stage: 'diffing', total, completed, current: title });
  }

  // ── Alert rule diff (fingerprint-based) ──
  // Compares alert rules by uid. Removal is HIGH risk (someone deleted
  // monitoring). Addition is LOW (new coverage). Change is MEDIUM — we
  // don't deep-diff the rule body here, just flag the uid as changed.
  const baseAlerts = (baselineSnap && baselineSnap.alerts) || [];
  const currAlerts = (currentSnap && currentSnap.alerts) || [];
  const baseAlertByUid = new Map();
  for (const a of baseAlerts) {
    if (a && a.rule_uid) baseAlertByUid.set(a.rule_uid, a);
  }
  const currAlertByUid = new Map();
  for (const a of currAlerts) {
    if (a && a.rule_uid) currAlertByUid.set(a.rule_uid, a);
  }

  for (const [uid, ba] of baseAlertByUid) {
    const ca = currAlertByUid.get(uid);
    if (!ca) {
      items.push({
        path: `alert:${uid}`,
        changeType: CHANGE_TYPES.ALERT_RULE_REMOVED,
        riskLevel: RISK_LEVELS.HIGH,
        before: { uid, title: ba.title, fingerprint: ba.fingerprint },
        after: undefined,
        panelId: null,
        panelTitle: null,
        dashboardUid: uid,
        dashboardTitle: `Alert: ${ba.title || uid}`,
      });
    } else if (ba.fingerprint !== ca.fingerprint) {
      items.push({
        path: `alert:${uid}`,
        changeType: CHANGE_TYPES.ALERT_RULE_CHANGED,
        riskLevel: RISK_LEVELS.MEDIUM,
        before: { uid, title: ba.title, fingerprint: ba.fingerprint, for: ba.for_duration, noDataState: ba.no_data_state, execErrState: ba.exec_err_state },
        after: { uid, title: ca.title, fingerprint: ca.fingerprint, for: ca.for_duration, noDataState: ca.no_data_state, execErrState: ca.exec_err_state },
        panelId: null,
        panelTitle: null,
        dashboardUid: uid,
        dashboardTitle: `Alert: ${ca.title || uid}`,
      });
    }
    // Unchanged → skip
  }
  for (const [uid, ca] of currAlertByUid) {
    if (!baseAlertByUid.has(uid)) {
      items.push({
        path: `alert:${uid}`,
        changeType: CHANGE_TYPES.ALERT_RULE_ADDED,
        riskLevel: RISK_LEVELS.LOW,
        before: undefined,
        after: { uid, title: ca.title, fingerprint: ca.fingerprint },
        panelId: null,
        panelTitle: null,
        dashboardUid: uid,
        dashboardTitle: `Alert: ${ca.title || uid}`,
      });
    }
  }

  return {
    items,
    summary: summarize(items, dashboardsChanged),
  };
}

// --------------------------------------------------------------------------
// Exports
// --------------------------------------------------------------------------

module.exports = {
  normalizeDashboard,
  diffDashboards,
  diffSnapshots,
  classifyChange,
  // Helpers exposed for unit tests
  deepEqual,
  isWhitespaceOnlyDiff,
  findPanelById,
  sortKeys,
  stableStringify,
  CHANGE_TYPES,
  RISK_LEVELS,
};
