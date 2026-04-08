import React, { useState, useEffect } from 'react';
import Card from '../components/Card';
import StatusBadge from '../components/StatusBadge';
import AIAnalysis from '../components/AIAnalysis';
import { CATEGORY_ICONS } from '../components/Sidebar';
import { getEnvironments } from '../api/store';
import { runTests, getCategories, CategoryInfo } from '../api/runner';

export default function RunTestPage() {
  const envs = getEnvironments();
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [selectedEnv, setSelectedEnv] = useState(envs[0]?.id || '');
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [useCustom, setUseCustom] = useState(false);
  const [customUrl, setCustomUrl] = useState('');
  const [customToken, setCustomToken] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<any[]>([]);
  const [report, setReport] = useState<any>(null);

  useEffect(() => { getCategories().then(setCategories); }, []);

  const env = envs.find(e => e.id === selectedEnv);

  function toggleCat(id: string) {
    setSelectedCats(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
  }

  async function handleRun() {
    const url = useCustom ? customUrl : env?.grafanaUrl;
    const token = useCustom ? customToken : env?.token;
    if (!url) { alert('Enter a Grafana URL or configure the environment.'); return; }

    setRunning(true);
    setProgress([]);
    setReport(null);

    try {
      const result = await runTests(url, token || '', selectedCats.length > 0 ? selectedCats : undefined, (evt) => {
        setProgress(prev => [...prev, evt]);
      });
      setReport(result);
    } catch (err: any) {
      alert(`Test run failed: ${err.message}`);
    } finally {
      setRunning(false);
    }
  }

  // Build mock report shape for AIAnalysis
  const aiRun = report ? {
    ...report,
    envName: useCustom ? 'Custom' : env?.name || '',
    results: report.categories?.flatMap((c: any) =>
      (c.tests || []).map((t: any) => ({
        category: c.name,
        name: t.name,
        uid: t.uid || '',
        status: t.status,
        load_time_ms: t.ms || 0,
        error: t.detail || null,
      }))
    ) || [],
    summary: report.summary,
    testLevel: 'full',
  } : null;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">▶️ Run Tests</h2>

      <Card>
        <div className="space-y-5">
          {/* Source Toggle */}
          <div className="flex gap-2">
            <button onClick={() => setUseCustom(false)} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${!useCustom ? 'bg-accent text-white' : 'bg-surface-200 text-muted hover:text-white'}`}>
              Environment
            </button>
            <button onClick={() => setUseCustom(true)} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${useCustom ? 'bg-accent text-white' : 'bg-surface-200 text-muted hover:text-white'}`}>
              Custom URL
            </button>
          </div>

          {!useCustom ? (
            <div className="grid grid-cols-3 gap-3">
              {envs.map(e => (
                <button key={e.id} onClick={() => setSelectedEnv(e.id)}
                  className={`p-4 rounded-xl border-2 text-left transition ${selectedEnv === e.id ? 'border-accent bg-accent/10' : 'border-surface-300 bg-surface-200'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: e.color }} />
                    <span className="font-semibold text-white">{e.name}</span>
                  </div>
                  <p className="text-xs text-muted truncate">{e.grafanaUrl || 'Not configured'}</p>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <input type="url" value={customUrl} onChange={e => setCustomUrl(e.target.value)} placeholder="https://grafana.example.com"
                className="w-full bg-surface-200 border border-surface-300 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-accent" />
              <input type="password" value={customToken} onChange={e => setCustomToken(e.target.value)} placeholder="glsa_..."
                className="w-full bg-surface-200 border border-surface-300 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-accent" />
            </div>
          )}

          {/* Category Selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-muted uppercase tracking-wider">Test Categories (select to filter, empty = run all)</label>
              <button onClick={() => setSelectedCats(selectedCats.length === categories.length ? [] : categories.map(c => c.id))}
                className="text-xs text-accent hover:underline">{selectedCats.length === categories.length ? 'Deselect All' : 'Select All'}</button>
            </div>
            <div className="grid grid-cols-3 lg:grid-cols-4 gap-2">
              {categories.map(cat => (
                <button key={cat.id} onClick={() => toggleCat(cat.id)}
                  className={`flex items-center gap-2 p-2.5 rounded-lg border text-left text-sm transition ${
                    selectedCats.includes(cat.id) ? 'border-accent bg-accent/10 text-white' : 'border-surface-300 bg-surface-200 text-muted hover:text-white'
                  }`}>
                  <span>{cat.icon}</span>
                  <span className="truncate">{cat.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Run */}
          <button onClick={handleRun} disabled={running}
            className={`w-full py-3 rounded-xl font-semibold text-white text-sm transition ${running ? 'bg-surface-300 cursor-not-allowed' : 'bg-accent hover:bg-accent-hover active:scale-[0.99]'}`}>
            {running ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Running {selectedCats.length || 11} categories...
              </span>
            ) : `Run ${selectedCats.length > 0 ? selectedCats.length : 'All 11'} Test Categories`}
          </button>
        </div>
      </Card>

      {/* Live Progress */}
      {progress.length > 0 && running && (
        <Card>
          <h3 className="font-semibold text-white mb-3">Live Progress</h3>
          <div className="space-y-1.5">
            {progress.filter(p => p.type === 'category_start' || p.type === 'category_done').map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span>{p.icon || CATEGORY_ICONS[p.categoryId] || '🔹'}</span>
                <span className="text-white">{p.categoryName || p.categoryId}</span>
                {p.type === 'category_start' && <span className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />}
                {p.type === 'category_done' && <StatusBadge status={p.result?.status || 'PASS'} />}
                {p.type === 'category_done' && p.result?.summary && (
                  <span className="text-xs text-muted">{p.result.summary.passed}/{p.result.summary.total} passed</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Results */}
      {report && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">Results</h3>
            <StatusBadge status={report.status} size="md" />
          </div>

          {report.summary && (
            <div className="grid grid-cols-5 gap-3 mb-5">
              <div className="text-center"><p className="text-2xl font-bold text-blue-400">{report.summary.total}</p><p className="text-xs text-muted">Total</p></div>
              <div className="text-center"><p className="text-2xl font-bold text-green-400">{report.summary.passed}</p><p className="text-xs text-muted">Passed</p></div>
              <div className="text-center"><p className="text-2xl font-bold text-red-400">{report.summary.failed}</p><p className="text-xs text-muted">Failed</p></div>
              <div className="text-center"><p className="text-2xl font-bold text-yellow-400">{report.summary.warnings}</p><p className="text-xs text-muted">Warnings</p></div>
              <div className="text-center"><p className={`text-2xl font-bold ${parseFloat(report.summary.pass_rate) >= 90 ? 'text-green-400' : 'text-red-400'}`}>{report.summary.pass_rate}</p><p className="text-xs text-muted">Pass Rate</p></div>
            </div>
          )}

          {/* Category Results */}
          <div className="space-y-3">
            {(report.categories || []).map((cat: any) => (
              <details key={cat.id} className="group">
                <summary className="flex items-center justify-between p-3 bg-surface-200 rounded-lg cursor-pointer hover:bg-surface-300 transition">
                  <div className="flex items-center gap-2">
                    <span>{cat.icon}</span>
                    <span className="font-medium text-white">{cat.name}</span>
                    <span className="text-xs text-muted">{cat.summary?.passed}/{cat.summary?.total}</span>
                  </div>
                  <StatusBadge status={cat.status} />
                </summary>
                <div className="mt-1 ml-6 space-y-0.5">
                  {(cat.tests || []).map((t: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 py-1 text-sm">
                      <StatusBadge status={t.status} />
                      <span className="text-white">{t.name}</span>
                      {t.ms && <span className="text-xs text-muted">{t.ms}ms</span>}
                      <span className="text-xs text-muted truncate max-w-md ml-auto">{t.detail}</span>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </Card>
      )}

      {/* AI Analysis */}
      {aiRun && !running && aiRun.results?.some((r: any) => r.status === 'FAIL' || r.status === 'WARN') && (
        <AIAnalysis run={aiRun} />
      )}
    </div>
  );
}
