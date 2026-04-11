import React, { useState, useEffect, useRef } from 'react';
import api from '../../services/api';
import { useApp } from '../../context/AppContext';

/* ── theme tokens ── */
const C = {
  bg: '#030712',
  card: '#111827',
  input: '#0f172a',
  text: '#e2e8f0',
  muted: '#94a3b8',
  accent: '#6366f1',
  border: '#1e293b',
  green: '#10b981',
  red: '#ef4444',
};

/* ── shared styles ── */
const s = {
  page: { color: C.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', maxWidth: 820 },
  title: { fontSize: 28, fontWeight: 700, margin: '0 0 32px 0', color: C.text },
  section: {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
    padding: 24, marginBottom: 24,
  },
  sectionTitle: { fontSize: 18, fontWeight: 700, margin: '0 0 20px 0', color: C.text, display: 'flex', alignItems: 'center', gap: 10 },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 6 },
  input: {
    width: '100%', boxSizing: 'border-box',
    background: C.input, color: C.text, border: `1px solid ${C.border}`,
    borderRadius: 8, padding: '10px 14px', fontSize: 14, outline: 'none',
    transition: 'border-color .2s',
  },
  inputFocus: { borderColor: C.accent },
  row: { display: 'flex', gap: 16, marginBottom: 16 },
  col: { flex: 1 },
  btn: {
    background: C.accent, color: '#fff', border: 'none', borderRadius: 8,
    padding: '10px 22px', fontWeight: 600, fontSize: 14, cursor: 'pointer',
    transition: 'opacity .2s',
  },
  btnOutline: {
    background: 'transparent', color: C.accent, border: `1px solid ${C.accent}40`,
    borderRadius: 8, padding: '8px 18px', fontWeight: 600, fontSize: 13, cursor: 'pointer',
  },
  saved: {
    color: C.green, fontSize: 13, fontWeight: 600, marginLeft: 12,
    transition: 'opacity .3s', display: 'inline-block',
  },
  resultBox: {
    marginTop: 12, background: C.input, border: `1px solid ${C.border}`,
    borderRadius: 8, padding: 14, fontSize: 13,
  },
  envDot: (color) => ({
    width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0,
  }),
  envCard: {
    background: C.input, border: `1px solid ${C.border}`, borderRadius: 10,
    padding: 16, marginBottom: 12,
  },
  envHeader: { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' },
  envName: { fontWeight: 700, fontSize: 15, flex: 1, color: C.text },
  toggle: { color: C.muted, fontSize: 12, cursor: 'pointer', background: 'none', border: 'none', padding: '4px 8px' },
  select: {
    width: '100%', boxSizing: 'border-box',
    background: C.input, color: C.text, border: `1px solid ${C.border}`,
    borderRadius: 8, padding: '10px 14px', fontSize: 14, outline: 'none',
    appearance: 'auto', cursor: 'pointer',
  },
};

/* ── Input with focus styling ── */
function StyledInput({ style, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      style={{ ...s.input, ...(focused ? s.inputFocus : {}), ...style }}
      onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
    />
  );
}

/* ── "Saved!" flash ── */
function useSavedFlash() {
  const [show, setShow] = useState(false);
  const timer = useRef(null);
  const flash = () => {
    setShow(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), 2000);
  };
  const el = show ? <span style={s.saved}>Saved!</span> : null;
  return [el, flash];
}

/* ── localStorage helpers ── */
const LS_LLM = 'grafana_probe_llm';

function loadLlm() {
  try { return JSON.parse(localStorage.getItem(LS_LLM)) || null; } catch { return null; }
}
function saveLlm(data) { localStorage.setItem(LS_LLM, JSON.stringify(data)); }

const LLM_MODELS = {
  None: [],
  OpenAI: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  Claude: ['claude-sonnet-4-20250514', 'claude-opus-4-0-20250115', 'claude-3-haiku-20240307'],
};

/* ═══════════════════════════════════════ */
export default function SettingsPage() {
  const { envs, setEnvs, activeEnvKey, setActiveEnvKey, openOnboarding } = useApp();

  /* ── Per-environment test state ── */
  const [envTesting, setEnvTesting] = useState({});      // { DEV: true, PERF: false, ... }
  const [envTestResults, setEnvTestResults] = useState({}); // { DEV: {ok, version, ...}, ... }

  const handleTestEnv = async (env) => {
    if (!env.url) {
      setEnvTestResults(p => ({ ...p, [env.key]: { ok: false, error: 'URL is required' } }));
      return;
    }
    setEnvTesting(p => ({ ...p, [env.key]: true }));
    setEnvTestResults(p => ({ ...p, [env.key]: null }));
    try {
      const res = await api.testConnection(env.url, env.token);
      setEnvTestResults(p => ({ ...p, [env.key]: res }));
    } catch (e) {
      setEnvTestResults(p => ({ ...p, [env.key]: { ok: false, error: e.message } }));
    }
    setEnvTesting(p => ({ ...p, [env.key]: false }));
  };

  /* ── Environments (sourced from AppContext — shared with sidebar) ── */
  const [expandedEnv, setExpandedEnv] = useState(null);
  const [envSaved, envFlash] = useSavedFlash();

  const updateEnv = (key, field, value) => {
    setEnvs((prev) => prev.map((e) => (e.key === key ? { ...e, [field]: value } : e)));
  };
  const handleSaveEnv = (key) => {
    // AppContext auto-persists on setEnvs; this just surfaces the "Saved!" flash
    envFlash();
    // Auto-select this env as active if none is selected yet
    if (!activeEnvKey) setActiveEnvKey(key);
  };

  /* ── Server config (retention etc.) ── */
  const [serverConfig, setServerConfig] = useState(null);
  useEffect(() => {
    api.config().then(setServerConfig).catch(() => {});
  }, []);

  /* ── LLM ── */
  const [llm, setLlm] = useState(() => loadLlm() || { provider: 'None', apiKey: '', model: '' });
  const [llmSaved, llmFlash] = useSavedFlash();

  const handleProviderChange = (provider) => {
    const models = LLM_MODELS[provider] || [];
    setLlm({ provider, apiKey: llm.apiKey, model: models[0] || '' });
  };
  const handleSaveLlm = () => {
    saveLlm(llm);
    llmFlash();
  };

  /* ── Email / SMTP ── */
  const [emailCfg, setEmailCfg] = useState({
    host: '', port: 587, secure: false,
    user: '', password: '',
    fromAddress: '', fromName: 'GrafanaProbe',
    defaultCc: '',
    enabled: false,
  });
  const [emailSaved, emailFlash] = useSavedFlash();
  const [emailTesting, setEmailTesting] = useState(false);
  const [emailTestResult, setEmailTestResult] = useState(null);
  const [testEmailTo, setTestEmailTo] = useState('');

  useEffect(() => {
    api.getEmailConfig().then((cfg) => { if (cfg && !cfg.error) setEmailCfg(cfg); }).catch(() => {});
  }, []);

  const updateEmail = (field, value) => {
    setEmailCfg((p) => ({ ...p, [field]: value }));
  };
  const handleSaveEmail = async () => {
    try {
      const saved = await api.saveEmailConfig(emailCfg);
      if (saved && !saved.error) setEmailCfg(saved);
      emailFlash();
    } catch (e) {
      setEmailTestResult({ ok: false, error: e.message });
    }
  };
  const handleTestEmail = async () => {
    setEmailTesting(true);
    setEmailTestResult(null);
    try {
      const r = await api.sendTestEmail(testEmailTo || emailCfg.fromAddress);
      setEmailTestResult(r);
    } catch (e) {
      setEmailTestResult({ ok: false, error: e.message });
    }
    setEmailTesting(false);
  };

  return (
    <div style={s.page} data-tour="settings-page">
      <h1 style={s.title}>{'\u2699\uFE0F'} Settings</h1>

      {/* ── Section 1: Environments (with built-in test) ── */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>
          {'\uD83C\uDF10'} Environments
          {envSaved}
        </h2>

        {envs.map((env) => {
          const open = expandedEnv === env.key;
          return (
            <div key={env.key} style={s.envCard}>
              <div style={s.envHeader} onClick={() => setExpandedEnv(open ? null : env.key)}>
                <div style={s.envDot(env.color)} />
                <span style={s.envName}>{env.label}</span>
                {env.url && <span style={{ fontSize: 12, color: C.muted }}>{env.url}</span>}
                <button style={s.toggle}>{open ? '\u25B2 Collapse' : '\u25BC Edit'}</button>
              </div>

              {open && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ marginBottom: 12 }}>
                    <label style={s.label}>URL</label>
                    <StyledInput type="text" placeholder="https://grafana-dev.example.com"
                      value={env.url} onChange={(e) => updateEnv(env.key, 'url', e.target.value)} />
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={s.label}>Token</label>
                    <StyledInput type="password" placeholder="glsa_..."
                      value={env.token} onChange={(e) => updateEnv(env.key, 'token', e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button style={s.btn} onClick={() => handleSaveEnv(env.key)}>Save</button>
                    <button style={{ ...s.btnOutline, opacity: envTesting[env.key] ? 0.6 : 1 }}
                      disabled={envTesting[env.key]}
                      onClick={() => handleTestEnv(env)}>
                      {envTesting[env.key] ? 'Testing...' : 'Test Connection'}
                    </button>
                  </div>
                  {envTestResults[env.key] && (
                    <div style={s.resultBox}>
                      {envTestResults[env.key].ok ? (
                        <div>
                          <span style={{ color: C.green, fontWeight: 700 }}>{'\u2714'} Connected</span>
                          <div style={{ marginTop: 8, color: C.muted, fontSize: 13 }}>
                            Version: <span style={{ color: C.text }}>{envTestResults[env.key].version}</span>
                            {' \u00B7 '}User: <span style={{ color: C.text }}>{envTestResults[env.key].user}</span>
                            {' \u00B7 '}{envTestResults[env.key].ms}ms
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: C.red }}>{'\u2718'} {envTestResults[env.key].error || 'Connection failed'}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Section 2: Retention ── */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>{'\uD83D\uDDC4\uFE0F'} Test Result Retention</h2>
        <div style={{
          padding: '14px 18px', borderRadius: 10,
          background: '#0f172a', border: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 10,
            background: 'rgba(99, 102, 241, 0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22,
          }}>📊</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>
              Keep last {serverConfig?.retention?.maxRunsPerEnv ?? '…'} runs per environment
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
              After each test run completes, older runs for the same environment are automatically pruned
              (cascading to test results, category results, and latency measurements).
              Override with the <code style={{ background: C.input, padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>MAX_RUNS_PER_ENV</code> env var in <code style={{ background: C.input, padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>backend/.env</code>.
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 2c: Email / SMTP Notifications ── */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>{'\uD83D\uDCE7'} Email Notifications {emailSaved}</h2>
        <p style={{ fontSize: 12, color: C.muted, margin: '0 0 16px 0', lineHeight: 1.5 }}>
          Configure SMTP so the 📧 button on each failing test row can send a notification to the
          dashboard's <strong>created-by</strong> and <strong>last-updated-by</strong> users (resolved via
          Grafana). The default CC list always receives a copy.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: C.input, border: `1px solid ${C.border}` }}>
          <input
            type="checkbox"
            checked={emailCfg.enabled}
            onChange={(e) => updateEmail('enabled', e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          <label style={{ fontSize: 13, color: C.text, cursor: 'pointer' }} onClick={() => updateEmail('enabled', !emailCfg.enabled)}>
            Enable email notifications
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={s.label}>SMTP Host</label>
            <StyledInput type="text" placeholder="smtp.gmail.com"
              value={emailCfg.host} onChange={(e) => updateEmail('host', e.target.value)} />
          </div>
          <div>
            <label style={s.label}>Port</label>
            <StyledInput type="number" placeholder="587"
              value={emailCfg.port} onChange={(e) => updateEmail('port', parseInt(e.target.value || 587, 10))} />
          </div>
          <div>
            <label style={s.label}>TLS / SSL</label>
            <select value={emailCfg.secure ? '1' : '0'}
              onChange={(e) => updateEmail('secure', e.target.value === '1')}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 6, background: C.input, border: `1px solid ${C.border}`, color: C.text, fontSize: 13, fontFamily: 'inherit' }}>
              <option value="0">STARTTLS (587)</option>
              <option value="1">SSL/TLS (465)</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={s.label}>SMTP Username</label>
            <StyledInput type="text" placeholder="user@example.com"
              value={emailCfg.user} onChange={(e) => updateEmail('user', e.target.value)} />
          </div>
          <div>
            <label style={s.label}>SMTP Password</label>
            <StyledInput type="password" placeholder="••••••••"
              value={emailCfg.password} onChange={(e) => updateEmail('password', e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={s.label}>From Address</label>
            <StyledInput type="email" placeholder="grafanaprobe@example.com"
              value={emailCfg.fromAddress} onChange={(e) => updateEmail('fromAddress', e.target.value)} />
          </div>
          <div>
            <label style={s.label}>From Name</label>
            <StyledInput type="text" placeholder="GrafanaProbe"
              value={emailCfg.fromName} onChange={(e) => updateEmail('fromName', e.target.value)} />
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={s.label}>Default CC (comma-separated, always receives notifications)</label>
          <StyledInput type="text" placeholder="oncall@example.com, sre-team@example.com"
            value={emailCfg.defaultCc} onChange={(e) => updateEmail('defaultCc', e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={handleSaveEmail}
            style={{ padding: '10px 18px', borderRadius: 8, background: C.accent, color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Save SMTP Config
          </button>
          <span style={{ fontSize: 12, color: C.muted }}>Test:</span>
          <input type="email" placeholder={emailCfg.fromAddress || 'recipient@example.com'}
            value={testEmailTo} onChange={(e) => setTestEmailTo(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 6, background: C.input, border: `1px solid ${C.border}`, color: C.text, fontSize: 12, fontFamily: 'inherit', flex: '1 1 200px', minWidth: 200 }} />
          <button onClick={handleTestEmail} disabled={emailTesting || !emailCfg.host}
            style={{ padding: '8px 16px', borderRadius: 6, background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, fontSize: 12, fontWeight: 600, cursor: (emailTesting || !emailCfg.host) ? 'not-allowed' : 'pointer', opacity: (emailTesting || !emailCfg.host) ? 0.5 : 1, fontFamily: 'inherit' }}>
            {emailTesting ? 'Sending…' : 'Send Test Email'}
          </button>
        </div>

        {emailTestResult && (
          <div style={{
            marginTop: 12, padding: '10px 14px', borderRadius: 8,
            background: emailTestResult.ok ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
            border: `1px solid ${emailTestResult.ok ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`,
            color: emailTestResult.ok ? '#10b981' : '#ef4444', fontSize: 12,
          }}>
            {emailTestResult.ok
              ? `✓ Test email sent to ${emailTestResult.sentTo} (messageId: ${(emailTestResult.messageId || '').slice(0, 60)})`
              : `✗ ${emailTestResult.error || 'Failed to send'}`}
          </div>
        )}
      </div>

      {/* ── Section 2b: Help & Welcome Tour ── */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>{'\u2753'} Help & Welcome Tour</h2>
        <div style={{
          padding: '14px 18px', borderRadius: 10,
          background: '#0f172a', border: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 10,
            background: 'rgba(99, 102, 241, 0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22,
          }}>🚀</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>
              Re-open the welcome tour
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
              Walk through the 4-step onboarding again. Useful for demos or
              when showing GrafanaProbe to a new teammate. The tour also
              auto-shows once after app version bumps.
            </div>
          </div>
          <button
            onClick={openOnboarding}
            style={{
              padding: '10px 18px', borderRadius: 8,
              background: C.accent, color: '#fff', border: 'none',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Show Tour
          </button>
        </div>
      </div>

      {/* ── Section 3: LLM / AI ── */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>
          {'\uD83E\uDD16'} LLM Analysis (AI)
          {llmSaved}
        </h2>

        <div style={s.row}>
          <div style={s.col}>
            <label style={s.label}>Provider</label>
            <select style={s.select} value={llm.provider}
              onChange={(e) => handleProviderChange(e.target.value)}>
              {Object.keys(LLM_MODELS).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div style={s.col}>
            <label style={s.label}>API Key</label>
            <StyledInput type="password" placeholder={llm.provider === 'None' ? 'N/A' : 'sk-...'}
              value={llm.apiKey} disabled={llm.provider === 'None'}
              onChange={(e) => setLlm({ ...llm, apiKey: e.target.value })}
              style={llm.provider === 'None' ? { opacity: 0.4 } : {}} />
          </div>
        </div>

        {llm.provider !== 'None' && (
          <div style={{ marginBottom: 16 }}>
            <label style={s.label}>Model</label>
            <select style={s.select} value={llm.model}
              onChange={(e) => setLlm({ ...llm, model: e.target.value })}>
              {(LLM_MODELS[llm.provider] || []).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}

        <button style={{ ...s.btn, opacity: llm.provider === 'None' ? 0.4 : 1 }}
          disabled={llm.provider === 'None'} onClick={handleSaveLlm}>
          Save
        </button>
      </div>
    </div>
  );
}
