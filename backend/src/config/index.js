require('dotenv').config();

module.exports = {
  grafana: {
    url: (process.env.GRAFANA_URL || 'http://localhost:3000').replace(/\/$/, ''),
    token: process.env.GRAFANA_API_TOKEN || '',
    orgId: process.env.GRAFANA_ORG_ID || '1',
  },
  server: {
    port: parseInt(process.env.PORT || '4000', 10),
    env: process.env.NODE_ENV || 'development',
  },
  paths: {
    screenshots: process.env.SCREENSHOTS_DIR || './screenshots',
    reports: process.env.REPORTS_DIR || './reports',
    db: process.env.DB_PATH || './data/heimdall.db',
  },
  thresholds: {
    queryTimeoutMs: parseInt(process.env.QUERY_TIMEOUT_MS || '15000', 10),
    dashboardLoadTimeoutMs: parseInt(process.env.DASHBOARD_LOAD_TIMEOUT_MS || '30000', 10),
    staleDataThresholdMs: parseInt(process.env.STALE_DATA_THRESHOLD_MS || '900000', 10),
    slowQueryThresholdMs: parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || '5000', 10),
  },
  k6: {
    binary: process.env.K6_BINARY || 'k6',
    vus: parseInt(process.env.K6_VUS || '10', 10),
    duration: process.env.K6_DURATION || '30s',
  },
  retention: {
    // How many most-recent runs to keep per environment. Older runs (and
    // their test_results / category_results / screenshots) are auto-pruned
    // after each new run completes. Set to 0 to disable pruning.
    maxRunsPerEnv: parseInt(process.env.MAX_RUNS_PER_ENV || '5', 10),
  },
  webhooks: {
    slack: process.env.SLACK_WEBHOOK_URL || '',
    pagerduty: process.env.PAGERDUTY_ROUTING_KEY || '',
    custom: process.env.CUSTOM_WEBHOOK_URL || '',
  },
  plugins: {
    grafanaComApi: process.env.GRAFANA_COM_API || 'https://grafana.com/api',
    rateLimitMs: parseInt(process.env.PLUGIN_CHECK_RATE_LIMIT_MS || '200', 10),
  },
};
