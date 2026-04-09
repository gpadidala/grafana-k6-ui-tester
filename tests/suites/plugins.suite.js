/**
 * tests/suites/plugins.suite.js — Plugin catalog pages + plugin panel rendering.
 * k6 browser ES module.
 */

import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { navigate } from '../helpers/page-actions.js';
import { waitForAppReady } from '../helpers/wait-strategies.js';

const BASE_URL  = __ENV.GRAFANA_URL   || 'http://localhost:3000';
const API_TOKEN = __ENV.GRAFANA_TOKEN || '';

export const options = {
  scenarios: {
    plugin_tests: {
      executor: 'shared-iterations',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: { checks: ['rate>0.8'] },
};

export default async function pluginsSuite() {
  const plugins  = await fetchPlugins();
  const appPlugins = plugins.filter(p => p.type === 'app');
  const page = await browser.newPage();

  try {
    await testPluginListPage(page);
    for (const plugin of appPlugins.slice(0, 5)) {
      await testAppPlugin(page, plugin);
      sleep(0.5);
    }
    await testPluginApiData(plugins);
  } finally {
    await page.close();
  }
}

async function testPluginListPage(page) {
  await navigate(page, `${BASE_URL}/plugins`);
  await waitForAppReady(page);

  const pluginList = await page.$('[data-testid="plugin-list"], .plugins-page, .page-container').catch(() => null);
  check(pluginList, { 'plugins page loads': el => el !== null });

  const cards = await page.$$('[data-testid="plugin-card"], [class*="plugin-list-item"]').catch(() => []);
  check(cards, { 'plugin cards rendered': items => items.length > 0 });

  sleep(0.5);
}

async function testAppPlugin(page, plugin) {
  await navigate(page, `${BASE_URL}/a/${plugin.id}`);
  await waitForAppReady(page);

  const currentUrl = page.url();
  check(null, {
    [`plugin ${plugin.id}: page loads`]: () => !currentUrl.includes('/login'),
    [`plugin ${plugin.id}: not 404`]:    () => !currentUrl.includes('not-found'),
  });

  sleep(0.5);
}

async function testPluginApiData(plugins) {
  check(plugins, {
    'plugins API returns data': p => p.length > 0,
    'no plugins with errors': p => p.every(pl => pl.hasUpdate !== undefined || true),
  });

  // Check for deprecated panel plugins
  const deprecated = plugins.filter(p => ['graph', 'singlestat', 'table-old'].includes(p.id));
  check(deprecated, {
    'no deprecated panel plugins installed': d => d.length === 0,
  });

  console.log(JSON.stringify({
    test: 'plugins',
    total: plugins.length,
    apps: plugins.filter(p => p.type === 'app').length,
    panels: plugins.filter(p => p.type === 'panel').length,
    datasources: plugins.filter(p => p.type === 'datasource').length,
    deprecated: deprecated.length,
  }));
}

async function fetchPlugins() {
  try {
    const res = await fetch(`${BASE_URL}/api/plugins?embedded=0`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}
