'use strict';
/**
 * snapshot/migration-advisor.js — Produce actionable fix suggestions from a diff report.
 * Analyzes: datasource UID changes, removed plugins (with affected dashboard count),
 * changed query formats, and other breaking changes.
 */

class MigrationAdvisor {
  /**
   * Analyze a DiffEngine result and produce actionable migration advice.
   * @param {object} diffReport  - Output of DiffEngine.diff()
   * @returns {MigrationAdvice}
   */
  analyze(diffReport) {
    const advice = {
      generated_at:   new Date().toISOString(),
      before_version: diffReport.meta?.before_version,
      after_version:  diffReport.meta?.after_version,
      risk_level:     'low',
      breaking_changes: [],
      warnings:         [],
      info:             [],
      action_plan:      [],
    };

    this._analyzeDatasourceChanges(diffReport.datasources, diffReport.dashboards, advice);
    this._analyzePluginChanges(diffReport.plugins, diffReport.dashboards, advice);
    this._analyzeDashboardChanges(diffReport.dashboards, advice);
    this._analyzeAlertRuleChanges(diffReport.alert_rules, advice);
    this._buildActionPlan(advice);
    this._assessRiskLevel(advice);

    return advice;
  }

  _analyzeDatasourceChanges(datasources, dashboards, advice) {
    if (!datasources) return;

    // Removed datasources — find affected dashboards
    for (const removed of datasources.removed || []) {
      const affectedDashboards = this._findDashboardsUsingDatasource(removed.uid, dashboards);
      advice.breaking_changes.push({
        type:    'datasource_removed',
        item:    removed.name,
        uid:     removed.uid,
        ds_type: removed.type,
        affected_dashboards: affectedDashboards.length,
        affected_dashboard_titles: affectedDashboards.map(d => d.title),
        fix: `Restore datasource "${removed.name}" or update the ${affectedDashboards.length} affected dashboard(s) to use a different datasource`,
      });
    }

    // Modified datasource URLs — may break queries
    for (const mod of datasources.modified || []) {
      const urlChange = mod.changes.find(c => c.field === 'url');
      if (urlChange) {
        advice.warnings.push({
          type:  'datasource_url_changed',
          item:  mod.name,
          from:  urlChange.from,
          to:    urlChange.to,
          fix:   `Verify datasource "${mod.name}" is reachable at ${urlChange.to} and run a connection test`,
        });
      }
      const typeChange = mod.changes.find(c => c.field === 'type');
      if (typeChange) {
        advice.breaking_changes.push({
          type: 'datasource_type_changed',
          item: mod.name,
          from: typeChange.from,
          to:   typeChange.to,
          fix:  `Datasource type changed from ${typeChange.from} to ${typeChange.to} — this WILL break all queries using "${mod.name}"`,
        });
      }
    }

    // Datasource UID references changed in panels
    const dsRefChanges = this._collectDatasourceRefChanges(dashboards);
    for (const change of dsRefChanges) {
      advice.warnings.push({
        type:  'panel_datasource_uid_changed',
        item:  `Panel in "${change.dashboard}"`,
        from:  change.from,
        to:    change.to,
        fix:   `Update panel's datasource reference from UID "${change.from}" to "${change.to}" in dashboard "${change.dashboard}"`,
      });
    }
  }

  _analyzePluginChanges(plugins, dashboards, advice) {
    if (!plugins) return;

    for (const removed of plugins.removed || []) {
      // Find dashboards using this panel plugin
      const affected = this._findDashboardsUsingPlugin(removed.id, dashboards);
      if (affected.length > 0) {
        advice.breaking_changes.push({
          type:       'plugin_removed_with_affected_dashboards',
          plugin_id:  removed.id,
          version:    removed.version,
          affected_dashboards: affected.length,
          affected_dashboard_titles: affected.map(d => d.title),
          fix: `Plugin "${removed.id}" was removed but is used by ${affected.length} dashboard(s). Install the plugin or migrate to a compatible replacement.`,
        });
      } else {
        advice.info.push({
          type:      'plugin_removed',
          plugin_id: removed.id,
          fix:       `Plugin "${removed.id}" was removed but appears to have no affected dashboards`,
        });
      }
    }

    for (const upgraded of plugins.upgraded || []) {
      advice.info.push({
        type:      'plugin_upgraded',
        plugin_id: upgraded.id,
        from:      upgraded.from,
        to:        upgraded.to,
        fix:       `Plugin "${upgraded.id}" upgraded from ${upgraded.from} to ${upgraded.to} — verify plugin settings and panel rendering`,
      });
    }
  }

  _analyzeDashboardChanges(dashboards, advice) {
    if (!dashboards) return;

    for (const mod of dashboards.modified || []) {
      // Alert if datasource refs changed
      const dsRefChanges = mod.changes.filter(c => c.type === 'datasource_ref_changed');
      if (dsRefChanges.length > 0) {
        advice.warnings.push({
          type:      'dashboard_datasource_refs_changed',
          dashboard: mod.title,
          uid:       mod.uid,
          changes:   dsRefChanges.length,
          fix:       `Dashboard "${mod.title}" has ${dsRefChanges.length} panel(s) with changed datasource references — verify panels show data`,
        });
      }

      // Alert on variable query changes (may fail with new Grafana version)
      const varQueryChanges = mod.changes.filter(c => c.type === 'variable_query_changed');
      if (varQueryChanges.length > 0) {
        advice.warnings.push({
          type:      'variable_query_changed',
          dashboard: mod.title,
          uid:       mod.uid,
          variables: varQueryChanges.map(c => c.name),
          fix:       `Variables [${varQueryChanges.map(c => c.name).join(', ')}] in "${mod.title}" have changed queries — verify dropdown values populate correctly`,
        });
      }
    }

    // Removed dashboards
    if (dashboards.removed?.length) {
      advice.warnings.push({
        type:  'dashboards_missing',
        count: dashboards.removed.length,
        titles: dashboards.removed.map(d => d.title),
        fix:   `${dashboards.removed.length} dashboard(s) are missing after upgrade — check provisioning config`,
      });
    }
  }

  _analyzeAlertRuleChanges(alertRules, advice) {
    if (!alertRules) return;

    if (alertRules.removed?.length) {
      advice.breaking_changes.push({
        type:   'alert_rules_removed',
        count:  alertRules.removed.length,
        titles: alertRules.removed.map(r => r.title),
        fix:    `${alertRules.removed.length} alert rule(s) were lost during upgrade — restore from provisioning or re-create manually`,
      });
    }

    if (alertRules.modified?.length) {
      advice.warnings.push({
        type:  'alert_rules_modified',
        count: alertRules.modified.length,
        fix:   `${alertRules.modified.length} alert rule(s) changed — verify they still fire correctly`,
      });
    }
  }

  _buildActionPlan(advice) {
    const plan = [];
    let step = 1;

    // Breaking changes first
    for (const bc of advice.breaking_changes) {
      plan.push({ step: step++, priority: 'critical', action: bc.fix, type: bc.type });
    }
    for (const w of advice.warnings) {
      plan.push({ step: step++, priority: 'high', action: w.fix, type: w.type });
    }
    for (const info of advice.info) {
      plan.push({ step: step++, priority: 'low', action: info.fix, type: info.type });
    }

    advice.action_plan = plan;
  }

  _assessRiskLevel(advice) {
    if (advice.breaking_changes.length > 0) {
      advice.risk_level = 'critical';
    } else if (advice.warnings.length > 3) {
      advice.risk_level = 'high';
    } else if (advice.warnings.length > 0) {
      advice.risk_level = 'medium';
    } else {
      advice.risk_level = 'low';
    }
  }

  _findDashboardsUsingDatasource(dsUid, dashboards) {
    const affected = [];
    if (!dashboards?.modified) return affected;
    for (const d of [...(dashboards.modified || []), ...(dashboards.added || [])]) {
      const changes = d.changes || [];
      if (changes.some(c => c.type === 'datasource_ref_changed' && (c.from === dsUid || c.to === dsUid))) {
        affected.push(d);
      }
    }
    return affected;
  }

  _findDashboardsUsingPlugin(pluginId, dashboards) {
    const affected = [];
    if (!dashboards?.modified) return affected;
    for (const d of dashboards.modified || []) {
      if (d.changes?.some(c => c.panel_type === pluginId || c.from === pluginId)) {
        affected.push(d);
      }
    }
    return affected;
  }

  _collectDatasourceRefChanges(dashboards) {
    const changes = [];
    for (const d of dashboards?.modified || []) {
      for (const c of d.changes || []) {
        if (c.type === 'datasource_ref_changed' && c.from !== c.to) {
          changes.push({ dashboard: d.title, uid: d.uid, ...c });
        }
      }
    }
    return changes;
  }

  /**
   * Print advice to stdout in human-readable format.
   */
  print(advice) {
    const icons = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║  GRAFANA SENTINEL — MIGRATION ADVISOR                        ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  ${advice.before_version} → ${advice.after_version}  Risk: ${icons[advice.risk_level]} ${advice.risk_level.toUpperCase()}`.padEnd(63) + '║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    if (advice.breaking_changes.length) {
      console.log('🔴 BREAKING CHANGES:');
      advice.breaking_changes.forEach(b => console.log(`   • ${b.fix}`));
    }
    if (advice.warnings.length) {
      console.log('\n🟠 WARNINGS:');
      advice.warnings.forEach(w => console.log(`   • ${w.fix}`));
    }
    if (advice.info.length) {
      console.log('\n🟢 INFO:');
      advice.info.forEach(i => console.log(`   • ${i.fix}`));
    }

    console.log('\n📋 ACTION PLAN:');
    advice.action_plan.forEach(step =>
      console.log(`   [${step.step}] ${icons[step.priority]} ${step.action}`));
    console.log('');
  }
}

module.exports = { MigrationAdvisor };
