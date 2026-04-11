const axios = require('axios');
const { v4: uuid } = require('uuid');
const logger = require('../utils/logger');
const config = require('../config');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PLANS = [
  { id: 'api-health-load', name: 'API Health Load', icon: '💚', group: 'core', duration: '5min', desc: 'Health endpoints under 50-100 users' },
  { id: 'auth-stress', name: 'Auth Stress', icon: '🔐', group: 'core', duration: '3min', desc: 'Login/token generation throughput' },
  { id: 'dashboard-load', name: 'Dashboard Load Sim', icon: '📊', group: 'core', duration: '10min', desc: 'Concurrent dashboard viewing' },
  { id: 'ds-query-stress', name: 'DS Query Stress', icon: '🗄', group: 'core', duration: '8min', desc: 'Query execution per DS type' },
  { id: 'ds-health', name: 'DS Health Check', icon: '🏥', group: 'core', duration: '3min', desc: 'DS proxy endpoints under load' },
  { id: 'alert-eval', name: 'Alert Eval Load', icon: '🔔', group: 'core', duration: '5min', desc: 'Alert pipeline performance' },
  { id: 'plugin-api', name: 'Plugin API Perf', icon: '🧩', group: 'core', duration: '3min', desc: 'Plugin endpoints under load' },
  { id: 'user-mgmt', name: 'User Mgmt Load', icon: '👥', group: 'core', duration: '3min', desc: 'User/team/org API performance' },
  { id: 'search-perf', name: 'Search Performance', icon: '🔍', group: 'core', duration: '3min', desc: 'Dashboard search throughput' },
  { id: 'annotation-throughput', name: 'Annotation Throughput', icon: '🏷', group: 'core', duration: '3min', desc: 'Annotation read/write' },
  { id: 'folder-api', name: 'Folder API Perf', icon: '📁', group: 'core', duration: '3min', desc: 'Folder hierarchy performance' },
  { id: 'explore-query', name: 'Explore Query Load', icon: '🔭', group: 'core', duration: '5min', desc: 'Explore page API load' },
  { id: 'mixed-workload', name: 'Mixed Workload', icon: '🌐', group: 'scenario', duration: '15min', desc: 'Realistic user simulation' },
  { id: 'spike-test', name: 'Spike Test', icon: '⚡', group: 'scenario', duration: '5min', desc: 'Sudden 20x traffic burst' },
  { id: 'soak-test', name: 'Soak Test', icon: '🕐', group: 'scenario', duration: '30min+', desc: 'Extended endurance run' },
  { id: 'capacity-planning', name: 'Capacity Planning', icon: '📈', group: 'scenario', duration: '15min', desc: 'Step-ladder to breaking point' },
  { id: 'deployment-check', name: 'Deployment Check', icon: '🚀', group: 'scenario', duration: '<3min', desc: 'Quick CI/CD validation' },
  { id: 'k8s-dashboard', name: 'K8s Dashboard Load', icon: '☸️', group: 'scenario', duration: '5min', desc: 'K8s monitoring stress' },
];

const SUITES = {
  deployment: ['api-health-load', 'deployment-check'],
  smoke: ['api-health-load', 'dashboard-load', 'ds-query-stress', 'alert-eval'],
  load: ['api-health-load', 'dashboard-load', 'ds-query-stress', 'ds-health', 'alert-eval', 'plugin-api', 'search-perf', 'folder-api'],
  stress: ['spike-test', 'capacity-planning'],
  soak: ['soak-test'],
  regression: ['api-health-load', 'dashboard-load', 'ds-query-stress', 'alert-eval', 'plugin-api', 'mixed-workload'],
};

class JMeterRunner {
  constructor(grafanaUrl, token) {
    this.grafanaUrl = grafanaUrl || config.grafana.url;
    this.token = token || config.grafana.token;
    this.resultsDir = path.resolve('jmeter/results');
    if (!fs.existsSync(this.resultsDir)) fs.mkdirSync(this.resultsDir, { recursive: true });
  }

  getPlans() { return PLANS; }
  getSuites() { return Object.entries(SUITES).map(([id, plans]) => ({ id, plans, planCount: plans.length })); }

  async runPlans(planIds, options = {}, onProgress) {
    const threads = options.threads || 20;
    const durationSec = options.duration || 60;
    const datasourceFilter = options.datasourceFilter || null;
    const runId = uuid();
    const results = [];

    // Resolve the filter to a concrete DS record (for scoped health/query
    // endpoints in ds-query-stress). Best-effort — if the lookup fails we
    // just run the plan without scoping.
    let scopedDs = null;
    if (datasourceFilter && (datasourceFilter.uid || datasourceFilter.name)) {
      try {
        const axios = require('axios');
        const headers = this.token ? { Authorization: `Bearer ${this.token}` } : {};
        const r = await axios.get(`${this.grafanaUrl}/api/datasources`, { headers, timeout: 10000, validateStatus: () => true });
        if (r.status === 200 && Array.isArray(r.data)) {
          const needleUid = (datasourceFilter.uid || '').toLowerCase();
          const needleName = (datasourceFilter.name || '').toLowerCase();
          scopedDs = r.data.find((d) =>
            (needleUid && String(d.uid).toLowerCase() === needleUid) ||
            (needleName && String(d.name).toLowerCase() === needleName)
          );
        }
      } catch (_) { /* ignore */ }
    }
    this._scopedDs = scopedDs;

    for (const planId of planIds) {
      const plan = PLANS.find(p => p.id === planId);
      if (!plan) continue;

      if (onProgress) onProgress({ type: 'jm_plan_start', planId, planName: plan.name, icon: plan.icon });

      const planResult = await this._executePlan(planId, threads, durationSec, onProgress, runId);
      results.push({ ...plan, ...planResult });

      if (onProgress) onProgress({ type: 'jm_plan_done', planId, result: planResult });
    }

    const allSamples = results.flatMap(r => r.samples || []);
    const totalReqs = allSamples.length;
    const errors = allSamples.filter(s => !s.success).length;
    const times = allSamples.map(s => s.ms).sort((a, b) => a - b);

    const summary = {
      totalRequests: totalReqs,
      errorRate: totalReqs > 0 ? `${((errors / totalReqs) * 100).toFixed(2)}%` : '0%',
      avgResponseTime: totalReqs > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / totalReqs) : 0,
      p50: times[Math.floor(times.length * 0.5)] || 0,
      p95: times[Math.floor(times.length * 0.95)] || 0,
      p99: times[Math.floor(times.length * 0.99)] || 0,
      throughput: totalReqs > 0 ? `${(totalReqs / durationSec).toFixed(1)} req/s` : '0 req/s',
      plans: results.length,
    };

    return { runId, summary, plans: results, status: errors > totalReqs * 0.01 ? 'failed' : 'passed' };
  }

  async _executePlan(planId, threads, durationSec, onProgress, runId) {
    const endpoints = this._getEndpointsForPlan(planId);
    const samples = [];
    const startTime = Date.now();
    const endTime = startTime + (Math.min(durationSec, 30) * 1000); // Cap at 30s for built-in runner

    const headers = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    headers['Content-Type'] = 'application/json';

    // Simulate concurrent requests
    const concurrency = Math.min(threads, 10); // Cap concurrency for safety
    let requestCount = 0;

    while (Date.now() < endTime) {
      const batch = endpoints.slice(0, concurrency).map(async (ep) => {
        const start = Date.now();
        try {
          const res = await axios({ method: ep.method || 'GET', url: `${this.grafanaUrl}${ep.path}`, headers, timeout: 15000, data: ep.body, validateStatus: () => true });
          const ms = Date.now() - start;
          const success = res.status >= 200 && res.status < 400;
          requestCount++;
          const sample = { label: ep.name, ms, success, status: res.status, bytes: JSON.stringify(res.data || '').length };
          samples.push(sample);

          if (onProgress && requestCount % 5 === 0) {
            onProgress({ type: 'jm_sample', runId, planId, label: ep.name, ms, success, status: res.status });
          }
          return sample;
        } catch (e) {
          const ms = Date.now() - start;
          samples.push({ label: ep.name, ms, success: false, status: 0, error: e.message });
          return null;
        }
      });

      await Promise.all(batch);
      await new Promise(r => setTimeout(r, 100)); // think time
    }

    const times = samples.map(s => s.ms).sort((a, b) => a - b);
    const errors = samples.filter(s => !s.success).length;
    const elapsed = Date.now() - startTime;

    return {
      samples,
      summary: {
        total: samples.length,
        errors,
        errorRate: samples.length > 0 ? `${((errors / samples.length) * 100).toFixed(1)}%` : '0%',
        avgMs: samples.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / samples.length) : 0,
        p50: times[Math.floor(times.length * 0.5)] || 0,
        p95: times[Math.floor(times.length * 0.95)] || 0,
        p99: times[Math.floor(times.length * 0.99)] || 0,
        throughput: `${(samples.length / (elapsed / 1000)).toFixed(1)} req/s`,
        duration: elapsed,
      },
      status: errors > samples.length * 0.01 ? 'FAIL' : 'PASS',
    };
  }

  _getEndpointsForPlan(planId) {
    const base = [
      { name: 'Health', path: '/api/health' },
      { name: 'Current User', path: '/api/user' },
      { name: 'Current Org', path: '/api/org' },
    ];
    const plans = {
      'api-health-load': [...base, { name: 'Frontend Settings', path: '/api/frontend/settings' }, { name: 'DS List', path: '/api/datasources' }, { name: 'Dashboard Search', path: '/api/search?type=dash-db&limit=10' }, { name: 'Folders', path: '/api/folders?limit=20' }, { name: 'Alert Rules', path: '/api/v1/provisioning/alert-rules' }, { name: 'Plugins', path: '/api/plugins?embedded=0' }, { name: 'Annotations', path: '/api/annotations?limit=10' }],
      'auth-stress': [{ name: 'Login', path: '/login', method: 'POST', body: { user: 'admin', password: 'admin' } }, { name: 'User Session', path: '/api/user' }],
      'dashboard-load': [...base, { name: 'Search', path: '/api/search?type=dash-db&limit=50' }, { name: 'Folders', path: '/api/folders?limit=100' }],
      'ds-query-stress': this._scopedDs
        ? [
            ...base,
            { name: `DS Health: ${this._scopedDs.name}`, path: `/api/datasources/uid/${this._scopedDs.uid}/health` },
            { name: `DS Meta: ${this._scopedDs.name}`, path: `/api/datasources/uid/${this._scopedDs.uid}` },
            { name: 'DS List', path: '/api/datasources' },
          ]
        : [...base, { name: 'DS List', path: '/api/datasources' }],
      'ds-health': this._scopedDs
        ? [
            { name: `DS Health: ${this._scopedDs.name}`, path: `/api/datasources/uid/${this._scopedDs.uid}/health` },
          ]
        : [{ name: 'DS List', path: '/api/datasources' }],
      'alert-eval': [{ name: 'Alert Rules', path: '/api/v1/provisioning/alert-rules' }, { name: 'Contact Points', path: '/api/v1/provisioning/contact-points' }, { name: 'Policies', path: '/api/v1/provisioning/policies' }, { name: 'Silences', path: '/api/alertmanager/grafana/api/v2/silences' }],
      'plugin-api': [{ name: 'Plugins', path: '/api/plugins?embedded=0' }],
      'user-mgmt': [{ name: 'Org Users', path: '/api/org/users' }, { name: 'Teams', path: '/api/teams/search?perpage=100' }],
      'search-perf': [{ name: 'Search All', path: '/api/search?limit=100' }, { name: 'Search DB', path: '/api/search?type=dash-db&limit=100' }, { name: 'Search Folder', path: '/api/search?type=dash-folder&limit=100' }],
      'annotation-throughput': [{ name: 'Annotations', path: '/api/annotations?limit=100' }],
      'folder-api': [{ name: 'Folders', path: '/api/folders?limit=100' }],
      'explore-query': [...base, { name: 'DS List', path: '/api/datasources' }],
      'mixed-workload': [...base, { name: 'Search', path: '/api/search?type=dash-db&limit=20' }, { name: 'Folders', path: '/api/folders?limit=20' }, { name: 'Alerts', path: '/api/v1/provisioning/alert-rules' }, { name: 'Plugins', path: '/api/plugins?embedded=0' }],
      'spike-test': [...base, { name: 'Search', path: '/api/search?limit=50' }],
      'soak-test': [...base, { name: 'Search', path: '/api/search?limit=10' }],
      'capacity-planning': [...base, { name: 'Search', path: '/api/search?type=dash-db&limit=50' }, { name: 'DS', path: '/api/datasources' }],
      'deployment-check': [...base, { name: 'DS', path: '/api/datasources' }, { name: 'Search', path: '/api/search?type=dash-db&limit=5' }, { name: 'Alerts', path: '/api/v1/provisioning/alert-rules' }],
      'k8s-dashboard': [...base, { name: 'K8s Search', path: '/api/search?type=dash-db&tag=kubernetes&limit=50' }],
    };
    return plans[planId] || base;
  }
}

module.exports = JMeterRunner;
