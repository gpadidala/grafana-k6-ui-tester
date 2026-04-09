'use strict';
/**
 * multi-instance/sync-validator.js — Detect missing dashboards and config drift between instances.
 */

class SyncValidator {
  constructor(registry) {
    this.registry = registry;
  }

  /**
   * Validate that a "follower" instance is in sync with a "leader" instance.
   * Returns a report of any missing or diverged resources.
   */
  async validate(leaderId, followerId) {
    const leaderClient   = this.registry.getClient(leaderId);
    const followerClient = this.registry.getClient(followerId);
    const leader         = this.registry.get(leaderId);
    const follower       = this.registry.get(followerId);

    const [leaderDashes, followerDashes, leaderDs, followerDs] = await Promise.all([
      leaderClient.searchDashboards('', [], 5000).then(r => r.ok ? r.data : []),
      followerClient.searchDashboards('', [], 5000).then(r => r.ok ? r.data : []),
      leaderClient.getDatasources().then(r => r.ok ? r.data : []),
      followerClient.getDatasources().then(r => r.ok ? r.data : []),
    ]);

    const leaderUids    = new Set(leaderDashes.map(d => d.uid));
    const followerUids  = new Set(followerDashes.map(d => d.uid));
    const leaderDsNames = new Set(leaderDs.map(d => d.name));
    const followerDsNames = new Set(followerDs.map(d => d.name));

    const missingDashboards = leaderDashes.filter(d => !followerUids.has(d.uid));
    const extraDashboards   = followerDashes.filter(d => !leaderUids.has(d.uid));
    const missingDatasources = leaderDs.filter(d => !followerDsNames.has(d.name));

    const syncPct = leaderDashes.length > 0
      ? Math.round((1 - missingDashboards.length / leaderDashes.length) * 100)
      : 100;

    const inSync = missingDashboards.length === 0 && missingDatasources.length === 0;

    return {
      leader:   { id: leaderId,   name: leader?.name,   dashboards: leaderDashes.length,   datasources: leaderDs.length },
      follower: { id: followerId, name: follower?.name, dashboards: followerDashes.length, datasources: followerDs.length },
      in_sync:  inSync,
      sync_pct: syncPct,
      missing_dashboards:   missingDashboards.map(d => ({ uid: d.uid, title: d.title, folder: d.folderTitle })),
      extra_dashboards:     extraDashboards.map(d => ({ uid: d.uid, title: d.title })),
      missing_datasources:  missingDatasources.map(d => ({ name: d.name, type: d.type })),
      recommendations: this._buildRecommendations(missingDashboards, missingDatasources, extraDashboards),
    };
  }

  /**
   * Validate all registered instances against the first "production" instance.
   */
  async validateAll() {
    const allInstances = this.registry.getAll();
    const prodInstances = allInstances.filter(i => i.environment === 'production' || i.environment === 'prod');
    const leader = prodInstances[0] || allInstances[0];
    if (!leader) return [];

    const followers = allInstances.filter(i => i.id !== leader.id);
    return Promise.all(followers.map(f => this.validate(leader.id, f.id)));
  }

  _buildRecommendations(missingDashes, missingDs, extraDashes) {
    const recs = [];
    if (missingDashes.length) {
      recs.push({
        priority: 'high',
        action:   `Sync ${missingDashes.length} missing dashboard(s) from leader to follower via provisioning or API export/import`,
        items:    missingDashes.map(d => d.title),
      });
    }
    if (missingDs.length) {
      recs.push({
        priority: 'critical',
        action:   `Add ${missingDs.length} missing datasource(s) to follower — dashboards referencing them will show errors`,
        items:    missingDs.map(d => d.name),
      });
    }
    if (extraDashes.length > 5) {
      recs.push({
        priority: 'low',
        action:   `Follower has ${extraDashes.length} extra dashboards not in leader — consider cleanup if these are stale`,
        items:    extraDashes.slice(0, 5).map(d => d.title),
      });
    }
    return recs;
  }
}

module.exports = { SyncValidator };
