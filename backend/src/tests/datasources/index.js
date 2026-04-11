const logger = require('../../utils/logger');
const config = require('../../config');
const { datasourceMatches, normalizeFilter } = require('../utils/dsFilter');

const CAT = 'datasources';

function result(name, status, detail, ms = 0, metadata = {}, uid = null) {
  return { name, status, detail, uid, ms, metadata };
}

// Type-aware sample queries
function sampleQuery(ds) {
  const type = (ds.type || '').toLowerCase();
  const now = Date.now();
  const from = now - 5 * 60 * 1000;

  if (type === 'prometheus' || type === 'mimir') {
    return {
      queries: [{
        refId: 'A',
        datasource: { uid: ds.uid, type: ds.type },
        expr: 'up',
        instant: true,
      }],
      from: String(from),
      to: String(now),
    };
  }
  if (type === 'loki') {
    return {
      queries: [{
        refId: 'A',
        datasource: { uid: ds.uid, type: ds.type },
        expr: '{job=~".+"}',
        queryType: 'range',
        maxLines: 5,
      }],
      from: String(from),
      to: String(now),
    };
  }
  if (type === 'testdata' || type === 'grafana-testdata-datasource') {
    return {
      queries: [{
        refId: 'A',
        datasource: { uid: ds.uid, type: ds.type },
        scenarioId: 'random_walk',
      }],
      from: String(from),
      to: String(now),
    };
  }
  if (type === 'elasticsearch' || type === 'opensearch') {
    return {
      queries: [{
        refId: 'A',
        datasource: { uid: ds.uid, type: ds.type },
        query: '*',
        metrics: [{ type: 'count', id: '1' }],
        bucketAggs: [{ type: 'date_histogram', id: '2', field: '@timestamp', settings: { interval: 'auto' } }],
      }],
      from: String(from),
      to: String(now),
    };
  }
  if (type === 'influxdb') {
    return {
      queries: [{
        refId: 'A',
        datasource: { uid: ds.uid, type: ds.type },
        query: 'SHOW DATABASES',
      }],
      from: String(from),
      to: String(now),
    };
  }
  // Tempo / Jaeger / Zipkin — skip query, health only
  return null;
}

async function run(client, _depGraph, options = {}) {
  const results = [];
  const dsFilter = normalizeFilter(options.datasourceFilter);

  // ── Fetch datasources ──
  const dsRes = await client.getDataSources();
  if (!dsRes.ok) {
    results.push(result('Datasource list', 'FAIL', `Cannot retrieve datasources: ${dsRes.error}`, dsRes.ms));
    return results;
  }

  const allDatasources = Array.isArray(dsRes.data) ? dsRes.data : [];
  // When scoped, only test the target datasource itself
  const datasources = dsFilter ? allDatasources.filter((d) => datasourceMatches(d, dsFilter)) : allDatasources;

  results.push(result(
    'Datasource inventory',
    datasources.length > 0 ? 'PASS' : dsFilter ? 'FAIL' : 'WARN',
    dsFilter
      ? `Scoped to ${datasources.length} datasource(s) matching filter "${dsFilter.uid || dsFilter.name}"`
      : `Found ${datasources.length} datasource(s)`,
    dsRes.ms,
    { count: datasources.length, types: [...new Set(datasources.map(d => d.type))], filtered: !!dsFilter }
  ));

  if (dsFilter && datasources.length === 0) {
    results.push(result(
      'Datasource scope',
      'FAIL',
      `No datasource matched the filter "${dsFilter.uid || dsFilter.name}"`,
      0,
      { filter: dsFilter }
    ));
    return results;
  }

  // ── Default datasource check ──
  const defaults = datasources.filter(d => d.isDefault);
  if (defaults.length === 1) {
    results.push(result('Default datasource', 'PASS', `Default DS: ${defaults[0].name} (${defaults[0].type})`, 0, { uid: defaults[0].uid, type: defaults[0].type }, defaults[0].uid));
  } else if (defaults.length === 0) {
    results.push(result('Default datasource', 'WARN', 'No default datasource configured', 0));
  } else {
    results.push(result('Default datasource', 'WARN', `Multiple defaults found: ${defaults.map(d => d.name).join(', ')}`, 0, { defaults: defaults.map(d => d.uid) }));
  }

  // ── Per-datasource checks ──
  for (const ds of datasources) {
    const dsLabel = `${ds.name} (${ds.type})`;

    // Config validation
    const configIssues = [];
    if (!ds.url && ds.type !== 'testdata' && ds.type !== 'grafana-testdata-datasource' && ds.type !== 'grafana') {
      configIssues.push('missing URL');
    }
    if (ds.basicAuth && !ds.basicAuthUser) {
      configIssues.push('basicAuth enabled but no user set');
    }
    if (ds.access === 'direct') {
      configIssues.push('using browser (direct) access mode — proxy recommended');
    }
    if (configIssues.length > 0) {
      results.push(result(`Config: ${dsLabel}`, 'WARN', `Config issues: ${configIssues.join('; ')}`, 0, { uid: ds.uid, issues: configIssues }, ds.uid));
    } else {
      results.push(result(`Config: ${dsLabel}`, 'PASS', `Configuration looks valid (access: ${ds.access || 'proxy'})`, 0, { uid: ds.uid, access: ds.access }, ds.uid));
    }

    // Health check
    const healthRes = await client.testDataSource(ds.uid);
    if (healthRes.ok) {
      const slowMs = config.thresholds.slowQueryThresholdMs || 5000;
      const status = healthRes.ms > slowMs ? 'WARN' : 'PASS';
      results.push(result(
        `Health: ${dsLabel}`,
        status,
        `Health OK in ${healthRes.ms}ms${healthRes.ms > slowMs ? ' (slow)' : ''}`,
        healthRes.ms,
        { uid: ds.uid, type: ds.type },
        ds.uid
      ));
    } else {
      results.push(result(
        `Health: ${dsLabel}`,
        'FAIL',
        `Health check failed (${healthRes.status}): ${healthRes.error || 'unknown error'}`,
        healthRes.ms,
        { uid: ds.uid, type: ds.type, errorStatus: healthRes.status },
        ds.uid
      ));
    }

    // Type-aware query test
    const body = sampleQuery(ds);
    if (body) {
      const qRes = await client.queryViaProxy(body);
      if (qRes.ok) {
        const frames = qRes.data?.results?.A?.frames || [];
        const rowCount = frames.reduce((sum, f) => {
          const len = f.data?.values?.[0]?.length || 0;
          return sum + len;
        }, 0);
        const slowMs = config.thresholds.slowQueryThresholdMs || 5000;
        results.push(result(
          `Query: ${dsLabel}`,
          qRes.ms > slowMs ? 'WARN' : 'PASS',
          `Query returned ${frames.length} frame(s), ~${rowCount} row(s) in ${qRes.ms}ms`,
          qRes.ms,
          { uid: ds.uid, type: ds.type, frames: frames.length, rows: rowCount },
          ds.uid
        ));
      } else {
        results.push(result(
          `Query: ${dsLabel}`,
          'WARN',
          `Query failed (${qRes.status}): ${qRes.error || 'no data'}`,
          qRes.ms,
          { uid: ds.uid, type: ds.type },
          ds.uid
        ));
      }
    }

    // Latency — already captured in health ms, record as metadata
    results.push(result(
      `Latency: ${dsLabel}`,
      healthRes.ms > (config.thresholds.slowQueryThresholdMs || 5000) ? 'WARN' : 'PASS',
      `Datasource response: ${healthRes.ms}ms`,
      healthRes.ms,
      { uid: ds.uid, type: ds.type, latencyMs: healthRes.ms },
      ds.uid
    ));
  }

  logger.info(`${CAT}: completed ${results.length} checks across ${datasources.length} datasources`, { category: CAT });
  return results;
}

module.exports = { run };
