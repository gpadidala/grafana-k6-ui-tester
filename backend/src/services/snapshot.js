const crypto = require('crypto');
const stableStringify = require('fast-json-stable-stringify');
const storage = require('./snapshotStorage');
const GrafanaClient = require('./grafanaClient');
const { ops, saveDb } = require('../db');
const logger = require('../utils/logger');

// Fields that change across dashboard saves but don't represent meaningful
// content changes. Stripped before fingerprinting.
const VOLATILE_DASH_FIELDS = ['id', 'version', 'iteration', 'updated', 'updatedBy', 'created', 'createdBy'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeEmit(onProgress, evt) {
  if (typeof onProgress === 'function') {
    try {
      onProgress(evt);
    } catch (err) {
      logger.warn('onProgress callback threw', { error: err.message });
    }
  }
}

function countPanels(dash) {
  if (!dash || !Array.isArray(dash.panels)) return 0;
  let total = 0;
  for (const p of dash.panels) {
    total += 1;
    // Row panels may contain nested panels
    if (Array.isArray(p.panels)) total += p.panels.length;
  }
  return total;
}

class DashboardSnapshotService {
  constructor(grafanaUrl, token, orgId) {
    this.client = new GrafanaClient(grafanaUrl, token, orgId);
    this.grafanaUrl = grafanaUrl || this.client.baseUrl;
  }

  // Strip volatile fields and return a deep-cloned, normalized dashboard.
  normalizeDashboard(dash) {
    if (!dash || typeof dash !== 'object') return dash;
    // Accept either the raw dashboard or Grafana's { dashboard, meta } envelope
    const source = dash.dashboard && typeof dash.dashboard === 'object' ? dash.dashboard : dash;
    const clone = JSON.parse(JSON.stringify(source));
    for (const field of VOLATILE_DASH_FIELDS) {
      if (field in clone) delete clone[field];
    }
    return clone;
  }

  // Deterministic SHA-256 over the normalized dashboard (keys sorted via stableStringify).
  computeFingerprint(dash) {
    const normalized = this.normalizeDashboard(dash);
    const canonical = stableStringify(normalized);
    return 'sha256:' + crypto.createHash('sha256').update(canonical).digest('hex');
  }

  async createSnapshot(name, { notes, createdBy, onProgress } = {}) {
    const startedAt = Date.now();

    // 1. Health check — fail fast if Grafana unreachable
    safeEmit(onProgress, { stage: 'health-check' });
    const health = await this.client.getHealth();
    if (!health.ok) {
      throw new Error(`Grafana unreachable: ${health.error || 'status=' + health.status}`);
    }

    // 2. Fetch health, plugins, datasources in parallel
    safeEmit(onProgress, { stage: 'fetching-meta' });
    const [buildInfo, plugins, datasources] = await Promise.all([
      this.client.getBuildInfo(),
      this.client.getPlugins(),
      this.client.getDataSources(),
    ]);

    const grafanaVersion =
      buildInfo.ok && buildInfo.data && buildInfo.data.buildInfo && buildInfo.data.buildInfo.version
        ? buildInfo.data.buildInfo.version
        : (health.data && health.data.version) || 'unknown';

    const pluginList = plugins.ok && Array.isArray(plugins.data) ? plugins.data : [];
    const datasourceList = datasources.ok && Array.isArray(datasources.data) ? datasources.data : [];

    // 3. Search all dashboards
    safeEmit(onProgress, { stage: 'searching-dashboards' });
    const searchRes = await this.client.searchDashboards('', 5000);
    if (!searchRes.ok) {
      throw new Error(`Dashboard search failed: ${searchRes.error || 'status=' + searchRes.status}`);
    }
    const hits = Array.isArray(searchRes.data) ? searchRes.data : [];
    const total = hits.length;

    safeEmit(onProgress, { stage: 'fetching-dashboards', total, completed: 0 });

    // 4. Create storage dir
    const { dir, id: snapshotId, createdAt } = storage.createSnapshotDir(name);

    // 5. Capture each dashboard
    const dashboardEntries = [];
    let totalPanels = 0;
    let completed = 0;
    const batchSize = 50;
    const sleepEveryN = 10; // crude rate limit: ~10 req/sec

    for (let i = 0; i < hits.length; i += batchSize) {
      const batch = hits.slice(i, i + batchSize);

      for (const hit of batch) {
        const uid = hit.uid;
        if (!uid) {
          completed += 1;
          continue;
        }

        const res = await this.client.getDashboardByUid(uid);
        if (!res.ok || !res.data || !res.data.dashboard) {
          logger.warn('Failed to fetch dashboard for snapshot', {
            uid,
            status: res.status,
            error: res.error,
          });
          completed += 1;
          safeEmit(onProgress, {
            stage: 'capturing',
            total,
            completed,
            current: hit.title,
            skipped: true,
          });
          continue;
        }

        const envelope = res.data;
        const dash = envelope.dashboard;
        const meta = envelope.meta || {};

        const normalized = this.normalizeDashboard(dash);
        const fingerprint = this.computeFingerprint(dash);
        const panelCount = countPanels(dash);
        totalPanels += panelCount;

        // Persist full envelope (including meta) so restore can re-create
        storage.writeDashboard(dir, uid, { dashboard: dash, meta });

        await ops.insertSnapshotDashboard(
          snapshotId,
          uid,
          dash.title || hit.title || '',
          meta.folderTitle || hit.folderTitle || '',
          fingerprint,
          panelCount,
          dash.schemaVersion || null
        );

        dashboardEntries.push({
          uid,
          title: dash.title || hit.title || '',
          folder: meta.folderTitle || hit.folderTitle || '',
          fingerprint,
          panelCount,
        });

        completed += 1;
        safeEmit(onProgress, {
          stage: 'capturing',
          total,
          completed,
          current: dash.title || hit.title,
        });

        if (completed % sleepEveryN === 0) {
          await sleep(100);
        }
      }
    }

    // 6. Write grafana-meta
    safeEmit(onProgress, { stage: 'writing-manifest' });
    const grafanaMeta = {
      grafanaUrl: this.grafanaUrl,
      grafanaVersion,
      health: health.data || null,
      plugins: pluginList.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        version: (p.info && p.info.version) || p.version || null,
        enabled: p.enabled,
      })),
      datasources: datasourceList.map((d) => ({
        uid: d.uid,
        name: d.name,
        type: d.type,
        url: d.url,
        isDefault: d.isDefault,
      })),
    };
    storage.writeGrafanaMeta(dir, grafanaMeta);

    // 7. Write manifest
    const manifest = {
      id: snapshotId,
      name,
      createdAt,
      grafanaVersion,
      grafanaUrl: this.grafanaUrl,
      dashboardCount: dashboardEntries.length,
      panelCount: totalPanels,
      pluginCount: pluginList.length,
      dashboards: dashboardEntries,
    };
    storage.writeManifest(dir, manifest);

    // 8. Compute checksum
    const manifestChecksum = storage.computeDirChecksum(dir);

    // 9. Insert snapshot row
    const environment = (() => {
      try {
        return new URL(this.grafanaUrl).host;
      } catch {
        return this.grafanaUrl || 'unknown';
      }
    })();

    await ops.insertSnapshot(
      snapshotId,
      name,
      environment,
      grafanaVersion,
      this.grafanaUrl,
      dashboardEntries.length,
      totalPanels,
      pluginList.length,
      dir,
      manifestChecksum,
      notes || null,
      createdBy || null
    );

    // 10. saveDb() — note: ops.run already calls saveDb, but belt-and-suspenders
    try {
      saveDb();
    } catch (err) {
      logger.warn('saveDb failed after snapshot create', { error: err.message });
    }

    const durationMs = Date.now() - startedAt;
    safeEmit(onProgress, {
      stage: 'complete',
      id: snapshotId,
      dashboardCount: dashboardEntries.length,
      panelCount: totalPanels,
      durationMs,
    });

    logger.info('Snapshot created', {
      id: snapshotId,
      name,
      dashboardCount: dashboardEntries.length,
      panelCount: totalPanels,
      durationMs,
    });

    return {
      id: snapshotId,
      name,
      manifest,
      dashboardCount: dashboardEntries.length,
      panelCount: totalPanels,
      durationMs,
    };
  }

  async listSnapshots(limit) {
    return ops.listSnapshots(limit);
  }

  async getSnapshot(id) {
    const snap = await ops.getSnapshot(id);
    if (!snap) return null;
    const dashboards = await ops.listSnapshotDashboards(id);
    return { ...snap, dashboards };
  }

  async deleteSnapshot(id) {
    const snap = await ops.getSnapshot(id);
    if (!snap) throw new Error('Snapshot not found');
    storage.deleteSnapshotDir(snap.storage_path);
    await ops.deleteSnapshot(id);
    try {
      saveDb();
    } catch (err) {
      logger.warn('saveDb failed after snapshot delete', { error: err.message });
    }
    return { ok: true };
  }

  // Load full dashboard JSON from snapshot storage. Returns the envelope
  // { dashboard, meta } as stored.
  async loadDashboardFromSnapshot(snapshotId, dashboardUid) {
    const snap = await ops.getSnapshot(snapshotId);
    if (!snap) throw new Error('Snapshot not found');
    return storage.readDashboard(snap.storage_path, dashboardUid);
  }

  // Emergency rollback — writes baseline dashboard JSON back to Grafana
  // GUARDED: caller must pass { allowWrites: true }
  async restoreDashboard(snapshotId, dashboardUid, { allowWrites } = {}) {
    if (!allowWrites) {
      throw new Error('Write operations disabled. Pass allowWrites: true.');
    }
    const stored = await this.loadDashboardFromSnapshot(snapshotId, dashboardUid);
    const dash = stored && stored.dashboard ? stored.dashboard : stored;

    const payload = {
      dashboard: { ...dash, id: null, version: 0 },
      overwrite: true,
      message: `DSUD emergency restore from snapshot ${snapshotId}`,
    };
    const res = await this.client.put('/api/dashboards/db', payload);
    if (!res.ok) {
      logger.error('Dashboard restore failed', {
        snapshotId,
        dashboardUid,
        status: res.status,
        error: res.error,
      });
    } else {
      logger.info('Dashboard restored from snapshot', { snapshotId, dashboardUid });
    }
    return res;
  }

  // Find the most recent snapshot BEFORE the given snapshot for the same
  // Grafana URL (environment proxy).
  async autoDetectBaseline(currentSnapshotId) {
    const current = await ops.getSnapshot(currentSnapshotId);
    if (!current) return null;
    const all = await ops.listSnapshots(100);
    const candidates = all.filter(
      (s) =>
        s.id !== currentSnapshotId &&
        s.grafana_url === current.grafana_url &&
        new Date(s.created_at) < new Date(current.created_at)
    );
    // listSnapshots is already ORDER BY created_at DESC
    return candidates[0] || null;
  }
}

module.exports = DashboardSnapshotService;
