'use strict';
/**
 * core/screenshot-engine.js — Puppeteer-based screenshot capture + pixel diff.
 * Uses pixelmatch for pixel-level comparison and pngjs for PNG I/O.
 */

const path = require('path');
const fs   = require('fs');

class ScreenshotEngine {
  /**
   * @param {object} opts
   * @param {string} opts.outputDir     - Directory to write screenshots
   * @param {string} opts.grafanaUrl    - Base Grafana URL
   * @param {string} opts.token         - Service account token (for cookie or header auth)
   * @param {boolean} opts.headless     - Run browser headless (default true)
   * @param {number} opts.viewportWidth
   * @param {number} opts.viewportHeight
   * @param {number} opts.loadTimeout  - ms to wait after navigation
   */
  constructor(opts = {}) {
    this.outputDir     = path.resolve(opts.outputDir || './screenshots');
    this.grafanaUrl    = (opts.grafanaUrl || 'http://localhost:3000').replace(/\/$/, '');
    this.token         = opts.token || '';
    this.headless      = opts.headless !== false;
    this.viewportWidth  = opts.viewportWidth  || 1920;
    this.viewportHeight = opts.viewportHeight || 1080;
    this.loadTimeout    = opts.loadTimeout || 30000;
    this._browser = null;
    this._page    = null;
    this._ensureDir(this.outputDir);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────────

  async launch() {
    const puppeteer = require('puppeteer');
    this._browser = await puppeteer.launch({
      headless: this.headless ? 'new' : false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        `--window-size=${this.viewportWidth},${this.viewportHeight}`,
      ],
    });
    this._page = await this._browser.newPage();
    await this._page.setViewport({ width: this.viewportWidth, height: this.viewportHeight });
    // Inject auth token as Authorization header via request interception
    await this._page.setExtraHTTPHeaders({ Authorization: `Bearer ${this.token}` });
    // Suppress non-critical console errors
    this._page.on('console', () => {});
    return this;
  }

  async close() {
    if (this._browser) {
      await this._browser.close().catch(() => {});
      this._browser = null;
      this._page    = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Capture
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Take a screenshot of a Grafana dashboard.
   * @param {string} dashboardUid
   * @param {string} [label]      - Used in filename; defaults to uid
   * @returns {string} Absolute path to saved PNG
   */
  async captureDashboard(dashboardUid, label = null) {
    const url = `${this.grafanaUrl}/d/${dashboardUid}?kiosk=tv&theme=dark`;
    return this._capture(url, label || dashboardUid);
  }

  /**
   * Take a screenshot of any Grafana page by relative path.
   */
  async capturePage(relativePath, label) {
    const url = `${this.grafanaUrl}${relativePath}`;
    return this._capture(url, label);
  }

  async _capture(url, label) {
    if (!this._page) await this.launch();
    const sanitized = this._sanitize(label);
    const outPath = path.join(this.outputDir, `${sanitized}_${Date.now()}.png`);

    try {
      await this._page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: this.loadTimeout,
      });
      // Wait for Grafana panels to finish loading
      await this._waitForPanels();
      await this._page.screenshot({ path: outPath, fullPage: false });
      return outPath;
    } catch (err) {
      // Try fallback: take whatever is rendered
      try {
        await this._page.screenshot({ path: outPath, fullPage: false });
        return outPath;
      } catch {
        throw new Error(`Screenshot failed for ${url}: ${err.message}`);
      }
    }
  }

  async _waitForPanels(timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const loading = await this._page.evaluate(() => {
        const spinners = document.querySelectorAll('[data-testid="panel-loading-bar"]');
        return spinners.length;
      }).catch(() => 0);
      if (loading === 0) break;
      await new Promise(r => setTimeout(r, 500));
    }
    // Extra settle time for animations
    await new Promise(r => setTimeout(r, 1000));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Pixel diff
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Compare two PNG screenshots using pixelmatch.
   * @param {string} beforePath   - Absolute path to before PNG
   * @param {string} afterPath    - Absolute path to after PNG
   * @param {string} [diffPath]   - Where to write diff PNG; auto-generated if omitted
   * @param {number} [threshold]  - Per-pixel threshold 0–1 (default 0.1)
   * @returns {{ diffPixels, totalPixels, diffPct, diffPath, passed, sizeMismatch }}
   */
  async pixelDiff(beforePath, afterPath, diffPath = null, threshold = 0.1) {
    const PNG = require('pngjs').PNG;
    const pixelmatch = require('pixelmatch');

    const before = this._readPng(beforePath);
    const after  = this._readPng(afterPath);

    // Handle size mismatches by cropping to the smaller dimension
    const width  = Math.min(before.width,  after.width);
    const height = Math.min(before.height, after.height);
    const sizeMismatch = before.width !== after.width || before.height !== after.height;

    const diff = new PNG({ width, height });

    const diffPixels = pixelmatch(
      before.data,
      after.data,
      diff.data,
      width,
      height,
      { threshold },
    );

    const totalPixels = width * height;
    const diffPct = (diffPixels / totalPixels) * 100;

    // Write diff image
    if (!diffPath) {
      const label = path.basename(beforePath, '.png');
      diffPath = path.join(this.outputDir, `diff_${label}_${Date.now()}.png`);
    }
    fs.writeFileSync(diffPath, PNG.sync.write(diff));

    return {
      diffPixels,
      totalPixels,
      diffPct: Math.round(diffPct * 100) / 100,
      diffPath,
      passed: diffPct <= 5,          // >5% diff = flagged
      sizeMismatch,
    };
  }

  /**
   * Batch-compare two directories of screenshots by filename.
   * Files must share the same basename (uid_timestamp.png → matched by uid prefix).
   */
  async diffDirectories(beforeDir, afterDir, outputDir = null) {
    const outDir = outputDir || path.join(this.outputDir, `diff_${Date.now()}`);
    this._ensureDir(outDir);

    const beforeFiles = this._listPngs(beforeDir);
    const afterFiles  = this._listPngs(afterDir);

    // Match by sanitized base name (strip timestamp suffix)
    const beforeMap = {};
    for (const f of beforeFiles) {
      const key = path.basename(f, '.png').replace(/_\d{13}$/, '');
      beforeMap[key] = f;
    }

    const results = [];
    for (const f of afterFiles) {
      const key = path.basename(f, '.png').replace(/_\d{13}$/, '');
      if (!beforeMap[key]) {
        results.push({ key, status: 'new', afterPath: f });
        continue;
      }
      const diffPath = path.join(outDir, `diff_${key}.png`);
      try {
        const r = await this.pixelDiff(beforeMap[key], f, diffPath);
        results.push({ key, status: r.passed ? 'ok' : 'changed', ...r });
      } catch (err) {
        results.push({ key, status: 'error', error: err.message });
      }
    }
    for (const [key, f] of Object.entries(beforeMap)) {
      if (!afterFiles.find(af => path.basename(af, '.png').replace(/_\d{13}$/, '') === key)) {
        results.push({ key, status: 'removed', beforePath: f });
      }
    }

    return {
      total: results.length,
      changed: results.filter(r => r.status === 'changed').length,
      new: results.filter(r => r.status === 'new').length,
      removed: results.filter(r => r.status === 'removed').length,
      ok: results.filter(r => r.status === 'ok').length,
      results,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  _readPng(filePath) {
    const PNG = require('pngjs').PNG;
    return PNG.sync.read(fs.readFileSync(filePath));
  }

  _listPngs(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.png'))
      .map(f => path.join(dir, f));
  }

  _sanitize(str) {
    return String(str).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = { ScreenshotEngine };
