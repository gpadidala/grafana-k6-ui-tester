module.exports = async function folderTests(client) {
  const results = [];
  const res = await client.searchFolders();
  if (!res.ok) {
    results.push({ name: 'Fetch Folders', status: 'FAIL', detail: `HTTP ${res.status}`, ms: res.ms });
    return results;
  }

  const folders = Array.isArray(res.data) ? res.data : [];
  results.push({ name: 'Fetch Folders', status: 'PASS', detail: `Found ${folders.length} folder(s)`, ms: res.ms });

  // Check each folder structure
  for (const f of folders) {
    const detail = await client.getFolder(f.uid);
    results.push({
      name: `Folder: ${f.title}`, status: detail.ok ? 'PASS' : 'WARN', uid: f.uid,
      detail: detail.ok ? `Accessible — created by: ${detail.data?.createdBy || 'unknown'}` : `Access error: HTTP ${detail.status}`,
      ms: detail.ms,
    });
  }

  // Dashboard distribution
  const dashRes = await client.searchDashboards();
  if (dashRes.ok && Array.isArray(dashRes.data)) {
    const byFolder = {};
    dashRes.data.forEach(d => {
      const f = d.folderTitle || 'General';
      byFolder[f] = (byFolder[f] || 0) + 1;
    });
    const dist = Object.entries(byFolder).map(([k, v]) => `${k}: ${v}`).join(', ');
    results.push({ name: 'Dashboard Distribution', status: 'PASS', detail: dist });
  }

  // Folder permissions
  for (const f of folders.slice(0, 10)) {
    const perms = await client.getFolderPermissions(f.uid);
    if (perms.ok && Array.isArray(perms.data)) {
      const roles = perms.data.map(p => p.role || p.teamId || p.userId).filter(Boolean);
      results.push({
        name: `Permissions: ${f.title}`, status: 'PASS', uid: f.uid,
        detail: `${perms.data.length} permission(s): ${roles.join(', ') || 'default'}`,
      });
    }
  }

  return results;
};
