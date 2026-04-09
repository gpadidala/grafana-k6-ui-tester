const config = require('../config');

class GrafanaClient {
  constructor(url, token) {
    this.baseUrl = url || config.grafanaUrl;
    this.token = token || config.grafanaToken;
    this._version = null;
    this._versionMajor = null;
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
  post(path, body) { return this.request(path, { method: 'POST', body: JSON.stringify(body) }); }

  // Try multiple endpoints in order, return first success
  async tryEndpoints(...paths) {
    for (const path of paths) {
      const res = await this.get(path);
      if (res.ok) return res;
    }
    // Return last failure
    return this.get(paths[paths.length - 1]);
  }

  // Detect Grafana version (cached)
  async getVersion() {
    if (this._version) return this._version;
    const h = await this.health();
    this._version = h.data?.version || 'unknown';
    this._versionMajor = parseInt(this._version.split('.')[0], 10) || 0;
    return this._version;
  }

  async getMajorVersion() {
    if (this._versionMajor !== null) return this._versionMajor;
    await this.getVersion();
    return this._versionMajor;
  }

  // ─── Core ───
  async health() { return this.get('/api/health'); }
  async buildInfo() { return this.get('/api/frontend/settings'); }

  // ─── Dashboards ───
  // /api/search works on all versions (9.x through 12.x)
  async searchDashboards() {
    return this.get('/api/search?type=dash-db&limit=5000');
  }

  async getDashboard(uid) { return this.get(`/api/dashboards/uid/${uid}`); }

  // ─── Folders ───
  // Grafana 11+: /api/folders (preferred)
  // Grafana 9-10: /api/search?type=dash-folder
  // Grafana 12+: /api/folders (same as 11)
  async searchFolders() {
    return this.tryEndpoints(
      '/api/folders?limit=1000',
      '/api/search?type=dash-folder&limit=1000'
    );
  }

  async getFolder(uid) {
    return this.tryEndpoints(
      `/api/folders/${uid}`,
      `/api/folders/id/${uid}`
    );
  }

  async getFolderPermissions(uid) {
    return this.tryEndpoints(
      `/api/folders/${uid}/permissions`,
      `/api/access-control/folders/${uid}`
    );
  }

  // ─── Data Sources ───
  async getDatasources() { return this.get('/api/datasources'); }

  async getDatasourceHealth(uid) {
    return this.tryEndpoints(
      `/api/datasources/uid/${uid}/health`,
      `/api/datasources/${uid}/health`
    );
  }

  // ─── Alerting ───
  // Grafana 11+: /api/v1/provisioning/alert-rules
  // Grafana 9-10: /api/ruler/grafana/api/v1/rules
  async getAlertRules() {
    return this.tryEndpoints(
      '/api/v1/provisioning/alert-rules',
      '/api/ruler/grafana/api/v1/rules'
    );
  }

  async getContactPoints() {
    return this.tryEndpoints(
      '/api/v1/provisioning/contact-points',
      '/api/v1/notifications/receivers'
    );
  }

  async getNotificationPolicies() {
    return this.tryEndpoints(
      '/api/v1/provisioning/policies',
      '/api/v1/notifications/policies'
    );
  }

  async getMuteTimings() {
    return this.tryEndpoints(
      '/api/v1/provisioning/mute-timings',
      '/api/v1/notifications/time-intervals'
    );
  }

  // ─── Plugins ───
  async getPlugins() { return this.get('/api/plugins?embedded=0'); }
  async getPluginHealth(id) { return this.get(`/api/plugins/${id}/health`); }
  async getPluginSettings(id) { return this.get(`/api/plugins/${id}/settings`); }

  // ─── Users & Access ───
  async getUsers() { return this.get('/api/org/users'); }
  async getOrgs() { return this.get('/api/orgs'); }

  async getTeams() {
    return this.tryEndpoints(
      '/api/teams/search?perpage=1000',
      '/api/teams?perpage=1000'
    );
  }

  async getServiceAccounts() {
    return this.tryEndpoints(
      '/api/serviceaccounts/search?perpage=1000',
      '/api/serviceaccounts?perpage=1000'
    );
  }

  // ─── Annotations ───
  async getAnnotations(limit = 100) { return this.get(`/api/annotations?limit=${limit}`); }

  // ─── Snapshots ───
  async getSnapshots() { return this.get('/api/dashboard/snapshots'); }
}

module.exports = GrafanaClient;
