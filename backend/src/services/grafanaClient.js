const config = require('../config');

class GrafanaClient {
  constructor(url, token) {
    this.baseUrl = url || config.grafanaUrl;
    this.token = token || config.grafanaToken;
  }

  async request(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...options.headers,
    };

    const start = Date.now();
    try {
      const res = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(15000) });
      const ms = Date.now() - start;
      const body = res.headers.get('content-type')?.includes('json') ? await res.json().catch(() => null) : await res.text().catch(() => '');
      return { ok: res.ok, status: res.status, data: body, ms };
    } catch (err) {
      return { ok: false, status: 0, data: null, ms: Date.now() - start, error: err.message };
    }
  }

  get(path) { return this.request(path); }

  post(path, body) {
    return this.request(path, { method: 'POST', body: JSON.stringify(body) });
  }

  // Convenience methods
  async health() { return this.get('/api/health'); }
  async buildInfo() { return this.get('/api/frontend/settings'); }
  async searchDashboards() { return this.get('/api/search?type=dash-db&limit=5000'); }
  async getDashboard(uid) { return this.get(`/api/dashboards/uid/${uid}`); }
  async searchFolders() {
    // Grafana 11.x uses /api/folders, older versions use /api/search?type=dash-folder
    const res = await this.get('/api/folders?limit=1000');
    if (res.ok) return res;
    return this.get('/api/search?type=dash-folder&limit=1000');
  }
  async getFolder(uid) { return this.get(`/api/folders/${uid}`); }
  async getFolderPermissions(uid) { return this.get(`/api/folders/${uid}/permissions`); }
  async getDatasources() { return this.get('/api/datasources'); }
  async getDatasourceHealth(uid) { return this.get(`/api/datasources/uid/${uid}/health`); }
  async getAlertRules() { return this.get('/api/v1/provisioning/alert-rules'); }
  async getContactPoints() { return this.get('/api/v1/provisioning/contact-points'); }
  async getNotificationPolicies() { return this.get('/api/v1/provisioning/policies'); }
  async getMuteTimings() { return this.get('/api/v1/provisioning/mute-timings'); }
  async getPlugins() { return this.get('/api/plugins?embedded=0'); }
  async getPluginHealth(id) { return this.get(`/api/plugins/${id}/health`); }
  async getUsers() { return this.get('/api/org/users'); }
  async getOrgs() { return this.get('/api/orgs'); }
  async getTeams() { return this.get('/api/teams/search?perpage=1000'); }
  async getServiceAccounts() { return this.get('/api/serviceaccounts/search?perpage=1000'); }
  async getAnnotations(limit = 100) { return this.get(`/api/annotations?limit=${limit}`); }
  async getSnapshots() { return this.get('/api/dashboard/snapshots'); }
}

module.exports = GrafanaClient;
