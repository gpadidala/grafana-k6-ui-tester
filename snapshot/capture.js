'use strict';
/**
 * snapshot/capture.js — Export full Grafana state to disk.
 * Captures: all dashboard JSONs, alert rules, datasource list, plugin list with versions,
 * screenshots (optional), performance baseline, Grafana version.
 * Output: snapshots/pre/ (or user-specified directory)
 */

const path = require('path');
const fs   = require('fs');
const { GrafanaClient }   = require('../core/grafana-client');
const { SnapshotManager } = require('../core/snapshot-manager');

class SnapshotCapture {
  /**
   * @param {GrafanaClient} client
   * @param {object} opts
   * @param {string} opts.outputDir     - Root snapshot directory
   * @param {string} opts.label         - Snapshot label (e.g. "pre-upgrade-v11")
   * @param {boolean} opts.screenshots  - Include screenshots (requires puppeteer)
   * @param {boolean} opts.performance  - Include performance baseline
   * @param {function} opts.onProgress  - Progress callback(step, total, message)
   */
  constructor(client, opts = {}) {
    this.client     = client;
    this.outputDir  = path.resolve(opts.outputDir || './snapshots/pre');
    this.label      = opts.label || `snapshot-${timestamp()}`;
    this.screenshots = opts.screenshots || false;
    this.performance = opts.performance !== false;
    this.onProgress  = opts.onProgress || (() => {});
    this.manager     = new SnapshotManager(path.dirname(this.outputDir));
  }

  async capture() {
    this.onProgress(0, 7, 'Starting snapshot capture...');

    const version = await this.client.getVersion();
    const grafanaUrl = this.client.baseUrl;

    // Step 1: Dashboards
    this.onProgress(1, 7, 'Fetching dashboards...');
    const dashboards = await this._captureDashboards();

    // Step 2: Alert rules
    this.onProgress(2, 7, 'Fetching alert rules...');
    const alerts = await this._captureAlertRules();

    // Step 3: Datasources
    this.onProgress(3, 7, 'Fetching datasources...');
    const datasources = await this._captureDatasources();

    // Step 4: Plugins
    this.onProgress(4, 7, 'Fetching plugins...');
    const plugins = await this._capturePlugins();

    // Step 5: Performance baseline
    let performance = null;
    if (this.performance) {
      this.onProgress(5, 7, 'Measuring performance baseline...');
      performance = await this._capturePerformanceBaseline();
    }

    // Step 6: Screenshots (optional)
    if (this.screenshots) {
      this.onProgress(6, 7, 'Taking screenshots...');
      await this._captureScreenshots(dashboards.slice(0, 20));
    }

    // Step 7: Save
    this.onProgress(7, 7, 'Saving snapshot...');
    const result = this.manager.save(this.label, {
      dashboards,
      alerts,
      datasources,
      plugins,
      performance,
      meta: {
        grafana_url:     grafanaUrl,
        grafana_version: version,
        captured_at:     new Date().toISOString(),
        dashboard_count: dashboards.length,
        alert_count:     alerts.length,
        datasource_count: datasources.length,
        plugin_count:    plugins.length,
      },
    });

    return {
      label:    this.label,
      dir:      result.dir,
      manifest: result.manifest,
      counts: {
        dashboards:  dashboards.length,
        alerts:      alerts.length,
        datasources: datasources.length,
        plugins:     plugins.length,
      },
    };
  }

  async _captureDashboards() {
    const searchRes = await this.client.searchDashboards('', [], 5000);
    if (!searchRes.ok) return [];

    const dashboards  = [];
    const summaries   = searchRes.data || [];
    const batchSize   = 5;

    for (let i = 0; i < summaries.length; i += batchSize) {
      const batch = summaries.slice(i, i + batchSize);
      const details = await Promise.allSettled(
        batch.map(s => this.client.getDashboard(s.uid)),
      );
      for (const r of details) {
        if (r.status === 'fulfilled' && r.value.ok) {
          dashboards.push(r.value.data);
        }
      }
      await sleep(100); // Rate limit
    }

    return dashboards;
  }

  async _captureAlertRules() {
    const res = await this.client.getAlertRules();
    if (!res.ok) return [];
    const data = res.data;
    if (Array.isArray(data)) return data;
    // Ruler API grouped format
    const rules = [];
    if (data && typeof data === 'object') {
      for (const ns of Object.values(data)) {
        if (Array.isArray(ns)) {
          for (const group of ns) {
            if (Array.isArray(group.rules)) rules.push(...group.rules);
          }
        }
      }
    }
    return rules;
  }

  async _captureDatasources() {
    const res = await this.client.getDatasources();
    if (!res.ok) return [];
    return res.data || [];
  }

  async _capturePlugins() {
    const res = await this.client.getInstalledPlugins();
    if (!res.ok) return [];
    return (res.data || []).map(p => ({
      id:      p.id,
      name:    p.name,
      type:    p.type,
      version: p.info?.version || 'unknown',
      enabled: p.enabled,
    }));
  }

  async _capturePerformanceBaseline() {
    const samples = [];
    for (let i = 0; i < 10; i++) {
      const start = Date.now();
      await this.client.getHealth();
      samples.push(Date.now() - start);
      await sleep(200);
    }

    const sorted = [...samples].sort((a, b) => a - b);
    return {
      api_health_p50_ms: sorted[Math.floor(sorted.length * 0.5)],
      api_health_p95_ms: sorted[Math.floor(sorted.length * 0.95)],
      api_health_p99_ms: sorted[sorted.length - 1],
      api_health_mean_ms: Math.round(samples.reduce((a, b) => a + b, 0) / samples.length),
      samples,
      measured_at: new Date().toISOString(),
    };
  }

  async _captureScreenshots(dashboards) {
    let ScreenshotEngine;
    try {
      ScreenshotEngine = require('../core/screenshot-engine').ScreenshotEngine;
    } catch {
      console.warn('[Snapshot] puppeteer not available — skipping screenshots');
      return;
    }

    const engine = new ScreenshotEngine({
      outputDir:   path.join(path.dirname(this.outputDir), this.label, 'screenshots'),
      grafanaUrl:  this.client.baseUrl,
      token:       this.client.token,
    });

    await engine.launch();
    for (const dash of dashboards) {
      const uid = dash.dashboard?.uid || dash.uid;
      if (uid) {
        await engine.captureDashboard(uid, uid).catch(err =>
          console.warn(`[Snapshot] Screenshot failed for ${uid}: ${err.message}`));
        await sleep(500);
      }
    }
    await engine.close();
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function timestamp() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); }

module.exports = { SnapshotCapture };
