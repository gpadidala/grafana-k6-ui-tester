// Grafana HTTP API Client
// Uses k6/http for API discovery - fetches dashboards, alerts, folders, datasources, plugins

import http from 'k6/http';
import config, { buildUrl, getAuthHeaders, getItemLimit } from '../config/grafana.config.js';

function apiGet(path) {
  const url = buildUrl(path);
  const res = http.get(url, { headers: getAuthHeaders(), timeout: '30s' });
  if (res.status !== 200) {
    console.warn(`API GET ${path} returned status ${res.status}`);
    return null;
  }
  try {
    return res.json();
  } catch (e) {
    console.warn(`API GET ${path} failed to parse JSON: ${e.message}`);
    return null;
  }
}

export function getGrafanaHealth() {
  const data = apiGet('/api/health');
  return data || { version: 'unknown', database: 'unknown' };
}

export function searchDashboards() {
  const results = [];
  let page = 1;
  const limit = 1000;

  while (true) {
    const data = apiGet(`/api/search?type=dash-db&limit=${limit}&page=${page}`);
    if (!data || !Array.isArray(data) || data.length === 0) break;
    results.push(...data);
    if (data.length < limit) break;
    page++;
  }

  const itemLimit = getItemLimit();
  const dashboards = results.slice(0, itemLimit).map((d) => ({
    uid: d.uid,
    title: d.title,
    url: d.url || `/d/${d.uid}`,
    folderTitle: d.folderTitle || 'General',
    tags: d.tags || [],
    createdBy: '',
    updatedBy: '',
    created: '',
    updated: '',
  }));

  // Fetch per-dashboard metadata (creator, updated info)
  for (const d of dashboards) {
    const detail = apiGet(`/api/dashboards/uid/${d.uid}`);
    if (detail && detail.meta) {
      d.createdBy = detail.meta.createdBy || '';
      d.updatedBy = detail.meta.updatedBy || '';
      d.created = detail.meta.created || '';
      d.updated = detail.meta.updated || '';
    }
  }

  return dashboards;
}

export function searchFolders() {
  const data = apiGet('/api/search?type=dash-folder&limit=1000');
  if (!data || !Array.isArray(data)) return [];
  return data.map((f) => ({
    uid: f.uid,
    title: f.title,
    url: f.url || `/dashboards/f/${f.uid}`,
  }));
}

export function getAlertRules() {
  const data = apiGet('/api/v1/provisioning/alert-rules');
  if (!data || !Array.isArray(data)) {
    // Try legacy endpoint
    const legacyData = apiGet('/api/ruler/grafana/api/v1/rules');
    if (legacyData && typeof legacyData === 'object') {
      const rules = [];
      for (const ns of Object.values(legacyData)) {
        if (Array.isArray(ns)) {
          for (const group of ns) {
            if (group.rules) rules.push(...group.rules);
          }
        }
      }
      return rules.slice(0, getItemLimit());
    }
    return [];
  }
  return data.slice(0, getItemLimit()).map((r) => ({
    uid: r.uid,
    title: r.title,
    folderUID: r.folderUID,
    ruleGroup: r.ruleGroup,
    condition: r.condition,
  }));
}

export function getDatasources() {
  const data = apiGet('/api/datasources');
  if (!data || !Array.isArray(data)) return [];
  return data.map((ds) => ({
    id: ds.id,
    uid: ds.uid,
    name: ds.name,
    type: ds.type,
    url: ds.url,
    isDefault: ds.isDefault,
  }));
}

export function getPlugins() {
  const data = apiGet('/api/plugins?embedded=0');
  if (!data || !Array.isArray(data)) return [];
  return data.slice(0, getItemLimit()).map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    enabled: p.enabled,
    info: p.info ? { version: p.info.version, description: p.info.description } : {},
  }));
}

export function discoverAll() {
  console.log('Starting Grafana discovery...');

  const health = getGrafanaHealth();
  console.log(`Grafana version: ${health.version}`);

  const dashboards = searchDashboards();
  console.log(`Discovered ${dashboards.length} dashboards`);

  const folders = searchFolders();
  console.log(`Discovered ${folders.length} folders`);

  const alertRules = getAlertRules();
  console.log(`Discovered ${alertRules.length} alert rules`);

  const datasources = getDatasources();
  console.log(`Discovered ${datasources.length} datasources`);

  const plugins = getPlugins();
  console.log(`Discovered ${plugins.length} plugins`);

  return {
    version: health.version,
    dashboards,
    folders,
    alertRules,
    datasources,
    plugins,
    discoveredAt: new Date().toISOString(),
    testLevel: config.test.level,
  };
}

export default {
  apiGet,
  getGrafanaHealth,
  searchDashboards,
  searchFolders,
  getAlertRules,
  getDatasources,
  getPlugins,
  discoverAll,
};
