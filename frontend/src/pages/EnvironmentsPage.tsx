import React, { useState } from 'react';
import Card from '../components/Card';
import { getEnvironments, saveEnvironments } from '../api/store';
import { getLLMConfig, saveLLMConfig } from '../api/llm';
import { Environment, LLMConfig } from '../types';

export default function EnvironmentsPage() {
  const [envs, setEnvs] = useState(getEnvironments());
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // LLM config
  const [llm, setLlm] = useState<LLMConfig>(getLLMConfig());
  const [llmSaved, setLlmSaved] = useState(false);

  function handleLlmChange(field: keyof LLMConfig, value: string) {
    const updated = { ...llm, [field]: value };
    // Auto-set default model
    if (field === 'provider') {
      if (value === 'openai') updated.model = updated.model || 'gpt-4o';
      else if (value === 'claude') updated.model = updated.model || 'claude-sonnet-4-20250514';
      else updated.model = '';
    }
    setLlm(updated);
    setLlmSaved(false);
  }

  function handleLlmSave() {
    saveLLMConfig(llm);
    setLlmSaved(true);
    setTimeout(() => setLlmSaved(false), 2000);
  }

  function handleChange(id: string, field: keyof Environment, value: string) {
    const updated = envs.map(e => e.id === id ? { ...e, [field]: value } : e);
    setEnvs(updated);
    setSaved(false);
  }

  function handleSave() {
    saveEnvironments(envs);
    setSaved(true);
    setEditing(null);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleTest(env: Environment) {
    if (!env.grafanaUrl) { alert('Enter a Grafana URL first'); return; }

    // Proxy through backend to avoid CORS
    const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:4000';
    fetch(`${API_BASE}/api/test-connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grafanaUrl: env.grafanaUrl, token: env.token }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          alert(`Connection OK!\n\nGrafana ${data.version}\nDatabase: ${data.database}\nUser: ${data.user}\nResponse: ${data.ms}ms`);
        } else {
          alert(`Connection failed: ${data.error}`);
        }
      })
      .catch(err => alert(`Backend not reachable: ${err.message}\n\nMake sure the backend is running on port 4000.`));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Environments</h2>
        {saved && <span className="text-green-400 text-sm animate-pulse">Saved!</span>}
      </div>

      <p className="text-sm text-muted">Configure your Grafana instances. Tokens are stored locally in your browser and never sent to any server except your Grafana.</p>

      <div className="space-y-4">
        {envs.map(env => (
          <Card key={env.id} className={editing === env.id ? 'border-accent' : ''}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="w-4 h-4 rounded-full" style={{ backgroundColor: env.color }} />
                <h3 className="text-lg font-semibold text-white">{env.name}</h3>
                <span className="text-xs text-muted bg-surface-200 px-2 py-0.5 rounded">{env.label}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleTest(env)}
                  className="px-3 py-1.5 text-xs bg-surface-200 hover:bg-surface-300 text-muted hover:text-white rounded-lg transition"
                >
                  Test Connection
                </button>
                <button
                  onClick={() => setEditing(editing === env.id ? null : env.id)}
                  className="px-3 py-1.5 text-xs bg-surface-200 hover:bg-surface-300 text-muted hover:text-white rounded-lg transition"
                >
                  {editing === env.id ? 'Collapse' : 'Edit'}
                </button>
              </div>
            </div>

            {editing === env.id ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-muted uppercase tracking-wider mb-1">Grafana URL</label>
                  <input
                    type="url"
                    value={env.grafanaUrl}
                    onChange={e => handleChange(env.id, 'grafanaUrl', e.target.value)}
                    placeholder="https://grafana.example.com"
                    className="w-full bg-surface-200 border border-surface-300 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted uppercase tracking-wider mb-1">Service Account Token</label>
                  <input
                    type="password"
                    value={env.token}
                    onChange={e => handleChange(env.id, 'token', e.target.value)}
                    placeholder="glsa_..."
                    className="w-full bg-surface-200 border border-surface-300 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-accent"
                  />
                  <p className="text-xs text-muted mt-1">Create at: Grafana &gt; Administration &gt; Service Accounts &gt; Add &gt; Admin role &gt; Generate Token</p>
                </div>
                <button
                  onClick={handleSave}
                  className="px-5 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition"
                >
                  Save All
                </button>
              </div>
            ) : (
              <p className="text-sm text-muted truncate">{env.grafanaUrl || 'Not configured — click Edit to set URL and token'}</p>
            )}
          </Card>
        ))}
      </div>

      {/* LLM Configuration */}
      <div className="pt-4 border-t border-surface-300">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">🤖</span>
            <h2 className="text-xl font-bold text-white">AI Analysis (LLM)</h2>
          </div>
          {llmSaved && <span className="text-green-400 text-sm animate-pulse">Saved!</span>}
        </div>

        <p className="text-sm text-muted mb-4">
          Connect OpenAI or Claude to automatically analyze test failures and suggest fixes. API keys are stored locally in your browser.
        </p>

        <Card>
          <div className="space-y-4">
            {/* Provider Selector */}
            <div>
              <label className="block text-xs text-muted uppercase tracking-wider mb-2">LLM Provider</label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { id: 'none', name: 'Disabled', desc: 'No AI analysis', icon: '⚪' },
                  { id: 'openai', name: 'OpenAI', desc: 'GPT-4o, GPT-4o-mini', icon: '🟢' },
                  { id: 'claude', name: 'Claude', desc: 'Sonnet, Opus, Haiku', icon: '🟠' },
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleLlmChange('provider', p.id)}
                    className={`p-4 rounded-xl border-2 text-left transition ${
                      llm.provider === p.id
                        ? 'border-purple-500 bg-purple-500/10'
                        : 'border-surface-300 bg-surface-200 hover:border-surface-300/80'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span>{p.icon}</span>
                      <span className="font-semibold text-white">{p.name}</span>
                    </div>
                    <p className="text-xs text-muted">{p.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {llm.provider !== 'none' && (
              <>
                {/* API Key */}
                <div>
                  <label className="block text-xs text-muted uppercase tracking-wider mb-1">
                    {llm.provider === 'openai' ? 'OpenAI API Key' : 'Anthropic API Key'}
                  </label>
                  <input
                    type="password"
                    value={llm.apiKey}
                    onChange={e => handleLlmChange('apiKey', e.target.value)}
                    placeholder={llm.provider === 'openai' ? 'sk-...' : 'sk-ant-...'}
                    className="w-full bg-surface-200 border border-surface-300 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                  />
                  <p className="text-xs text-muted mt-1">
                    {llm.provider === 'openai'
                      ? 'Get key at: platform.openai.com/api-keys'
                      : 'Get key at: console.anthropic.com/settings/keys'}
                  </p>
                </div>

                {/* Model */}
                <div>
                  <label className="block text-xs text-muted uppercase tracking-wider mb-1">Model</label>
                  <select
                    value={llm.model}
                    onChange={e => handleLlmChange('model', e.target.value)}
                    className="w-full bg-surface-200 border border-surface-300 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-purple-500"
                  >
                    {llm.provider === 'openai' ? (
                      <>
                        <option value="gpt-4o">GPT-4o (recommended)</option>
                        <option value="gpt-4o-mini">GPT-4o Mini (faster, cheaper)</option>
                        <option value="gpt-4-turbo">GPT-4 Turbo</option>
                        <option value="o3-mini">o3-mini (reasoning)</option>
                      </>
                    ) : (
                      <>
                        <option value="claude-sonnet-4-20250514">Claude Sonnet 4 (recommended)</option>
                        <option value="claude-opus-4-20250514">Claude Opus 4 (most capable)</option>
                        <option value="claude-haiku-4-20250514">Claude Haiku 4 (fastest)</option>
                      </>
                    )}
                  </select>
                </div>

                <button
                  onClick={handleLlmSave}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg transition"
                >
                  Save LLM Settings
                </button>
              </>
            )}

            {llm.provider === 'none' && (
              <button
                onClick={handleLlmSave}
                className="px-5 py-2 bg-surface-300 hover:bg-surface-200 text-muted text-sm font-medium rounded-lg transition"
              >
                Save (Disabled)
              </button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
