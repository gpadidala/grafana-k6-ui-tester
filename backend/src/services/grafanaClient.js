const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

class GrafanaClient {
  constructor(url, token, orgId) {
    this.baseUrl = (url || config.grafana.url).replace(/\/$/, '');
    this.token = token || config.grafana.token;
    this.orgId = orgId || config.grafana.orgId;

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: config.thresholds.queryTimeoutMs,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        'X-Grafana-Org-Id': this.orgId,
      },
    });
  }

  async request(method, path, data, options = {}) {
    const start = process.hrtime.bigint();
    try {
      const res = await this.http.request({ method, url: path, data, ...options });
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      return { ok: true, status: res.status, data: res.data, ms: Math.round(ms) };
    } catch (err) {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const status = err.response?.status || 0;
      const data = err.response?.data || null;
      if (status !== 404 && status !== 403) {
        logger.warn(`API ${method} ${path} → ${status}`, { error: err.message });
      }
      return { ok: false, status, data, ms: Math.round(ms), error: err.message };
    }
  }

  get(path, params) { return this.request('GET', path, null, { params }); }
  post(path, body) { return this.request('POST', path, body); }
  put(path, body) { return this.request('PUT', path, body); }
  del(path) { return this.request('DELETE', path); }

  // Try multiple endpoints — return first success
  async tryEndpoints(...paths) {
    for (const p of paths) {
      const res = await this.get(p);
      if (res.ok) return res;
    }
    return this.get(paths[paths.length - 1]);
  }

  // ─── Health & Info ───
  async getHealth() { return this.get('/api/health'); }
  async getAdminStats() { return this.get('/api/admin/stats'); }
  async getBuildInfo() { return this.get('/api/frontend/settings'); }
  async getOrgPreferences() { return this.get('/api/org/preferences'); }
  async getCurrentOrg() { return this.get('/api/org'); }
  async getCurrentUser() { return this.get('/api/user'); }

  // ─── Dashboards ───
  async searchDashboards(query, limit = 5000, tags) {
    let path = `/api/search?type=dash-db&limit=${limit}`;
    if (query) path += `&query=${encodeURIComponent(query)}`;
    if (tags) path += `&tag=${encodeURIComponent(tags)}`;
    return this.get(path);
  }
  async getDashboardByUid(uid) { return this.get(`/api/dashboards/uid/${uid}`); }
  async getDashboardPermissions(id) { return this.get(`/api/dashboards/id/${id}/permissions`); }
  async getDashboardVersions(id, limit = 10) { return this.get(`/api/dashboards/id/${id}/versions?limit=${limit}`); }

  // ─── Data Sources ───
  async getDataSources() { return this.get('/api/datasources'); }
  async getDataSourceById(id) { return this.get(`/api/datasources/${id}`); }
  async getDataSourceByUid(uid) { return this.get(`/api/datasources/uid/${uid}`); }
  async testDataSource(uid) {
    return this.tryEndpoints(`/api/datasources/uid/${uid}/health`, `/api/datasources/${uid}/health`);
  }
  async queryViaProxy(body) { return this.post('/api/ds/query', body); }

  // ─── Alerts ───
  async getAlertRules() {
    return this.tryEndpoints('/api/v1/provisioning/alert-rules', '/api/ruler/grafana/api/v1/rules');
  }
  async getAlertRuleByUid(uid) { return this.get(`/api/v1/provisioning/alert-rules/${uid}`); }
  async getRulerRules() { return this.get('/api/ruler/grafana/api/v1/rules'); }
  async getContactPoints() {
    return this.tryEndpoints('/api/v1/provisioning/contact-points', '/api/v1/notifications/receivers');
  }
  async getNotificationPolicies() {
    return this.tryEndpoints('/api/v1/provisioning/policies', '/api/v1/notifications/policies');
  }
  async getMuteTimings() {
    return this.tryEndpoints('/api/v1/provisioning/mute-timings', '/api/v1/notifications/time-intervals');
  }
  async getAlertNotifications() { return this.get('/api/alert-notifications'); }
  async getSilences() { return this.get('/api/alertmanager/grafana/api/v2/silences'); }

  // ─── Plugins ───
  async getPlugins() { return this.get('/api/plugins?embedded=0'); }
  async getPluginSettings(id) { return this.get(`/api/plugins/${id}/settings`); }
  async getPluginHealth(id) { return this.get(`/api/plugins/${id}/health`); }

  // ─── Users & Orgs ───
  async getOrgUsers() { return this.get('/api/org/users'); }
  async getUserById(id) { return this.get(`/api/users/${id}`); }
  async getOrgs() { return this.get('/api/orgs'); }
  async getOrgById(id) { return this.get(`/api/orgs/${id}`); }
  async getTeams() { return this.tryEndpoints('/api/teams/search?perpage=1000', '/api/teams?perpage=1000'); }
  async getServiceAccounts() { return this.tryEndpoints('/api/serviceaccounts/search?perpage=1000', '/api/serviceaccounts?perpage=1000'); }

  // ─── Folders ───
  async getFolders() { return this.tryEndpoints('/api/folders?limit=1000', '/api/search?type=dash-folder&limit=1000'); }
  async getFolderByUid(uid) { return this.get(`/api/folders/${uid}`); }
  async getFolderPermissions(uid) { return this.tryEndpoints(`/api/folders/${uid}/permissions`, `/api/access-control/folders/${uid}`); }

  // ─── Other ───
  async getAnnotations(params = { limit: 200 }) { return this.get('/api/annotations', params); }
  async getSnapshots() { return this.get('/api/dashboard/snapshots'); }
  async getLibraryPanels() { return this.get('/api/library-elements?kind=1&perPage=1000'); }

  // ─── Org-switching (multi-org) ───
  withOrg(orgId) {
    return new GrafanaClient(this.baseUrl, this.token, String(orgId));
  }
}

module.exports = GrafanaClient;
