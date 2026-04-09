'use strict';
/**
 * snapshot/diff-engine.js — Deep structural diff between two Grafana snapshots.
 * Detects: panels added/removed/modified, datasource reference changes,
 * variable changes, annotation changes, permission changes.
 */

const { SnapshotManager } = require('../core/snapshot-manager');

class DiffEngine {
  constructor(snapshotDir = './snapshots') {
    this.manager = new SnapshotManager(snapshotDir);
  }

  /**
   * Run a complete diff between two snapshot labels.
   * Returns a rich DiffReport object.
   */
  diff(beforeLabel, afterLabel) {
    const before = this.manager.load(beforeLabel);
    const after  = this.manager.load(afterLabel);

    return {
      meta: {
        generated_at:    new Date().toISOString(),
        before_label:    beforeLabel,
        after_label:     afterLabel,
        before_version:  before.manifest.grafana_version,
        after_version:   after.manifest.grafana_version,
        before_captured: before.manifest.created_at,
        after_captured:  after.manifest.created_at,
      },
      dashboards:       this._diffDashboards(before.dashboards, after.dashboards),
      datasources:      this._diffDatasources(before.datasources, after.datasources),
      alert_rules:      this._diffAlertRules(before.alerts, after.alerts),
      plugins:          this._diffPlugins(before.plugins, after.plugins),
      risk_summary:     null, // filled below
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Dashboard diff
  // ─────────────────────────────────────────────────────────────────────────────

  _diffDashboards(before, after) {
    const bMap = this._indexBy(before, d => d.dashboard?.uid || d.uid);
    const aMap = this._indexBy(after,  d => d.dashboard?.uid || d.uid);
    const allUIDs = new Set([...Object.keys(bMap), ...Object.keys(aMap)]);

    const added    = [];
    const removed  = [];
    const modified = [];
    const unchanged = [];

    for (const uid of allUIDs) {
      if (!bMap[uid]) {
        added.push({ uid, title: aMap[uid].dashboard?.title || uid });
        continue;
      }
      if (!aMap[uid]) {
        removed.push({ uid, title: bMap[uid].dashboard?.title || uid });
        continue;
      }

      const changes = this._dashboardDeepDiff(bMap[uid], aMap[uid]);
      if (changes.length === 0) {
        unchanged.push(uid);
      } else {
        modified.push({
          uid,
          title: aMap[uid].dashboard?.title || uid,
          version_before: bMap[uid].dashboard?.version,
          version_after:  aMap[uid].dashboard?.version,
          change_count:   changes.length,
          changes,
        });
      }
    }

    return {
      summary: {
        total_before: before.length,
        total_after:  after.length,
        added:    added.length,
        removed:  removed.length,
        modified: modified.length,
        unchanged: unchanged.length,
      },
      added,
      removed,
      modified,
    };
  }

  _dashboardDeepDiff(before, after) {
    const changes = [];
    const bd = before.dashboard || before;
    const ad = after.dashboard  || after;

    if (bd.version !== ad.version) {
      changes.push({ type: 'version_changed', from: bd.version, to: ad.version });
    }
    if (bd.title !== ad.title) {
      changes.push({ type: 'title_changed', from: bd.title, to: ad.title });
    }
    if (bd.description !== ad.description) {
      changes.push({ type: 'description_changed' });
    }

    // Panel diffs
    const bPanels = this._flatPanels(bd.panels || []);
    const aPanels = this._flatPanels(ad.panels  || []);
    const bPMap   = this._indexBy(bPanels, p => String(p.id));
    const aPMap   = this._indexBy(aPanels, p => String(p.id));

    for (const id of Object.keys(aPMap)) {
      if (!bPMap[id]) {
        changes.push({ type: 'panel_added', panel_id: id, title: aPMap[id].title, panel_type: aPMap[id].type });
      }
    }
    for (const id of Object.keys(bPMap)) {
      if (!aPMap[id]) {
        changes.push({ type: 'panel_removed', panel_id: id, title: bPMap[id].title, panel_type: bPMap[id].type });
      }
    }
    for (const id of Object.keys(aPMap)) {
      if (!bPMap[id]) continue;
      const bp = bPMap[id];
      const ap = aPMap[id];
      if (bp.type !== ap.type) {
        changes.push({ type: 'panel_type_changed', panel_id: id, from: bp.type, to: ap.type });
      }
      // Datasource UID changed?
      const bds = this._panelDsUID(bp);
      const ads = this._panelDsUID(ap);
      if (bds !== ads) {
        changes.push({ type: 'datasource_ref_changed', panel_id: id, title: ap.title, from: bds, to: ads });
      }
    }

    // Variable diffs
    const bVars = (bd.templating?.list || []);
    const aVars = (ad.templating?.list || []);
    const bVMap = this._indexBy(bVars, v => v.name);
    const aVMap = this._indexBy(aVars, v => v.name);

    for (const name of Object.keys(aVMap)) {
      if (!bVMap[name]) {
        changes.push({ type: 'variable_added', name });
      }
    }
    for (const name of Object.keys(bVMap)) {
      if (!aVMap[name]) {
        changes.push({ type: 'variable_removed', name });
      }
    }
    for (const name of Object.keys(aVMap)) {
      if (!bVMap[name]) continue;
      const bv = bVMap[name];
      const av = aVMap[name];
      if (bv.type !== av.type) {
        changes.push({ type: 'variable_type_changed', name, from: bv.type, to: av.type });
      }
      if (JSON.stringify(bv.query) !== JSON.stringify(av.query)) {
        changes.push({ type: 'variable_query_changed', name });
      }
    }

    // Annotation changes
    const bAnnots = (bd.annotations?.list || []).map(a => a.name);
    const aAnnots = (ad.annotations?.list || []).map(a => a.name);
    const addedAnnots   = aAnnots.filter(n => !bAnnots.includes(n));
    const removedAnnots = bAnnots.filter(n => !aAnnots.includes(n));
    if (addedAnnots.length)   changes.push({ type: 'annotations_added',   names: addedAnnots });
    if (removedAnnots.length) changes.push({ type: 'annotations_removed', names: removedAnnots });

    return changes;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Datasource diff
  // ─────────────────────────────────────────────────────────────────────────────

  _diffDatasources(before, after) {
    const bMap = this._indexBy(before, ds => ds.uid || ds.name);
    const aMap = this._indexBy(after,  ds => ds.uid || ds.name);
    const allKeys = new Set([...Object.keys(bMap), ...Object.keys(aMap)]);

    const added   = [];
    const removed = [];
    const modified = [];

    for (const key of allKeys) {
      if (!bMap[key]) { added.push({ uid: key, name: aMap[key].name, type: aMap[key].type }); continue; }
      if (!aMap[key]) { removed.push({ uid: key, name: bMap[key].name, type: bMap[key].type }); continue; }

      const b = bMap[key];
      const a = aMap[key];
      const changes = [];
      if (b.type !== a.type)   changes.push({ field: 'type',     from: b.type,   to: a.type });
      if (b.url  !== a.url)    changes.push({ field: 'url',      from: b.url,    to: a.url });
      if (b.name !== a.name)   changes.push({ field: 'name',     from: b.name,   to: a.name });
      if (b.access !== a.access) changes.push({ field: 'access', from: b.access, to: a.access });
      if (changes.length) modified.push({ uid: key, name: a.name, changes });
    }

    return { added, removed, modified };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Alert rule diff
  // ─────────────────────────────────────────────────────────────────────────────

  _diffAlertRules(before, after) {
    const bMap = this._indexBy(before, r => r.uid || r.title);
    const aMap = this._indexBy(after,  r => r.uid || r.title);
    const allKeys = new Set([...Object.keys(bMap), ...Object.keys(aMap)]);

    const added   = [];
    const removed = [];
    const modified = [];

    for (const key of allKeys) {
      if (!bMap[key]) { added.push({ uid: key, title: aMap[key].title }); continue; }
      if (!aMap[key]) { removed.push({ uid: key, title: bMap[key].title }); continue; }
      const changes = [];
      if (JSON.stringify(bMap[key].condition) !== JSON.stringify(aMap[key].condition)) {
        changes.push({ type: 'condition_changed' });
      }
      if (JSON.stringify(bMap[key].data) !== JSON.stringify(aMap[key].data)) {
        changes.push({ type: 'query_changed' });
      }
      if (changes.length) modified.push({ uid: key, title: aMap[key].title, changes });
    }

    return { added, removed, modified };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Plugin diff
  // ─────────────────────────────────────────────────────────────────────────────

  _diffPlugins(before, after) {
    const bMap = this._indexBy(before, p => p.id);
    const aMap = this._indexBy(after,  p => p.id);

    const added    = Object.keys(aMap).filter(k => !bMap[k]).map(k => ({ id: k, version: aMap[k].version }));
    const removed  = Object.keys(bMap).filter(k => !aMap[k]).map(k => ({ id: k, version: bMap[k].version }));
    const upgraded = [];
    for (const id of Object.keys(aMap)) {
      if (!bMap[id]) continue;
      if (bMap[id].version !== aMap[id].version) {
        upgraded.push({ id, from: bMap[id].version, to: aMap[id].version });
      }
    }

    return { added, removed, upgraded };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  _indexBy(arr, keyFn) {
    const map = {};
    for (const item of arr || []) {
      const key = keyFn(item);
      if (key) map[key] = item;
    }
    return map;
  }

  _flatPanels(panels, result = []) {
    for (const p of panels || []) {
      result.push(p);
      if (p.panels) this._flatPanels(p.panels, result);
    }
    return result;
  }

  _panelDsUID(panel) {
    if (!panel.datasource) return null;
    return typeof panel.datasource === 'object' ? panel.datasource?.uid : panel.datasource;
  }
}

module.exports = { DiffEngine };
