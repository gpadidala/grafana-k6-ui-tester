'use strict';
/**
 * core/grafana-client.js — Complete Grafana HTTP API v1 client
 * Supports Grafana 9.x — 12.x with graceful version fallbacks
 */

const axios = require('axios');

class GrafanaClient {
  /**
   * @param {string} baseUrl  - e.g. "http://localhost:3000"
   * @param {string} token    - Service account token (Bearer)
   * @param {object} opts     - { orgId, timeoutMs, retries, retryDelayMs }
   */
  constructor(baseUrl, token, opts = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.orgId = opts.orgId || 1;
    this.timeoutMs = opts.timeoutMs || 15000;
    this.retries = opts.retries || 3;
    this.retryDelayMs = opts.retryDelayMs || 500;
    this._versionCache = null;

    this._axios = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeoutMs,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Grafana-Org-Id': String(this.orgId),
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Internal HTTP helpers
  // ─────────────────────────────────────────────────────────────────────────────

  async _request(method, path, data, attempt = 1) {
    const start = Date.now();
    try {
      const res = await this._axios.request({ method, url: path, data });
      return { ok: true, status: res.status, data: res.data, ms: Date.now() - start };
    } catch (err) {
      const status = err.response?.status;
      const errData = err.response?.data;
      const ms = Date.now() - start;

      // Retry on 429, 503, network errors (not on 4xx auth/not-found)
      const retryable = !status || status === 429 || status >= 500;
      if (retryable && attempt < this.retries) {
        await this._sleep(this.retryDelayMs * attempt);
        return this._request(method, path, data, attempt + 1);
      }

      return {
        ok: false,
        status: status || 0,
        data: errData || null,
        ms,
        error: err.message,
      };
    }
  }

  async get(path)          { return this._request('GET', path); }
  async post(path, body)   { return this._request('POST', path, body); }
  async put(path, body)    { return this._request('PUT', path, body); }
  async patch(path, body)  { return this._request('PATCH', path, body); }
  async delete(path)       { return this._request('DELETE', path); }

  /** Try multiple endpoints, return first 2xx or last response */
  async _tryEndpoints(...paths) {
    let last;
    for (const p of paths) {
      last = await this.get(p);
      if (last.ok) return last;
    }
    return last;
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ─────────────────────────────────────────────────────────────────────────────
  // Health & version
  // ─────────────────────────────────────────────────────────────────────────────

  async getHealth() {
    return this.get('/api/health');
  }

  async getVersion() {
    if (this._versionCache) return this._versionCache;
    const res = await this.get('/api/frontend/settings');
    if (res.ok && res.data?.buildInfo?.version) {
      this._versionCache = res.data.buildInfo.version;
    } else {
      const h = await this.getHealth();
      this._versionCache = h.data?.version || 'unknown';
    }
    return this._versionCache;
  }

  async getMajorVersion() {
    const v = await this.getVersion();
    return parseInt((v || '0').split('.')[0], 10);
  }

  async getStats() {
    return this.get('/api/admin/stats');
  }

  async getSettings() {
    return this.get('/api/admin/settings');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Dashboards
  // ─────────────────────────────────────────────────────────────────────────────

  async searchDashboards(query = '', tags = [], limit = 5000) {
    const params = new URLSearchParams({ type: 'dash-db', limit: String(limit) });
    if (query) params.set('query', query);
    tags.forEach(t => params.append('tag', t));
    return this.get(`/api/search?${params}`);
  }

  async getDashboard(uid) {
    return this.get(`/api/dashboards/uid/${uid}`);
  }

  async getDashboardVersions(uid, limit = 20) {
    return this.get(`/api/dashboards/uid/${uid}/versions?limit=${limit}`);
  }

  async getAllDashboardUIDs() {
    const res = await this.searchDashboards('', [], 5000);
    if (!res.ok) return [];
    return (res.data || []).map(d => d.uid).filter(Boolean);
  }

  async createDashboard(dashboardJson, folderId = 0, overwrite = false) {
    return this.post('/api/dashboards/db', {
      dashboard: dashboardJson,
      folderId,
      overwrite,
    });
  }

  async getDashboardTags() {
    return this.get('/api/dashboards/tags');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Folders
  // ─────────────────────────────────────────────────────────────────────────────

  async getFolders(limit = 1000) {
    return this._tryEndpoints(
      `/api/folders?limit=${limit}`,
      `/api/search?type=dash-folder&limit=${limit}`,
    );
  }

  async getFolder(uid) {
    return this.get(`/api/folders/${uid}`);
  }

  async getFolderPermissions(uid) {
    return this.get(`/api/folders/${uid}/permissions`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Alerts (Unified Alerting — Grafana 9+)
  // ─────────────────────────────────────────────────────────────────────────────

  async getAlertRules() {
    return this._tryEndpoints(
      '/api/v1/provisioning/alert-rules',
      '/api/ruler/grafana/api/v1/rules',
    );
  }

  async getAlertGroups() {
    return this.get('/api/alertmanager/grafana/api/v2/alerts/groups');
  }

  async getAlertInstances() {
    return this.get('/api/alertmanager/grafana/api/v2/alerts');
  }

  async getSilences() {
    return this.get('/api/alertmanager/grafana/api/v2/silences');
  }

  async getContactPoints() {
    return this._tryEndpoints(
      '/api/v1/provisioning/contact-points',
      '/api/alertmanager/grafana/config/api/v1/receivers',
    );
  }

  async getNotificationPolicies() {
    return this._tryEndpoints(
      '/api/v1/provisioning/policies',
      '/api/alertmanager/grafana/config/api/v1/route',
    );
  }

  async getMuteTimings() {
    return this._tryEndpoints(
      '/api/v1/provisioning/mute-timings',
      '/api/alertmanager/grafana/config/api/v1/muteTimings',
    );
  }

  async getAlertHistory() {
    return this.get('/api/annotations?type=alert&limit=100');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Data sources
  // ─────────────────────────────────────────────────────────────────────────────

  async getDatasources() {
    return this.get('/api/datasources');
  }

  async getDatasource(id) {
    return this.get(`/api/datasources/${id}`);
  }

  async getDatasourceByUID(uid) {
    return this.get(`/api/datasources/uid/${uid}`);
  }

  async testDatasource(id) {
    return this.get(`/api/datasources/${id}/health`);
  }

  async queryDatasource(uid, query) {
    return this.post(`/api/ds/query`, {
      queries: [{ ...query, datasource: { uid } }],
      from: 'now-1h',
      to: 'now',
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Plugins
  // ─────────────────────────────────────────────────────────────────────────────

  async getInstalledPlugins() {
    return this.get('/api/plugins?embedded=0');
  }

  async getPlugin(id) {
    return this.get(`/api/plugins/${id}/settings`);
  }

  async getPluginSettings(id) {
    return this.get(`/api/plugins/${id}/settings`);
  }

  async getPluginDashboards(id) {
    return this.get(`/api/plugins/${id}/dashboards`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Users & Teams
  // ─────────────────────────────────────────────────────────────────────────────

  async getUsers(perpage = 1000, page = 1) {
    return this.get(`/api/users?perpage=${perpage}&page=${page}`);
  }

  async getTeams(perpage = 1000, page = 1) {
    return this.get(`/api/teams/search?perpage=${perpage}&page=${page}`);
  }

  async getTeamMembers(teamId) {
    return this.get(`/api/teams/${teamId}/members`);
  }

  async getOrgUsers(orgId = null) {
    const id = orgId || this.orgId;
    return this.get(`/api/orgs/${id}/users`);
  }

  async getCurrentUser() {
    return this.get('/api/user');
  }

  async getOrgs() {
    return this.get('/api/orgs');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Annotations
  // ─────────────────────────────────────────────────────────────────────────────

  async getAnnotations(params = {}) {
    const qs = new URLSearchParams({ limit: '200', ...params }).toString();
    return this.get(`/api/annotations?${qs}`);
  }

  async createTestAnnotation(dashboardUID = null) {
    const body = {
      text: `Sentinel test annotation — ${new Date().toISOString()}`,
      tags: ['sentinel', 'test'],
    };
    if (dashboardUID) body.dashboardUID = dashboardUID;
    return this.post('/api/annotations', body);
  }

  async deleteAnnotation(id) {
    return this.delete(`/api/annotations/${id}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Enterprise endpoints (gracefully no-op on OSS)
  // ─────────────────────────────────────────────────────────────────────────────

  async getLicenseInfo() {
    return this._tryEndpoints('/api/licensing/check', '/api/licensing');
  }

  async getUsageInsights() {
    return this.get('/api/usage-insights/summary');
  }

  async getReportingSchedules() {
    return this.get('/api/reports');
  }

  async getDataSourcePermissions(datasourceId) {
    return this.get(`/api/datasources/${datasourceId}/permissions`);
  }

  async getRoleAssignments() {
    return this.get('/apis/iam.grafana.app/v0alpha1/namespaces/default/rolebindings');
  }

  async getTeamRoles(teamId) {
    return this.get(`/api/access-control/teams/${teamId}/roles`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Service accounts
  // ─────────────────────────────────────────────────────────────────────────────

  async getServiceAccounts() {
    return this.get('/api/serviceaccounts/search?perpage=1000');
  }

  async getServiceAccountTokens(id) {
    return this.get(`/api/serviceaccounts/${id}/tokens`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Provisioning
  // ─────────────────────────────────────────────────────────────────────────────

  async getProvisionedDashboards() {
    return this.get('/api/provisioning/dashboards');
  }

  async getProvisionedDatasources() {
    return this.get('/api/provisioning/datasources');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Kubernetes-style API (Grafana 10+)
  // ─────────────────────────────────────────────────────────────────────────────

  async k8sDashboardList(namespace = 'default') {
    return this.get(`/apis/dashboard.grafana.app/v0alpha1/namespaces/${namespace}/dashboards`);
  }

  async k8sAlertRuleList(namespace = 'default') {
    return this.get(`/apis/alerting.grafana.app/v0alpha1/namespaces/${namespace}/alertrules`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Convenience: build a complete instance summary
  // ─────────────────────────────────────────────────────────────────────────────

  async getInstanceSummary() {
    const [health, version, stats, dashboards, datasources, plugins, users, alertRules] =
      await Promise.allSettled([
        this.getHealth(),
        this.getVersion(),
        this.getStats(),
        this.searchDashboards(),
        this.getDatasources(),
        this.getInstalledPlugins(),
        this.getUsers(),
        this.getAlertRules(),
      ]);

    const v = r => (r.status === 'fulfilled' ? r.value : { ok: false, data: null });

    return {
      health: v(health).data,
      version: version.status === 'fulfilled' ? version.value : 'unknown',
      stats: v(stats).data,
      dashboard_count: Array.isArray(v(dashboards).data) ? v(dashboards).data.length : 0,
      datasource_count: Array.isArray(v(datasources).data) ? v(datasources).data.length : 0,
      plugin_count: Array.isArray(v(plugins).data) ? v(plugins).data.length : 0,
      user_count: Array.isArray(v(users).data) ? v(users).data.length : 0,
      alert_rule_count: Array.isArray(v(alertRules).data) ? v(alertRules).data.length : 0,
    };
  }
}

module.exports = { GrafanaClient };
