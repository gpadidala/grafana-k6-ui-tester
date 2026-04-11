#!/usr/bin/env node
/**
 * record-demo.js
 *
 * Walks through Heimdall's key pages with Playwright and captures
 * the 9 static screenshots referenced in README.md + an animated GIF
 * demo at docs/assets/heimdall-demo.gif.
 *
 * Prerequisites (all installed locally, not saved to package.json):
 *   npm install playwright gif-encoder-2 canvas
 *
 * Usage:
 *   node scripts/record-demo.js [--host=http://localhost:3001] [--gif-scale=0.5]
 *
 * Output:
 *   docs/assets/screenshots/01-dashboard.png
 *   docs/assets/screenshots/02-run-tests.png
 *   ...
 *   docs/assets/screenshots/09-schedules.png
 *   docs/assets/heimdall-demo.gif  (animated walkthrough)
 */

const fs = require('fs');
const path = require('path');

// Modules live in backend/node_modules — resolve from there so the
// script can run from any directory.
const BACKEND_NM = path.resolve(__dirname, '../backend/node_modules');
const { chromium } = require(path.join(BACKEND_NM, 'playwright'));
const GIFEncoder = require(path.join(BACKEND_NM, 'gif-encoder-2'));
const { createCanvas, loadImage } = require(path.join(BACKEND_NM, 'canvas'));

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('='))
);
const HOST = argv.host || 'http://localhost:3001';
const GIF_SCALE = parseFloat(argv['gif-scale'] || '0.5'); // scale down for smaller gif
const VIEWPORT = { width: 1440, height: 900 };
const FRAME_DELAY_MS = 1200; // how long each frame holds in the gif

const SHOTS_DIR = path.resolve(__dirname, '../docs/assets/screenshots');
const GIF_PATH = path.resolve(__dirname, '../docs/assets/heimdall-demo.gif');
if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });

// Pages to capture, in order. Each entry becomes a PNG + a GIF frame.
const STEPS = [
  { file: '01-dashboard.png',              path: '/',          title: 'Dashboard',                wait: 2200 },
  { file: '02-run-tests.png',              path: '/run',       title: 'Run Tests',                wait: 2200 },
  { file: '03-live-progress.png',          path: '/run',       title: 'Live Progress',            wait: 1500, hash: '' },
  { file: '04-results-ai-analysis.png',    path: '/ai-tests',  title: 'AI Failure Analysis',      wait: 2500 },
  { file: '05-reports-list.png',           path: '/reports',   title: 'Reports List',             wait: 2500 },
  { file: '06-html-report-donut.png',      path: '/reports',   title: 'HTML Report',              wait: 1500 },
  { file: '07-dependency-graph.png',       path: '/snapshots', title: 'Dependency Graph',         wait: 2500 },
  { file: '08-settings-environments.png',  path: '/settings',  title: 'Multi-Environment',        wait: 2500 },
  { file: '09-schedules.png',              path: '/compare',   title: 'Schedules / Compare',      wait: 2500 },
];

async function dismissTourIfOpen(page) {
  // If the Welcome Tour panel is visible, click "Skip tour" so it gets out
  // of the way of the screenshots. Safe no-op if it's not open.
  try {
    const skip = page.getByRole('button', { name: /skip tour/i }).first();
    if (await skip.isVisible({ timeout: 500 })) {
      await skip.click();
      await page.waitForTimeout(300);
    }
  } catch {}
}

async function capturePngs(page) {
  const frames = [];
  for (const step of STEPS) {
    console.log(`  ▶ ${step.title.padEnd(22)} → ${step.file}`);
    try {
      await page.goto(`${HOST}${step.path}`, { waitUntil: 'load', timeout: 30000 });
    } catch (e) {
      console.warn(`    ⚠ navigation failed: ${e.message}`);
    }
    // Let React render + any websocket progress settle
    await page.waitForTimeout(step.wait || 1500);
    await dismissTourIfOpen(page);

    const outPath = path.join(SHOTS_DIR, step.file);
    try {
      await page.screenshot({ path: outPath, fullPage: false });
      frames.push({ file: outPath, title: step.title });
    } catch (e) {
      console.warn(`    ⚠ screenshot failed: ${e.message}`);
    }
  }
  return frames;
}

async function encodeGif(frames) {
  if (frames.length === 0) {
    console.warn('  ⚠ no frames captured, skipping GIF');
    return;
  }
  const w = Math.round(VIEWPORT.width * GIF_SCALE);
  const h = Math.round(VIEWPORT.height * GIF_SCALE);
  console.log(`  ✍ encoding GIF at ${w}×${h}, ${frames.length} frames, ${FRAME_DELAY_MS}ms per frame`);

  const encoder = new GIFEncoder(w, h, 'neuquant', true);
  encoder.setDelay(FRAME_DELAY_MS);
  encoder.setQuality(10);
  encoder.setRepeat(0); // loop forever
  encoder.start();

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  for (const frame of frames) {
    const img = await loadImage(frame.file);
    ctx.fillStyle = '#030712'; // app background
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    encoder.addFrame(ctx);
  }

  encoder.finish();
  fs.writeFileSync(GIF_PATH, encoder.out.getData());
  const sizeKb = (fs.statSync(GIF_PATH).size / 1024).toFixed(1);
  console.log(`  ✅ wrote ${GIF_PATH} (${sizeKb} KB)`);
}

(async () => {
  console.log(`\n🎬 Heimdall demo recorder`);
  console.log(`   host: ${HOST}`);
  console.log(`   output dir: ${SHOTS_DIR}`);
  console.log(`   gif: ${GIF_PATH}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();

  // Seed some state so the Dashboard page has something to show
  // (skip if it errors — we'd rather have empty-state screenshots than crash)
  try {
    await page.goto(HOST, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(800);
    await dismissTourIfOpen(page);
  } catch (e) {
    console.warn(`  ⚠ initial load failed: ${e.message}`);
  }

  console.log('📸 capturing screenshots...');
  const frames = await capturePngs(page);

  console.log('\n🎞  building animated GIF...');
  await encodeGif(frames);

  await browser.close();

  console.log('\n✅ Done. Files written:');
  frames.forEach((f) => console.log(`   ${path.relative(process.cwd(), f.file)}`));
  console.log(`   ${path.relative(process.cwd(), GIF_PATH)}`);
})().catch((err) => {
  console.error('❌ recorder failed:', err);
  process.exit(1);
});
