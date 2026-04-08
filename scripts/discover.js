// Standalone Discovery Script
// Run: k6 run scripts/discover.js
import { discoverAll } from '../lib/grafana-api.js';
import config from '../config/grafana.config.js';

export const options = {
  vus: 1,
  iterations: 1,
};

export default function () {
  console.log(`\nDiscovering Grafana at: ${config.grafana.url}`);
  console.log(`Test level: ${config.test.level}\n`);

  const manifest = discoverAll();

  console.log('\n=== Discovery Summary ===');
  console.log(`Grafana Version: ${manifest.version}`);
  console.log(`Dashboards:      ${manifest.dashboards.length}`);
  console.log(`Folders:         ${manifest.folders.length}`);
  console.log(`Alert Rules:     ${manifest.alertRules.length}`);
  console.log(`Datasources:     ${manifest.datasources.length}`);
  console.log(`Plugins:         ${manifest.plugins.length}`);
  console.log(`========================\n`);

  if (manifest.dashboards.length > 0) {
    console.log('Dashboards found:');
    manifest.dashboards.forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.title} (uid: ${d.uid}) [${d.folderTitle}]`);
    });
  }

  if (manifest.datasources.length > 0) {
    console.log('\nDatasources:');
    manifest.datasources.forEach((ds) => {
      console.log(`  - ${ds.name} (${ds.type})${ds.isDefault ? ' [DEFAULT]' : ''}`);
    });
  }
}

export function handleSummary() {
  const manifest = discoverAll();
  return {
    [`${config.test.reportDir}/manifest.json`]: JSON.stringify(manifest, null, 2),
  };
}
