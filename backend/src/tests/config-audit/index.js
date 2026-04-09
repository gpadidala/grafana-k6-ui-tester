'use strict';

const logger = require('../../utils/logger');

const CAT = 'config-audit';

async function run(client, _depGraph, options = {}) {
  const results = [];
  const start = Date.now();

  // 1. Build info — edition, version, feature toggles
  const buildRes = await client.getBuildInfo();
  if (!buildRes.ok) {
    results.push({ name: `${CAT}:build-info`, status: 'FAIL', detail: `Failed to fetch build info: ${buildRes.error || buildRes.status}`, uid: null, ms: buildRes.ms, metadata: {} });
  } else {
    const settings = buildRes.data || {};
    const buildInfo = settings.buildInfo || {};
    const version = buildInfo.version || 'unknown';
    const edition = buildInfo.edition || 'unknown';
    const env = buildInfo.env || 'unknown';

    results.push({
      name: `${CAT}:version`,
      status: 'PASS',
      detail: `Grafana ${edition} v${version} (${env})`,
      uid: null,
      ms: buildRes.ms,
      metadata: { version, edition, env, commit: buildInfo.commit },
    });

    // Feature toggles
    const featureToggles = settings.featureToggles || {};
    const enabledToggles = Object.entries(featureToggles).filter(([, v]) => v === true);
    const criticalToggles = ['publicDashboards', 'nestedFolders', 'topnav', 'scenes', 'flameGraph'];
    const criticalEnabled = enabledToggles.filter(([k]) => criticalToggles.includes(k));

    results.push({
      name: `${CAT}:feature-toggles`,
      status: enabledToggles.length > 20 ? 'WARN' : 'PASS',
      detail: `${enabledToggles.length} feature toggles enabled${criticalEnabled.length > 0 ? ` (critical: ${criticalEnabled.map(([k]) => k).join(', ')})` : ''}`,
      uid: null,
      ms: 0,
      metadata: { enabledCount: enabledToggles.length, toggles: Object.fromEntries(enabledToggles), criticalEnabled: criticalEnabled.map(([k]) => k) },
    });

    // Anonymous access
    const authAnonymous = settings.authProxyEnabled || false;
    const anonymousEnabled = settings.auth?.anonymous?.enabled || false;
    results.push({
      name: `${CAT}:anonymous-access`,
      status: anonymousEnabled ? 'FAIL' : 'PASS',
      detail: anonymousEnabled ? 'Anonymous access is ENABLED — security risk' : 'Anonymous access is disabled',
      uid: null,
      ms: 0,
      metadata: { anonymousEnabled, authProxyEnabled: authAnonymous },
    });

    // Auth providers
    const auth = settings.auth || {};
    const providers = [];
    for (const [key, val] of Object.entries(auth)) {
      if (val && typeof val === 'object' && val.enabled) providers.push(key);
    }
    results.push({
      name: `${CAT}:auth-providers`,
      status: providers.length === 0 ? 'WARN' : 'PASS',
      detail: providers.length > 0 ? `Auth providers: ${providers.join(', ')}` : 'No external auth providers detected',
      uid: null,
      ms: 0,
      metadata: { providers, count: providers.length },
    });

    // Unified alerting
    const unifiedAlerting = settings.unifiedAlertingEnabled !== undefined
      ? settings.unifiedAlertingEnabled
      : settings.unifiedAlerting?.enabled;
    const legacyAlerting = settings.alertingEnabled;
    let alertStatus = 'PASS';
    let alertDetail = 'Unified alerting enabled';
    if (!unifiedAlerting && legacyAlerting) {
      alertStatus = 'WARN';
      alertDetail = 'Legacy alerting enabled — consider migrating to unified alerting';
    } else if (!unifiedAlerting && !legacyAlerting) {
      alertStatus = 'WARN';
      alertDetail = 'No alerting system detected as enabled';
    }
    results.push({
      name: `${CAT}:unified-alerting`,
      status: alertStatus,
      detail: alertDetail,
      uid: null,
      ms: 0,
      metadata: { unifiedAlerting: !!unifiedAlerting, legacyAlerting: !!legacyAlerting },
    });

    // Default org role
    const defaultRole = settings.auth?.anonymous?.orgRole || settings.defaultRole || 'Viewer';
    const roleStatus = defaultRole === 'Admin' ? 'FAIL' : defaultRole === 'Editor' ? 'WARN' : 'PASS';
    results.push({
      name: `${CAT}:default-role`,
      status: roleStatus,
      detail: `Default org role: ${defaultRole}`,
      uid: null,
      ms: 0,
      metadata: { defaultRole },
    });

    // Disable gravatar / external image proxying
    const disableGravatar = settings.disableGravatar;
    if (disableGravatar === false) {
      results.push({
        name: `${CAT}:gravatar`,
        status: 'WARN',
        detail: 'Gravatar is enabled — may leak user email hashes externally',
        uid: null,
        ms: 0,
        metadata: { disableGravatar },
      });
    }
  }

  // 2. Admin stats
  const statsRes = await client.getAdminStats();
  if (statsRes.ok) {
    const s = statsRes.data || {};
    results.push({
      name: `${CAT}:admin-stats`,
      status: 'PASS',
      detail: `Dashboards: ${s.dashboards || 0}, Data sources: ${s.datasources || 0}, Users: ${s.users || 0}, Orgs: ${s.orgs || 0}, Alerts: ${s.alerts || 0}`,
      uid: null,
      ms: statsRes.ms,
      metadata: {
        dashboards: s.dashboards || 0,
        datasources: s.datasources || 0,
        users: s.users || 0,
        orgs: s.orgs || 0,
        alerts: s.alerts || 0,
        activeUsers: s.activeUsers || 0,
        activeSessions: s.activeSessions || 0,
        playlists: s.playlists || 0,
        stars: s.stars || 0,
        snapshots: s.snapshots || 0,
      },
    });

    // Warn if many orgs but single-org mindset
    if ((s.orgs || 0) > 10) {
      results.push({
        name: `${CAT}:org-sprawl`,
        status: 'WARN',
        detail: `${s.orgs} orgs detected — consider running multi-org audit`,
        uid: null,
        ms: 0,
        metadata: { orgCount: s.orgs },
      });
    }
  } else {
    results.push({
      name: `${CAT}:admin-stats`,
      status: 'WARN',
      detail: `Admin stats not accessible (may require admin token): ${statsRes.status}`,
      uid: null,
      ms: statsRes.ms,
      metadata: {},
    });
  }

  // 3. Org preferences
  const prefsRes = await client.getOrgPreferences();
  if (prefsRes.ok) {
    const prefs = prefsRes.data || {};
    results.push({
      name: `${CAT}:org-preferences`,
      status: 'PASS',
      detail: `Theme: ${prefs.theme || 'default'}, Home dashboard: ${prefs.homeDashboardUID || prefs.homeDashboardId || 'default'}, Timezone: ${prefs.timezone || 'browser'}`,
      uid: null,
      ms: prefsRes.ms,
      metadata: { theme: prefs.theme, homeDashboard: prefs.homeDashboardUID || prefs.homeDashboardId, timezone: prefs.timezone },
    });
  }

  logger.info(`[${CAT}] Completed: ${results.length} checks in ${Date.now() - start}ms`, { category: CAT });
  return results;
}

module.exports = { run };
