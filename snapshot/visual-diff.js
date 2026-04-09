'use strict';
/**
 * snapshot/visual-diff.js — Pixel-diff screenshots between two snapshot sets.
 * Uses pixelmatch to flag dashboards with >5% diff.
 * Highlights changed regions in output diff images.
 */

const path = require('path');
const fs   = require('fs');

class VisualDiff {
  /**
   * @param {string} baseDir  - Root snapshots directory
   * @param {object} opts
   * @param {number} opts.threshold  - Pixel-level sensitivity 0–1 (default 0.1)
   * @param {number} opts.flagPct    - % diff above which dashboard is flagged (default 5)
   */
  constructor(baseDir = './snapshots', opts = {}) {
    this.baseDir   = path.resolve(baseDir);
    this.threshold = opts.threshold || 0.1;
    this.flagPct   = opts.flagPct   || 5;
  }

  /**
   * Compare screenshots in two snapshot labels.
   * Returns { total, changed, new, removed, ok, results, flagged }
   */
  async compare(beforeLabel, afterLabel, outputLabel = null) {
    const PNG        = require('pngjs').PNG;
    const pixelmatch = require('pixelmatch');

    const beforeDir = path.join(this.baseDir, beforeLabel, 'screenshots');
    const afterDir  = path.join(this.baseDir, afterLabel,  'screenshots');
    const diffLabel = outputLabel || `diff-${beforeLabel}-vs-${afterLabel}`;
    const diffDir   = path.join(this.baseDir, diffLabel);

    if (!fs.existsSync(beforeDir) || !fs.existsSync(afterDir)) {
      return {
        error: `Screenshots not found — ensure screenshots:true was set during capture`,
        beforeDir,
        afterDir,
      };
    }

    this._ensureDir(diffDir);

    const beforeFiles = this._listPngs(beforeDir);
    const afterFiles  = this._listPngs(afterDir);

    // Build key map (strip timestamp suffix from filename)
    const beforeMap = {};
    for (const f of beforeFiles) {
      const key = this._fileKey(f);
      beforeMap[key] = f;
    }

    const results = [];

    for (const f of afterFiles) {
      const key      = this._fileKey(f);
      const before   = beforeMap[key];

      if (!before) {
        results.push({ key, status: 'new', afterPath: f });
        continue;
      }

      const diffPath = path.join(diffDir, `${key}_diff.png`);
      try {
        const result = await this._pixelDiff(PNG, pixelmatch, before, f, diffPath);
        results.push({
          key,
          status:       result.diffPct > this.flagPct ? 'changed' : 'ok',
          diffPct:      result.diffPct,
          diffPixels:   result.diffPixels,
          totalPixels:  result.totalPixels,
          diffPath,
          beforePath:   before,
          afterPath:    f,
          flagged:      result.diffPct > this.flagPct,
          sizeMismatch: result.sizeMismatch,
        });
      } catch (err) {
        results.push({ key, status: 'error', error: err.message, afterPath: f });
      }
    }

    // Removed (in before but not after)
    for (const [key, f] of Object.entries(beforeMap)) {
      if (!afterFiles.find(af => this._fileKey(af) === key)) {
        results.push({ key, status: 'removed', beforePath: f });
      }
    }

    const flagged = results.filter(r => r.flagged);

    return {
      total:    results.length,
      changed:  results.filter(r => r.status === 'changed').length,
      new:      results.filter(r => r.status === 'new').length,
      removed:  results.filter(r => r.status === 'removed').length,
      ok:       results.filter(r => r.status === 'ok').length,
      errors:   results.filter(r => r.status === 'error').length,
      flagged_count: flagged.length,
      flagged,
      results,
      diff_dir: diffDir,
    };
  }

  async _pixelDiff(PNG, pixelmatch, beforePath, afterPath, diffPath) {
    const before = PNG.sync.read(fs.readFileSync(beforePath));
    const after  = PNG.sync.read(fs.readFileSync(afterPath));

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
      {
        threshold:      this.threshold,
        includeAA:      false,
        diffColor:      [255, 0, 0],       // Red for changed pixels
        diffColorAlt:   [0, 0, 255],       // Blue for anti-aliasing
        alpha:          0.3,
      },
    );

    fs.writeFileSync(diffPath, PNG.sync.write(diff));

    const totalPixels = width * height;
    const diffPct     = totalPixels > 0 ? (diffPixels / totalPixels) * 100 : 0;

    return {
      diffPixels,
      totalPixels,
      diffPct: Math.round(diffPct * 100) / 100,
      sizeMismatch,
    };
  }

  _fileKey(filePath) {
    // Strip timestamp suffix: "uid_1234567890123.png" → "uid"
    return path.basename(filePath, '.png').replace(/_\d{13}$/, '');
  }

  _listPngs(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.png'))
      .map(f => path.join(dir, f));
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  /**
   * Generate an HTML report page showing all diff images side-by-side.
   */
  generateHtmlReport(compareResult, outputPath) {
    const { results, flagged_count, total } = compareResult;

    const rows = results.map(r => {
      const statusColor = r.status === 'ok' ? '#2eb67d' : r.status === 'changed' ? '#ecb22e' : '#e01e5a';
      const hasImages   = r.beforePath && r.afterPath && r.diffPath;
      return `
        <tr>
          <td><code>${r.key}</code></td>
          <td style="color:${statusColor};font-weight:bold">${r.status.toUpperCase()}</td>
          <td>${r.diffPct !== undefined ? r.diffPct + '%' : 'N/A'}</td>
          <td>${r.flagged ? '⚠️ FLAGGED' : ''}</td>
          ${hasImages ? `
            <td><img src="${r.beforePath}" style="max-width:200px"></td>
            <td><img src="${r.afterPath}"  style="max-width:200px"></td>
            <td><img src="${r.diffPath}"   style="max-width:200px"></td>
          ` : '<td colspan="3">N/A</td>'}
        </tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html><head>
<title>Grafana Sentinel — Visual Diff Report</title>
<style>body{font-family:sans-serif;background:#1a1a1a;color:#fff}table{border-collapse:collapse;width:100%}
th,td{border:1px solid #444;padding:8px;text-align:left}th{background:#333}
tr:hover{background:#222}img{border:1px solid #555;border-radius:4px}</style>
</head><body>
<h1>Grafana Sentinel — Visual Diff Report</h1>
<p>Flagged: ${flagged_count}/${total} dashboards have &gt;${this.flagPct}% visual change</p>
<table><thead><tr>
<th>Dashboard</th><th>Status</th><th>Diff %</th><th>Flag</th>
<th>Before</th><th>After</th><th>Diff</th>
</tr></thead><tbody>${rows}</tbody></table>
</body></html>`;

    fs.writeFileSync(outputPath, html);
    return outputPath;
  }
}

module.exports = { VisualDiff };
