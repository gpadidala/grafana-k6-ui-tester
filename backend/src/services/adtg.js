// AI Dynamic Test Generator (ADTG) — orchestrator
// Pipeline: parseIntent → generatePlan → validatePlan → executePlan → explainResults

const { v4: uuid } = require('uuid');
const LLMClient = require('./llm');
const AdtgExecutor = require('./adtgExecutor');
const logger = require('../utils/logger');

const PLANNER_SYSTEM_PROMPT = `You are an expert Grafana SRE and test designer. Your job is to convert plain-English test intents into structured, runnable JSON test plans for the Heimdall testing platform.

You have access to a strict, whitelisted action vocabulary:

ACTIONS:
- "grafana_api_get": GET a Grafana API endpoint and store result.
    Fields: endpoint (must start with /api/), store (variable name)
- "iterate": Loop over an array stored in context.
    Fields: over (variable name), as (loop var name), limit (optional), do (array of steps)
- "measure_latency": GET endpoint and assert response time.
    Fields: endpoint, assert: { maxMs }
- "assert": Assert a value from context.
    Fields: field (dot-path in context), op (== != > >= < <= contains exists), value
- "check_references": Verify all items in an array exist in another lookup.
    Fields: refs (path), in (path), refKey (default: uid), lookupKey (default: uid)
- "regex_match": Assert a string matches a regex.
    Fields: field (path), pattern
- "count_gte" / "count_lte" / "count_eq": Assert array length.
    Fields: field, value

VARIABLE INTERPOLATION:
Inside endpoint strings, you can use \${varname.field} to reference values from previous steps.
Example: { "action": "grafana_api_get", "endpoint": "/api/dashboards/uid/\${dash.uid}" }

GRAFANA API ENDPOINTS YOU CAN USE (read-only):
- /api/health — instance health
- /api/datasources — list all datasources
- /api/datasources/uid/{uid}/health — datasource health
- /api/search?type=dash-db — list dashboards (supports tag, query params)
- /api/search?type=dash-folder — list folders
- /api/dashboards/uid/{uid} — full dashboard JSON
- /api/folders — list folders
- /api/folders/{uid}/permissions — folder permissions
- /api/v1/provisioning/alert-rules — alert rules
- /api/v1/provisioning/contact-points — contact points
- /api/v1/provisioning/policies — notification policies
- /api/plugins — installed plugins
- /api/plugins/{id}/health — plugin health
- /api/org/users — users in current org
- /api/teams/search — teams
- /api/serviceaccounts/search — service accounts
- /api/annotations — annotations
- /api/admin/stats — instance stats

OUTPUT FORMAT — return ONLY a JSON object with this exact shape:
{
  "name": "Short suite name",
  "description": "What this validates",
  "testCases": [
    {
      "id": "tc-1",
      "description": "Human-readable test description",
      "severity": "high|medium|low",
      "tags": ["..."],
      "steps": [ /* action objects from the whitelist above */ ]
    }
  ]
}

RULES:
1. ONLY use actions from the whitelist. Never invent new actions.
2. ONLY use GET endpoints (read-only).
3. Be specific with assertions — use measurable thresholds the user mentioned.
4. Break complex requests into multiple test cases.
5. Use realistic limits (limit: 20 for iterations) to avoid testing thousands of items.
6. Include severity and tags for every test case.
7. Return ONLY the JSON object — no markdown, no prose, no explanations.`;

class AIDynamicTestGenerator {
  constructor(grafanaUrl, token, opts = {}) {
    this.grafanaUrl = grafanaUrl;
    this.token = token;
    this.llm = new LLMClient(opts.llmOpts || {});
  }

  isLLMConfigured() { return this.llm.isConfigured(); }

  // Step 1: Convert user prompt → structured intent
  async parseIntent(prompt, grafanaContext = {}) {
    if (!this.llm.isConfigured()) {
      throw new Error('LLM not configured. Set LLM_API_KEY in backend/.env');
    }
    return {
      prompt: prompt.trim(),
      grafanaContext,
      timestamp: new Date().toISOString(),
    };
  }

  // Step 2: Generate test plan via LLM
  async generatePlan(intent, refinement = null) {
    const userPrompt = refinement
      ? `EXISTING PLAN:\n${JSON.stringify(refinement.currentPlan, null, 2)}\n\nUSER REFINEMENT: ${refinement.userMessage}\n\nReturn the modified plan as JSON.`
      : `Generate a test plan for this request:\n\n${intent.prompt}\n\nGrafana version: ${intent.grafanaContext?.version || 'unknown'}\nOrg ID: ${intent.grafanaContext?.orgId || 1}`;

    const response = await this.llm.chat({
      system: PLANNER_SYSTEM_PROMPT,
      user: userPrompt,
      json: true,
      maxTokens: 3000,
      temperature: 0.2,
    });

    let plan;
    try {
      plan = LLMClient.parseJSON(response.content);
    } catch (err) {
      logger.error('LLM returned invalid JSON', { content: response.content.slice(0, 500) });
      throw new Error(`AI returned invalid plan: ${err.message}`);
    }

    plan.suiteId = uuid();
    plan.originalPrompt = intent.prompt;
    plan.grafanaContext = intent.grafanaContext;
    plan.createdAt = new Date().toISOString();

    return plan;
  }

  // Step 3: Validate plan against whitelist
  validatePlan(plan, opts = {}) {
    const executor = new AdtgExecutor(this.grafanaUrl, this.token, opts);
    return executor.validatePlan(plan);
  }

  // Step 4: Execute plan
  async executePlan(plan, onProgress, opts = {}) {
    const executor = new AdtgExecutor(this.grafanaUrl, this.token, opts);

    // Validate first
    const validation = executor.validatePlan(plan);
    if (!validation.valid) {
      throw new Error(`Plan validation failed: ${validation.errors.join('; ')}`);
    }

    const runId = uuid();
    const startedAt = new Date().toISOString();
    const results = [];

    if (onProgress) onProgress({ type: 'adtg-run-start', runId, totalCases: plan.testCases.length });

    for (const tc of plan.testCases) {
      if (onProgress) onProgress({ type: 'adtg-case-start', runId, tcId: tc.id, description: tc.description });

      const result = await executor.executeTestCase(tc, onProgress);
      results.push(result);

      if (onProgress) onProgress({ type: 'adtg-case-done', runId, tcId: tc.id, result });
    }

    const completedAt = new Date().toISOString();
    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    const totalAssertions = results.reduce((sum, r) => sum + r.assertions.length, 0);
    const passedAssertions = results.reduce((sum, r) => sum + r.assertions.filter(a => a.passed).length, 0);

    const summary = {
      runId,
      suiteId: plan.suiteId,
      startedAt,
      completedAt,
      durationMs: new Date(completedAt) - new Date(startedAt),
      totalCases: results.length,
      passed,
      failed,
      totalAssertions,
      passedAssertions,
      passRate: results.length > 0 ? `${((passed / results.length) * 100).toFixed(0)}%` : '0%',
      status: failed > 0 ? 'failed' : 'passed',
    };

    if (onProgress) onProgress({ type: 'adtg-run-complete', runId, summary, results });

    return { summary, results, plan };
  }

  // Step 5: AI-generated explanation of results
  async explainResults({ plan, summary, results }) {
    if (!this.llm.isConfigured()) {
      return { explanation: 'LLM not configured — explanation skipped.', recommendations: [] };
    }

    const failedDetails = results
      .filter(r => r.status === 'FAIL')
      .slice(0, 10)
      .map(r => ({
        description: r.description,
        errors: r.errors,
        failedAssertions: r.assertions.filter(a => !a.passed).map(a => `${a.name}: actual=${a.actual}`),
      }));

    const userPrompt = `A test suite was just executed against a Grafana instance. Provide a concise, plain-English summary and remediation steps.

ORIGINAL REQUEST: ${plan.originalPrompt}

RESULT: ${summary.passed}/${summary.totalCases} test cases passed (${summary.passRate})

FAILURES:
${JSON.stringify(failedDetails, null, 2)}

Return a JSON object: { "summary": "1-2 sentence overview", "details": "1 paragraph explanation", "recommendations": ["actionable step 1", "step 2", "step 3"] }`;

    try {
      const response = await this.llm.chat({
        system: 'You are a helpful Grafana SRE assistant. Be concise and actionable.',
        user: userPrompt,
        json: true,
        maxTokens: 800,
        temperature: 0.3,
      });
      return LLMClient.parseJSON(response.content);
    } catch (err) {
      logger.warn('explainResults LLM call failed', { error: err.message });
      return {
        summary: `${summary.passed}/${summary.totalCases} tests passed.`,
        details: 'AI explanation unavailable.',
        recommendations: [],
      };
    }
  }
}

module.exports = AIDynamicTestGenerator;
