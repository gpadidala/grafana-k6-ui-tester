import React, { useState } from 'react';
import Card from '../components/Card';
import StatusBadge from '../components/StatusBadge';
import AIAnalysis from '../components/AIAnalysis';
import { getEnvironments } from '../api/store';
import { triggerTestRun } from '../api/runner';
import { TestRun } from '../types';

export default function RunTestPage() {
  const envs = getEnvironments();
  const [selectedEnv, setSelectedEnv] = useState(envs[0]?.id || '');
  const [testLevel, setTestLevel] = useState('full');
  const [customUrl, setCustomUrl] = useState('');
  const [customToken, setCustomToken] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<TestRun | null>(null);

  const env = envs.find(e => e.id === selectedEnv);

  async function handleRun() {
    const url = useCustom ? customUrl : env?.grafanaUrl;
    const token = useCustom ? customToken : env?.token;

    if (!url) {
      alert('Please enter a Grafana URL or configure the environment first.');
      return;
    }

    setRunning(true);
    setLastRun(null);

    try {
      const run = await triggerTestRun(
        useCustom ? 'custom' : selectedEnv,
        useCustom ? 'Custom' : env?.name || '',
        url,
        token || '',
        testLevel
      );
      setLastRun(run);
    } catch (err: any) {
      alert(`Test run failed: ${err.message}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Run Tests</h2>

      <Card>
        <div className="space-y-5">
          {/* Environment Toggle */}
          <div>
            <label className="block text-xs text-muted uppercase tracking-wider mb-2">Source</label>
            <div className="flex gap-2">
              <button
                onClick={() => setUseCustom(false)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  !useCustom ? 'bg-accent text-white' : 'bg-surface-200 text-muted hover:text-white'
                }`}
              >
                Environment
              </button>
              <button
                onClick={() => setUseCustom(true)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  useCustom ? 'bg-accent text-white' : 'bg-surface-200 text-muted hover:text-white'
                }`}
              >
                Custom URL
              </button>
            </div>
          </div>

          {!useCustom ? (
            /* Environment Selector */
            <div>
              <label className="block text-xs text-muted uppercase tracking-wider mb-2">Environment</label>
              <div className="grid grid-cols-3 gap-3">
                {envs.map(e => (
                  <button
                    key={e.id}
                    onClick={() => setSelectedEnv(e.id)}
                    className={`p-4 rounded-xl border-2 text-left transition ${
                      selectedEnv === e.id
                        ? 'border-accent bg-accent/10'
                        : 'border-surface-300 bg-surface-200 hover:border-surface-300/80'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: e.color }} />
                      <span className="font-semibold text-white">{e.name}</span>
                    </div>
                    <p className="text-xs text-muted truncate">{e.grafanaUrl || 'Not configured'}</p>
                    {!e.grafanaUrl && <p className="text-xs text-yellow-500 mt-1">Configure in Environments</p>}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Custom URL */
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-muted uppercase tracking-wider mb-1">Grafana URL</label>
                <input
                  type="url"
                  value={customUrl}
                  onChange={e => setCustomUrl(e.target.value)}
                  placeholder="https://grafana.example.com"
                  className="w-full bg-surface-200 border border-surface-300 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-xs text-muted uppercase tracking-wider mb-1">Service Account Token</label>
                <input
                  type="password"
                  value={customToken}
                  onChange={e => setCustomToken(e.target.value)}
                  placeholder="glsa_..."
                  className="w-full bg-surface-200 border border-surface-300 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-accent"
                />
              </div>
            </div>
          )}

          {/* Test Level */}
          <div>
            <label className="block text-xs text-muted uppercase tracking-wider mb-2">Test Level</label>
            <div className="flex gap-2">
              {[
                { value: 'smoke', label: 'Smoke', desc: '5 dashboards, ~1 min' },
                { value: 'standard', label: 'Standard', desc: '20 dashboards, ~3 min' },
                { value: 'full', label: 'Full', desc: 'All dashboards, ~10 min' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setTestLevel(opt.value)}
                  className={`flex-1 p-3 rounded-lg border text-left transition ${
                    testLevel === opt.value
                      ? 'border-accent bg-accent/10'
                      : 'border-surface-300 bg-surface-200 hover:border-surface-300/80'
                  }`}
                >
                  <span className="block text-sm font-medium text-white">{opt.label}</span>
                  <span className="block text-xs text-muted">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Run Button */}
          <button
            onClick={handleRun}
            disabled={running}
            className={`w-full py-3 rounded-xl font-semibold text-white text-sm transition ${
              running
                ? 'bg-surface-300 cursor-not-allowed'
                : 'bg-accent hover:bg-accent-hover active:scale-[0.99]'
            }`}
          >
            {running ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Running tests...
              </span>
            ) : (
              'Run Test Suite'
            )}
          </button>
        </div>
      </Card>

      {/* Results */}
      {lastRun && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">Results — {lastRun.envName}</h3>
            <StatusBadge status={lastRun.status} size="md" />
          </div>

          {lastRun.summary && (
            <div className="grid grid-cols-5 gap-3 mb-5">
              <div className="text-center"><p className="text-2xl font-bold text-blue-400">{lastRun.summary.total}</p><p className="text-xs text-muted">Total</p></div>
              <div className="text-center"><p className="text-2xl font-bold text-green-400">{lastRun.summary.passed}</p><p className="text-xs text-muted">Passed</p></div>
              <div className="text-center"><p className="text-2xl font-bold text-red-400">{lastRun.summary.failed}</p><p className="text-xs text-muted">Failed</p></div>
              <div className="text-center"><p className="text-2xl font-bold text-yellow-400">{lastRun.summary.warnings}</p><p className="text-xs text-muted">Warnings</p></div>
              <div className="text-center"><p className={`text-2xl font-bold ${parseFloat(lastRun.summary.pass_rate) >= 90 ? 'text-green-400' : 'text-red-400'}`}>{lastRun.summary.pass_rate}</p><p className="text-xs text-muted">Pass Rate</p></div>
            </div>
          )}

          {lastRun.results && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted uppercase tracking-wider border-b border-surface-300">
                    <th className="pb-2 pr-3">#</th>
                    <th className="pb-2 pr-3">Category</th>
                    <th className="pb-2 pr-3">Name</th>
                    <th className="pb-2 pr-3">Status</th>
                    <th className="pb-2 pr-3">Load Time</th>
                    <th className="pb-2">Error / Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {lastRun.results.map((r, i) => (
                    <tr key={i} className="border-b border-surface-300/30 hover:bg-surface-200 transition">
                      <td className="py-2 pr-3 text-muted">{i + 1}</td>
                      <td className="py-2 pr-3 text-muted">{r.category}</td>
                      <td className="py-2 pr-3 text-white">{r.name}</td>
                      <td className="py-2 pr-3"><StatusBadge status={r.status} /></td>
                      <td className="py-2 pr-3 text-muted">{r.load_time_ms}ms</td>
                      <td className="py-2 text-xs text-muted max-w-xs truncate">{r.error || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* AI Analysis */}
      {lastRun && lastRun.status !== 'running' && (
        <AIAnalysis run={lastRun} />
      )}
    </div>
  );
}
