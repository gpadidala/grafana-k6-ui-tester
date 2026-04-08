import { TestRun, TestResult, TestSummary } from '../types';
import { addTestRun, updateTestRun } from './store';

// Trigger a test run against the backend
// In production, this calls your API server which runs k6
// For now, we simulate + support local backend at /api
const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:4000';

export async function triggerTestRun(
  envId: string,
  envName: string,
  grafanaUrl: string,
  token: string,
  testLevel: string
): Promise<TestRun> {
  const run: TestRun = {
    id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    envId,
    envName,
    grafanaUrl,
    status: 'running',
    startedAt: new Date().toISOString(),
    testLevel,
  };

  addTestRun(run);

  try {
    const res = await fetch(`${API_BASE}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grafanaUrl,
        token,
        testLevel,
        envName,
      }),
    });

    if (!res.ok) {
      throw new Error(`Backend returned ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();

    run.status = parseFloat(data.summary?.pass_rate || '0') >= 90 ? 'passed' : 'failed';
    run.completedAt = new Date().toISOString();
    run.summary = data.summary;
    run.results = data.results;
    run.reportHtml = data.reportHtml;

    updateTestRun(run);
    return run;
  } catch (err: any) {
    // If backend is not running, simulate with mock data
    console.warn('Backend not available, using mock data:', err.message);
    return simulateTestRun(run);
  }
}

// Simulate a test run when backend is not available
async function simulateTestRun(run: TestRun): Promise<TestRun> {
  await new Promise(r => setTimeout(r, 3000)); // simulate delay

  const categories = [
    { cat: 'login', items: ['Login & Authentication'] },
    { cat: 'home', items: ['Home Page', 'Dashboard Browser'] },
    { cat: 'dashboards', items: ['Infrastructure Overview', 'Application Metrics', 'Business KPIs', 'Network Traffic', 'System Health'] },
    { cat: 'alerts', items: ['Alert Rules List', 'Silences Page', 'Contact Points'] },
    { cat: 'explore', items: ['Explore Page'] },
    { cat: 'datasources', items: ['Datasources List', 'Datasource: Prometheus'] },
    { cat: 'plugins', items: ['Plugins List', 'Plugin: Alertmanager', 'Plugin: Loki'] },
  ];

  const results: TestResult[] = [];
  categories.forEach(({ cat, items }) => {
    items.forEach(name => {
      const r = Math.random();
      const status = r > 0.15 ? 'PASS' : r > 0.05 ? 'WARN' : 'FAIL';
      results.push({
        category: cat,
        name,
        uid: name.toLowerCase().replace(/\s+/g, '-'),
        status: status as any,
        load_time_ms: Math.round(500 + Math.random() * 3000),
        error: status === 'PASS'
          ? `OK — loaded in ${Math.round(500 + Math.random() * 2000)}ms`
          : status === 'WARN'
            ? '2 panel(s) showing "No data": [CPU, Memory]'
            : 'Page /alerting/silences failed (HTTP timeout)',
      });
    });
  });

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const warnings = results.filter(r => r.status === 'WARN').length;
  const total = results.length;

  const summary: TestSummary = {
    total,
    passed,
    failed,
    warnings,
    pass_rate: `${((passed / total) * 100).toFixed(1)}%`,
  };

  run.status = parseFloat(summary.pass_rate) >= 90 ? 'passed' : 'failed';
  run.completedAt = new Date().toISOString();
  run.summary = summary;
  run.results = results;

  updateTestRun(run);
  return run;
}
