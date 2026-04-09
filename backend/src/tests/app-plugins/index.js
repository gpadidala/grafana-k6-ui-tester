const logger = require('../../utils/logger');

const CAT = 'app-plugins';

function result(name, status, detail, ms = 0, metadata = {}, uid = null) {
  return { name, status, detail, uid, ms, metadata };
}

async function run(client, _depGraph, _options) {
  const results = [];

  // ── Fetch all plugins, filter to apps ──
  const plugRes = await client.getPlugins();
  if (!plugRes.ok) {
    results.push(result('App plugin list', 'FAIL', `Cannot fetch plugins: ${plugRes.error}`, plugRes.ms));
    return results;
  }

  const allPlugins = Array.isArray(plugRes.data) ? plugRes.data : [];
  const appPlugins = allPlugins.filter(p => p.type === 'app');

  results.push(result(
    'App plugin inventory',
    'PASS',
    `Found ${appPlugins.length} app plugin(s)`,
    plugRes.ms,
    { count: appPlugins.length, apps: appPlugins.map(p => p.id || p.slug) }
  ));

  if (appPlugins.length === 0) {
    return results;
  }

  for (const app of appPlugins) {
    const appId = app.id || app.slug;
    const appName = app.name || appId;
    const prefix = `[${appName}]`;
    const enabled = app.enabled === true;

    // ── Enabled status ──
    if (!enabled) {
      results.push(result(
        `${prefix} Enabled`,
        'WARN',
        `App plugin is installed but not enabled`,
        0,
        { pluginId: appId, enabled: false },
        appId
      ));
      continue; // skip further checks for disabled apps
    }

    results.push(result(
      `${prefix} Enabled`,
      'PASS',
      `App plugin is enabled`,
      0,
      { pluginId: appId, enabled: true },
      appId
    ));

    // ── Settings ──
    const settingsRes = await client.getPluginSettings(appId);
    if (settingsRes.ok) {
      const settings = settingsRes.data || {};
      const jsonData = settings.jsonData || {};
      const secureFields = settings.secureJsonFields || {};
      const configuredFields = Object.keys(jsonData).length + Object.keys(secureFields).length;
      const pinned = settings.pinned === true;
      const version = settings.info?.version || app.info?.version || 'unknown';

      results.push(result(
        `${prefix} Settings`,
        'PASS',
        `Version: ${version}, ${configuredFields} config field(s), pinned: ${pinned}`,
        settingsRes.ms,
        {
          pluginId: appId,
          version,
          configuredFields,
          pinned,
          jsonDataKeys: Object.keys(jsonData),
          secureFieldKeys: Object.keys(secureFields),
        },
        appId
      ));
    } else {
      results.push(result(
        `${prefix} Settings`,
        'WARN',
        `Cannot fetch settings (${settingsRes.status}): ${settingsRes.error}`,
        settingsRes.ms,
        { pluginId: appId },
        appId
      ));
    }

    // ── Health ──
    const healthRes = await client.getPluginHealth(appId);
    if (healthRes.ok) {
      results.push(result(
        `${prefix} Health`,
        'PASS',
        `Health check passed in ${healthRes.ms}ms`,
        healthRes.ms,
        { pluginId: appId },
        appId
      ));
    } else if (healthRes.status === 404) {
      results.push(result(
        `${prefix} Health`,
        'PASS',
        `No health endpoint available (not required for all apps)`,
        healthRes.ms,
        { pluginId: appId },
        appId
      ));
    } else {
      results.push(result(
        `${prefix} Health`,
        'WARN',
        `Health check failed (${healthRes.status}): ${healthRes.error || 'error'}`,
        healthRes.ms,
        { pluginId: appId, errorStatus: healthRes.status },
        appId
      ));
    }

    // ── Included dashboards ──
    const includes = (app.includes || settingsRes?.data?.includes || []).filter(
      inc => inc.type === 'dashboard'
    );

    if (includes.length > 0) {
      let foundCount = 0;
      let missingCount = 0;

      for (const inc of includes) {
        const dashPath = inc.path || '';
        const dashName = inc.name || dashPath || 'unnamed';
        // Try to find the included dashboard via search
        const searchRes = await client.searchDashboards(dashName);
        if (searchRes.ok && Array.isArray(searchRes.data) && searchRes.data.length > 0) {
          foundCount++;
        } else {
          missingCount++;
          results.push(result(
            `${prefix} Included dash: ${dashName}`,
            'WARN',
            `Included dashboard "${dashName}" not found via search`,
            searchRes.ms || 0,
            { pluginId: appId, dashName, path: dashPath },
            appId
          ));
        }
      }

      results.push(result(
        `${prefix} Included dashboards`,
        missingCount > 0 ? 'WARN' : 'PASS',
        `${includes.length} included dashboard(s): ${foundCount} found, ${missingCount} missing`,
        0,
        { pluginId: appId, total: includes.length, found: foundCount, missing: missingCount },
        appId
      ));
    } else {
      results.push(result(
        `${prefix} Included dashboards`,
        'PASS',
        `No included dashboards defined`,
        0,
        { pluginId: appId },
        appId
      ));
    }
  }

  logger.info(`${CAT}: completed ${results.length} checks across ${appPlugins.length} app plugins`, { category: CAT });
  return results;
}

module.exports = { run };
