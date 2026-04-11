// AI Dynamic Test Generator (ADTG) — frontend page
// Chat input → plan preview → approval → live execution → save as suite

import React, { useState, useEffect } from 'react';
import { useActiveEnv } from '../../context/AppContext';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:4000';

const C = {
  bg: '#030712',
  card: '#111827',
  card2: '#0f172a',
  border: '#1e293b',
  text: '#e2e8f0',
  muted: '#94a3b8',
  accent: '#a855f7',           // purple — distinct from indigo (K6) / orange (JMeter)
  accentLight: '#c084fc',
  green: '#10b981',
  red: '#ef4444',
  yellow: '#eab308',
};

const KEYFRAMES = `
@keyframes adtgFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes adtgPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
@keyframes adtgSpin { to { transform: rotate(360deg); } }
.gp-adtg-chip { transition: all 0.15s; cursor: pointer; }
.gp-adtg-chip:hover { background: rgba(168,85,247,0.18) !important; border-color: ${C.accent} !important; transform: translateY(-1px); }
.gp-adtg-suite-card { transition: all 0.2s ease; }
.gp-adtg-suite-card:hover { border-color: ${C.accent} !important; transform: translateY(-2px); box-shadow: 0 8px 24px rgba(168,85,247,0.15); }
.gp-adtg-btn-primary { transition: all 0.15s; }
.gp-adtg-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(168,85,247,0.4); }
.gp-adtg-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
.gp-adtg-input:focus { border-color: ${C.accent} !important; box-shadow: 0 0 0 3px rgba(168,85,247,0.15); }
`;

let kfInjected = false;
function injectKF() {
  if (kfInjected || typeof document === 'undefined') return;
  const el = document.createElement('style');
  el.textContent = KEYFRAMES;
  document.head.appendChild(el);
  kfInjected = true;
}

const EXAMPLES = [
  'Make sure every dashboard loads in under 2 seconds',
  'Check that all alert rules have a contact point assigned',
  'Audit RBAC — list users and flag if there are too many admins',
  'Find dashboards with no folder (orphans in General)',
  'Verify all datasources are healthy before an upgrade',
];

const styles = {
  page: { padding: '8px 8px 60px', minHeight: '100vh', maxWidth: 1200 },
  title: { fontSize: 28, fontWeight: 800, color: C.text, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 12 },
  subtitle: { fontSize: 14, color: C.muted, marginBottom: 24 },

  // status banner
  statusBanner: (configured) => ({
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 16px', borderRadius: 10,
    background: configured ? 'rgba(16,185,129,0.08)' : 'rgba(234,179,8,0.08)',
    border: `1px solid ${configured ? 'rgba(16,185,129,0.3)' : 'rgba(234,179,8,0.3)'}`,
    color: configured ? C.green : C.yellow,
    fontSize: 13, marginBottom: 24,
  }),

  // chat input section
  chatSection: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, marginBottom: 20 },
  chatLabel: { fontSize: 12, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  chatInputWrap: { display: 'flex', gap: 12, alignItems: 'stretch' },
  chatInput: {
    flex: 1, background: C.card2, border: `1.5px solid ${C.border}`,
    borderRadius: 10, padding: '14px 18px', fontSize: 15, color: C.text,
    fontFamily: 'inherit', outline: 'none', resize: 'none',
    minHeight: 60, transition: 'border-color 0.15s',
  },
  generateBtn: {
    background: `linear-gradient(135deg, ${C.accent}, ${C.accentLight})`,
    color: '#fff', border: 'none', borderRadius: 10,
    padding: '14px 28px', fontSize: 14, fontWeight: 700,
    cursor: 'pointer', boxShadow: '0 6px 20px rgba(168,85,247,0.35)',
    fontFamily: 'inherit',
    display: 'flex', alignItems: 'center', gap: 8,
  },

  chips: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 },
  chip: {
    background: 'rgba(168,85,247,0.08)', border: `1px solid ${C.border}`,
    color: C.muted, padding: '6px 14px', borderRadius: 999,
    fontSize: 12, fontWeight: 500,
  },

  // plan preview
  planSection: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, marginBottom: 20, animation: 'adtgFadeIn 0.4s ease' },
  planHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  planTitle: { fontSize: 18, fontWeight: 700, color: C.text },
  planMeta: { fontSize: 12, color: C.muted },
  planJson: {
    background: C.card2, border: `1px solid ${C.border}`, borderRadius: 10,
    padding: 16, fontFamily: "'SF Mono', 'Fira Code', monospace",
    fontSize: 12, color: '#cbd5e1', maxHeight: 400, overflow: 'auto',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  },
  validationBox: (valid) => ({
    marginTop: 12, padding: 14, borderRadius: 10,
    background: valid ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
    border: `1px solid ${valid ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
    fontSize: 13, color: valid ? C.green : C.red,
  }),
  approveBar: {
    display: 'flex', gap: 12, alignItems: 'center',
    marginTop: 16, padding: 16, borderRadius: 10,
    background: 'rgba(168,85,247,0.06)', border: `1px solid rgba(168,85,247,0.3)`,
  },
  approveCost: { fontSize: 13, color: C.muted, flex: 1 },
  approveBtn: {
    background: `linear-gradient(135deg, ${C.accent}, ${C.accentLight})`,
    color: '#fff', border: 'none', borderRadius: 8,
    padding: '10px 22px', fontSize: 13, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
    boxShadow: '0 4px 14px rgba(168,85,247,0.35)',
  },

  // results
  resultsSection: { animation: 'adtgFadeIn 0.5s ease' },
  resultCard: (status) => ({
    background: C.card, border: `1px solid ${status === 'PASS' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
    borderRadius: 12, padding: 16, marginBottom: 10,
  }),
  resultHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 },
  resultIcon: (status) => ({ fontSize: 18, color: status === 'PASS' ? C.green : C.red }),
  resultName: { flex: 1, fontSize: 14, fontWeight: 600, color: C.text },
  resultBadge: (status) => ({
    fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
    background: status === 'PASS' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
    color: status === 'PASS' ? C.green : C.red,
    textTransform: 'uppercase', letterSpacing: 0.5,
  }),
  assertion: (passed) => ({
    fontSize: 12, color: passed ? C.muted : C.red,
    paddingLeft: 12, marginBottom: 4, display: 'flex', gap: 6, alignItems: 'flex-start',
  }),

  // suites library
  suitesSection: { marginTop: 32 },
  suitesGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 },
  suiteCard: {
    background: C.card, border: `1px solid ${C.border}`,
    borderRadius: 12, padding: 18, cursor: 'pointer',
  },
  suiteName: { fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 },
  suiteDesc: { fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 1.4, height: 32, overflow: 'hidden' },
  suiteFooter: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: C.muted },
  templateBadge: { fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'rgba(168,85,247,0.15)', color: C.accent, textTransform: 'uppercase', letterSpacing: 0.5 },

  // explanation
  explanationCard: {
    background: 'linear-gradient(135deg, rgba(168,85,247,0.06), rgba(168,85,247,0.02))',
    border: `1px solid rgba(168,85,247,0.3)`, borderRadius: 12, padding: 18, marginBottom: 16,
  },
  explanationTitle: { fontSize: 13, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  explanationText: { fontSize: 14, color: C.text, lineHeight: 1.6, marginBottom: 10 },
  recommendation: { fontSize: 13, color: C.muted, paddingLeft: 12, marginBottom: 4 },

  spinner: {
    display: 'inline-block', width: 14, height: 14,
    border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff',
    borderRadius: '50%', animation: 'adtgSpin 0.6s linear infinite',
  },
};

// Read the LLM config the Settings page saved to localStorage and
// translate it into the shape the backend expects. Returns null if the
// user hasn't configured anything yet.
function readLlmConfig() {
  try {
    const raw = localStorage.getItem('heimdall_llm');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.apiKey || parsed.provider === 'None') return null;
    return {
      provider: (parsed.provider || '').toLowerCase() === 'claude' ? 'claude' : 'openai',
      apiKey: parsed.apiKey,
      model: parsed.model || undefined,
    };
  } catch {
    return null;
  }
}

export default function AITestsPage() {
  const { grafanaUrl, token, label: envLabel, isConfigured: envConfigured } = useActiveEnv();
  const [status, setStatus] = useState({ llmConfigured: false });
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [plan, setPlan] = useState(null);
  const [validation, setValidation] = useState(null);
  const [planJson, setPlanJson] = useState('');
  const [editingPlan, setEditingPlan] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [suites, setSuites] = useState([]);
  const [error, setError] = useState(null);
  const [savingName, setSavingName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  useEffect(() => { injectKF(); }, []);

  // Re-check LLM status whenever the page mounts OR focus returns (so the
  // banner flips from yellow to green after the user saves a key in Settings
  // and comes back to this tab).
  useEffect(() => {
    function refreshStatus() {
      const llmConfig = readLlmConfig();
      fetch(`${API_BASE}/api/adtg/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llmConfig }),
      }).then(r => r.json()).then(setStatus).catch(() => {});
    }
    refreshStatus();
    loadSuites();
    window.addEventListener('focus', refreshStatus);
    return () => window.removeEventListener('focus', refreshStatus);
  }, []);

  function loadSuites() {
    fetch(`${API_BASE}/api/adtg/suites`).then(r => r.json()).then(setSuites).catch(() => setSuites([]));
  }

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setError(null);
    setGenerating(true);
    setPlan(null);
    setValidation(null);
    setRunResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/adtg/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, grafanaUrl, token, llmConfig: readLlmConfig() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      setPlan(data.plan);
      setValidation(data.validation);
      setPlanJson(JSON.stringify(data.plan, null, 2));
    } catch (err) {
      setError(err.message);
    }
    setGenerating(false);
  }

  async function handleExecute() {
    if (!plan) return;
    if (!envConfigured) {
      setError('No environment selected — pick one in the sidebar (Settings → configure URL + token).');
      return;
    }
    setExecuting(true);
    setError(null);
    try {
      // Use possibly-edited plan
      let executePlan = plan;
      if (editingPlan) {
        try {
          executePlan = JSON.parse(planJson);
        } catch (e) {
          setError('Invalid JSON in plan: ' + e.message);
          setExecuting(false);
          return;
        }
      }
      const res = await fetch(`${API_BASE}/api/adtg/execute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: executePlan, grafanaUrl, token, llmConfig: readLlmConfig() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Execution failed');
      setRunResult(data);
    } catch (err) {
      setError(err.message);
    }
    setExecuting(false);
  }

  async function handleRunSuite(suite) {
    if (!envConfigured) {
      setError('No environment selected — pick one in the sidebar (Settings → configure URL + token).');
      return;
    }
    setPlan(suite.plan);
    setPlanJson(JSON.stringify(suite.plan, null, 2));
    setValidation({ valid: true, estimatedCalls: 0 });
    setRunResult(null);
    setExecuting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/adtg/execute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: suite.plan, grafanaUrl, token, llmConfig: readLlmConfig() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Execution failed');
      setRunResult(data);
    } catch (err) {
      setError(err.message);
    }
    setExecuting(false);
  }

  async function handleSaveSuite() {
    if (!plan || !savingName.trim()) return;
    try {
      await fetch(`${API_BASE}/api/adtg/suites`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: savingName.trim(),
          description: plan.description || '',
          plan: editingPlan ? JSON.parse(planJson) : plan,
          tags: plan.tags || [],
        }),
      });
      setShowSaveDialog(false);
      setSavingName('');
      loadSuites();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div style={styles.page} data-tour="ai-tests-page">
      <h1 style={styles.title}>
        <span style={{ fontSize: 32 }}>🧠</span>
        AI Tests
        <span style={{ ...styles.templateBadge, fontSize: 11 }}>BETA</span>
      </h1>
      <p style={styles.subtitle}>
        Describe what you want to validate in plain English. AI converts your intent into runnable Grafana tests.
      </p>

      {/* LLM status banner */}
      <div style={styles.statusBanner(status.llmConfigured)}>
        {status.llmConfigured ? '✓' : '⚠'}
        <span style={{ flex: 1 }}>
          {status.llmConfigured
            ? `LLM configured: ${status.provider} (${status.model})`
            : `LLM not configured. Set LLM_API_KEY in backend/.env to enable AI generation. You can still run pre-built Smart Suites below.`}
        </span>
      </div>

      {/* Chat input */}
      <div style={styles.chatSection}>
        <div style={styles.chatLabel}>Describe what you want to validate</div>
        <div style={styles.chatInputWrap}>
          <textarea
            className="gp-adtg-input"
            style={styles.chatInput}
            placeholder="e.g. Check that every production dashboard loads in under 2 seconds and has no broken panel queries"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !generating) handleGenerate();
            }}
          />
          <button
            className="gp-adtg-btn-primary"
            style={styles.generateBtn}
            disabled={!prompt.trim() || generating || !status.llmConfigured}
            onClick={handleGenerate}
          >
            {generating && <span style={styles.spinner} />}
            {generating ? 'Generating...' : '✨ Generate Plan'}
          </button>
        </div>
        <div style={styles.chips}>
          {EXAMPLES.map((ex, i) => (
            <span key={i} className="gp-adtg-chip" style={styles.chip} onClick={() => setPrompt(ex)}>
              {ex}
            </span>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: `1px solid ${C.red}40`, color: C.red, padding: 14, borderRadius: 10, marginBottom: 16, fontSize: 13 }}>
          ✗ {error}
        </div>
      )}

      {/* Plan preview */}
      {plan && (
        <div style={styles.planSection}>
          <div style={styles.planHeader}>
            <div>
              <div style={styles.planTitle}>📋 {plan.name || 'Generated Test Plan'}</div>
              <div style={styles.planMeta}>{plan.testCases?.length || 0} test cases · {plan.description || ''}</div>
            </div>
            <button
              style={{ ...styles.chip, background: 'transparent', cursor: 'pointer' }}
              onClick={() => setEditingPlan(!editingPlan)}
            >
              {editingPlan ? '✓ Done editing' : '✎ Edit JSON'}
            </button>
          </div>

          {editingPlan ? (
            <textarea
              style={{ ...styles.planJson, width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 300, fontFamily: "'SF Mono', monospace" }}
              value={planJson}
              onChange={(e) => setPlanJson(e.target.value)}
            />
          ) : (
            <pre style={styles.planJson}>{planJson}</pre>
          )}

          {validation && (
            <div style={styles.validationBox(validation.valid)}>
              {validation.valid ? '✓ Plan is valid' : '✗ ' + (validation.errors || []).join('; ')}
              {validation.warnings && validation.warnings.length > 0 && (
                <div style={{ marginTop: 6, color: C.yellow }}>⚠ {validation.warnings.join('; ')}</div>
              )}
            </div>
          )}

          {validation?.valid && (
            <div style={styles.approveBar}>
              <div style={styles.approveCost}>
                ~{validation.estimatedCalls || 0} API calls · estimated {validation.estimatedSeconds || 1}s
              </div>
              <button
                className="gp-adtg-btn-primary"
                style={styles.approveBtn}
                disabled={executing}
                onClick={handleExecute}
              >
                {executing && <span style={styles.spinner} />}
                {executing ? 'Running...' : '▶ Approve & Run'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Run results */}
      {runResult && (
        <div style={styles.resultsSection}>
          {runResult.explanation && runResult.explanation.summary && (
            <div style={styles.explanationCard}>
              <div style={styles.explanationTitle}>🤖 AI Analysis</div>
              <div style={styles.explanationText}>{runResult.explanation.summary}</div>
              {runResult.explanation.details && (
                <div style={{ ...styles.explanationText, color: C.muted, fontSize: 13 }}>{runResult.explanation.details}</div>
              )}
              {runResult.explanation.recommendations?.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, textTransform: 'uppercase', marginBottom: 6 }}>Recommendations</div>
                  {runResult.explanation.recommendations.map((rec, i) => (
                    <div key={i} style={styles.recommendation}>→ {rec}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>
                Results: {runResult.summary?.passed}/{runResult.summary?.totalCases} passed
              </div>
              <div style={{ fontSize: 12, color: C.muted }}>
                {runResult.summary?.passRate} · {runResult.summary?.durationMs}ms · {runResult.summary?.totalAssertions} assertions
              </div>
            </div>
            <button
              style={styles.approveBtn}
              onClick={() => setShowSaveDialog(true)}
            >
              💾 Save as Smart Suite
            </button>
          </div>

          {(runResult.results || []).map((r) => (
            <div key={r.id} style={styles.resultCard(r.status)}>
              <div style={styles.resultHeader}>
                <span style={styles.resultIcon(r.status)}>{r.status === 'PASS' ? '✓' : '✗'}</span>
                <span style={styles.resultName}>{r.description}</span>
                <span style={styles.resultBadge(r.status)}>{r.status}</span>
                <span style={{ fontSize: 11, color: C.muted }}>{r.durationMs}ms</span>
              </div>
              {r.assertions.map((a, i) => (
                <div key={i} style={styles.assertion(a.passed)}>
                  <span>{a.passed ? '✓' : '✗'}</span>
                  <div>
                    <div>{a.name}</div>
                    {!a.passed && <div style={{ color: C.muted, fontSize: 11 }}>actual: {a.actual} · expected: {a.expected}</div>}
                  </div>
                </div>
              ))}
              {r.errors?.length > 0 && (
                <div style={{ marginTop: 8, padding: 8, background: 'rgba(239,68,68,0.06)', borderRadius: 6, fontSize: 11, color: C.red }}>
                  {r.errors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Smart Suites Library */}
      <div style={styles.suitesSection}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 16 }}>
          📚 Smart Suite Library
          <span style={{ marginLeft: 12, fontSize: 12, fontWeight: 500, color: C.muted }}>{suites.length} available</span>
        </h2>
        <div style={styles.suitesGrid}>
          {suites.map((s) => (
            <div key={s.id} className="gp-adtg-suite-card" style={styles.suiteCard} onClick={() => handleRunSuite(s)}>
              <div style={styles.suiteName}>{s.name}</div>
              <div style={styles.suiteDesc}>{s.description || s.original_prompt}</div>
              <div style={styles.suiteFooter}>
                <span>{s.run_count || 0} runs</span>
                {s.isTemplate && <span style={styles.templateBadge}>Template</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Save dialog */}
      {showSaveDialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, width: 420 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 12 }}>💾 Save as Smart Suite</h3>
            <input
              className="gp-adtg-input"
              type="text"
              placeholder="Suite name (e.g. Production smoke check)"
              value={savingName}
              onChange={(e) => setSavingName(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', background: C.card2, border: `1.5px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', fontSize: 14, color: C.text, marginBottom: 16 }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button style={{ ...styles.chip, cursor: 'pointer', padding: '8px 16px' }} onClick={() => setShowSaveDialog(false)}>Cancel</button>
              <button style={styles.approveBtn} disabled={!savingName.trim()} onClick={handleSaveSuite}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
