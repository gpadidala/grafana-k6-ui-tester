// Full Test Suite Orchestrator
// Runs all tests as k6 scenarios with parallel execution
import { browser } from 'k6/browser';
import config from '../config/grafana.config.js';
import { discoverAll } from '../lib/grafana-api.js';
import { generateJsonReport, generateHtmlReport } from '../lib/reporter.js';

import loginTests from '../tests/01-login.test.js';
import homeTests from '../tests/02-home.test.js';
import dashboardTests, { results as dashboardResults } from '../tests/03-dashboards.test.js';
import alertTests from '../tests/04-alerts.test.js';
import exploreTests from '../tests/05-explore.test.js';
import datasourceTests from '../tests/06-datasources.test.js';
import usersTeamsTests from '../tests/07-users-teams.test.js';
import pluginTests from '../tests/08-plugins.test.js';
import adminTests from '../tests/09-admin.test.js';

export const options = {
  scenarios: {
    login_home: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      exec: 'loginAndHome',
      startTime: '0s',
      options: { browser: { type: 'chromium' } },
    },
    dashboards: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      exec: 'testDashboards',
      startTime: '15s',
      options: { browser: { type: 'chromium' } },
    },
    alerts: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      exec: 'testAlerts',
      startTime: '15s',
      options: { browser: { type: 'chromium' } },
    },
    explore_datasources: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      exec: 'testExploreDatasources',
      startTime: '15s',
      options: { browser: { type: 'chromium' } },
    },
    plugins_users_admin: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      exec: 'testPluginsUsersAdmin',
      startTime: '15s',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: {
    browser_web_vital_lcp: ['p(75)<4000'],
    browser_web_vital_fid: ['p(75)<300'],
    browser_web_vital_cls: ['p(75)<0.1'],
    http_req_duration: ['p(95)<5000'],
    checks: ['rate>0.90'],
  },
};

export async function loginAndHome() {
  await loginTests();
  await homeTests();
}

export async function testDashboards() {
  await dashboardTests();
}

export async function testAlerts() {
  await alertTests();
}

export async function testExploreDatasources() {
  await exploreTests();
  await datasourceTests();
}

export async function testPluginsUsersAdmin() {
  await pluginTests();
  await usersTeamsTests();
  await adminTests();
}

export function handleSummary(data) {
  // Generate reports from k6 summary data
  const manifest = discoverAll();
  const allResults = [...dashboardResults];

  const jsonReport = generateJsonReport(allResults, manifest, config);
  const htmlContent = generateHtmlReport(jsonReport, null);

  return {
    [`${config.test.reportDir}/report.json`]: JSON.stringify(jsonReport, null, 2),
    [`${config.test.reportDir}/report.html`]: htmlContent,
    stdout: generateSummaryOutput(jsonReport),
  };
}

function generateSummaryOutput(report) {
  const s = report.summary;
  const verdict = parseFloat(s.pass_rate) >= 90 ? 'PASSED' : 'FAILED';
  const icon = verdict === 'PASSED' ? '✅' : '❌';

  return `
╔══════════════════════════════════════════════╗
║       GRAFANA UI TEST RESULTS SUMMARY        ║
╠══════════════════════════════════════════════╣
║  Grafana:    ${report.grafana_version.padEnd(32)}║
║  Test Level: ${report.test_level.padEnd(32)}║
║  Total Tests:  ${String(s.total).padEnd(30)}║
║  ✅ Passed:    ${String(s.passed).padEnd(30)}║
║  ❌ Failed:    ${String(s.failed).padEnd(30)}║
║  ⚠️  Warnings:  ${String(s.warnings).padEnd(30)}║
║  Pass Rate:    ${s.pass_rate.padEnd(30)}║
║                                              ║
║  Verdict: ${icon} ${verdict.padEnd(33)}║
╚══════════════════════════════════════════════╝
`;
}
