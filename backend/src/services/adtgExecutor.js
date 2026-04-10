// ADTG Action Executor — sandboxed test plan runner
// Safety boundaries:
//   - Whitelisted action vocabulary only
//   - Read-only Grafana API by default (only GET allowed)
//   - Rate limiter (10 req/sec)
//   - Variable interpolation ${var.field} from context
//   - All Grafana calls go through GrafanaClient

const GrafanaClient = require('./grafanaClient');
const logger = require('../utils/logger');

const WHITELIST = new Set([
  'grafana_api_get',     // GET /api/path → store in context
  'iterate',             // loop over array, run nested actions
  'measure_latency',     // GET endpoint, assert {maxMs}
  'assert',              // assert {field, op, value}
  'check_references',    // verify all refs in array exist in lookup map
  'regex_match',         // assert string matches regex
  'count_gte',           // assert array.length >= value
  'count_lte',           // assert array.length <= value
  'count_eq',            // assert array.length === value
]);

const ALLOWED_API_METHODS = new Set(['GET']);
const RATE_LIMIT_REQS_PER_SEC = 10;

class AdtgExecutor {
  constructor(grafanaUrl, token, opts = {}) {
    this.client = new GrafanaClient(grafanaUrl, token);
    this.allowWrites = opts.allowWrites === true;
    this.lastRequestTimes = [];
    this.context = {}; // variables stored by tests
  }

  async _rateLimit() {
    const now = Date.now();
    this.lastRequestTimes = this.lastRequestTimes.filter(t => now - t < 1000);
    if (this.lastRequestTimes.length >= RATE_LIMIT_REQS_PER_SEC) {
      const waitMs = 1000 - (now - this.lastRequestTimes[0]) + 10;
      await new Promise(r => setTimeout(r, waitMs));
    }
    this.lastRequestTimes.push(Date.now());
  }

  // Interpolate ${var.field} from context
  _interpolate(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/\$\{([^}]+)\}/g, (_, path) => {
      const parts = path.split('.');
      let val = this.context;
      for (const p of parts) {
        if (val == null) return '';
        val = val[p];
      }
      return val == null ? '' : String(val);
    });
  }

  _isAllowedEndpoint(path, method = 'GET') {
    if (!ALLOWED_API_METHODS.has(method.toUpperCase()) && !this.allowWrites) {
      return false;
    }
    // Block dangerous paths even if writes allowed (admin endpoints)
    if (path.includes('/api/admin/') && !this.allowWrites) return false;
    return true;
  }

  validatePlan(plan) {
    const warnings = [];
    const errors = [];

    if (!plan || typeof plan !== 'object') {
      return { valid: false, errors: ['Plan must be an object'], warnings: [] };
    }
    if (!Array.isArray(plan.testCases)) {
      return { valid: false, errors: ['plan.testCases must be an array'], warnings: [] };
    }

    let estimatedCalls = 0;
    const walk = (steps) => {
      if (!Array.isArray(steps)) return;
      for (const s of steps) {
        if (!s || typeof s !== 'object') {
          errors.push('Each step must be an object');
          continue;
        }
        if (!WHITELIST.has(s.action)) {
          errors.push(`Disallowed action: "${s.action}". Whitelisted: ${Array.from(WHITELIST).join(', ')}`);
          continue;
        }
        if (s.action === 'grafana_api_get' || s.action === 'measure_latency') {
          if (!s.endpoint || typeof s.endpoint !== 'string') {
            errors.push(`${s.action} missing endpoint`);
            continue;
          }
          if (!s.endpoint.startsWith('/api/')) {
            errors.push(`Endpoint must start with /api/: ${s.endpoint}`);
            continue;
          }
          // Block writes
          const method = s.method || 'GET';
          if (!this._isAllowedEndpoint(s.endpoint, method)) {
            errors.push(`Write operation blocked: ${method} ${s.endpoint} (enable dangerous mode to allow)`);
            continue;
          }
          estimatedCalls += 1;
        }
        if (s.action === 'iterate' && Array.isArray(s.do)) {
          // Estimate ~10x for iterations as a rough guess
          const inner = s.do;
          const innerCount = inner.filter(x => x.action === 'grafana_api_get' || x.action === 'measure_latency').length;
          estimatedCalls += innerCount * 10;
          walk(inner);
        }
      }
    };

    for (const tc of plan.testCases) {
      if (!tc.id || !tc.description) {
        errors.push(`Test case missing id or description: ${JSON.stringify(tc).slice(0, 80)}`);
      }
      if (!Array.isArray(tc.steps)) {
        errors.push(`Test case "${tc.id}" missing steps array`);
        continue;
      }
      walk(tc.steps);
    }

    if (estimatedCalls > 500) {
      warnings.push(`Plan will make ~${estimatedCalls} API calls — this may take a while`);
    }

    // Estimate duration: 100ms per call + rate limiting
    const estimatedSec = Math.ceil(estimatedCalls * 0.15);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      estimatedCalls,
      estimatedSeconds: estimatedSec,
    };
  }

  // Execute a single test case
  async executeTestCase(tc, onProgress) {
    const result = {
      id: tc.id,
      description: tc.description,
      severity: tc.severity || 'medium',
      tags: tc.tags || [],
      status: 'PASS',
      assertions: [],
      errors: [],
      durationMs: 0,
    };
    const start = Date.now();

    // Each test case gets its own scoped context (carries over to next case via parent)
    try {
      await this._executeSteps(tc.steps, result, onProgress, tc.id);
    } catch (err) {
      result.status = 'FAIL';
      result.errors.push(err.message);
    }

    result.durationMs = Date.now() - start;
    if (result.assertions.some(a => !a.passed)) result.status = 'FAIL';
    return result;
  }

  async _executeSteps(steps, result, onProgress, tcId) {
    if (!Array.isArray(steps)) return;
    for (const step of steps) {
      try {
        await this._executeStep(step, result, onProgress, tcId);
      } catch (err) {
        result.errors.push(`Step ${step.action}: ${err.message}`);
        // Continue with next step instead of crashing whole test case
      }
    }
  }

  async _executeStep(step, result, onProgress, tcId) {
    const action = step.action;
    if (!WHITELIST.has(action)) {
      throw new Error(`SecurityError: action "${action}" not whitelisted`);
    }

    if (onProgress) onProgress({ type: 'adtg-step', tcId, action, message: step.description || action });

    switch (action) {
      case 'grafana_api_get': {
        const endpoint = this._interpolate(step.endpoint);
        if (!this._isAllowedEndpoint(endpoint, 'GET')) {
          throw new Error(`SecurityError: ${endpoint} not allowed`);
        }
        await this._rateLimit();
        const res = await this.client.get(endpoint);
        if (!res.ok) {
          throw new Error(`API ${endpoint} → HTTP ${res.status}`);
        }
        if (step.store) this.context[step.store] = res.data;
        break;
      }

      case 'measure_latency': {
        const endpoint = this._interpolate(step.endpoint);
        if (!this._isAllowedEndpoint(endpoint, 'GET')) {
          throw new Error(`SecurityError: ${endpoint} not allowed`);
        }
        await this._rateLimit();
        const t0 = Date.now();
        const res = await this.client.get(endpoint);
        const ms = Date.now() - t0;
        const maxMs = step.assert?.maxMs;
        const passed = res.ok && (maxMs == null || ms <= maxMs);
        result.assertions.push({
          name: `${endpoint} loads in ${maxMs ? `<${maxMs}ms` : 'OK'}`,
          passed,
          actual: `${ms}ms (HTTP ${res.status})`,
          expected: maxMs ? `<${maxMs}ms` : 'HTTP 200',
        });
        break;
      }

      case 'iterate': {
        const collection = this.context[step.over];
        if (!Array.isArray(collection)) {
          throw new Error(`iterate: ${step.over} is not an array`);
        }
        const limit = step.limit || collection.length;
        for (let i = 0; i < Math.min(collection.length, limit); i++) {
          this.context[step.as] = collection[i];
          await this._executeSteps(step.do, result, onProgress, tcId);
        }
        delete this.context[step.as];
        break;
      }

      case 'assert': {
        const value = this._resolveContextPath(step.field);
        const passed = this._compareValue(value, step.op, step.value);
        result.assertions.push({
          name: step.description || `${step.field} ${step.op} ${step.value}`,
          passed,
          actual: JSON.stringify(value),
          expected: `${step.op} ${JSON.stringify(step.value)}`,
        });
        break;
      }

      case 'check_references': {
        // Verify all items in array (refs) exist in lookup map keyed by id
        const refs = this._resolveContextPath(step.refs) || [];
        const lookup = this._resolveContextPath(step.in) || [];
        const lookupKey = step.lookupKey || 'uid';
        const refKey = step.refKey || 'uid';
        const lookupSet = new Set((Array.isArray(lookup) ? lookup : []).map(x => x[lookupKey]));
        const missing = (Array.isArray(refs) ? refs : []).filter(r => !lookupSet.has(r[refKey]));
        const passed = missing.length === 0;
        result.assertions.push({
          name: step.description || 'check_references',
          passed,
          actual: passed ? 'all references resolve' : `${missing.length} missing references`,
          expected: 'all references resolve',
        });
        break;
      }

      case 'regex_match': {
        const value = this._resolveContextPath(step.field);
        const re = new RegExp(step.pattern);
        const passed = re.test(String(value || ''));
        result.assertions.push({
          name: step.description || `${step.field} matches /${step.pattern}/`,
          passed,
          actual: String(value || '').slice(0, 80),
          expected: `match /${step.pattern}/`,
        });
        break;
      }

      case 'count_gte':
      case 'count_lte':
      case 'count_eq': {
        const value = this._resolveContextPath(step.field);
        const length = Array.isArray(value) ? value.length : 0;
        const passed =
          action === 'count_gte' ? length >= step.value :
          action === 'count_lte' ? length <= step.value :
          length === step.value;
        result.assertions.push({
          name: step.description || `count(${step.field}) ${action.replace('count_', '')} ${step.value}`,
          passed,
          actual: `${length}`,
          expected: `${action.replace('count_', '')} ${step.value}`,
        });
        break;
      }

      default:
        throw new Error(`Unhandled action: ${action}`);
    }
  }

  _resolveContextPath(path) {
    if (typeof path !== 'string') return path;
    const parts = path.split('.');
    let val = this.context;
    for (const p of parts) {
      if (val == null) return undefined;
      val = val[p];
    }
    return val;
  }

  _compareValue(actual, op, expected) {
    switch (op) {
      case '==': case 'eq': return actual == expected;
      case '!=': case 'ne': return actual != expected;
      case '>': case 'gt': return Number(actual) > Number(expected);
      case '>=': case 'gte': return Number(actual) >= Number(expected);
      case '<': case 'lt': return Number(actual) < Number(expected);
      case '<=': case 'lte': return Number(actual) <= Number(expected);
      case 'contains': return String(actual).includes(String(expected));
      case 'exists': return actual != null;
      default: return false;
    }
  }
}

module.exports = AdtgExecutor;
module.exports.WHITELIST = WHITELIST;
