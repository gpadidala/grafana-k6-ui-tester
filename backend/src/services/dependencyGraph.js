const { stmts } = require('../db');

class DependencyGraph {
  constructor() {
    this._built = false;
    this._builtAt = null;
    this.TTL_MS = 5 * 60 * 1000; // 5 min cache
  }

  isStale() {
    if (!this._built || !this._builtAt) return true;
    return Date.now() - this._builtAt > this.TTL_MS;
  }

  async build(client, force = false) {
    if (!force && !this.isStale()) return;

    console.log('[DepGraph] Building dependency graph...');
    const start = Date.now();

    // Clear existing graph
    stmts.clearGraph.run();

    // Fetch all resources
    const [dsRes, dashRes, pluginRes, folderRes, alertRes] = await Promise.all([
      client.getDatasources(),
      client.searchDashboards(),
      client.getPlugins(),
      client.searchFolders(),
      client.getAlertRules(),
    ]);

    const datasources = dsRes.ok ? (dsRes.data || []) : [];
    const dashboards = dashRes.ok ? (dashRes.data || []) : [];
    const plugins = pluginRes.ok ? (pluginRes.data || []) : [];
    const folders = folderRes.ok ? (folderRes.data || []) : [];
    const alertRules = alertRes.ok && Array.isArray(alertRes.data) ? alertRes.data : [];

    // Build DS uid→name map
    const dsMap = {};
    datasources.forEach(ds => { dsMap[ds.uid] = ds; });

    // Process each dashboard for panel→datasource and dashboard→folder edges
    const insertMany = stmts.insertEdge;
    const batch = [];

    for (const d of dashboards) {
      // Dashboard → Folder
      if (d.folderUid || d.folderTitle) {
        batch.push(['dashboard', d.uid, d.title, 'folder', d.folderUid || d.folderId?.toString() || 'general', d.folderTitle || 'General', 'IN_FOLDER', null]);
      }

      // Fetch full dashboard for panel details
      const detail = await client.getDashboard(d.uid);
      if (!detail.ok) continue;

      const panels = this._flattenPanels(detail.data?.dashboard?.panels || []);

      for (const panel of panels) {
        const panelId = `${d.uid}:panel-${panel.id || 0}`;
        const panelName = panel.title || 'untitled';

        // Dashboard → Panel
        batch.push(['dashboard', d.uid, d.title, 'panel', panelId, panelName, 'CONTAINS_PANEL', null]);

        // Panel → Datasource
        const ds = panel.datasource;
        if (ds) {
          const dsUid = typeof ds === 'object' ? ds.uid : String(ds);
          if (dsUid && !dsUid.startsWith('$') && dsUid !== '-- Mixed --' && dsUid !== '-- Grafana --') {
            batch.push(['panel', panelId, panelName, 'datasource', dsUid, dsMap[dsUid]?.name || dsUid, 'USES_DATASOURCE', null]);
            batch.push(['dashboard', d.uid, d.title, 'datasource', dsUid, dsMap[dsUid]?.name || dsUid, 'USES_DATASOURCE', null]);
          }
        }

        // Panel → Plugin (panel type)
        if (panel.type) {
          batch.push(['panel', panelId, panelName, 'plugin', panel.type, panel.type, 'USES_PLUGIN', null]);
          batch.push(['dashboard', d.uid, d.title, 'plugin', panel.type, panel.type, 'USES_PLUGIN', null]);
        }
      }
    }

    // Alert → Datasource edges
    for (const rule of alertRules) {
      if (rule.uid && rule.data) {
        for (const q of rule.data) {
          if (q.datasourceUid) {
            batch.push(['alert', rule.uid, rule.title, 'datasource', q.datasourceUid, dsMap[q.datasourceUid]?.name || q.datasourceUid, 'USES_DATASOURCE', null]);
          }
        }
      }
    }

    // Datasource → Plugin (datasource type)
    for (const ds of datasources) {
      batch.push(['datasource', ds.uid, ds.name, 'plugin', ds.type, ds.type, 'USES_PLUGIN', null]);
    }

    // Bulk insert
    const insertTx = require('../db').db.transaction((rows) => {
      for (const row of rows) {
        insertMany.run(...row);
      }
    });
    insertTx(batch);

    this._built = true;
    this._builtAt = Date.now();
    console.log(`[DepGraph] Built ${batch.length} edges in ${Date.now() - start}ms`);
  }

  _flattenPanels(panels) {
    const result = [];
    for (const p of panels) {
      if (p.type === 'row' && Array.isArray(p.panels)) {
        result.push(...p.panels);
      } else if (p.type !== 'row') {
        result.push(p);
      }
    }
    return result;
  }

  // ─── Traversal Methods ───

  getImpactedByDatasource(dsUid) {
    const edges = stmts.getEdgesTo.all('datasource', dsUid);
    return {
      dashboards: edges.filter(e => e.source_type === 'dashboard').map(e => ({ uid: e.source_id, name: e.source_name })),
      panels: edges.filter(e => e.source_type === 'panel').map(e => ({ id: e.source_id, name: e.source_name })),
      alerts: edges.filter(e => e.source_type === 'alert').map(e => ({ uid: e.source_id, name: e.source_name })),
    };
  }

  getImpactedByPlugin(pluginId) {
    const edges = stmts.getEdgesTo.all('plugin', pluginId);
    return {
      dashboards: edges.filter(e => e.source_type === 'dashboard').map(e => ({ uid: e.source_id, name: e.source_name })),
      panels: edges.filter(e => e.source_type === 'panel').map(e => ({ id: e.source_id, name: e.source_name })),
      datasources: edges.filter(e => e.source_type === 'datasource').map(e => ({ uid: e.source_id, name: e.source_name })),
    };
  }

  getDashboardDependencies(dashUid) {
    const edges = stmts.getEdgesFrom.all('dashboard', dashUid);
    return {
      panels: edges.filter(e => e.edge_type === 'CONTAINS_PANEL').map(e => ({ id: e.target_id, name: e.target_name })),
      datasources: edges.filter(e => e.edge_type === 'USES_DATASOURCE').map(e => ({ uid: e.target_id, name: e.target_name })),
      plugins: edges.filter(e => e.edge_type === 'USES_PLUGIN').map(e => ({ id: e.target_id, name: e.target_name })),
      folder: edges.find(e => e.edge_type === 'IN_FOLDER'),
    };
  }

  getFullGraph() {
    return stmts.getFullGraph.all();
  }

  getStats() {
    const edges = stmts.getFullGraph.all();
    const types = {};
    edges.forEach(e => {
      types[e.edge_type] = (types[e.edge_type] || 0) + 1;
    });
    return { totalEdges: edges.length, byType: types, builtAt: this._builtAt };
  }
}

module.exports = DependencyGraph;
