// LLM Provider Abstraction — OpenAI + Claude
// Reads config from env: LLM_PROVIDER, LLM_API_KEY, LLM_MODEL
// Single chat() interface — supports JSON-mode for structured output

const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const PROVIDER = process.env.LLM_PROVIDER || 'openai';
const API_KEY = process.env.LLM_API_KEY || '';
const MODEL = process.env.LLM_MODEL || (PROVIDER === 'claude' ? 'claude-sonnet-4-20250514' : 'gpt-4o-mini');

class LLMClient {
  constructor(opts = {}) {
    this.provider = opts.provider || PROVIDER;
    this.apiKey = opts.apiKey || API_KEY;
    this.model = opts.model || MODEL;
  }

  isConfigured() {
    return !!this.apiKey;
  }

  async chat({ system, user, json = false, maxTokens = 2000, temperature = 0.2 }) {
    if (!this.apiKey) {
      throw new Error('LLM not configured. Set LLM_API_KEY in backend/.env');
    }
    if (this.provider === 'openai') return this._openai({ system, user, json, maxTokens, temperature });
    if (this.provider === 'claude') return this._claude({ system, user, json, maxTokens, temperature });
    throw new Error(`Unknown LLM provider: ${this.provider}`);
  }

  async _openai({ system, user, json, maxTokens, temperature }) {
    const body = {
      model: this.model,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: user },
      ],
      temperature,
      max_tokens: maxTokens,
    };
    if (json) body.response_format = { type: 'json_object' };

    try {
      const res = await axios.post('https://api.openai.com/v1/chat/completions', body, {
        headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        timeout: 60000,
      });
      const content = res.data.choices?.[0]?.message?.content || '';
      return { content, raw: res.data };
    } catch (err) {
      logger.error('OpenAI request failed', { error: err.response?.data?.error?.message || err.message });
      throw new Error(`OpenAI: ${err.response?.data?.error?.message || err.message}`);
    }
  }

  async _claude({ system, user, json, maxTokens, temperature }) {
    const userContent = json ? `${user}\n\nReturn ONLY valid JSON. No markdown, no prose.` : user;
    try {
      const res = await axios.post('https://api.anthropic.com/v1/messages', {
        model: this.model,
        max_tokens: maxTokens,
        temperature,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: userContent }],
      }, {
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      });
      const content = res.data.content?.[0]?.text || '';
      return { content, raw: res.data };
    } catch (err) {
      logger.error('Claude request failed', { error: err.response?.data?.error?.message || err.message });
      throw new Error(`Claude: ${err.response?.data?.error?.message || err.message}`);
    }
  }

  // Helper: parse JSON from LLM response, tolerant of code fences
  static parseJSON(text) {
    if (!text) throw new Error('Empty LLM response');
    const trimmed = text.trim();
    // Strip ```json ... ``` fences
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
    try {
      return JSON.parse(candidate);
    } catch (err) {
      // Try to extract first { ... } block
      const objMatch = candidate.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try { return JSON.parse(objMatch[0]); } catch {}
      }
      throw new Error(`LLM returned invalid JSON: ${err.message}`);
    }
  }
}

module.exports = LLMClient;
