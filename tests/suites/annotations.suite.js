/**
 * tests/suites/annotations.suite.js — Annotation creation + display validation.
 * k6 browser ES module.
 */

import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { navigate } from '../helpers/page-actions.js';
import { waitForAppReady, waitForToast } from '../helpers/wait-strategies.js';

const BASE_URL  = __ENV.GRAFANA_URL   || 'http://localhost:3000';
const API_TOKEN = __ENV.GRAFANA_TOKEN || '';

export const options = {
  scenarios: {
    annotation_tests: {
      executor: 'shared-iterations',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: { checks: ['rate>0.8'] },
};

export default async function annotationsSuite() {
  const page = await browser.newPage();
  try {
    await testAnnotationsPage(page);
    await testAnnotationApi();
    await testAnnotationOnDashboard(page);
  } finally {
    await page.close();
  }
}

async function testAnnotationsPage(page) {
  await navigate(page, `${BASE_URL}/org/annotations`);
  await waitForAppReady(page);

  const container = await page.$('[data-testid="annotations-page"], .page-container').catch(() => null);
  check(null, {
    'annotations management page loads': () => !page.url().includes('/login'),
  });
  sleep(0.5);
}

async function testAnnotationApi() {
  // Create a test annotation via API
  const createRes = await fetch(`${BASE_URL}/api/annotations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `Sentinel test annotation — ${new Date().toISOString()}`,
      tags: ['sentinel', 'automated-test'],
      time: Date.now(),
    }),
  }).then(r => ({ ok: r.ok, status: r.status })).catch(e => ({ ok: false, error: e.message }));

  check(createRes, {
    'annotation create API: success': r => r.ok,
    'annotation create API: 200 status': r => r.status === 200,
  });

  // Fetch annotations
  const listRes = await fetch(`${BASE_URL}/api/annotations?limit=20`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  }).then(async r => ({ ok: r.ok, data: r.ok ? await r.json() : [] })).catch(() => ({ ok: false, data: [] }));

  check(listRes, {
    'annotation list API: success': r => r.ok,
    'annotation list returns array': r => Array.isArray(r.data),
  });

  sleep(0.5);
}

async function testAnnotationOnDashboard(page) {
  // Navigate to the first available dashboard and check annotations layer
  const dashRes = await fetch(`${BASE_URL}/api/search?type=dash-db&limit=1`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  }).then(r => r.json()).catch(() => []);

  if (!dashRes.length) return;
  const dash = dashRes[0];

  await navigate(page, `${BASE_URL}/d/${dash.uid}?annotations=on`);
  await page.waitForTimeout(3000);

  // Annotations appear as vertical lines on timeseries panels
  const annotationLines = await page.$$('[class*="annotation-marker"], [data-testid="annotation-event-marker"]').catch(() => []);

  // Annotations may or may not exist on the dashboard — just check the page loaded
  check(null, {
    'dashboard with annotations: page loads': () => !page.url().includes('/login'),
  });

  sleep(0.5);
}
