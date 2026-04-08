// Grafana K6 UI Tester - Configuration
// Loads all settings from environment variables with sensible defaults

const config = {
  grafana: {
    url: (__ENV.GRAFANA_URL || 'http://localhost:3000').replace(/\/$/, ''),
    token: __ENV.GRAFANA_TOKEN || '',
    orgId: parseInt(__ENV.GRAFANA_ORG_ID || '1', 10),
  },
  test: {
    level: __ENV.TEST_LEVEL || 'standard', // smoke | standard | full
    screenshotOnFail: (__ENV.SCREENSHOT_ON_FAIL || 'true') === 'true',
    headless: (__ENV.HEADLESS || 'true') === 'true',
    parallelVUs: parseInt(__ENV.PARALLEL_VUS || '3', 10),
    reportDir: __ENV.REPORT_DIR || './reports',
    baselineReport: __ENV.BASELINE_REPORT || '',
    dashboardLoadTimeout: parseInt(__ENV.DASHBOARD_LOAD_TIMEOUT || '10000', 10),
    rateLimitMs: parseInt(__ENV.RATE_LIMIT_MS || '500', 10),
    maxRetries: parseInt(__ENV.MAX_RETRIES || '3', 10),
  },
};

// Item limits based on test level
const LEVEL_LIMITS = {
  smoke: 5,
  standard: 20,
  full: Infinity,
};

export function getItemLimit() {
  return LEVEL_LIMITS[config.test.level] || LEVEL_LIMITS.standard;
}

export function buildUrl(path) {
  return `${config.grafana.url}${path.startsWith('/') ? path : '/' + path}`;
}

export function getAuthHeaders() {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (config.grafana.token) {
    headers['Authorization'] = `Bearer ${config.grafana.token}`;
  }
  return headers;
}

export default config;
