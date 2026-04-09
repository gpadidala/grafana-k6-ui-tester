const logger = require('../../utils/logger');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const CAT = 'links';

function result(name, status, detail, ms = 0, metadata = {}, uid = null) {
  return { name, status, detail, uid, ms, metadata };
}

/**
 * Lightweight HEAD request to validate external URLs.
 * Returns {ok, status, ms, error}.
 */
function headCheck(urlStr, timeoutMs = 5000) {
  return new Promise(resolve => {
    const start = Date.now();
    try {
      const parsed = new URL(urlStr);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request(parsed, { method: 'HEAD', timeout: timeoutMs }, res => {
        res.resume();
        const ms = Date.now() - start;
        resolve({ ok: res.statusCode < 400, status: res.statusCode, ms, error: null });
      });
      req.on('error', err => {
        resolve({ ok: false, status: 0, ms: Date.now() - start, error: err.message });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, status: 0, ms: Date.now() - start, error: 'timeout' });
      });
      req.end();
    } catch (err) {
      resolve({ ok: false, status: 0, ms: Date.now() - start, error: err.message });
    }
  });
}

function flattenPanels(panels) {
  const flat = [];
  if (!Array.isArray(panels)) return flat;
  for (const p of panels) {
    if (p.type === 'row' && Array.isArray(p.panels)) {
      flat.push(...p.panels);
    } else {
      flat.push(p);
    }
  }
  return flat;
}

async function run(client, _depGraph, _options) {
  const results = [];

  // ── Fetch dashboards ──
  const searchRes = await client.searchDashboards();
  if (!searchRes.ok) {
    results.push(result('Dashboard search', 'FAIL', `Cannot list dashboards: ${searchRes.error}`, searchRes.ms));
    return results;
  }

  const dashList = Array.isArray(searchRes.data) ? searchRes.data : [];
  const dashUidSet = new Set(dashList.map(d => d.uid));
  const dashTagMap = {};
  for (const d of dashList) {
    if (Array.isArray(d.tags)) {
      for (const tag of d.tags) {
        if (!dashTagMap[tag]) dashTagMap[tag] = [];
        dashTagMap[tag].push(d.uid);
      }
    }
  }

  let totalLinks = 0;
  let externalChecked = 0;
  let externalBroken = 0;
  let internalBroken = 0;

  // ── Per-dashboard link analysis ──
  for (const dash of dashList) {
    const uid = dash.uid;
    const dashTitle = dash.title || uid;

    const dbRes = await client.getDashboardByUid(uid);
    if (!dbRes.ok) continue;

    const model = dbRes.data?.dashboard || {};
    const dashLinks = model.links || [];
    const panels = flattenPanels(model.panels || []);

    for (const link of dashLinks) {
      totalLinks++;
      const linkTitle = link.title || link.url || 'untitled';
      const prefix = `[${dashTitle}] Link: ${linkTitle}`;

      if (link.type === 'link' && link.url) {
        // External or absolute URL
        const url = link.url;
        const isExternal = /^https?:\/\//.test(url) && !url.includes('${');

        if (isExternal) {
          // HEAD check for external URLs
          externalChecked++;
          const check = await headCheck(url);
          if (check.ok) {
            results.push(result(prefix, 'PASS', `External link OK (${check.status}) in ${check.ms}ms`, check.ms, { url, dashUid: uid, status: check.status }, uid));
          } else {
            externalBroken++;
            results.push(result(prefix, 'WARN', `External link broken (${check.status || check.error}): ${url}`, check.ms, { url, dashUid: uid, error: check.error, status: check.status }, uid));
          }
        } else if (url.includes('${')) {
          // Template variable in URL — cannot validate
          results.push(result(prefix, 'PASS', `URL contains template variables — skipping validation: ${url}`, 0, { url, dashUid: uid, templated: true }, uid));
        } else {
          // Internal relative link — try to resolve
          const uidMatch = url.match(/\/d\/([^/]+)/);
          if (uidMatch) {
            const refUid = uidMatch[1];
            if (dashUidSet.has(refUid)) {
              results.push(result(prefix, 'PASS', `Internal link to dashboard ${refUid} — exists`, 0, { url, dashUid: uid, targetUid: refUid }, uid));
            } else {
              internalBroken++;
              results.push(result(prefix, 'WARN', `Internal link to dashboard ${refUid} — not found`, 0, { url, dashUid: uid, targetUid: refUid }, uid));
            }
          }
        }
      } else if (link.type === 'dashboards' && link.tags && Array.isArray(link.tags)) {
        // Tag-based links
        const linkedDashes = [];
        for (const tag of link.tags) {
          if (dashTagMap[tag]) linkedDashes.push(...dashTagMap[tag]);
        }
        const uniqueLinked = [...new Set(linkedDashes)];
        if (uniqueLinked.length > 0) {
          results.push(result(
            prefix,
            'PASS',
            `Tag-based link (tags: ${link.tags.join(', ')}) resolves to ${uniqueLinked.length} dashboard(s)`,
            0,
            { dashUid: uid, tags: link.tags, resolvedCount: uniqueLinked.length },
            uid
          ));
        } else {
          results.push(result(
            prefix,
            'WARN',
            `Tag-based link (tags: ${link.tags.join(', ')}) resolves to 0 dashboards`,
            0,
            { dashUid: uid, tags: link.tags, resolvedCount: 0 },
            uid
          ));
        }
      }
    }

    // Check panel links (data links / drilldown links)
    for (const panel of panels) {
      const panelLinks = panel.links || [];
      const fieldConfig = panel.fieldConfig?.defaults?.links || [];
      const allPanelLinks = [...panelLinks, ...fieldConfig];

      for (const pl of allPanelLinks) {
        totalLinks++;
        const plUrl = pl.url || '';
        const plTitle = pl.title || plUrl || 'panel link';
        const plPrefix = `[${dashTitle}/${panel.title || panel.id}] ${plTitle}`;

        if (/^https?:\/\//.test(plUrl) && !plUrl.includes('${')) {
          externalChecked++;
          const check = await headCheck(plUrl);
          if (!check.ok) {
            externalBroken++;
            results.push(result(plPrefix, 'WARN', `Broken panel link (${check.status || check.error}): ${plUrl}`, check.ms, { url: plUrl, dashUid: uid, panelId: panel.id }, uid));
          }
        } else if (plUrl) {
          const uidMatch = plUrl.match(/\/d\/([^/]+)/);
          if (uidMatch && !dashUidSet.has(uidMatch[1])) {
            internalBroken++;
            results.push(result(plPrefix, 'WARN', `Panel link references missing dashboard: ${uidMatch[1]}`, 0, { url: plUrl, dashUid: uid, panelId: panel.id, targetUid: uidMatch[1] }, uid));
          }
        }
      }
    }
  }

  // Link summary
  results.unshift(result(
    'Links summary',
    externalBroken > 0 || internalBroken > 0 ? 'WARN' : 'PASS',
    `${totalLinks} link(s) scanned — ${externalChecked} external checked, ${externalBroken} broken external, ${internalBroken} broken internal`,
    0,
    { totalLinks, externalChecked, externalBroken, internalBroken }
  ));

  // ── Snapshots ──
  const snapRes = await client.getSnapshots();
  if (snapRes.ok) {
    const snapshots = Array.isArray(snapRes.data) ? snapRes.data : [];
    const now = Date.now();
    const expired = snapshots.filter(s => {
      if (s.expires && s.expires !== '0001-01-01T00:00:00Z') {
        return new Date(s.expires) < now;
      }
      return false;
    });

    results.push(result(
      'Snapshots',
      'PASS',
      `${snapshots.length} snapshot(s)`,
      snapRes.ms,
      { count: snapshots.length }
    ));

    if (expired.length > 0) {
      results.push(result(
        'Expired snapshots',
        'WARN',
        `${expired.length} expired snapshot(s) — consider cleaning up`,
        0,
        { expiredCount: expired.length, snapshots: expired.map(s => s.key || s.name) }
      ));
    }
  } else {
    results.push(result('Snapshots', 'WARN', `Cannot fetch snapshots: ${snapRes.error}`, snapRes.ms));
  }

  logger.info(`${CAT}: completed ${results.length} checks`, { category: CAT });
  return results;
}

module.exports = { run };
