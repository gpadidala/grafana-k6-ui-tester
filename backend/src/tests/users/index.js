module.exports = async function userTests(client) {
  const results = [];

  // Org users
  const users = await client.getUsers();
  if (users.ok && Array.isArray(users.data)) {
    results.push({ name: 'Org Users', status: 'PASS', detail: `${users.data.length} user(s)`, ms: users.ms });
    const admins = users.data.filter(u => u.role === 'Admin');
    results.push({
      name: 'Admin Count', status: admins.length <= 5 ? 'PASS' : 'WARN',
      detail: `${admins.length} admin(s)${admins.length > 5 ? ' — consider reducing admin count for security' : ''}`,
    });
  } else {
    results.push({ name: 'Org Users', status: 'FAIL', detail: `HTTP ${users.status}`, ms: users.ms });
  }

  // Organizations
  const orgs = await client.getOrgs();
  results.push({
    name: 'Organizations', status: orgs.ok ? 'PASS' : (orgs.status === 403 ? 'PASS' : 'FAIL'),
    detail: orgs.ok ? `${Array.isArray(orgs.data) ? orgs.data.length : 0} org(s)` : orgs.status === 403 ? 'Requires server admin — skipped' : `HTTP ${orgs.status}`,
    ms: orgs.ms,
  });

  // Teams
  const teams = await client.getTeams();
  if (teams.ok) {
    const list = teams.data?.teams || [];
    results.push({ name: 'Teams', status: 'PASS', detail: `${list.length} team(s)`, ms: teams.ms });
  } else {
    results.push({ name: 'Teams', status: orgs.status === 403 ? 'PASS' : 'FAIL', detail: `HTTP ${teams.status}`, ms: teams.ms });
  }

  // Service accounts
  const sa = await client.getServiceAccounts();
  if (sa.ok) {
    const list = sa.data?.serviceAccounts || [];
    results.push({ name: 'Service Accounts', status: 'PASS', detail: `${list.length} service account(s)`, ms: sa.ms });

    // Check for overprivileged SAs
    const adminSa = list.filter(s => s.role === 'Admin');
    if (adminSa.length > 3) {
      results.push({
        name: 'SA Security', status: 'WARN',
        detail: `${adminSa.length} service accounts with Admin role — review for least privilege`,
      });
    }
  } else {
    results.push({ name: 'Service Accounts', status: sa.status === 403 ? 'PASS' : 'FAIL', detail: `HTTP ${sa.status}`, ms: sa.ms });
  }

  return results;
};
