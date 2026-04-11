const API = process.env.REACT_APP_API_URL || 'http://localhost:4000';

async function request(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return res.json();
}

export const api = {
  health: () => request('GET', '/api/health'),
  config: () => request('GET', '/api/config'),
  testConnection: (grafanaUrl, token) => request('POST', '/api/test-connection', { grafanaUrl, token }),
  listDatasources: (grafanaUrl, token) => {
    const qs = new URLSearchParams();
    if (grafanaUrl) qs.set('grafanaUrl', grafanaUrl);
    if (token) qs.set('token', token);
    return request('GET', `/api/datasources?${qs.toString()}`);
  },
  getDatasourceImpact: (uid, grafanaUrl, token) => {
    const qs = new URLSearchParams();
    if (grafanaUrl) qs.set('grafanaUrl', grafanaUrl);
    if (token) qs.set('token', token);
    return request('GET', `/api/datasources/${encodeURIComponent(uid)}/impact?${qs.toString()}`);
  },
  getCategories: () => request('GET', '/api/tests/categories'),
  runTests: (body) => request('POST', '/api/tests/run', body),
  runCategory: (id, body) => request('POST', `/api/tests/run-category/${id}`, body),
  getReports: () => request('GET', '/api/reports'),
  getReport: (file) => request('GET', `/api/reports/${file}`),
  deleteReport: (id) => request('DELETE', `/api/reports/${id}`),
  deleteAllReports: () => request('DELETE', '/api/reports'),
  getHtmlReportUrl: (file) => `${API}/api/reports/html/${file}`,

  // DSUD Snapshots
  listSnapshots: () => request('GET', '/api/snapshots'),
  getSnapshot: (id) => request('GET', `/api/snapshots/${id}`),
  createSnapshot: (body) => request('POST', '/api/snapshots', body),
  deleteSnapshot: (id) => request('DELETE', `/api/snapshots/${id}`),
  createDiff: (baselineId, currentId) => request('POST', '/api/snapshots/diff', { baselineId, currentId }),
  getDiff: (id) => request('GET', `/api/snapshots/diff/${id}`),
  listDiffs: () => request('GET', '/api/snapshots/diff'),
  acknowledgeDiffItem: (diffId, itemId) => request('POST', `/api/snapshots/diff/${diffId}/items/${itemId}/ack`),
  getSnapshotDashboard: (snapshotId, uid) => request('GET', `/api/snapshots/${snapshotId}/dashboards/${uid}`),
  getSnapshotStorageInfo: () => request('GET', '/api/snapshots/storage-info'),

  // Email
  getEmailConfig: () => request('GET', '/api/email/config'),
  saveEmailConfig: (cfg) => request('POST', '/api/email/config', cfg),
  sendTestEmail: (to) => request('POST', '/api/email/test', { to }),
  notifyFailure: (body) => request('POST', '/api/email/notify-failure', body),
};

export const API_BASE = API;
export default api;
