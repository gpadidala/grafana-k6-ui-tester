'use strict';

/**
 * Test-screenshot store. Saves panel/dashboard screenshots from Playwright
 * runs as gzipped PNGs under a structured directory:
 *
 *   {reports_dir}/../.test-screenshots/{runId}/{safeName}.png.gz
 *
 * Mirrors the snapshot storage pattern (small files, gzipped, indexed by
 * a stable id). Served back to the UI via /api/test-screenshots/:runId/:name
 * which gunzips on demand and streams as image/png.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const config = require('../config');
const logger = require('../utils/logger');

// Sibling directory to reports/ — keeps the runs+screenshots co-located
// without polluting the report JSON files.
const BASE = path.resolve(path.join(path.dirname(path.resolve(config.paths.reports)), '.test-screenshots'));

function ensureBase() {
  if (!fs.existsSync(BASE)) fs.mkdirSync(BASE, { recursive: true });
}

function dirFor(runId) {
  ensureBase();
  const d = path.join(BASE, runId);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function safeFileName(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

/**
 * Write a PNG buffer for a given run, gzipped to disk.
 * Returns the relative path that the server endpoint will serve, e.g.
 * "abc12345/dashboardUid_panel-3.png.gz" — or null on failure.
 */
function writeScreenshot(runId, name, pngBuffer) {
  if (!runId || !pngBuffer) return null;
  try {
    const dir = dirFor(runId);
    const fileName = safeFileName(name) + '.png.gz';
    const filePath = path.join(dir, fileName);
    const gz = zlib.gzipSync(pngBuffer);
    fs.writeFileSync(filePath, gz);
    return path.posix.join(runId, fileName);
  } catch (err) {
    logger.warn('writeScreenshot failed', { runId, name, error: err.message });
    return null;
  }
}

/**
 * Read + ungzip a screenshot. Returns a Buffer (PNG) or null if missing.
 * Validates the path so callers can't escape the screenshots dir.
 */
function readScreenshot(relPath) {
  if (!relPath || typeof relPath !== 'string') return null;
  // Defend against path traversal
  if (relPath.includes('..') || path.isAbsolute(relPath)) return null;
  const filePath = path.join(BASE, relPath);
  if (!filePath.startsWith(BASE)) return null;
  if (!fs.existsSync(filePath)) return null;
  try {
    const gz = fs.readFileSync(filePath);
    return zlib.gunzipSync(gz);
  } catch (err) {
    logger.warn('readScreenshot failed', { relPath, error: err.message });
    return null;
  }
}

function listForRun(runId) {
  if (!runId) return [];
  const dir = path.join(BASE, runId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.png.gz'))
    .map((f) => path.posix.join(runId, f));
}

module.exports = {
  BASE,
  writeScreenshot,
  readScreenshot,
  listForRun,
  ensureBase,
};
