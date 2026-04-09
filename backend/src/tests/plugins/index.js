const logger = require('../../utils/logger');

const CAT = 'plugins';

function result(name, status, detail, ms = 0, metadata = {}, uid = null) {
  return { name, status, detail, uid, ms, metadata };
}

// Known Angular-based plugins (no exhaustive list — we also check the angular flag)
const KNOWN_ANGULAR_PLUGINS = new Set([
  'grafana-piechart-panel', 'grafana-worldmap-panel', 'grafana-clock-panel',
  'natel-discrete-panel', 'natel-plotly-panel', 'briangann-gauge-panel',
  'digiapulssi-breadcrumb-panel', 'jdbranham-diagram-panel',
]);

async function run(client, _depGraph, _options) {
  const results = [];

  // ── Fetch plugins ──
  const plugRes = await client.getPlugins();
  if (!plugRes.ok) {
    results.push(result('Plugin list', 'FAIL', `Cannot fetch plugins: ${plugRes.error}`, plugRes.ms));
    return results;
  }

  const plugins = Array.isArray(plugRes.data) ? plugRes.data : [];
  const panelPlugins = plugins.filter(p => p.type === 'panel');
  const dsPlugins = plugins.filter(p => p.type === 'datasource');
  const appPlugins = plugins.filter(p => p.type === 'app');

  results.push(result(
    'Plugin inventory',
    'PASS',
    `${plugins.length} plugin(s): ${panelPlugins.length} panel, ${dsPlugins.length} datasource, ${appPlugins.length} app`,
    plugRes.ms,
    { total: plugins.length, panel: panelPlugins.length, datasource: dsPlugins.length, app: appPlugins.length }
  ));

  for (const plugin of plugins) {
    const pid = plugin.id || plugin.slug;
    const pName = plugin.name || pid;
    const prefix = `[${pName}]`;

    // ── Signature check ──
    const sig = plugin.signature || plugin.signatureType || 'unknown';
    const sigOrg = plugin.signatureOrg || '';
    if (sig === 'valid' || sig === 'internal' || sig === 'grafana') {
      results.push(result(
        `${prefix} Signature`,
        'PASS',
        `Signature: ${sig}${sigOrg ? ` (${sigOrg})` : ''}`,
        0,
        { pluginId: pid, signature: sig, signatureOrg: sigOrg },
        pid
      ));
    } else if (sig === 'unsigned') {
      results.push(result(
        `${prefix} Signature`,
        'WARN',
        `Plugin is unsigned — potential security risk`,
        0,
        { pluginId: pid, signature: sig },
        pid
      ));
    } else if (sig === 'modified') {
      results.push(result(
        `${prefix} Signature`,
        'FAIL',
        `Plugin signature is modified — files may have been tampered with`,
        0,
        { pluginId: pid, signature: sig },
        pid
      ));
    } else if (sig === 'invalid') {
      results.push(result(
        `${prefix} Signature`,
        'FAIL',
        `Plugin has invalid signature`,
        0,
        { pluginId: pid, signature: sig },
        pid
      ));
    } else {
      results.push(result(
        `${prefix} Signature`,
        'WARN',
        `Signature status: ${sig}`,
        0,
        { pluginId: pid, signature: sig },
        pid
      ));
    }

    // ── Health check (for plugins that support it) ──
    const healthRes = await client.getPluginHealth(pid);
    if (healthRes.ok) {
      results.push(result(
        `${prefix} Health`,
        'PASS',
        `Health check passed in ${healthRes.ms}ms`,
        healthRes.ms,
        { pluginId: pid },
        pid
      ));
    } else if (healthRes.status === 404) {
      // No health endpoint — not all plugins have one
      results.push(result(
        `${prefix} Health`,
        'PASS',
        `No health endpoint (normal for ${plugin.type} plugins)`,
        healthRes.ms,
        { pluginId: pid },
        pid
      ));
    } else {
      results.push(result(
        `${prefix} Health`,
        'WARN',
        `Health check failed (${healthRes.status}): ${healthRes.error || 'error'}`,
        healthRes.ms,
        { pluginId: pid, errorStatus: healthRes.status },
        pid
      ));
    }

    // ── Version info ──
    const version = plugin.info?.version || plugin.version || 'unknown';
    results.push(result(
      `${prefix} Version`,
      'PASS',
      `Installed version: ${version}`,
      0,
      { pluginId: pid, version },
      pid
    ));

    // ── Angular detection ──
    const isAngular = plugin.angular?.detected === true
      || plugin.angularDetected === true
      || KNOWN_ANGULAR_PLUGINS.has(pid);
    if (isAngular) {
      results.push(result(
        `${prefix} Angular`,
        'WARN',
        `Plugin uses Angular — Angular support is deprecated and will be removed`,
        0,
        { pluginId: pid, angular: true },
        pid
      ));
    }

    // ── Update discovery (mock: check hasUpdate flag) ──
    const hasUpdate = plugin.hasUpdate === true || plugin.latestVersion != null;
    if (hasUpdate) {
      const latest = plugin.latestVersion || 'newer version available';
      results.push(result(
        `${prefix} Update available`,
        'WARN',
        `Update available: ${version} -> ${latest}`,
        0,
        { pluginId: pid, currentVersion: version, latestVersion: latest },
        pid
      ));
    }
  }

  // ── Summary: unsigned count ──
  const unsigned = plugins.filter(p => (p.signature || p.signatureType) === 'unsigned');
  const angularCount = plugins.filter(p =>
    p.angular?.detected === true || p.angularDetected === true || KNOWN_ANGULAR_PLUGINS.has(p.id || p.slug)
  );

  if (unsigned.length > 0) {
    results.push(result(
      'Unsigned plugins summary',
      'WARN',
      `${unsigned.length} unsigned plugin(s): ${unsigned.map(p => p.id || p.slug).join(', ')}`,
      0,
      { count: unsigned.length, plugins: unsigned.map(p => p.id || p.slug) }
    ));
  }

  if (angularCount.length > 0) {
    results.push(result(
      'Angular plugins summary',
      'WARN',
      `${angularCount.length} Angular plugin(s) detected — plan migration`,
      0,
      { count: angularCount.length, plugins: angularCount.map(p => p.id || p.slug) }
    ));
  }

  logger.info(`${CAT}: completed ${results.length} checks across ${plugins.length} plugins`, { category: CAT });
  return results;
}

module.exports = { run };
