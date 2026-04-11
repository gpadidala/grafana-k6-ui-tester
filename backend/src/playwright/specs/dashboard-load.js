// dashboard-load.js
//
// For each dashboard:
//   1. Emit a "Dashboard info" header row with creator/updater/version/views
//      pulled from the Grafana API meta object.
//   2. Navigate to the dashboard in the real browser.
//   3. Wait for panels to render.
//   4. Walk every panel and detect:
//        - Error indicators (red ⚠ in the corner, "panel-status-message-error")
//        - "No data" panels
//        - Crashed/empty panels
//      Each detected issue is reported as a separate FAIL/WARN test result.
//   5. Capture a screenshot of each problematic panel, gzip it, and store it
//      via screenshotStore so the user can verify manually later. The
//      screenshot path is attached to the test result's metadata.
//
// Honors options.scopedDs to filter to dashboards using a specific datasource
// (the exporter-upgrade blast-radius use case).

const screenshotStore = require('../../services/screenshotStore');

function fmtDate(iso) {
  if (!iso || String(iso).startsWith('0001')) return 'unknown';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

module.exports = async function (page, grafanaUrl, token, options) {
  const results = [];
  const scopedDs = options && options.scopedDs;
  const runId = options && options.runId;

  // Fetch dashboard list
  let dashboards = [];
  const t0 = Date.now();
  try {
    const res = await page.request.get(`${grafanaUrl}/api/search?type=dash-db&limit=200`);
    dashboards = await res.json();
    results.push({
      name: 'Fetch dashboard list',
      status: 'PASS',
      detail: `Found ${dashboards.length} dashboards${scopedDs ? ' (pre-filter)' : ''}`,
      ms: Date.now() - t0,
    });
  } catch (e) {
    results.push({ name: 'Fetch dashboard list', status: 'FAIL', detail: e.message, ms: Date.now() - t0 });
    return results;
  }

  if (dashboards.length === 0) {
    results.push({ name: 'Dashboards exist', status: 'WARN', detail: 'No dashboards found', ms: 0 });
    return results;
  }

  // Datasource scope: keep only dashboards using the target DS
  let toTest = dashboards;
  if (scopedDs && (scopedDs.uid || scopedDs.name)) {
    const needleUid = (scopedDs.uid || '').toLowerCase();
    const needleName = (scopedDs.name || '').toLowerCase();
    const filtered = [];
    for (const db of dashboards) {
      try {
        const r = await page.request.get(`${grafanaUrl}/api/dashboards/uid/${db.uid}`);
        if (!r.ok()) continue;
        const body = await r.json();
        const found = JSON.stringify(body.dashboard || {}).toLowerCase();
        if ((needleUid && found.includes(`"uid":"${needleUid}"`)) ||
            (needleName && found.includes(`"${needleName}"`))) {
          filtered.push(db);
        }
      } catch { /* skip */ }
    }
    toTest = filtered;
    results.push({
      name: 'Datasource scope',
      status: toTest.length > 0 ? 'PASS' : 'WARN',
      detail: `Scoped to ${toTest.length} dashboard(s) using "${scopedDs.name || scopedDs.uid}"`,
      ms: 0,
    });
  } else {
    // No filter — cap at 10 to keep runs quick
    toTest = dashboards.slice(0, 10);
  }

  // Per-dashboard: header + render check + per-panel scan + screenshots
  for (const db of toTest) {
    const start = Date.now();
    const dashUid = db.uid;
    const dashTitle = db.title || dashUid;

    // ── 1. Dashboard info header (from API meta) ──
    let metaInfo = {};
    try {
      const dashApi = await page.request.get(`${grafanaUrl}/api/dashboards/uid/${dashUid}`);
      if (dashApi.ok()) {
        const body = await dashApi.json();
        metaInfo = body.meta || {};
      }
    } catch { /* leave metaInfo empty */ }

    const createdBy = metaInfo.createdBy || 'unknown';
    const updatedBy = metaInfo.updatedBy || 'unknown';
    const versionNum = metaInfo.version || 0;
    const viewCount = (metaInfo.viewCount != null) ? metaInfo.viewCount : null;
    // Reusable bundle of dashboard meta to attach to every per-panel result.
    // The email-notify endpoint reads this to resolve recipients.
    const dashboardMeta = {
      createdBy,
      updatedBy,
      created: metaInfo.created || null,
      updated: metaInfo.updated || null,
      version: versionNum,
      viewCount,
      folderTitle: metaInfo.folderTitle || null,
    };
    const detailParts = [
      `👤 Created by ${createdBy} (${fmtDate(metaInfo.created)})`,
      `✏️ Last edited by ${updatedBy} (${fmtDate(metaInfo.updated)})`,
      `v${versionNum}`,
      viewCount != null ? `${viewCount} views` : '— views',
    ];
    results.push({
      name: `[${dashTitle}] Dashboard info`,
      status: 'PASS',
      detail: detailParts.join(' · '),
      ms: 0,
      uid: dashUid,
      metadata: {
        infoRow: true,
        createdBy,
        updatedBy,
        created: metaInfo.created || null,
        updated: metaInfo.updated || null,
        version: versionNum,
        viewCount,
        folderTitle: metaInfo.folderTitle || null,
        url: metaInfo.url || null,
      },
    });

    // ── 2. Navigate + render ──
    try {
      await page.goto(`${grafanaUrl}/d/${dashUid}`, { waitUntil: 'load', timeout: 30000 });
      // Wait for panel loaders to finish (max 15s, but no failure if some don't)
      try {
        await page.locator('.panel-loading').first().waitFor({ state: 'hidden', timeout: 15000 });
      } catch {}
      // Give async queries another second to settle
      await page.waitForTimeout(1000);
    } catch (e) {
      // Take a screenshot of the broken page anyway
      let shotPath = null;
      if (runId) {
        try {
          const buf = await page.screenshot({ fullPage: false });
          shotPath = screenshotStore.writeScreenshot(runId, `${dashUid}_load-failed`, buf);
        } catch {}
      }
      results.push({
        name: `[${dashTitle}] Load`,
        status: 'FAIL',
        detail: `Dashboard failed to load: ${e.message}`,
        ms: Date.now() - start,
        uid: dashUid,
        url: `${grafanaUrl}/d/${dashUid}`,
        metadata: shotPath ? { screenshot: shotPath } : {},
      });
      continue;
    }

    // ── 3. Whole-dashboard screenshot for the report ──
    let dashScreenshot = null;
    if (runId) {
      try {
        const buf = await page.screenshot({ fullPage: false });
        dashScreenshot = screenshotStore.writeScreenshot(runId, `${dashUid}_dashboard`, buf);
      } catch (e) {
        // ignore — screenshot is best-effort
      }
    }

    // ── 4. Per-panel scan: title, error icon, "No data" indicator ──
    // Grafana 11 panel container structure (verified via DOM probe):
    //   <div data-viz-panel-key="panel-7">
    //     <section data-testid="data-testid Panel header My Title">...</section>
    //   </div>
    // Older Grafana 9/10 fallback uses [data-panelid] on the section.
    const panelContainers = page.locator('[data-viz-panel-key], section[data-testid^="data-testid Panel header"], [data-panelid]');
    let panelCount = 0;
    try {
      panelCount = await panelContainers.count();
    } catch {}

    let errorPanels = 0;
    let noDataPanels = 0;
    let okPanels = 0;

    for (let i = 0; i < panelCount; i++) {
      const panel = panelContainers.nth(i);
      // Panel id: prefer data-viz-panel-key="panel-N" → extract N
      let panelId = null;
      try {
        const vizKey = await panel.getAttribute('data-viz-panel-key');
        if (vizKey) {
          const m = vizKey.match(/panel-(\d+)/);
          if (m) panelId = m[1];
        }
      } catch {}
      if (!panelId) {
        try { panelId = await panel.getAttribute('data-panelid'); } catch {}
      }
      if (!panelId) panelId = String(i);

      // Panel title: extract from data-testid attribute or section header
      let panelTitle = `panel ${panelId}`;
      try {
        const sectionEl = panel.locator('section[data-testid^="data-testid Panel header"]').first();
        const testid = await sectionEl.getAttribute('data-testid', { timeout: 500 }).catch(() => null);
        if (testid) {
          // Format: "data-testid Panel header My Title Here"
          const m = testid.match(/Panel header\s+(.+)$/);
          if (m) panelTitle = m[1].slice(0, 60);
        } else {
          // Older Grafana: try the section's own attribute
          const directTestid = await panel.getAttribute('data-testid', { timeout: 500 }).catch(() => null);
          if (directTestid) {
            const m = directTestid.match(/Panel header\s+(.+)$/);
            if (m) panelTitle = m[1].slice(0, 60);
          }
        }
      } catch {}

      // Detect "No data" — Grafana renders the literal text inside the
      // panel body when a query returns 0 rows. Most reliable detection.
      let hasNoData = false;
      try {
        hasNoData = await panel.locator('text="No data"').first().isVisible({ timeout: 300 }).catch(() => false);
      } catch {}

      // Detect error indicator — Grafana shows a red status pill in the
      // panel header when a query failed. Multiple selectors to cover
      // Grafana 9/10/11.
      let hasError = false;
      try {
        hasError = await panel.locator(
          '[data-testid*="panel status error"], ' +
          '[data-testid*="Panel status"][data-testid*="error"], ' +
          '.panel-info-corner--error, ' +
          '[class*="panel-error"]'
        ).first().isVisible({ timeout: 300 }).catch(() => false);
      } catch {}
      // Also detect via "Error" text in panel header (Grafana 11 sometimes
      // shows just an icon with a tooltip — fall back to looking for the
      // word "Error" in the visible header area)
      if (!hasError) {
        try {
          const headerErr = await panel.locator('header').filter({ hasText: /^\s*Error\s*$/i }).first().isVisible({ timeout: 200 }).catch(() => false);
          if (headerErr) hasError = true;
        } catch {}
      }

      // Capture per-panel screenshot for any failing panel
      let shotPath = null;
      if ((hasError || hasNoData) && runId) {
        try {
          const buf = await panel.screenshot({ timeout: 3000 });
          shotPath = screenshotStore.writeScreenshot(
            runId,
            `${dashUid}_panel-${panelId}`,
            buf
          );
        } catch {
          // Sometimes the panel is not in viewport — try scrolling first
          try {
            await panel.scrollIntoViewIfNeeded({ timeout: 2000 });
            const buf2 = await panel.screenshot({ timeout: 3000 });
            shotPath = screenshotStore.writeScreenshot(
              runId,
              `${dashUid}_panel-${panelId}`,
              buf2
            );
          } catch {}
        }
      }

      const liveUrl = `${grafanaUrl}/d/${dashUid}?viewPanel=${panelId}`;
      if (hasError) {
        errorPanels++;
        results.push({
          name: `[${dashTitle}] Panel "${panelTitle}"`,
          status: 'FAIL',
          detail: 'Panel has an error indicator (red ⚠ in the corner)',
          ms: 0,
          uid: dashUid,
          url: liveUrl,
          metadata: {
            panelId: parseInt(panelId, 10) || panelId,
            panelTitle,
            dashboardTitle: dashTitle,
            screenshot: shotPath,
            issue: 'panel-error',
            dashboardMeta,
          },
        });
      } else if (hasNoData) {
        noDataPanels++;
        results.push({
          name: `[${dashTitle}] Panel "${panelTitle}"`,
          status: 'WARN',
          detail: 'Panel returned No data',
          ms: 0,
          uid: dashUid,
          url: liveUrl,
          metadata: {
            panelId: parseInt(panelId, 10) || panelId,
            panelTitle,
            dashboardTitle: dashTitle,
            screenshot: shotPath,
            issue: 'no-data',
            dashboardMeta,
          },
        });
      } else {
        okPanels++;
      }
    }

    // ── 5. Dashboard summary row ──
    const dashStatus = errorPanels > 0 ? 'FAIL' : noDataPanels > 0 ? 'WARN' : 'PASS';
    const summaryDetail = panelCount === 0
      ? 'No panels detected on this dashboard'
      : `${okPanels}/${panelCount} panels OK · ${errorPanels} error · ${noDataPanels} no-data`;
    results.push({
      name: `[${dashTitle}] Render summary`,
      status: dashStatus,
      detail: summaryDetail,
      ms: Date.now() - start,
      uid: dashUid,
      url: `${grafanaUrl}/d/${dashUid}`,
      metadata: {
        panelCount,
        errorPanels,
        noDataPanels,
        okPanels,
        screenshot: dashScreenshot,
      },
    });
  }

  return results;
};
