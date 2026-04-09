'use strict';
/**
 * core/snapshot-manager.js — Save, load, and diff dashboard JSON snapshots to/from disk.
 */

const fs = require('fs');
const path = require('path');

class SnapshotManager {
  /**
   * @param {string} baseDir  - Root directory for all snapshots
   */
  constructor(baseDir = './snapshots') {
    this.baseDir = path.resolve(baseDir);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Save
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Save a full snapshot (dashboards, datasources, alerts, metadata)
   * @param {string} label - e.g. "pre-upgrade", "post-upgrade", "2024-01-15"
   * @param {object} data  - { dashboards: [...], datasources: [...], alerts: [...], meta: {} }
   */
  save(label, data) {
    const dir = path.join(this.baseDir, label);
    this._ensureDir(dir);

    // Write manifest
    const manifest = {
      label,
      created_at: new Date().toISOString(),
      grafana_url: data.meta?.grafana_url,
      grafana_version: data.meta?.grafana_version,
      counts: {
        dashboards: (data.dashboards || []).length,
        datasources: (data.datasources || []).length,
        alert_rules: (data.alerts || []).length,
        plugins: (data.plugins || []).length,
      },
      files: [],
    };

    // Save each dashboard as individual JSON file
    const dashDir = path.join(dir, 'dashboards');
    this._ensureDir(dashDir);
    for (const dash of data.dashboards || []) {
      const uid = dash.dashboard?.uid || dash.uid || 'unknown';
      const fileName = `${this._sanitize(uid)}.json`;
      fs.writeFileSync(path.join(dashDir, fileName), JSON.stringify(dash, null, 2));
      manifest.files.push(`dashboards/${fileName}`);
    }

    // Save datasources
    if (data.datasources?.length) {
      const dsPath = path.join(dir, 'datasources.json');
      fs.writeFileSync(dsPath, JSON.stringify(data.datasources, null, 2));
      manifest.files.push('datasources.json');
    }

    // Save alert rules
    if (data.alerts?.length) {
      const alertPath = path.join(dir, 'alert-rules.json');
      fs.writeFileSync(alertPath, JSON.stringify(data.alerts, null, 2));
      manifest.files.push('alert-rules.json');
    }

    // Save plugins
    if (data.plugins?.length) {
      const pluginPath = path.join(dir, 'plugins.json');
      fs.writeFileSync(pluginPath, JSON.stringify(data.plugins, null, 2));
      manifest.files.push('plugins.json');
    }

    // Save performance baseline if present
    if (data.performance) {
      const perfPath = path.join(dir, 'performance-baseline.json');
      fs.writeFileSync(perfPath, JSON.stringify(data.performance, null, 2));
      manifest.files.push('performance-baseline.json');
    }

    // Write manifest last
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    return { dir, manifest };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Load
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Load a full snapshot from disk by label.
   * Returns { manifest, dashboards, datasources, alerts, plugins, performance }
   */
  load(label) {
    const dir = path.join(this.baseDir, label);
    if (!fs.existsSync(dir)) throw new Error(`Snapshot "${label}" not found at ${dir}`);

    const manifest = this._readJSON(path.join(dir, 'manifest.json'));
    const dashboards = this._loadDirectory(path.join(dir, 'dashboards'));
    const datasources = this._readJSONOpt(path.join(dir, 'datasources.json')) || [];
    const alerts      = this._readJSONOpt(path.join(dir, 'alert-rules.json')) || [];
    const plugins     = this._readJSONOpt(path.join(dir, 'plugins.json')) || [];
    const performance = this._readJSONOpt(path.join(dir, 'performance-baseline.json'));

    return { manifest, dashboards, datasources, alerts, plugins, performance };
  }

  /**
   * List all available snapshot labels
   */
  listSnapshots() {
    if (!fs.existsSync(this.baseDir)) return [];
    return fs.readdirSync(this.baseDir)
      .filter(f => fs.statSync(path.join(this.baseDir, f)).isDirectory())
      .map(label => {
        const manifestPath = path.join(this.baseDir, label, 'manifest.json');
        if (!fs.existsSync(manifestPath)) return null;
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        return { label, created_at: m.created_at, counts: m.counts, grafana_version: m.grafana_version };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Diff
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Diff two snapshots. Returns a structured diff report.
   */
  diff(beforeLabel, afterLabel) {
    const before = this.load(beforeLabel);
    const after  = this.load(afterLabel);

    return {
      before: { label: beforeLabel, version: before.manifest.grafana_version, created_at: before.manifest.created_at },
      after:  { label: afterLabel,  version: after.manifest.grafana_version,  created_at: after.manifest.created_at },
      dashboards: this._diffDashboards(before.dashboards, after.dashboards),
      datasources: this._diffDatasources(before.datasources, after.datasources),
      alert_rules: this._diffAlertRules(before.alerts, after.alerts),
      plugins: this._diffPlugins(before.plugins, after.plugins),
    };
  }

  _diffDashboards(before, after) {
    const beforeMap = {};
    const afterMap  = {};
    for (const d of before) beforeMap[d.dashboard?.uid || d.uid] = d;
    for (const d of after)  afterMap[d.dashboard?.uid || d.uid]  = d;

    const allUIDs = new Set([...Object.keys(beforeMap), ...Object.keys(afterMap)]);
    const added   = [];
    const removed = [];
    const modified = [];
    const unchanged = [];

    for (const uid of allUIDs) {
      if (!beforeMap[uid]) { added.push({ uid, title: afterMap[uid].dashboard?.title || uid }); continue; }
      if (!afterMap[uid])  { removed.push({ uid, title: beforeMap[uid].dashboard?.title || uid }); continue; }

      const changes = this._dashboardChanges(beforeMap[uid], afterMap[uid]);
      if (changes.length === 0) {
        unchanged.push(uid);
      } else {
        modified.push({ uid, title: afterMap[uid].dashboard?.title || uid, changes });
      }
    }

    return {
      total_before: before.length,
      total_after:  after.length,
      added:    added.length,
      removed:  removed.length,
      modified: modified.length,
      unchanged: unchanged.length,
      added_list:   added,
      removed_list:  removed,
      modified_list: modified,
    };
  }

  _dashboardChanges(before, after) {
    const changes = [];
    const bd = before.dashboard || before;
    const ad = after.dashboard  || after;

    // Version bump
    if (bd.version !== ad.version) changes.push({ type: 'version_changed', from: bd.version, to: ad.version });

    // Title change
    if (bd.title !== ad.title) changes.push({ type: 'title_changed', from: bd.title, to: ad.title });

    // Panel changes
    const beforePanels = this._flatPanels(bd.panels || []);
    const afterPanels  = this._flatPanels(ad.panels  || []);
    const beforePMap = {};
    const afterPMap  = {};
    for (const p of beforePanels) beforePMap[p.id] = p;
    for (const p of afterPanels)  afterPMap[p.id]  = p;

    for (const id of Object.keys(afterPMap)) {
      if (!beforePMap[id]) changes.push({ type: 'panel_added', panel_id: id, title: afterPMap[id].title });
    }
    for (const id of Object.keys(beforePMap)) {
      if (!afterPMap[id]) changes.push({ type: 'panel_removed', panel_id: id, title: beforePMap[id].title });
    }
    for (const id of Object.keys(afterPMap)) {
      if (!beforePMap[id]) continue;
      const bp = beforePMap[id];
      const ap = afterPMap[id];
      if (bp.type !== ap.type) changes.push({ type: 'panel_type_changed', panel_id: id, from: bp.type, to: ap.type });
      // Datasource reference changed
      const bds = typeof bp.datasource === 'object' ? bp.datasource?.uid : bp.datasource;
      const ads = typeof ap.datasource === 'object' ? ap.datasource?.uid : ap.datasource;
      if (bds !== ads) changes.push({ type: 'datasource_ref_changed', panel_id: id, from: bds, to: ads });
    }

    // Variable changes
    const bVars = (bd.templating?.list || []).map(v => v.name);
    const aVars = (ad.templating?.list || []).map(v => v.name);
    const addedVars   = aVars.filter(v => !bVars.includes(v));
    const removedVars = bVars.filter(v => !aVars.includes(v));
    if (addedVars.length)   changes.push({ type: 'variables_added',   names: addedVars });
    if (removedVars.length) changes.push({ type: 'variables_removed', names: removedVars });

    return changes;
  }

  _flatPanels(panels, result = []) {
    for (const p of panels) {
      result.push(p);
      if (p.panels) this._flatPanels(p.panels, result);
    }
    return result;
  }

  _diffDatasources(before, after) {
    const beforeMap = {};
    const afterMap  = {};
    for (const ds of before) beforeMap[ds.uid || ds.name] = ds;
    for (const ds of after)  afterMap[ds.uid  || ds.name] = ds;

    const added   = Object.keys(afterMap).filter(k => !beforeMap[k]).map(k => ({ uid: k, name: afterMap[k].name, type: afterMap[k].type }));
    const removed = Object.keys(beforeMap).filter(k => !afterMap[k]).map(k => ({ uid: k, name: beforeMap[k].name, type: beforeMap[k].type }));
    const modified = [];

    for (const key of Object.keys(afterMap)) {
      if (!beforeMap[key]) continue;
      const b = beforeMap[key];
      const a = afterMap[key];
      const changes = [];
      if (b.type !== a.type) changes.push({ field: 'type', from: b.type, to: a.type });
      if (b.url  !== a.url)  changes.push({ field: 'url',  from: b.url,  to: a.url });
      if (changes.length) modified.push({ uid: key, name: a.name, changes });
    }

    return { added, removed, modified };
  }

  _diffAlertRules(before, after) {
    const toMap = arr => {
      const m = {};
      for (const r of arr) m[r.uid || r.title || r.name] = r;
      return m;
    };
    const bm = toMap(before);
    const am = toMap(after);
    const added   = Object.keys(am).filter(k => !bm[k]);
    const removed = Object.keys(bm).filter(k => !am[k]);
    return { added: added.length, removed: removed.length, added_names: added, removed_names: removed };
  }

  _diffPlugins(before, after) {
    const toMap = arr => {
      const m = {};
      for (const p of arr) m[p.id] = p;
      return m;
    };
    const bm = toMap(before);
    const am = toMap(after);
    const added   = Object.keys(am).filter(k => !bm[k]).map(k => ({ id: k, version: am[k].info?.version }));
    const removed = Object.keys(bm).filter(k => !am[k]).map(k => ({ id: k, version: bm[k].info?.version }));
    const upgraded = [];
    for (const id of Object.keys(am)) {
      if (!bm[id]) continue;
      const bv = bm[id]?.info?.version;
      const av = am[id]?.info?.version;
      if (bv !== av) upgraded.push({ id, from: bv, to: av });
    }
    return { added, removed, upgraded };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _sanitize(str) {
    return String(str).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  }

  _readJSON(p) {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }

  _readJSONOpt(p) {
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  }

  _loadDirectory(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => { try { return this._readJSON(path.join(dir, f)); } catch { return null; } })
      .filter(Boolean);
  }
}

module.exports = { SnapshotManager };
