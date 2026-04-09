import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../services/api';
import { getSocket } from '../../services/socket';
import StatusBadge from '../Common/StatusBadge';

/* ───────────────────────── keyframes (injected once) ───────────────────────── */
const KEYFRAMES = `
@keyframes trSpin { to { transform: rotate(360deg); } }
@keyframes trFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
`;
let kfInjected = false;
function injectKF() {
  if (kfInjected || typeof document === 'undefined') return;
  const el = document.createElement('style');
  el.textContent = KEYFRAMES;
  document.head.appendChild(el);
  kfInjected = true;
}

/* ───────────────────────── constants ───────────────────────── */
const LS_URL_KEY = 'grafanaprobe_grafanaUrl';
const LS_TOKEN_KEY = 'grafanaprobe_token';

/* ───────────────────────── component ───────────────────────── */
export default function TestRunnerPage() {
  /* ── state ── */
  const [engine, setEngine] = useState('k6'); // 'k6' | 'playwright'
  const [categories, setCategories] = useState([]);
  const [selected, setSelected] = useState(new Set());

  // Playwright state
  const [pwSelected, setPwSelected] = useState(new Set());
  const [pwPhase, setPwPhase] = useState('config');
  const [pwLogs, setPwLogs] = useState([]);
  const [pwResults, setPwResults] = useState(null);
  const pwLogRef = useRef(null);
  const [grafanaUrl, setGrafanaUrl] = useState('');
  const [token, setToken] = useState('');
  const [phase, setPhase] = useState('config'); // config | running | done
  const [catStatuses, setCatStatuses] = useState({}); // { catId: { status, total, passed, failed, tests:[] } }
  const [logs, setLogs] = useState([]);
  const [results, setResults] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [hoveredCat, setHoveredCat] = useState(null);
  const [hoveredResult, setHoveredResult] = useState(null);
  const logRef = useRef(null);

  useEffect(() => { injectKF(); }, []);

  /* load categories */
  useEffect(() => {
    (async () => {
      try {
        const cats = await api.getCategories();
        if (Array.isArray(cats)) {
          setCategories(cats);
          setSelected(new Set(cats.map((c) => c.id)));
        }
      } catch (e) {
        console.error('Failed to load categories:', e);
      }
    })();
  }, []);

  /* restore from localStorage */
  useEffect(() => {
    try {
      const u = localStorage.getItem(LS_URL_KEY);
      const t = localStorage.getItem(LS_TOKEN_KEY);
      if (u) setGrafanaUrl(u);
      if (t) setToken(t);
    } catch { /* ignore */ }
  }, []);

  /* persist inputs */
  useEffect(() => {
    try {
      localStorage.setItem(LS_URL_KEY, grafanaUrl);
      localStorage.setItem(LS_TOKEN_KEY, token);
    } catch { /* ignore */ }
  }, [grafanaUrl, token]);

  /* auto-scroll log */
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  /* ── selection helpers ── */
  const toggleCat = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(categories.map((c) => c.id)));
  const deselectAll = () => setSelected(new Set());

  /* ── add log line ── */
  const addLog = useCallback((line) => {
    setLogs((prev) => [...prev, { ts: Date.now(), text: line }]);
  }, []);

  /* ── run tests ── */
  const handleRun = useCallback(() => {
    if (selected.size === 0) return;
    setPhase('running');
    setResults(null);
    setLogs([]);
    setExpanded(new Set());

    /* initialize category statuses */
    const init = {};
    selected.forEach((id) => {
      init[id] = { status: 'pending', total: 0, passed: 0, failed: 0, tests: [] };
    });
    setCatStatuses(init);

    addLog('Starting test run...');

    const socket = getSocket();

    const onProgress = (data) => {
      if (!data) return;
      const { type, categoryId, categoryName, test, category } = data;

      if (type === 'category_start') {
        setCatStatuses((prev) => ({
          ...prev,
          [categoryId]: { ...prev[categoryId], status: 'running' },
        }));
        addLog(`▶  ${categoryName || categoryId} starting...`);
      }

      if (type === 'test_result' && test) {
        const icon = test.status === 'PASS' ? '✓' : test.status === 'FAIL' ? '✗' : '⚠';
        const color = test.status === 'PASS' ? 'pass' : test.status === 'FAIL' ? 'fail' : 'warn';
        setCatStatuses((prev) => {
          const cat = prev[categoryId] || { status: 'running', total: 0, passed: 0, failed: 0, tests: [] };
          return {
            ...prev,
            [categoryId]: {
              ...cat,
              total: cat.total + 1,
              passed: cat.passed + (test.status === 'PASS' ? 1 : 0),
              failed: cat.failed + (test.status === 'FAIL' ? 1 : 0),
              tests: [...cat.tests, test],
            },
          };
        });
        addLog(`  ${icon} [${color}] ${test.name || test.testName || 'test'} (${test.ms || test.latency || 0}ms)`);
      }

      if (type === 'category_done' || type === 'category_complete') {
        const catData = category || {};
        const p = catData.passed || 0;
        const t = catData.total || 0;
        setCatStatuses((prev) => {
          const existing = prev[categoryId] || {};
          return {
            ...prev,
            [categoryId]: {
              ...existing,
              status: existing.failed > 0 || (catData.failed > 0) ? 'failed' : 'passed',
              total: t || existing.total,
              passed: p || existing.passed,
              failed: catData.failed || existing.failed,
            },
          };
        });
        addLog(`■  ${categoryName || categoryId} done ${p}/${t} passed`);
      }
    };

    const onComplete = (data) => {
      setPhase('done');
      setResults(data);
      addLog('──── Test run complete ────');
      socket.off('test-progress', onProgress);
      socket.off('test-complete', onComplete);
    };

    socket.on('test-progress', onProgress);
    socket.on('test-complete', onComplete);

    /* emit run command */
    socket.emit('run-tests', {
      grafanaUrl,
      token,
      categories: Array.from(selected),
    });

    /* also fire REST call as fallback */
    api.runTests({ grafanaUrl, token, categories: Array.from(selected) })
      .then((res) => {
        if (phase !== 'done' && res) {
          /* socket might not be available; use REST result */
        }
      })
      .catch((err) => {
        addLog(`Error: ${err.message}`);
      });
  }, [selected, grafanaUrl, token, addLog, phase]);

  /* ── toggle expanded result ── */
  const toggleExpanded = (catId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(catId) ? next.delete(catId) : next.add(catId);
      return next;
    });
  };

  /* ── helper: find category by id ── */
  const catMap = {};
  categories.forEach((c) => { catMap[c.id] = c; });

  /* ───────────────────────── styles ───────────────────────── */
  const st = {
    page: {
      padding: '8px 8px',
      minHeight: '100vh',
      backgroundColor: '#030712',
    },
    pageTitle: {
      fontSize: 24,
      fontWeight: 700,
      color: '#e2e8f0',
      marginBottom: 8,
    },
    pageSubtitle: {
      fontSize: 14,
      color: '#94a3b8',
      marginBottom: 28,
    },

    /* section label */
    sectionLabel: {
      fontSize: 13,
      fontWeight: 600,
      color: '#94a3b8',
      textTransform: 'uppercase',
      letterSpacing: '0.8px',
      marginBottom: 12,
    },

    /* category selector grid */
    catGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 10,
      marginBottom: 24,
    },
    catChip: (isSelected, isHovered) => ({
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '12px 14px',
      backgroundColor: isSelected ? 'rgba(99,102,241,0.1)' : '#111827',
      border: `1.5px solid ${isSelected ? '#6366f1' : isHovered ? '#374151' : '#1e293b'}`,
      borderRadius: 10,
      cursor: 'pointer',
      transition: 'all 0.15s ease',
    }),
    catChipIcon: {
      fontSize: 20,
      flexShrink: 0,
    },
    catChipName: {
      fontSize: 13,
      fontWeight: 500,
      color: '#e2e8f0',
    },
    catChipCheck: (isSelected) => ({
      marginLeft: 'auto',
      width: 20,
      height: 20,
      borderRadius: 6,
      border: `2px solid ${isSelected ? '#6366f1' : '#374151'}`,
      backgroundColor: isSelected ? '#6366f1' : 'transparent',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 12,
      color: '#fff',
      flexShrink: 0,
      transition: 'all 0.15s ease',
    }),

    /* select/deselect buttons */
    bulkBtnRow: {
      display: 'flex',
      gap: 10,
      marginBottom: 24,
    },
    bulkBtn: {
      padding: '7px 16px',
      fontSize: 12,
      fontWeight: 600,
      color: '#94a3b8',
      backgroundColor: '#111827',
      border: '1px solid #1e293b',
      borderRadius: 8,
      cursor: 'pointer',
      transition: 'all 0.15s ease',
    },

    /* inputs */
    inputGroup: {
      marginBottom: 16,
    },
    inputLabel: {
      display: 'block',
      fontSize: 12,
      fontWeight: 600,
      color: '#94a3b8',
      marginBottom: 6,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
    },
    input: {
      width: '100%',
      padding: '11px 14px',
      fontSize: 14,
      color: '#e2e8f0',
      backgroundColor: '#0f172a',
      border: '1px solid #1e293b',
      borderRadius: 8,
      outline: 'none',
      transition: 'border-color 0.15s ease',
      boxSizing: 'border-box',
      fontFamily: 'inherit',
    },
    inputRow: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 16,
      marginBottom: 24,
    },

    /* run button */
    runBtn: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '12px 32px',
      fontSize: 15,
      fontWeight: 600,
      color: '#ffffff',
      background: 'linear-gradient(135deg, #6366f1, #818cf8)',
      border: 'none',
      borderRadius: 10,
      cursor: selected.size === 0 || phase === 'running' ? 'not-allowed' : 'pointer',
      opacity: selected.size === 0 || phase === 'running' ? 0.6 : 1,
      boxShadow: '0 0 20px rgba(99,102,241,0.35)',
      transition: 'all 0.2s ease',
      marginBottom: 32,
    },
    spinner: {
      display: 'inline-block',
      width: 16,
      height: 16,
      border: '2px solid rgba(255,255,255,0.3)',
      borderTopColor: '#fff',
      borderRadius: '50%',
      animation: 'trSpin 0.6s linear infinite',
    },

    /* running layout */
    runLayout: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 24,
      marginBottom: 32,
    },

    /* category status board */
    statusBoard: {
      backgroundColor: '#111827',
      border: '1px solid #1e293b',
      borderRadius: 12,
      padding: '20px',
      maxHeight: 500,
      overflowY: 'auto',
    },
    statusBoardTitle: {
      fontSize: 14,
      fontWeight: 600,
      color: '#e2e8f0',
      marginBottom: 14,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
    },
    statusRow: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 0',
      borderBottom: '1px solid #1e293b',
    },
    statusIcon: {
      fontSize: 18,
      width: 28,
      textAlign: 'center',
      flexShrink: 0,
    },
    statusName: {
      flex: 1,
      fontSize: 13,
      fontWeight: 500,
      color: '#e2e8f0',
    },
    statusEmoji: {
      fontSize: 16,
      flexShrink: 0,
    },
    statusSpinEmoji: {
      fontSize: 16,
      display: 'inline-block',
      animation: 'trSpin 1s linear infinite',
      flexShrink: 0,
    },
    statusStats: {
      fontSize: 12,
      color: '#94a3b8',
      whiteSpace: 'nowrap',
    },

    /* log stream */
    logPanel: {
      backgroundColor: '#0f172a',
      border: '1px solid #1e293b',
      borderRadius: 12,
      padding: '16px',
      maxHeight: 450,
      overflowY: 'auto',
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 12,
      lineHeight: 1.7,
    },
    logPanelTitle: {
      fontSize: 14,
      fontWeight: 600,
      color: '#e2e8f0',
      marginBottom: 12,
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
    },
    logLine: {
      color: '#94a3b8',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    },
    logLinePass: { color: '#10b981' },
    logLineFail: { color: '#ef4444' },
    logLineWarn: { color: '#eab308' },
    logLineHeader: { color: '#6366f1', fontWeight: 600 },

    /* results */
    resultsSection: {
      marginTop: 32,
    },
    resultHeader: (isExpanded, isHov) => ({
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '14px 16px',
      backgroundColor: isHov ? '#1e293b' : '#111827',
      border: '1px solid #1e293b',
      borderRadius: isExpanded ? '12px 12px 0 0' : 12,
      cursor: 'pointer',
      transition: 'background-color 0.15s ease',
      marginBottom: isExpanded ? 0 : 8,
    }),
    resultChevron: (isExpanded) => ({
      fontSize: 12,
      color: '#94a3b8',
      transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)',
      transition: 'transform 0.2s ease',
      flexShrink: 0,
    }),
    resultIcon: {
      fontSize: 20,
      flexShrink: 0,
    },
    resultName: {
      flex: 1,
      fontSize: 14,
      fontWeight: 600,
      color: '#e2e8f0',
    },
    resultCount: {
      fontSize: 12,
      color: '#94a3b8',
      marginLeft: 'auto',
      paddingLeft: 8,
    },
    resultBody: {
      backgroundColor: '#0f172a',
      border: '1px solid #1e293b',
      borderTop: 'none',
      borderRadius: '0 0 12px 12px',
      padding: '12px 0',
      marginBottom: 8,
      overflow: 'hidden',
    },
    resultTable: {
      width: '100%',
      borderCollapse: 'collapse',
    },
    resultTh: {
      textAlign: 'left',
      padding: '8px 16px',
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      color: '#94a3b8',
      borderBottom: '1px solid #1e293b',
    },
    resultTd: {
      padding: '8px 16px',
      fontSize: 13,
      color: '#e2e8f0',
      borderBottom: '1px solid rgba(30,41,59,0.5)',
    },
    resultDetail: {
      maxWidth: 320,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      color: '#94a3b8',
      fontSize: 12,
    },
    resultLink: {
      color: '#818cf8',
      fontSize: 12,
      textDecoration: 'none',
    },
  };

  /* ── log line coloring ── */
  const logLineStyle = (text) => {
    if (text.includes('[pass]') || text.includes('✓')) return { ...st.logLine, ...st.logLinePass };
    if (text.includes('[fail]') || text.includes('✗')) return { ...st.logLine, ...st.logLineFail };
    if (text.includes('[warn]') || text.includes('⚠')) return { ...st.logLine, ...st.logLineWarn };
    if (text.startsWith('▶') || text.startsWith('■') || text.startsWith('──')) return { ...st.logLine, ...st.logLineHeader };
    return st.logLine;
  };

  /* ── status emoji ── */
  const statusEmoji = (status) => {
    if (status === 'pending') return <span style={st.statusEmoji}>⏳</span>;
    if (status === 'running') return <span style={st.statusSpinEmoji}>🔄</span>;
    if (status === 'passed') return <span style={st.statusEmoji}>✅</span>;
    if (status === 'failed') return <span style={st.statusEmoji}>❌</span>;
    return <span style={st.statusEmoji}>⚠️</span>;
  };

  /* ── input focus handler ── */
  const handleFocus = (e) => {
    e.target.style.borderColor = '#6366f1';
  };
  const handleBlur = (e) => {
    e.target.style.borderColor = '#1e293b';
  };

  /* ───────────────────────── render ───────────────────────── */
  /* ── engine tab styles ── */
  const engineTabStyle = (active) => ({
    padding: '10px 24px',
    fontSize: 14,
    fontWeight: 600,
    color: active ? '#fff' : '#94a3b8',
    background: active ? 'linear-gradient(135deg, #6366f1, #818cf8)' : '#111827',
    border: `1.5px solid ${active ? '#6366f1' : '#1e293b'}`,
    borderRadius: 10,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    boxShadow: active ? '0 0 16px rgba(99,102,241,0.3)' : 'none',
  });

  const PLAYWRIGHT_SUITES = [
    { id: 'smoke', icon: '🔥', name: 'Smoke Tests', desc: 'Login, nav, health' },
    { id: 'dashboards', icon: '📊', name: 'Dashboard E2E', desc: 'Load, variables, time picker' },
    { id: 'panels', icon: '📱', name: 'Panel Rendering', desc: 'All panel types' },
    { id: 'alerting', icon: '🔔', name: 'Alerting E2E', desc: 'Rules, pipeline, contacts' },
    { id: 'plugins', icon: '🧩', name: 'Plugin Pages', desc: 'Catalog, config, app pages' },
    { id: 'visual', icon: '📸', name: 'Visual Regression', desc: 'Screenshot diff' },
    { id: 'performance', icon: '⚡', name: 'Performance', desc: 'Web Vitals, load time' },
    { id: 'a11y', icon: '♿', name: 'Accessibility', desc: 'WCAG audit' },
    { id: 'security', icon: '🔒', name: 'Security', desc: 'Auth, XSS, CSRF' },
    { id: 'k8s', icon: '☸️', name: 'Kubernetes E2E', desc: 'K8s dashboards, vars' },
    { id: 'upgrade', icon: '🔄', name: 'Upgrade Validation', desc: 'Pre/post diff' },
    { id: 'multi-org', icon: '🏢', name: 'Multi-Org E2E', desc: 'Org switch, isolation' },
  ];

  return (
    <div style={st.page}>
      <h1 style={st.pageTitle}>Test Runner</h1>
      <p style={st.pageSubtitle}>Select test engine, categories, and run tests.</p>

      {/* ── Engine Selector (K6 vs Playwright) ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
        <button style={engineTabStyle(engine === 'k6')} onClick={() => setEngine('k6')}>
          <span style={{ fontSize: 18 }}>⚡</span> K6 API Tests
          <span style={{ fontSize: 11, opacity: 0.7, fontWeight: 400 }}>({categories.length} categories)</span>
        </button>
        <button style={engineTabStyle(engine === 'playwright')} onClick={() => setEngine('playwright')}>
          <span style={{ fontSize: 18 }}>🎭</span> Playwright E2E
          <span style={{ fontSize: 11, opacity: 0.7, fontWeight: 400 }}>({PLAYWRIGHT_SUITES.length} suites)</span>
        </button>
      </div>

      {/* ── Playwright Mode ── */}
      {engine === 'playwright' && (
        <div style={{ marginBottom: 32 }}>
          <div style={st.sectionLabel}>Select E2E Suites</div>
          <div style={{ ...st.catGrid, gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {PLAYWRIGHT_SUITES.map((suite) => {
              const isSel = pwSelected.has(suite.id);
              return (
                <div key={suite.id} style={{
                  padding: '14px 16px',
                  backgroundColor: isSel ? 'rgba(99,102,241,0.1)' : '#111827',
                  border: `1.5px solid ${isSel ? '#6366f1' : '#1e293b'}`,
                  borderRadius: 12,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                  onClick={() => setPwSelected(prev => { const n = new Set(prev); n.has(suite.id) ? n.delete(suite.id) : n.add(suite.id); return n; })}
                  onMouseEnter={e => { if (!isSel) e.currentTarget.style.borderColor = '#374151'; }}
                  onMouseLeave={e => { if (!isSel) e.currentTarget.style.borderColor = '#1e293b'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <span style={{ fontSize: 20 }}>{suite.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', flex: 1 }}>{suite.name}</span>
                    <span style={{
                      width: 20, height: 20, borderRadius: 6,
                      border: `2px solid ${isSel ? '#6366f1' : '#374151'}`,
                      backgroundColor: isSel ? '#6366f1' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, color: '#fff',
                    }}>{isSel ? '✓' : ''}</span>
                  </div>
                  <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>{suite.desc}</p>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            <button style={st.bulkBtn} onClick={() => setPwSelected(new Set(PLAYWRIGHT_SUITES.map(s => s.id)))}>Select All</button>
            <button style={st.bulkBtn} onClick={() => setPwSelected(new Set())}>Deselect All</button>
            <span style={{ fontSize: 13, color: '#94a3b8', lineHeight: '32px', marginLeft: 8 }}>{pwSelected.size} of {PLAYWRIGHT_SUITES.length} selected</span>
          </div>

          {/* Run Button */}
          <button
            style={{ ...st.runBtn, cursor: pwSelected.size === 0 || pwPhase === 'running' ? 'not-allowed' : 'pointer', opacity: pwSelected.size === 0 || pwPhase === 'running' ? 0.6 : 1 }}
            disabled={pwSelected.size === 0 || pwPhase === 'running'}
            onClick={() => {
              setPwPhase('running');
              setPwResults(null);
              setPwLogs([]);
              const socket = getSocket();
              socket.off('pw-progress');
              socket.off('pw-complete');
              socket.on('pw-progress', (evt) => {
                if (evt.type === 'pw_suite_start') setPwLogs(p => [...p, { text: `🎭 ▶ ${evt.suiteName} starting...`, color: '#6366f1' }]);
                if (evt.type === 'pw_test_result' && evt.test) {
                  const icon = evt.test.status === 'PASS' ? '✓' : evt.test.status === 'FAIL' ? '✗' : '⚠';
                  const color = evt.test.status === 'PASS' ? '#10b981' : evt.test.status === 'FAIL' ? '#ef4444' : '#eab308';
                  setPwLogs(p => [...p, { text: `  ${icon} ${evt.test.name} (${evt.test.ms || 0}ms)`, color }]);
                }
                if (evt.type === 'pw_suite_done') setPwLogs(p => [...p, { text: `🎭 ■ ${evt.result?.name} — ${evt.result?.summary?.passed}/${evt.result?.summary?.total} passed`, color: evt.result?.status === 'PASS' ? '#10b981' : '#ef4444' }]);
              });
              socket.on('pw-complete', (data) => { setPwPhase('done'); setPwResults(data); });
              socket.emit('run-playwright', { grafanaUrl, token, suites: Array.from(pwSelected) });
            }}
          >
            {pwPhase === 'running' && <span style={st.spinner} />}
            {pwPhase === 'running' ? 'Running Playwright E2E...' : `🎭 Run ${pwSelected.size || 'All'} E2E Suites`}
          </button>

          {/* Live logs */}
          {(pwPhase === 'running' || pwPhase === 'done') && (
            <div style={{ marginTop: 24 }}>
              <div style={{ display: 'grid', gridTemplateColumns: pwResults ? '1fr 1fr' : '1fr', gap: 20 }}>
                <div>
                  <div style={st.logPanelTitle}>🎭 Playwright Live Log</div>
                  <div style={st.logPanel} ref={pwLogRef}>
                    {pwLogs.map((l, i) => <div key={i} style={{ color: l.color || '#94a3b8', whiteSpace: 'pre-wrap' }}>{l.text}</div>)}
                    {pwPhase === 'running' && <div style={{ color: '#6366f1', animation: 'trFadeIn 0.5s ease' }}>Running...</div>}
                  </div>
                </div>

                {/* Results summary */}
                {pwResults && (
                  <div>
                    <div style={st.logPanelTitle}>Results — {pwResults.summary?.pass_rate}</div>
                    <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                      <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 14, textAlign: 'center', flex: 1 }}>
                        <div style={{ fontSize: 24, fontWeight: 700, color: '#3b82f6' }}>{pwResults.summary?.total || 0}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase' }}>Total</div>
                      </div>
                      <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 14, textAlign: 'center', flex: 1 }}>
                        <div style={{ fontSize: 24, fontWeight: 700, color: '#10b981' }}>{pwResults.summary?.passed || 0}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase' }}>Passed</div>
                      </div>
                      <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 14, textAlign: 'center', flex: 1 }}>
                        <div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{pwResults.summary?.failed || 0}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase' }}>Failed</div>
                      </div>
                    </div>
                    {(pwResults.suites || []).map(s => (
                      <div key={s.id} style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: '12px 16px', marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span><span style={{ marginRight: 8 }}>{s.icon}</span><strong style={{ color: '#e2e8f0' }}>{s.name}</strong></span>
                          <StatusBadge status={s.status} size="sm" />
                        </div>
                        <div style={{ marginTop: 8 }}>
                          {(s.tests || []).map((t, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
                              <StatusBadge status={t.status} size="sm" />
                              <span style={{ color: '#e2e8f0' }}>{t.name}</span>
                              {t.ms && <span style={{ color: '#94a3b8', marginLeft: 'auto' }}>{t.ms}ms</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── K6 Mode ── */}
      {engine === 'k6' && (<>
      {/* ── Category Selector ── */}
      <div style={st.sectionLabel}>Select Categories</div>
      <div style={st.catGrid}>
        {categories.map((cat, idx) => {
          const isSel = selected.has(cat.id);
          const isHov = hoveredCat === idx;
          return (
            <div
              key={cat.id}
              style={st.catChip(isSel, isHov)}
              onClick={() => toggleCat(cat.id)}
              onMouseEnter={() => setHoveredCat(idx)}
              onMouseLeave={() => setHoveredCat(null)}
            >
              <span style={st.catChipIcon}>{cat.icon || '📦'}</span>
              <span style={st.catChipName}>{cat.name}</span>
              <span style={st.catChipCheck(isSel)}>
                {isSel ? '✓' : ''}
              </span>
            </div>
          );
        })}
      </div>
      <div style={st.bulkBtnRow}>
        <button style={st.bulkBtn} onClick={selectAll}>Select All</button>
        <button style={st.bulkBtn} onClick={deselectAll}>Deselect All</button>
        <span style={{ fontSize: 13, color: '#94a3b8', lineHeight: '32px', marginLeft: 8 }}>
          {selected.size} of {categories.length} selected
        </span>
      </div>

      {/* ── Grafana Config ── */}
      <div style={st.sectionLabel}>Grafana Connection</div>
      <div style={st.inputRow}>
        <div style={st.inputGroup}>
          <label style={st.inputLabel}>Grafana URL</label>
          <input
            type="text"
            placeholder="https://your-grafana.example.com"
            value={grafanaUrl}
            onChange={(e) => setGrafanaUrl(e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            style={st.input}
          />
        </div>
        <div style={st.inputGroup}>
          <label style={st.inputLabel}>API Token</label>
          <input
            type="password"
            placeholder="glsa_..."
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            style={st.input}
          />
        </div>
      </div>

      {/* ── Run Button ── */}
      <button
        style={st.runBtn}
        onClick={handleRun}
        disabled={selected.size === 0 || phase === 'running'}
      >
        {phase === 'running' && <span style={st.spinner} />}
        {phase === 'running' ? 'Running Tests...' : 'Run Tests'}
      </button>

      {/* ── Running / Done View ── */}
      {(phase === 'running' || phase === 'done') && (
        <>
          <div style={st.runLayout}>
            {/* Left: Category Status Board */}
            <div style={st.statusBoard}>
              <div style={st.statusBoardTitle}>Category Status</div>
              {Array.from(selected).map((catId) => {
                const cat = catMap[catId] || {};
                const cs = catStatuses[catId] || { status: 'pending', total: 0, passed: 0, failed: 0 };
                return (
                  <div key={catId} style={st.statusRow}>
                    <span style={st.statusIcon}>{cat.icon || '📦'}</span>
                    <span style={st.statusName}>{cat.name || catId}</span>
                    {statusEmoji(cs.status)}
                    {cs.total > 0 && (
                      <span style={st.statusStats}>
                        {cs.total} tests &middot;{' '}
                        <span style={{ color: '#10b981' }}>{cs.passed}</span>
                        /
                        <span style={{ color: '#ef4444' }}>{cs.failed}</span>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Right: Live Log Stream */}
            <div>
              <div style={st.logPanelTitle}>Live Log</div>
              <div style={st.logPanel} ref={logRef}>
                {logs.map((log, i) => (
                  <div key={i} style={logLineStyle(log.text)}>
                    {log.text}
                  </div>
                ))}
                {logs.length === 0 && (
                  <div style={{ color: '#475569' }}>Waiting for events...</div>
                )}
              </div>
            </div>
          </div>

          {/* ── Expandable Results (after done) ── */}
          {phase === 'done' && (
            <div style={st.resultsSection}>
              <div style={{ ...st.sectionLabel, marginBottom: 16 }}>Results</div>
              {Array.from(selected).map((catId, idx) => {
                const cat = catMap[catId] || {};
                const cs = catStatuses[catId] || { status: 'pending', total: 0, passed: 0, failed: 0, tests: [] };
                const isExp = expanded.has(catId);
                const isHov = hoveredResult === idx;

                return (
                  <div key={catId}>
                    <div
                      style={st.resultHeader(isExp, isHov)}
                      onClick={() => toggleExpanded(catId)}
                      onMouseEnter={() => setHoveredResult(idx)}
                      onMouseLeave={() => setHoveredResult(null)}
                    >
                      <span style={st.resultChevron(isExp)}>▶</span>
                      <span style={st.resultIcon}>{cat.icon || '📦'}</span>
                      <span style={st.resultName}>{cat.name || catId}</span>
                      <StatusBadge status={cs.status === 'passed' ? 'PASS' : cs.status === 'failed' ? 'FAIL' : cs.status} size="sm" />
                      <span style={st.resultCount}>
                        {cs.passed}/{cs.total} passed
                      </span>
                    </div>

                    {isExp && cs.tests && cs.tests.length > 0 && (
                      <div style={st.resultBody}>
                        <table style={st.resultTable}>
                          <thead>
                            <tr>
                              <th style={st.resultTh}>Status</th>
                              <th style={st.resultTh}>Test Name</th>
                              <th style={st.resultTh}>Detail</th>
                              <th style={st.resultTh}>Latency</th>
                              <th style={st.resultTh}>Link</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cs.tests.map((t, ti) => {
                              const testStatus = t.status === 'PASS' ? 'passed' : t.status === 'FAIL' ? 'failed' : 'warning';
                              const uid = t.uid || t.dashboardUid || '';
                              const linkUrl = uid && grafanaUrl
                                ? `${grafanaUrl.replace(/\/+$/, '')}/d/${uid}`
                                : null;
                              return (
                                <tr key={ti}>
                                  <td style={st.resultTd}>
                                    <StatusBadge status={testStatus} size="sm" />
                                  </td>
                                  <td style={st.resultTd}>
                                    {t.name || t.testName || '—'}
                                  </td>
                                  <td style={st.resultTd}>
                                    <div style={st.resultDetail} title={t.detail || t.message || ''}>
                                      {t.detail || t.message || '—'}
                                    </div>
                                  </td>
                                  <td style={{ ...st.resultTd, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                                    {t.ms || t.latency || 0}ms
                                  </td>
                                  <td style={st.resultTd}>
                                    {linkUrl ? (
                                      <a href={linkUrl} target="_blank" rel="noopener noreferrer" style={st.resultLink}>
                                        Open
                                      </a>
                                    ) : (
                                      <span style={{ color: '#475569', fontSize: 12 }}>—</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {isExp && (!cs.tests || cs.tests.length === 0) && (
                      <div style={{ ...st.resultBody, padding: '20px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                        No test results available for this category.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      </>)}
    </div>
  );
}
