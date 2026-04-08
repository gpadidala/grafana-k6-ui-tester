import { LLMConfig, TestRun } from '../types';

const STORAGE_KEY = 'k6ui_llm_config';

const DEFAULT_CONFIG: LLMConfig = {
  provider: 'none',
  apiKey: '',
  model: '',
};

export function getLLMConfig(): LLMConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_CONFIG;
  } catch { return DEFAULT_CONFIG; }
}

export function saveLLMConfig(config: LLMConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function buildPrompt(run: TestRun): string {
  const failures = (run.results || []).filter(r => r.status === 'FAIL' || r.status === 'WARN');
  if (failures.length === 0) return '';

  const failureList = failures.map((r, i) =>
    `${i + 1}. [${r.status}] ${r.category} / ${r.name} (uid: ${r.uid || 'n/a'})\n   Error: ${r.error || 'No details'}\n   Load time: ${r.load_time_ms}ms`
  ).join('\n');

  return `You are a Grafana observability expert. Analyze these test failures from a Grafana UI automation test suite.

Environment: ${run.envName}
Grafana URL: ${run.grafanaUrl}
Test Level: ${run.testLevel}
Summary: ${run.summary?.total} total, ${run.summary?.passed} passed, ${run.summary?.failed} failed, ${run.summary?.warnings} warnings (${run.summary?.pass_rate} pass rate)

Failed / Warning tests:
${failureList}

For each failure:
1. Explain the likely ROOT CAUSE in plain language
2. Suggest a specific FIX (command, config change, or UI action)
3. Assess SEVERITY (Critical / High / Medium / Low)
4. Flag if multiple failures share a common cause (e.g. same datasource down)

Format your response as:

## Summary
(1-2 sentence overview of the health state)

## Failures Analysis
### [Test Name]
- **Root Cause:** ...
- **Fix:** ...
- **Severity:** ...

## Common Patterns
(Group related failures if any share a root cause)

## Recommendations
(Top 3 prioritized actions to fix the most issues)`;
}

export async function analyzeWithLLM(run: TestRun): Promise<string> {
  const config = getLLMConfig();

  if (config.provider === 'none' || !config.apiKey) {
    throw new Error('LLM not configured. Go to Environments page to set up OpenAI or Claude.');
  }

  const prompt = buildPrompt(run);
  if (!prompt) return 'All tests passed — no failures to analyze.';

  if (config.provider === 'openai') {
    return callOpenAI(config, prompt);
  } else if (config.provider === 'claude') {
    return callClaude(config, prompt);
  }

  throw new Error(`Unknown LLM provider: ${config.provider}`);
}

async function callOpenAI(config: LLMConfig, prompt: string): Promise<string> {
  const model = config.model || 'gpt-4o';

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a Grafana and observability expert. Analyze test failures and provide actionable fixes.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenAI API error (${res.status}): ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || 'No response from OpenAI.';
}

async function callClaude(config: LLMConfig, prompt: string): Promise<string> {
  const model = config.model || 'claude-sonnet-4-20250514';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      messages: [
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Claude API error (${res.status}): ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || 'No response from Claude.';
}
