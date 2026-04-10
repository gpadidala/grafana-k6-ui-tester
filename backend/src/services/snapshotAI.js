const axios = require('axios');
const logger = require('../utils/logger');

const ANTHROPIC_API_KEY = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.LLM_MODEL || 'claude-sonnet-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

function truncate(val, max = 500) {
  try {
    const s = typeof val === 'string' ? val : JSON.stringify(val);
    return s && s.length > max ? s.slice(0, max) + '…' : s || '';
  } catch {
    return '';
  }
}

async function explainChange(change) {
  if (!ANTHROPIC_API_KEY) {
    return null; // AI disabled
  }

  const prompt = `You are a Grafana upgrade expert. Explain this change in 1-2 sentences.
Context: Grafana ${change.grafanaVersionFrom} → ${change.grafanaVersionTo}
Dashboard: ${change.dashboardTitle}
Panel: ${change.panelTitle || 'N/A'} (${change.panelType || 'N/A'})
Change type: ${change.changeType}
Risk: ${change.riskLevel}
Path: ${change.path}
Before: ${truncate(change.before, 500)}
After: ${truncate(change.after, 500)}

Respond with ONLY valid JSON:
{"explanation":"...","recommendation":"..."}`;

  try {
    const res = await axios.post(
      ANTHROPIC_URL,
      {
        model: MODEL,
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const text = (res.data && res.data.content && res.data.content[0] && res.data.content[0].text) || '';
    // Strip code fences if present
    const clean = text
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    return JSON.parse(clean);
  } catch (err) {
    logger.warn('AI explanation failed', { error: err.message });
    return null;
  }
}

async function explainChanges(changes, { concurrency = 3 } = {}) {
  if (!Array.isArray(changes) || changes.length === 0) return [];
  const results = [];
  for (let i = 0; i < changes.length; i += concurrency) {
    const batch = changes.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((c) => explainChange(c)));
    results.push(...batchResults);
  }
  return results;
}

module.exports = {
  explainChange,
  explainChanges,
  isEnabled: () => Boolean(ANTHROPIC_API_KEY),
};
