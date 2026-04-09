'use strict';
/**
 * multi-instance/cross-compare.js — Diff dashboards between staging and production.
 * Identifies diverged dashboards, missing panels, and config drift.
 */

class CrossCompare {
  /**
   * @param {InstanceRegistry} registry
   */
  constructor(registry) {
    this.registry = registry;
  }

  /**
   * Compare dashboards between two instances.
   * Returns a structured comparison report.
   */
  async compareDashboards(sourceId, targetId) {
    const sourceClient = this.registry.getClient(sourceId);
    const targetClient = this.registry.getClient(targetId);
    const source       = this.registry.get(sourceId);
    const target       = this.registry.get(targetId);

    const [sourceSearch, targetSearch] = await Promise.all([
      sourceClient.searchDashboards('', [], 5000),
      targetClient.searchDashboards('', [], 5000),
    ]);

    const sourceDashes = sourceSearch.ok ? sourceSearch.data : [];
    const targetDashes = targetSearch.ok ? targetSearch.data : [];

    // Build UID maps
    const sourceMap = {};
    const targetMap = {};
    for (const d of sourceDashes) sourceMap[d.uid] = d;
    for (const d of targetDashes) targetMap[d.uid] = d;

    const onlyInSource = sourceDashes.filter(d => !targetMap[d.uid]);
    const onlyInTarget = targetDashes.filter(d => !sourceMap[d.uid]);
    const inBoth       = sourceDashes.filter(d => targetMap[d.uid]);

    // Deep diff shared dashboards
    const diverged = [];
    const batchSize = 5;
    for (let i = 0; i < inBoth.length; i += batchSize) {
      const batch = inBoth.slice(i, i + batchSize);
      await Promise.all(batch.map(async dash => {
        const [srcDetail, tgtDetail] = await Promise.all([
          sourceClient.getDashboard(dash.uid),
          targetClient.getDashboard(dash.uid),
        ]);
        if (!srcDetail.ok || !tgtDetail.ok) return;

        const diff = this._diffDashboardJsons(srcDetail.data, tgtDetail.data);
        if (diff.length > 0) {
          diverged.push({
            uid:   dash.uid,
            title: dash.title,
            changes: diff,
            severity: diff.some(c => c.type.includes('datasource')) ? 'high' : 'low',
          });
        }
      }));
    }

    return {
      source: { id: sourceId, name: source?.name, url: source?.url, count: sourceDashes.length },
      target: { id: targetId, name: target?.name, url: target?.url, count: targetDashes.length },
      summary: {
        total_in_source:   sourceDashes.length,
        total_in_target:   targetDashes.length,
        only_in_source:    onlyInSource.length,
        only_in_target:    onlyInTarget.length,
        in_both:           inBoth.length,
        diverged:          diverged.length,
        in_sync:           inBoth.length - diverged.length,
      },
      only_in_source: onlyInSource.map(d => ({ uid: d.uid, title: d.title })),
      only_in_target: onlyInTarget.map(d => ({ uid: d.uid, title: d.title })),
      diverged,
    };
  }

  /**
   * Compare datasources between two instances.
   */
  async compareDatasources(sourceId, targetId) {
    const sourceClient = this.registry.getClient(sourceId);
    const targetClient = this.registry.getClient(targetId);

    const [src, tgt] = await Promise.all([
      sourceClient.getDatasources(),
      targetClient.getDatasources(),
    ]);

    const sourceDs = src.ok ? src.data : [];
    const targetDs = tgt.ok ? tgt.data : [];

    const srcMap = {};
    const tgtMap = {};
    for (const ds of sourceDs) srcMap[ds.name] = ds;
    for (const ds of targetDs) tgtMap[ds.name] = ds;

    const onlyInSource = sourceDs.filter(d => !tgtMap[d.name]);
    const onlyInTarget = targetDs.filter(d => !srcMap[d.name]);

    const mismatched = [];
    for (const ds of sourceDs) {
      const t = tgtMap[ds.name];
      if (!t) continue;
      if (ds.type !== t.type || ds.url !== t.url) {
        mismatched.push({
          name: ds.name,
          source: { type: ds.type, url: ds.url },
          target: { type: t.type, url: t.url },
        });
      }
    }

    return {
      only_in_source: onlyInSource.map(d => ({ name: d.name, type: d.type })),
      only_in_target: onlyInTarget.map(d => ({ name: d.name, type: d.type })),
      mismatched,
    };
  }

  _diffDashboardJsons(sourceData, targetData) {
    const sd = sourceData.dashboard || sourceData;
    const td = targetData.dashboard || targetData;
    const changes = [];

    if (sd.version !== td.version) {
      changes.push({ type: 'version_diff', source: sd.version, target: td.version });
    }

    // Panel count diff
    const srcPanels = this._flatPanels(sd.panels || []).length;
    const tgtPanels = this._flatPanels(td.panels || []).length;
    if (srcPanels !== tgtPanels) {
      changes.push({ type: 'panel_count_diff', source: srcPanels, target: tgtPanels });
    }

    return changes;
  }

  _flatPanels(panels, result = []) {
    for (const p of panels) {
      result.push(p);
      if (p.panels) this._flatPanels(p.panels, result);
    }
    return result;
  }
}

module.exports = { CrossCompare };
