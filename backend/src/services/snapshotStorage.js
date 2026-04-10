const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const logger = require('../utils/logger');

// ─── Base dir resolution ───
const BASE_DIR = path.join(__dirname, '../../.snapshots');

function getSnapshotBaseDir() {
  if (!fs.existsSync(BASE_DIR)) {
    fs.mkdirSync(BASE_DIR, { recursive: true });
  }
  return BASE_DIR;
}

// ─── Helpers ───
function slugify(str) {
  return String(str || 'snapshot')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'snapshot';
}

function timestamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return sha256(buf);
}

// ─── Snapshot directory lifecycle ───
function createSnapshotDir(snapshotName) {
  const base = getSnapshotBaseDir();
  const createdAt = new Date();
  const dirName = `${timestamp(createdAt)}_${slugify(snapshotName)}`;
  const dir = path.join(base, dirName);

  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'dashboards'), { recursive: true });

  const id = crypto.randomUUID();
  return { dir, id, createdAt: createdAt.toISOString() };
}

function deleteSnapshotDir(dir) {
  if (!dir) return;
  if (!fs.existsSync(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    logger.error('Failed to delete snapshot dir', { dir, error: err.message });
    throw err;
  }
}

// ─── Dashboard JSON read/write (gzip) ───
function writeDashboard(dir, dashboardUid, json) {
  const dashDir = path.join(dir, 'dashboards');
  if (!fs.existsSync(dashDir)) fs.mkdirSync(dashDir, { recursive: true });
  const filePath = path.join(dashDir, `${dashboardUid}.json.gz`);
  const payload = JSON.stringify(json);
  const gz = zlib.gzipSync(Buffer.from(payload, 'utf-8'));
  fs.writeFileSync(filePath, gz);
  return filePath;
}

function readDashboard(dir, dashboardUid) {
  const filePath = path.join(dir, 'dashboards', `${dashboardUid}.json.gz`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Dashboard not found in snapshot: ${dashboardUid}`);
  }
  const gz = fs.readFileSync(filePath);
  const raw = zlib.gunzipSync(gz).toString('utf-8');
  return JSON.parse(raw);
}

function listDashboardFiles(dir) {
  const dashDir = path.join(dir, 'dashboards');
  if (!fs.existsSync(dashDir)) return [];
  return fs
    .readdirSync(dashDir)
    .filter((f) => f.endsWith('.json.gz'))
    .map((f) => f.replace(/\.json\.gz$/, ''));
}

// ─── Manifest & meta ───
function writeManifest(dir, manifest) {
  const filePath = path.join(dir, 'manifest.json');
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2), 'utf-8');
  return filePath;
}

function readManifest(dir) {
  const filePath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeGrafanaMeta(dir, meta) {
  const filePath = path.join(dir, 'grafana-meta.json');
  fs.writeFileSync(filePath, JSON.stringify(meta, null, 2), 'utf-8');
  return filePath;
}

function readGrafanaMeta(dir) {
  const filePath = path.join(dir, 'grafana-meta.json');
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// ─── Checksums ───
function computeDirChecksum(dir) {
  const entries = [];

  // Hash manifest
  const manifestPath = path.join(dir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    entries.push({ rel: 'manifest.json', sha: sha256File(manifestPath) });
  }

  // Hash grafana-meta
  const metaPath = path.join(dir, 'grafana-meta.json');
  if (fs.existsSync(metaPath)) {
    entries.push({ rel: 'grafana-meta.json', sha: sha256File(metaPath) });
  }

  // Hash all dashboard gz files
  const dashDir = path.join(dir, 'dashboards');
  if (fs.existsSync(dashDir)) {
    const files = fs.readdirSync(dashDir).filter((f) => f.endsWith('.json.gz')).sort();
    for (const f of files) {
      entries.push({
        rel: `dashboards/${f}`,
        sha: sha256File(path.join(dashDir, f)),
      });
    }
  }

  // Sort by relative path for determinism
  entries.sort((a, b) => a.rel.localeCompare(b.rel));

  const lines = entries.map((e) => `${e.sha}  ${e.rel}`).join('\n') + '\n';
  const checksumsPath = path.join(dir, 'checksums.txt');
  fs.writeFileSync(checksumsPath, lines, 'utf-8');

  // Root checksum is sha256 of the checksums file contents
  return sha256(Buffer.from(lines, 'utf-8'));
}

// ─── Utilities ───
function getDirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const walk = (p) => {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(p)) walk(path.join(p, entry));
    } else {
      total += stat.size;
    }
  };
  walk(dir);
  return total;
}

async function createZipExport(dir, outputPath) {
  let archiver;
  try {
    archiver = require('archiver');
  } catch (err) {
    return { ok: false, error: 'archiver module not installed' };
  }

  return new Promise((resolve) => {
    try {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        resolve({ ok: true, path: outputPath, bytes: archive.pointer() });
      });
      archive.on('error', (err) => {
        resolve({ ok: false, error: err.message });
      });

      archive.pipe(output);
      archive.directory(dir, false);
      archive.finalize();
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

module.exports = {
  getSnapshotBaseDir,
  createSnapshotDir,
  writeDashboard,
  readDashboard,
  writeManifest,
  readManifest,
  writeGrafanaMeta,
  readGrafanaMeta,
  computeDirChecksum,
  listDashboardFiles,
  deleteSnapshotDir,
  getDirSize,
  createZipExport,
};
