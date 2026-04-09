const logger = require('../../utils/logger');

const CAT = 'folders';

function result(name, status, detail, ms = 0, metadata = {}, uid = null) {
  return { name, status, detail, uid, ms, metadata };
}

async function run(client, _depGraph, _options) {
  const results = [];

  // ── Fetch folders ──
  const foldersRes = await client.getFolders();
  if (!foldersRes.ok) {
    results.push(result('Folder list', 'FAIL', `Cannot fetch folders: ${foldersRes.error}`, foldersRes.ms));
    return results;
  }

  // Normalize: search API returns {uid, title, type}, folders API returns {uid, title}
  const rawFolders = Array.isArray(foldersRes.data) ? foldersRes.data : [];
  const folders = rawFolders.filter(f => f.type === 'dash-folder' || !f.type); // filter if from search

  results.push(result(
    'Folder inventory',
    folders.length > 0 ? 'PASS' : 'WARN',
    `Found ${folders.length} folder(s)`,
    foldersRes.ms,
    { count: folders.length }
  ));

  // ── Fetch all dashboards for distribution analysis ──
  const dashRes = await client.searchDashboards();
  const dashboards = (dashRes.ok && Array.isArray(dashRes.data)) ? dashRes.data : [];

  // Build folder -> dashboard mapping
  const folderDashCount = {};
  const generalCount = dashboards.filter(d => !d.folderUid && !d.folderId).length;
  for (const d of dashboards) {
    const fUid = d.folderUid || (d.folderId ? String(d.folderId) : null);
    if (fUid) {
      folderDashCount[fUid] = (folderDashCount[fUid] || 0) + 1;
    }
  }

  // Also map folderId -> folderUid for folders that report both
  const folderIdToUid = {};
  for (const f of folders) {
    if (f.id && f.uid) folderIdToUid[String(f.id)] = f.uid;
  }

  // ── 1. Hierarchy / nested folder support detection ──
  const nestedFolders = folders.filter(f => f.parentUid);
  const supportsNesting = nestedFolders.length > 0;

  results.push(result(
    'Nested folder support',
    'PASS',
    supportsNesting
      ? `${nestedFolders.length} nested folder(s) detected — nested folders are in use`
      : 'No nested folders detected (flat structure or nesting not enabled)',
    0,
    { nestedCount: nestedFolders.length, supportsNesting }
  ));

  if (supportsNesting) {
    // Build parent-child tree
    const childMap = {};
    for (const f of nestedFolders) {
      const parent = f.parentUid;
      if (!childMap[parent]) childMap[parent] = [];
      childMap[parent].push(f);
    }

    // Compute max depth
    function getDepth(uid, visited = new Set()) {
      if (visited.has(uid)) return 0; // cycle protection
      visited.add(uid);
      const children = childMap[uid] || [];
      if (children.length === 0) return 0;
      return 1 + Math.max(...children.map(c => getDepth(c.uid, visited)));
    }

    const rootFolders = folders.filter(f => !f.parentUid);
    let maxDepth = 0;
    for (const rf of rootFolders) {
      const depth = getDepth(rf.uid);
      if (depth > maxDepth) maxDepth = depth;
    }

    results.push(result(
      'Folder hierarchy depth',
      maxDepth > 5 ? 'WARN' : 'PASS',
      `Max nesting depth: ${maxDepth}${maxDepth > 5 ? ' — deeply nested, may impact navigation' : ''}`,
      0,
      { maxDepth, rootFolders: rootFolders.length }
    ));
  }

  // ── 2. Per-folder checks ──
  const OVERFULL_THRESHOLD = 50;

  for (const folder of folders) {
    const fUid = folder.uid;
    const fTitle = folder.title || folder.name || fUid;
    const prefix = `[${fTitle}]`;

    // Dashboard distribution
    const count = folderDashCount[fUid] || folderDashCount[String(folder.id)] || 0;

    if (count === 0) {
      results.push(result(
        `${prefix} Empty folder`,
        'WARN',
        `Folder has no dashboards — consider removing or populating`,
        0,
        { folderUid: fUid, dashboardCount: 0 },
        fUid
      ));
    } else if (count > OVERFULL_THRESHOLD) {
      results.push(result(
        `${prefix} Overfull folder`,
        'WARN',
        `Folder has ${count} dashboards — consider splitting into sub-folders`,
        0,
        { folderUid: fUid, dashboardCount: count, threshold: OVERFULL_THRESHOLD },
        fUid
      ));
    } else {
      results.push(result(
        `${prefix} Dashboard count`,
        'PASS',
        `${count} dashboard(s)`,
        0,
        { folderUid: fUid, dashboardCount: count },
        fUid
      ));
    }

    // ── Permissions ──
    const permRes = await client.getFolderPermissions(fUid);
    if (permRes.ok) {
      const perms = Array.isArray(permRes.data) ? permRes.data : [];
      const hasViewer = perms.some(p => p.role === 'Viewer' || p.permission === 1);
      const hasEditor = perms.some(p => p.role === 'Editor' || p.permission === 2);
      const hasAdmin = perms.some(p => p.role === 'Admin' || p.permission === 4);
      const teamPerms = perms.filter(p => p.teamId || p.team);
      const userPerms = perms.filter(p => p.userId || p.userLogin);

      results.push(result(
        `${prefix} Permissions`,
        perms.length > 0 ? 'PASS' : 'WARN',
        `${perms.length} permission rule(s) — Viewer:${hasViewer} Editor:${hasEditor} Admin:${hasAdmin}` +
          (teamPerms.length > 0 ? `, ${teamPerms.length} team-based` : '') +
          (userPerms.length > 0 ? `, ${userPerms.length} user-based` : ''),
        permRes.ms,
        {
          folderUid: fUid,
          permissionCount: perms.length,
          hasViewer, hasEditor, hasAdmin,
          teamPerms: teamPerms.length,
          userPerms: userPerms.length,
        },
        fUid
      ));

      // Check for overly permissive (everyone = admin)
      const orgAdminPerms = perms.filter(p => p.role === 'Viewer' && (p.permission === 4 || p.permissionName === 'Admin'));
      if (orgAdminPerms.length > 0) {
        results.push(result(
          `${prefix} Overly permissive`,
          'WARN',
          `Viewer role has Admin permission on this folder`,
          0,
          { folderUid: fUid },
          fUid
        ));
      }
    } else {
      results.push(result(
        `${prefix} Permissions`,
        'WARN',
        `Cannot fetch folder permissions: ${permRes.error}`,
        permRes.ms,
        { folderUid: fUid },
        fUid
      ));
    }
  }

  // ── 3. General folder (unfoldered dashboards) ──
  if (generalCount > 0) {
    results.push(result(
      'General folder (root)',
      generalCount > OVERFULL_THRESHOLD ? 'WARN' : 'PASS',
      `${generalCount} dashboard(s) in root/General${generalCount > OVERFULL_THRESHOLD ? ' — consider organizing into folders' : ''}`,
      0,
      { dashboardCount: generalCount }
    ));
  }

  // ── 4. Distribution summary ──
  const totalDash = dashboards.length;
  const emptyFolders = folders.filter(f => (folderDashCount[f.uid] || folderDashCount[String(f.id)] || 0) === 0);
  const overfullFolders = folders.filter(f => (folderDashCount[f.uid] || folderDashCount[String(f.id)] || 0) > OVERFULL_THRESHOLD);

  results.push(result(
    'Dashboard distribution',
    emptyFolders.length > 0 || overfullFolders.length > 0 ? 'WARN' : 'PASS',
    `${totalDash} dashboard(s) across ${folders.length} folder(s) + root — ${emptyFolders.length} empty, ${overfullFolders.length} overfull`,
    0,
    {
      totalDashboards: totalDash,
      folderCount: folders.length,
      emptyFolders: emptyFolders.map(f => f.title || f.uid),
      overfullFolders: overfullFolders.map(f => f.title || f.uid),
      generalCount,
    }
  ));

  logger.info(`${CAT}: completed ${results.length} checks across ${folders.length} folders`, { category: CAT });
  return results;
}

module.exports = { run };
