const logger = require('../../utils/logger');

const CAT = 'users';

function result(name, status, detail, ms = 0, metadata = {}, uid = null) {
  return { name, status, detail, uid, ms, metadata };
}

async function run(client, _depGraph, _options) {
  const results = [];

  // ── 1. Org users + admin count ──
  const usersRes = await client.getOrgUsers();
  if (usersRes.ok) {
    const users = Array.isArray(usersRes.data) ? usersRes.data : [];
    const admins = users.filter(u => u.role === 'Admin');
    const editors = users.filter(u => u.role === 'Editor');
    const viewers = users.filter(u => u.role === 'Viewer');

    results.push(result(
      'Org users',
      users.length > 0 ? 'PASS' : 'WARN',
      `${users.length} user(s): ${admins.length} Admin, ${editors.length} Editor, ${viewers.length} Viewer`,
      usersRes.ms,
      { total: users.length, admins: admins.length, editors: editors.length, viewers: viewers.length }
    ));

    // Admin count audit
    if (admins.length === 0) {
      results.push(result('Admin count', 'FAIL', 'No admin users found in current org', 0, { admins: 0 }));
    } else if (admins.length === 1) {
      results.push(result(
        'Admin count',
        'WARN',
        `Only 1 admin (${admins[0].login || admins[0].email}) — consider having at least 2 for redundancy`,
        0,
        { admins: 1, admin: admins[0].login || admins[0].email }
      ));
    } else if (admins.length > 5) {
      results.push(result(
        'Admin count',
        'WARN',
        `${admins.length} admins — consider reducing for least-privilege`,
        0,
        { admins: admins.length, adminUsers: admins.map(a => a.login || a.email) }
      ));
    } else {
      results.push(result(
        'Admin count',
        'PASS',
        `${admins.length} admin(s) — healthy count`,
        0,
        { admins: admins.length }
      ));
    }

    // Admin role audit: list users with admin role
    for (const admin of admins) {
      const login = admin.login || admin.email || 'unknown';
      const lastSeen = admin.lastSeenAt || admin.lastSeenAtAge || null;
      results.push(result(
        `[Admin audit] ${login}`,
        'PASS',
        `Admin user: ${login}${lastSeen ? `, last seen: ${lastSeen}` : ''}`,
        0,
        { login, email: admin.email, lastSeen, userId: admin.userId }
      ));
    }
  } else {
    results.push(result('Org users', 'FAIL', `Cannot fetch org users: ${usersRes.error}`, usersRes.ms, { status: usersRes.status }));
  }

  // ── 2. Orgs ──
  const orgsRes = await client.getOrgs();
  if (orgsRes.ok) {
    const orgs = Array.isArray(orgsRes.data) ? orgsRes.data : [];
    results.push(result(
      'Organizations',
      'PASS',
      `${orgs.length} org(s): ${orgs.map(o => o.name).join(', ') || 'none'}`,
      orgsRes.ms,
      { count: orgs.length, orgs: orgs.map(o => ({ id: o.id, name: o.name })) }
    ));
  } else {
    // Orgs endpoint requires server admin — downgrade to WARN
    results.push(result(
      'Organizations',
      orgsRes.status === 403 ? 'WARN' : 'FAIL',
      `Cannot list orgs (${orgsRes.status}): ${orgsRes.error || 'requires server admin'}`,
      orgsRes.ms,
      { status: orgsRes.status }
    ));
  }

  // ── 3. Teams ──
  const teamsRes = await client.getTeams();
  if (teamsRes.ok) {
    const teams = teamsRes.data?.teams || (Array.isArray(teamsRes.data) ? teamsRes.data : []);
    results.push(result(
      'Teams',
      'PASS',
      `${teams.length} team(s)${teams.length > 0 ? ': ' + teams.map(t => t.name).slice(0, 10).join(', ') : ''}`,
      teamsRes.ms,
      { count: teams.length, teams: teams.map(t => ({ id: t.id, name: t.name, memberCount: t.memberCount })) }
    ));

    // Check for empty teams
    const emptyTeams = teams.filter(t => t.memberCount === 0);
    if (emptyTeams.length > 0) {
      results.push(result(
        'Empty teams',
        'WARN',
        `${emptyTeams.length} team(s) with no members: ${emptyTeams.map(t => t.name).join(', ')}`,
        0,
        { count: emptyTeams.length, teams: emptyTeams.map(t => t.name) }
      ));
    }
  } else {
    results.push(result(
      'Teams',
      teamsRes.status === 403 ? 'WARN' : 'FAIL',
      `Cannot list teams (${teamsRes.status}): ${teamsRes.error}`,
      teamsRes.ms
    ));
  }

  // ── 4. Service accounts ──
  const saRes = await client.getServiceAccounts();
  if (saRes.ok) {
    const sas = saRes.data?.serviceAccounts || (Array.isArray(saRes.data) ? saRes.data : []);
    results.push(result(
      'Service accounts',
      'PASS',
      `${sas.length} service account(s)`,
      saRes.ms,
      { count: sas.length }
    ));

    // Admin role audit for service accounts
    const adminSAs = sas.filter(sa => sa.role === 'Admin');
    if (adminSAs.length > 0) {
      results.push(result(
        'Service accounts — admin role',
        'WARN',
        `${adminSAs.length} service account(s) with Admin role: ${adminSAs.map(sa => sa.name || sa.login).join(', ')}`,
        0,
        { count: adminSAs.length, accounts: adminSAs.map(sa => sa.name || sa.login) }
      ));
    } else if (sas.length > 0) {
      results.push(result(
        'Service accounts — admin role',
        'PASS',
        'No service accounts with Admin role',
        0
      ));
    }

    // Token expiry check (if available)
    for (const sa of sas) {
      const saName = sa.name || sa.login || `sa-${sa.id}`;
      if (sa.tokens && Array.isArray(sa.tokens)) {
        for (const token of sa.tokens) {
          if (token.expiration) {
            const expiresAt = new Date(token.expiration);
            const now = new Date();
            const daysUntilExpiry = (expiresAt - now) / (1000 * 60 * 60 * 24);
            if (daysUntilExpiry < 0) {
              results.push(result(
                `[SA] ${saName} — token expired`,
                'FAIL',
                `Token "${token.name || 'unnamed'}" expired ${Math.abs(Math.round(daysUntilExpiry))} day(s) ago`,
                0,
                { saId: sa.id, saName, tokenName: token.name, expiration: token.expiration }
              ));
            } else if (daysUntilExpiry < 30) {
              results.push(result(
                `[SA] ${saName} — token expiring soon`,
                'WARN',
                `Token "${token.name || 'unnamed'}" expires in ${Math.round(daysUntilExpiry)} day(s)`,
                0,
                { saId: sa.id, saName, tokenName: token.name, expiration: token.expiration, daysUntilExpiry: Math.round(daysUntilExpiry) }
              ));
            }
          } else {
            results.push(result(
              `[SA] ${saName} — no token expiry`,
              'WARN',
              `Token "${token.name || 'unnamed'}" has no expiration set`,
              0,
              { saId: sa.id, saName, tokenName: token.name }
            ));
          }
        }
      }
      // Check isDisabled flag
      if (sa.isDisabled === true) {
        results.push(result(
          `[SA] ${saName} — disabled`,
          'WARN',
          `Service account "${saName}" is disabled`,
          0,
          { saId: sa.id, saName, disabled: true }
        ));
      }
    }
  } else {
    results.push(result(
      'Service accounts',
      saRes.status === 403 ? 'WARN' : 'FAIL',
      `Cannot list service accounts (${saRes.status}): ${saRes.error}`,
      saRes.ms
    ));
  }

  // ── 5. Security scorecard ──
  const scorecard = { score: 0, max: 0, issues: [] };

  // Check: multiple admins (redundancy)
  scorecard.max += 10;
  if (usersRes.ok) {
    const admins = (Array.isArray(usersRes.data) ? usersRes.data : []).filter(u => u.role === 'Admin');
    if (admins.length >= 2 && admins.length <= 5) {
      scorecard.score += 10;
    } else {
      scorecard.issues.push(admins.length < 2 ? 'Too few admins (<2)' : 'Too many admins (>5)');
    }
  }

  // Check: no admin service accounts
  scorecard.max += 10;
  if (saRes.ok) {
    const sas = saRes.data?.serviceAccounts || (Array.isArray(saRes.data) ? saRes.data : []);
    const adminSAs = sas.filter(sa => sa.role === 'Admin');
    if (adminSAs.length === 0) {
      scorecard.score += 10;
    } else {
      scorecard.issues.push(`${adminSAs.length} service account(s) have Admin role`);
    }
  }

  // Check: teams exist (RBAC usage)
  scorecard.max += 10;
  if (teamsRes.ok) {
    const teams = teamsRes.data?.teams || (Array.isArray(teamsRes.data) ? teamsRes.data : []);
    if (teams.length > 0) {
      scorecard.score += 10;
    } else {
      scorecard.issues.push('No teams configured — consider team-based RBAC');
    }
  }

  // Check: viewer-to-editor ratio (viewers should be majority)
  scorecard.max += 10;
  if (usersRes.ok) {
    const users = Array.isArray(usersRes.data) ? usersRes.data : [];
    const viewers = users.filter(u => u.role === 'Viewer').length;
    const editors = users.filter(u => u.role === 'Editor').length;
    if (users.length > 0 && viewers >= editors) {
      scorecard.score += 10;
    } else if (users.length > 0) {
      scorecard.issues.push('More editors than viewers — review least-privilege');
    }
  }

  const pct = scorecard.max > 0 ? Math.round((scorecard.score / scorecard.max) * 100) : 0;
  results.push(result(
    'Security scorecard',
    pct >= 75 ? 'PASS' : pct >= 50 ? 'WARN' : 'FAIL',
    `Score: ${scorecard.score}/${scorecard.max} (${pct}%)${scorecard.issues.length > 0 ? ' — ' + scorecard.issues.join('; ') : ''}`,
    0,
    { score: scorecard.score, max: scorecard.max, pct, issues: scorecard.issues }
  ));

  logger.info(`${CAT}: completed ${results.length} checks`, { category: CAT });
  return results;
}

module.exports = { run };
