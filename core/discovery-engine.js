'use strict';
/**
 * core/discovery-engine.js — Auto-discovers ALL Grafana resources and builds
 * a complete manifest. Results cached in memory for 1 hour (lazy, on first use).
 */

const { GrafanaClient } = require('./grafana-client');

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

class DiscoveryEngine {
  /**
   * @param {GrafanaClient} client
   */
  constructor(client) {
    this.client = client;
    this._cache = null;
    this._cacheTime = null;
    this._discovering = null; // Promise while discovery is in progress
  }

  /**
   * Return complete manifest, using cache if fresh.
   * Multiple concurrent calls resolve to the same discovery run.
   */
  async discover(forceRefresh = false) {
    if (!forceRefresh && this._isCacheValid()) return this._cache;

    if (this._discovering) return this._discovering;

    this._discovering = this._runDiscovery()
      .then(manifest => {
        this._cache = manifest;
        this._cacheTime = Date.now();
        this._discovering = null;
        return manifest;
      })
      .catch(err => {
        this._discovering = null;
        throw err;
      });

    return this._discovering;
  }

  /**
   * Force-clear cache (call after a run completes to stay fresh)
   */
  invalidate() {
    this._cache = null;
    this._cacheTime = null;
  }

  _isCacheValid() {
    return this._cache && this._cacheTime && (Date.now() - this._cacheTime) < CACHE_TTL_MS;
  }

  async _runDiscovery() {
    const start = Date.now();
    const [
      version,
      health,
      stats,
      dashboardsRes,
      foldersRes,
      datasourcesRes,
      pluginsRes,
      usersRes,
      teamsRes,
      alertRulesRes,
      contactPointsRes,
      silencesRes,
      annotationsRes,
    ] = await Promise.allSettled([
      this.client.getVersion(),
      this.client.getHealth(),
      this.client.getStats(),
      this.client.searchDashboards('', [], 5000),
      this.client.getFolders(1000),
      this.client.getDatasources(),
      this.client.getInstalledPlugins(),
      this.client.getUsers(1000),
      this.client.getTeams(1000),
      this.client.getAlertRules(),
      this.client.getContactPoints(),
      this.client.getSilences(),
      this.client.getAnnotations(),
    ]);

    const safe = r => (r.status === 'fulfilled' ? r.value : { ok: false, data: null });
    const arr  = r => (Array.isArray(safe(r).data) ? safe(r).data : []);

    const dashboards  = arr(dashboardsRes);
    const folders     = arr(foldersRes);
    const datasources = arr(datasourcesRes);
    const plugins     = arr(pluginsRes);
    const users       = arr(usersRes);
    const teams       = Array.isArray(safe(teamsRes).data?.teams) ? safe(teamsRes).data.teams : arr(teamsRes);

    // Alert rules — handle both flat array and grouped object
    let alertRules = [];
    const arRaw = safe(alertRulesRes).data;
    if (Array.isArray(arRaw)) {
      alertRules = arRaw;
    } else if (arRaw && typeof arRaw === 'object') {
      // Ruler API returns { namespace: [{ name, rules: [...] }] }
      for (const ns of Object.values(arRaw)) {
        if (Array.isArray(ns)) {
          for (const group of ns) {
            if (Array.isArray(group.rules)) alertRules.push(...group.rules);
          }
        }
      }
    }

    const contactPoints = arr(contactPointsRes);
    const silences      = arr(silencesRes);
    const annotations   = arr(annotationsRes);

    // Build datasource UID → name map for fast lookup
    const datasourceMap = {};
    for (const ds of datasources) {
      if (ds.uid) datasourceMap[ds.uid] = ds.name;
      if (ds.id)  datasourceMap[String(ds.id)] = ds.name;
    }

    // Enrich dashboards with datasource references (parse panel targets)
    // We only do this if dashboard count is manageable (< 200 for full detail)
    const enrichedDashboards = [];
    const DETAIL_LIMIT = 200;
    for (const d of dashboards.slice(0, DETAIL_LIMIT)) {
      const detail = await this.client.getDashboard(d.uid).catch(() => null);
      const dsRefs = new Set();
      if (detail?.ok && detail.data?.dashboard?.panels) {
        this._extractDatasourceRefs(detail.data.dashboard.panels, dsRefs, datasourceMap);
      }
      enrichedDashboards.push({
        uid: d.uid,
        title: d.title,
        url: d.url,
        folderTitle: d.folderTitle,
        folderUid: d.folderUid,
        tags: d.tags || [],
        datasources: [...dsRefs],
        panels: detail?.ok ? (detail.data.dashboard.panels || []).map(p => ({
          id: p.id,
          type: p.type,
          title: p.title,
          datasource: p.datasource,
        })) : [],
      });
    }

    // For the rest (if > DETAIL_LIMIT), add without panel detail
    for (const d of dashboards.slice(DETAIL_LIMIT)) {
      enrichedDashboards.push({
        uid: d.uid,
        title: d.title,
        url: d.url,
        folderTitle: d.folderTitle,
        folderUid: d.folderUid,
        tags: d.tags || [],
        datasources: [],
        panels: [],
      });
    }

    const manifest = {
      discovered_at: new Date().toISOString(),
      discovery_ms: Date.now() - start,
      version: version.status === 'fulfilled' ? version.value : 'unknown',
      health: safe(healthRes ?? health).data,
      stats: safe(stats).data,
      counts: {
        dashboards: dashboards.length,
        folders: folders.length,
        datasources: datasources.length,
        plugins: plugins.length,
        users: users.length,
        teams: teams.length,
        alert_rules: alertRules.length,
        contact_points: contactPoints.length,
        silences: silences.length,
        annotations: annotations.length,
      },
      dashboards: enrichedDashboards,
      folders,
      datasources,
      plugins,
      users: users.map(u => ({ id: u.id, login: u.login, email: u.email, role: u.role, isAdmin: u.isGrafanaAdmin })),
      teams,
      alert_rules: alertRules,
      contact_points: contactPoints,
      silences,
      datasource_map: datasourceMap,
    };

    return manifest;
  }

  _extractDatasourceRefs(panels, refs, datasourceMap) {
    if (!Array.isArray(panels)) return;
    for (const panel of panels) {
      if (panel.datasource) {
        const uid = typeof panel.datasource === 'object' ? panel.datasource.uid : panel.datasource;
        if (uid && uid !== '-- Grafana --' && uid !== '-- Mixed --') {
          const name = datasourceMap[uid] || uid;
          refs.add(name);
        }
      }
      // Recurse into row panels
      if (panel.panels) this._extractDatasourceRefs(panel.panels, refs, datasourceMap);
    }
  }

  /** Get cached manifest or throw if not yet discovered */
  getManifest() {
    if (!this._cache) throw new Error('Discovery has not run yet. Call discover() first.');
    return this._cache;
  }

  /** Convenience: just dashboard UIDs (fast from cache) */
  async getDashboardUIDs() {
    const m = await this.discover();
    return m.dashboards.map(d => d.uid);
  }

  /** Convenience: datasource IDs */
  async getDatasourceIds() {
    const m = await this.discover();
    return m.datasources.map(d => d.id);
  }
}

module.exports = { DiscoveryEngine };
