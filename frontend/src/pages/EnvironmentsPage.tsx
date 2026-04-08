import React, { useState } from 'react';
import Card from '../components/Card';
import { getEnvironments, saveEnvironments } from '../api/store';
import { Environment } from '../types';

export default function EnvironmentsPage() {
  const [envs, setEnvs] = useState(getEnvironments());
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
    const url = env.grafanaUrl.replace(/\/$/, '') + '/api/health';
    const headers: Record<string, string> = {};
    if (env.token) headers['Authorization'] = `Bearer ${env.token}`;

    fetch(url, { headers })
      .then(r => r.json())
      .then(data => alert(`Connection OK!\nGrafana ${data.version}\nDatabase: ${data.database}`))
      .catch(err => alert(`Connection failed: ${err.message}\n\nCheck the URL and ensure CORS is enabled on Grafana.`));
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
    </div>
  );
}
