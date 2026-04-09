'use strict';
/**
 * core/config.js — Unified configuration loader for Grafana Sentinel
 * Priority: CLI flags > environment variables > YAML config > built-in defaults
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DEFAULTS = {
  grafana: {
    url: 'http://localhost:3000',
    token: '',
    org_id: 1,
    timeout_ms: 15000,
    retry_attempts: 3,
    retry_delay_ms: 1000,
  },
  testing: {
    test_level: 'standard',         // smoke | standard | full
    headless: true,
    parallel_vus: 1,
    dashboard_load_timeout_ms: 30000,
    panel_load_timeout_ms: 15000,
    screenshot_on_fail: true,
    screenshot_on_pass: false,
    rate_limit_ms: 200,
    max_dashboards: 0,              // 0 = no limit
  },
  thresholds: {
    dashboard_load_p95_ms: 5000,
    panel_render_p95_ms: 3000,
    api_response_p99_ms: 2000,
    min_pass_rate_pct: 80,
    max_no_data_pct: 10,
    max_error_pct: 5,
  },
  monitoring: {
    enabled: false,
    schedule: '0 7 * * *',         // 07:00 daily
    retention_days: 30,
    alert_on_degradation_pct: 10,
    baseline_window_days: 7,
  },
  notifications: {
    enabled: false,
    channels: [],
    on_failure: true,
    on_recovery: true,
    on_degradation: true,
    min_severity: 'warning',        // info | warning | critical
  },
  snapshots: {
    output_dir: './snapshots',
    include_screenshots: true,
    include_performance: true,
    compress: false,
  },
  reports: {
    output_dir: './reports',
    formats: ['html', 'json'],
    open_after_run: false,
    include_screenshots: true,
  },
  server: {
    port: 4000,
    host: '0.0.0.0',
  },
  database: {
    path: './data/sentinel.db',
  },
  log: {
    level: 'info',
    file: null,
  },
};

class SentinelConfig {
  constructor() {
    this._config = JSON.parse(JSON.stringify(DEFAULTS));
    this._sources = {};
  }

  /**
   * Load configuration from YAML file
   */
  loadYaml(filePath) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) return this;

    try {
      const raw = fs.readFileSync(resolved, 'utf8');
      const parsed = yaml.load(raw);
      this._mergeDeep(this._config, parsed || {});
      this._sources.yaml = resolved;
    } catch (err) {
      console.warn(`[Config] Failed to parse YAML at ${resolved}: ${err.message}`);
    }
    return this;
  }

  /**
   * Load configuration from environment variables
   */
  loadEnv() {
    const e = process.env;

    // Grafana
    if (e.GRAFANA_URL)       this._set('grafana.url', e.GRAFANA_URL);
    if (e.GRAFANA_TOKEN)     this._set('grafana.token', e.GRAFANA_TOKEN);
    if (e.GRAFANA_ORG_ID)    this._set('grafana.org_id', parseInt(e.GRAFANA_ORG_ID, 10));
    if (e.GRAFANA_TIMEOUT)   this._set('grafana.timeout_ms', parseInt(e.GRAFANA_TIMEOUT, 10));

    // Testing
    if (e.TEST_LEVEL)        this._set('testing.test_level', e.TEST_LEVEL);
    if (e.HEADLESS)          this._set('testing.headless', e.HEADLESS !== 'false');
    if (e.PARALLEL_VUS)      this._set('testing.parallel_vus', parseInt(e.PARALLEL_VUS, 10));
    if (e.MAX_DASHBOARDS)    this._set('testing.max_dashboards', parseInt(e.MAX_DASHBOARDS, 10));
    if (e.RATE_LIMIT_MS)     this._set('testing.rate_limit_ms', parseInt(e.RATE_LIMIT_MS, 10));
    if (e.SCREENSHOT_ON_FAIL) this._set('testing.screenshot_on_fail', e.SCREENSHOT_ON_FAIL !== 'false');

    // Thresholds
    if (e.THRESHOLD_LOAD_P95)    this._set('thresholds.dashboard_load_p95_ms', parseInt(e.THRESHOLD_LOAD_P95, 10));
    if (e.THRESHOLD_MIN_PASS)    this._set('thresholds.min_pass_rate_pct', parseFloat(e.THRESHOLD_MIN_PASS));

    // Monitoring
    if (e.MONITOR_SCHEDULE)  this._set('monitoring.schedule', e.MONITOR_SCHEDULE);
    if (e.MONITOR_ENABLED)   this._set('monitoring.enabled', e.MONITOR_ENABLED === 'true');

    // Notifications
    if (e.SLACK_WEBHOOK_URL) {
      this._set('notifications.enabled', true);
      const existing = this._get('notifications.channels') || [];
      if (!existing.find(c => c.type === 'slack')) {
        existing.push({ type: 'slack', webhook_url: e.SLACK_WEBHOOK_URL });
        this._set('notifications.channels', existing);
      }
    }
    if (e.PAGERDUTY_ROUTING_KEY) {
      this._set('notifications.enabled', true);
      const existing = this._get('notifications.channels') || [];
      if (!existing.find(c => c.type === 'pagerduty')) {
        existing.push({ type: 'pagerduty', routing_key: e.PAGERDUTY_ROUTING_KEY });
        this._set('notifications.channels', existing);
      }
    }

    // Server
    if (e.PORT)         this._set('server.port', parseInt(e.PORT, 10));
    if (e.HOST)         this._set('server.host', e.HOST);

    // Database
    if (e.DB_PATH)      this._set('database.path', e.DB_PATH);

    // Logging
    if (e.LOG_LEVEL)    this._set('log.level', e.LOG_LEVEL);
    if (e.LOG_FILE)     this._set('log.file', e.LOG_FILE);

    // Reports
    if (e.REPORT_DIR)   this._set('reports.output_dir', e.REPORT_DIR);

    // Snapshots
    if (e.SNAPSHOT_DIR) this._set('snapshots.output_dir', e.SNAPSHOT_DIR);

    this._sources.env = true;
    return this;
  }

  /**
   * Apply CLI flag overrides
   */
  applyFlags(flags = {}) {
    if (!flags || typeof flags !== 'object') return this;

    const mappings = {
      url:            'grafana.url',
      token:          'grafana.token',
      orgId:          'grafana.org_id',
      level:          'testing.test_level',
      headless:       'testing.headless',
      vus:            'testing.parallel_vus',
      maxDashboards:  'testing.max_dashboards',
      schedule:       'monitoring.schedule',
      port:           'server.port',
      reportDir:      'reports.output_dir',
      snapshotDir:    'snapshots.output_dir',
      logLevel:       'log.level',
    };

    for (const [flag, configPath] of Object.entries(mappings)) {
      if (flags[flag] !== undefined && flags[flag] !== null) {
        this._set(configPath, flags[flag]);
      }
    }

    this._sources.cli = flags;
    return this;
  }

  get(keyPath, fallback = undefined) {
    const val = this._get(keyPath);
    return val !== undefined ? val : fallback;
  }

  get grafana()       { return this._config.grafana; }
  get testing()       { return this._config.testing; }
  get thresholds()    { return this._config.thresholds; }
  get monitoring()    { return this._config.monitoring; }
  get notifications() { return this._config.notifications; }
  get snapshots()     { return this._config.snapshots; }
  get reports()       { return this._config.reports; }
  get server()        { return this._config.server; }
  get database()      { return this._config.database; }
  get log()           { return this._config.log; }

  validate() {
    const errors = [];
    if (!this._config.grafana.url) errors.push('grafana.url is required');
    if (!this._config.grafana.token) errors.push('grafana.token is required (service account token)');
    if (!['smoke', 'standard', 'full'].includes(this._config.testing.test_level)) {
      errors.push('testing.test_level must be one of: smoke, standard, full');
    }
    return { valid: errors.length === 0, errors };
  }

  toJSON() {
    return JSON.parse(JSON.stringify(this._config));
  }

  _get(keyPath) {
    return keyPath.split('.').reduce((obj, key) => (obj && obj[key] !== undefined ? obj[key] : undefined), this._config);
  }

  _set(keyPath, value) {
    const keys = keyPath.split('.');
    let obj = this._config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]] || typeof obj[keys[i]] !== 'object') obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
  }

  _mergeDeep(target, source) {
    if (!source || typeof source !== 'object') return;
    for (const key of Object.keys(source)) {
      if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (!target[key] || typeof target[key] !== 'object') target[key] = {};
        this._mergeDeep(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }
}

/**
 * Load and return a fully resolved SentinelConfig instance.
 * Searches for config/default.yaml relative to cwd.
 */
function loadConfig(flags = {}) {
  const cfg = new SentinelConfig();

  // Load YAML (search common locations)
  const yamlPaths = [
    path.join(process.cwd(), 'config', 'default.yaml'),
    path.join(process.cwd(), 'config', 'sentinel.yaml'),
    path.join(__dirname, '..', 'config', 'default.yaml'),
  ];
  for (const p of yamlPaths) {
    if (fs.existsSync(p)) { cfg.loadYaml(p); break; }
  }

  // Overlay env vars then CLI flags
  cfg.loadEnv().applyFlags(flags);

  return cfg;
}

module.exports = { SentinelConfig, loadConfig, DEFAULTS };
