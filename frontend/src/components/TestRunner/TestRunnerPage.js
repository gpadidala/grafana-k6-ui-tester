import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../../services/api';
import { getSocket } from '../../services/socket';
import StatusBadge from '../Common/StatusBadge';
import { useActiveEnv } from '../../context/AppContext';

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

/* ───────────────────────── component ───────────────────────── */
export default function TestRunnerPage() {
  /* ── active env (sourced from Settings via AppContext) ── */
  const { grafanaUrl, token, label: envLabel, color: envColor, isConfigured: envConfigured, env: activeEnv } = useActiveEnv();

  /* ── preselect category from navigation state (e.g. Dashboard "Run" button) ── */
  const location = useLocation();
  const preselectCategory = location.state?.preselectCategory || null;

  /* ── state ── */
  const [engine, setEngine] = useState('k6'); // 'k6' | 'playwright' | 'jmeter'
  const [categories, setCategories] = useState([]);
  const [selected, setSelected] = useState(new Set());

  // JMeter state
  const [jmPlans] = useState([
    { id: 'api-health-load', name: 'API Health Load', icon: '💚', group: 'core', desc: 'Health endpoints under load' },
    { id: 'auth-stress', name: 'Auth Stress', icon: '🔐', group: 'core', desc: 'Login throughput' },
    { id: 'dashboard-load', name: 'Dashboard Load', icon: '📊', group: 'core', desc: 'Concurrent dashboard viewing' },
    { id: 'ds-query-stress', name: 'DS Query Stress', icon: '🗄', group: 'core', desc: 'Query execution per DS type' },
    { id: 'alert-eval', name: 'Alert Eval', icon: '🔔', group: 'core', desc: 'Alert pipeline performance' },
    { id: 'plugin-api', name: 'Plugin API', icon: '🧩', group: 'core', desc: 'Plugin endpoints' },
    { id: 'search-perf', name: 'Search Perf', icon: '🔍', group: 'core', desc: 'Search throughput' },
    { id: 'mixed-workload', name: 'Mixed Workload', icon: '🌐', group: 'scenario', desc: 'Realistic simulation' },
    { id: 'spike-test', name: 'Spike Test', icon: '⚡', group: 'scenario', desc: '20x traffic burst' },
    { id: 'capacity-planning', name: 'Capacity Planning', icon: '📈', group: 'scenario', desc: 'Find breaking point' },
    { id: 'deployment-check', name: 'Deployment Check', icon: '🚀', group: 'scenario', desc: 'Quick CI/CD validation' },
    { id: 'k8s-dashboard', name: 'K8s Load', icon: '☸️', group: 'scenario', desc: 'K8s monitoring stress' },
  ]);
  const [jmSelected, setJmSelected] = useState(new Set());
  const [jmThreads, setJmThreads] = useState(20);
  const [jmDuration, setJmDuration] = useState(30);
  const [jmPhase, setJmPhase] = useState('config');
  const [jmLogs, setJmLogs] = useState([]);
  const [jmResults, setJmResults] = useState(null);
  const jmLogRef = useRef(null);

  // Playwright state
  const [pwSelected, setPwSelected] = useState(new Set());
  const [pwPhase, setPwPhase] = useState('config');
  const [pwLogs, setPwLogs] = useState([]);
  const [pwResults, setPwResults] = useState(null);
  const pwLogRef = useRef(null);
  const [phase, setPhase] = useState('config'); // config | running | done
  const [catStatuses, setCatStatuses] = useState({}); // { catId: { status, total, passed, failed, tests:[] } }
  const [logs, setLogs] = useState([]);
  const [results, setResults] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [hoveredCat, setHoveredCat] = useState(null);
  const [hoveredResult, setHoveredResult] = useState(null);
  const logRef = useRef(null);

  /* ── Datasource scope (optional) — filters dashboards/panels/alerts
     to only those using the selected datasource. Applies to all three
     engines (K6 / Playwright / JMeter). ── */
  const [datasources, setDatasources] = useState([]);
  const [datasourceUid, setDatasourceUid] = useState('');
  const [dsImpact, setDsImpact] = useState(null);
  const [dsLoading, setDsLoading] = useState(false);

  useEffect(() => { injectKF(); }, []);

  // Load datasources when env changes
  useEffect(() => {
    if (!envConfigured) { setDatasources([]); return; }
    setDsLoading(true);
    api.listDatasources(grafanaUrl, token)
      .then((list) => { setDatasources(Array.isArray(list) ? list : []); })
      .catch(() => setDatasources([]))
      .finally(() => setDsLoading(false));
    // Clear any previous selection/impact when env changes
    setDatasourceUid('');
    setDsImpact(null);
  }, [grafanaUrl, token, envConfigured]);

  // When the user picks a DS, show the blast-radius preview
  useEffect(() => {
    if (!datasourceUid || !envConfigured) { setDsImpact(null); return; }
    let cancelled = false;
    api.getDatasourceImpact(datasourceUid, grafanaUrl, token)
      .then((r) => { if (!cancelled) setDsImpact(r); })
      .catch(() => { if (!cancelled) setDsImpact(null); });
    return () => { cancelled = true; };
  }, [datasourceUid, grafanaUrl, token, envConfigured]);

  // Helper to build the datasourceFilter payload to send to the backend
  const datasourceFilter = (() => {
    if (!datasourceUid) return null;
    const ds = datasources.find((d) => d.uid === datasourceUid);
    return ds ? { uid: ds.uid, name: ds.name } : null;
  })();

  /* load categories */
  useEffect(() => {
    (async () => {
      try {
        const cats = await api.getCategories();
        if (Array.isArray(cats)) {
          setCategories(cats);
          // If navigated here with a preselect hint (e.g. from Dashboard
          // page "Run" button), select only that category. Otherwise
          // default to selecting everything.
          if (preselectCategory && cats.some((c) => c.id === preselectCategory)) {
            setSelected(new Set([preselectCategory]));
          } else {
            setSelected(new Set(cats.map((c) => c.id)));
          }
        }
      } catch (e) {
        console.error('Failed to load categories:', e);
      }
    })();
  }, [preselectCategory]);

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
    if (!envConfigured) {
      alert('No environment selected. Pick a target env in the sidebar (or configure one in Settings).');
      return;
    }
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

    /* emit run command — WS gives live progress; no REST duplicate */
    socket.emit('run-tests', {
      grafanaUrl,
      token,
      envKey: activeEnv?.key || null,
      categories: Array.from(selected),
      datasourceFilter,
    });
  }, [selected, grafanaUrl, token, activeEnv, envConfigured, addLog, phase, datasourceFilter]);

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
    <div style={st.page} data-tour="run-tests-page">
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
        <button style={engineTabStyle(engine === 'jmeter')} onClick={() => setEngine('jmeter')}>
          <span style={{ fontSize: 18 }}>🔥</span> JMeter Performance
          <span style={{ fontSize: 11, opacity: 0.7, fontWeight: 400 }}>({jmPlans.length} plans)</span>
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
            style={{ ...st.runBtn, cursor: (pwSelected.size === 0 || pwPhase === 'running' || !envConfigured) ? 'not-allowed' : 'pointer', opacity: (pwSelected.size === 0 || pwPhase === 'running' || !envConfigured) ? 0.6 : 1 }}
            disabled={pwSelected.size === 0 || pwPhase === 'running' || !envConfigured}
            onClick={() => {
              if (!envConfigured) { alert('No environment selected.'); return; }
              setPwPhase('running');
              setPwResults(null);
              setPwLogs([]);
              const socket = getSocket();
              socket.off('pw-progress');
              socket.off('pw-complete');
              socket.on('pw-progress', (evt) => {
                if (evt.type === 'pw_suite_start') setPwLogs(p => [...p, { text: `🎭 ▶ ${evt.suiteName} starting...`, color: '#6366f1' }]);
                if (evt.type === 'pw_test_result' && evt.test) {
                  const t = evt.test;
                  const icon = t.status === 'PASS' ? '✓' : t.status === 'FAIL' ? '✗' : '⚠';
                  const color = t.status === 'PASS' ? '#10b981' : t.status === 'FAIL' ? '#ef4444' : '#eab308';
                  const isIssue = t.status === 'FAIL' || t.status === 'WARN';
                  setPwLogs(p => {
                    const lines = [{ text: `  ${icon} ${t.name} (${t.ms || 0}ms)`, color }];
                    if (isIssue && t.detail) lines.push({ text: `     ↳ ${t.detail}`, color: '#94a3b8' });
                    if (isIssue && t.url) lines.push({ text: `     ↳ ${t.url}`, color: '#64748b' });
                    return [...p, ...lines];
                  });
                }
                if (evt.type === 'pw_suite_done') setPwLogs(p => [...p, { text: `🎭 ■ ${evt.result?.name} — ${evt.result?.summary?.passed}/${evt.result?.summary?.total} passed`, color: evt.result?.status === 'PASS' ? '#10b981' : '#ef4444' }]);
              });
              socket.on('pw-complete', (data) => { setPwPhase('done'); setPwResults(data); });
              socket.emit('run-playwright', { grafanaUrl, token, suites: Array.from(pwSelected), datasourceFilter });
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
                          {(s.tests || []).map((t, i) => {
                            const isIssue = t.status === 'FAIL' || t.status === 'WARN';
                            const liveUrl = t.url || grafanaUrl || null;
                            const isInfoRow = t.metadata && t.metadata.infoRow;
                            const shotPath = t.metadata && t.metadata.screenshot;
                            // Special render for "Dashboard info" header rows
                            if (isInfoRow) {
                              const md = t.metadata || {};
                              const fmtD = (iso) => {
                                if (!iso || String(iso).startsWith('0001')) return 'unknown';
                                try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
                                catch { return iso; }
                              };
                              const titleMatch = (t.name || '').match(/^\[(.+)\]\s+Dashboard info$/);
                              const dashTitle = titleMatch ? titleMatch[1] : t.name;
                              return (
                                <div key={i} style={{
                                  padding: '12px 14px', marginTop: 8, marginBottom: 4, borderRadius: 8,
                                  background: 'rgba(99, 102, 241, 0.08)',
                                  border: '1px solid rgba(99, 102, 241, 0.25)',
                                }}>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: '#a5b4fc', marginBottom: 6 }}>
                                    📊 {dashTitle}
                                    {md.folderTitle && <span style={{ marginLeft: 8, fontSize: 10, color: '#64748b', fontWeight: 400 }}>in {md.folderTitle}</span>}
                                  </div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 11, color: '#94a3b8' }}>
                                    <span>👤 <strong style={{ color: '#cbd5e1' }}>{md.createdBy || 'unknown'}</strong> · {fmtD(md.created)}</span>
                                    <span>✏️ <strong style={{ color: '#cbd5e1' }}>{md.updatedBy || 'unknown'}</strong> · {fmtD(md.updated)}</span>
                                    <span>🔢 v{md.version || 0}</span>
                                    <span title="View count requires Grafana Enterprise or usage stats">👁 {md.viewCount != null ? md.viewCount : '—'}</span>
                                  </div>
                                </div>
                              );
                            }
                            return (
                              <div key={i} style={{
                                padding: '6px 8px', fontSize: 12, borderRadius: 6, marginBottom: 2,
                                background: isIssue ? (t.status === 'FAIL' ? 'rgba(239,68,68,0.06)' : 'rgba(234,179,8,0.06)') : 'transparent',
                                borderLeft: isIssue ? `2px solid ${t.status === 'FAIL' ? '#ef4444' : '#eab308'}` : '2px solid transparent',
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <StatusBadge status={t.status} size="sm" />
                                  <span style={{ color: '#e2e8f0', flex: 1 }}>{t.name}</span>
                                  {t.spec && (
                                    <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'ui-monospace, Menlo, monospace' }}>
                                      {t.spec}
                                    </span>
                                  )}
                                  {liveUrl && isIssue && (
                                    <a href={liveUrl} target="_blank" rel="noopener noreferrer"
                                      style={{ fontSize: 11, color: '#818cf8', textDecoration: 'none', fontWeight: 500 }}
                                      title={`Open in Grafana: ${liveUrl}`}>
                                      Open ↗
                                    </a>
                                  )}
                                  {t.ms != null && <span style={{ color: '#94a3b8', fontSize: 11 }}>{t.ms}ms</span>}
                                </div>
                                {isIssue && t.detail && (
                                  <div style={{
                                    marginTop: 4, marginLeft: 28, fontSize: 11,
                                    color: t.status === 'FAIL' ? '#fca5a5' : '#fde68a',
                                    lineHeight: 1.5, wordBreak: 'break-word',
                                  }}>
                                    {t.detail}
                                  </div>
                                )}
                                {isIssue && t.error && t.error !== t.detail && (
                                  <pre style={{
                                    marginTop: 4, marginLeft: 28, marginBottom: 0,
                                    padding: '6px 10px', borderRadius: 6,
                                    background: '#030712', border: '1px solid #1e293b',
                                    fontSize: 10, lineHeight: 1.4,
                                    color: '#94a3b8', fontFamily: 'ui-monospace, Menlo, monospace',
                                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                    maxHeight: 140, overflow: 'auto',
                                  }}>
                                    {t.error}
                                  </pre>
                                )}
                                {isIssue && liveUrl && (
                                  <div style={{
                                    marginTop: 3, marginLeft: 28, fontSize: 10,
                                    color: '#64748b', fontFamily: 'ui-monospace, Menlo, monospace',
                                    wordBreak: 'break-all',
                                  }}>
                                    at {liveUrl}
                                  </div>
                                )}
                                {shotPath && (
                                  <div style={{ marginTop: 6, marginLeft: 28 }}>
                                    <a href={`http://localhost:4000/api/test-screenshots/${shotPath}`}
                                      target="_blank" rel="noopener noreferrer"
                                      title="Click for full-size screenshot">
                                      <img
                                        src={`http://localhost:4000/api/test-screenshots/${shotPath}`}
                                        alt="Panel screenshot"
                                        style={{
                                          maxWidth: 240, maxHeight: 140,
                                          border: '1px solid #334155', borderRadius: 6,
                                          display: 'block',
                                        }}
                                        loading="lazy"
                                      />
                                    </a>
                                  </div>
                                )}
                              </div>
                            );
                          })}
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

      {/* ── JMeter Mode ── */}
      {engine === 'jmeter' && (
        <div style={{ marginBottom: 32 }}>
          <div style={st.sectionLabel}>Select Performance Test Plans</div>
          <div style={{ ...st.catGrid, gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {jmPlans.map(plan => {
              const isSel = jmSelected.has(plan.id);
              return (
                <div key={plan.id} style={{
                  padding: '14px 16px', backgroundColor: isSel ? 'rgba(249,115,22,0.1)' : '#111827',
                  border: `1.5px solid ${isSel ? '#f97316' : '#1e293b'}`, borderRadius: 12, cursor: 'pointer', transition: 'all 0.15s ease',
                }} onClick={() => setJmSelected(prev => { const n = new Set(prev); n.has(plan.id) ? n.delete(plan.id) : n.add(plan.id); return n; })}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <span style={{ fontSize: 20 }}>{plan.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', flex: 1 }}>{plan.name}</span>
                    <span style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${isSel ? '#f97316' : '#374151'}`, backgroundColor: isSel ? '#f97316' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#fff' }}>{isSel ? '✓' : ''}</span>
                  </div>
                  <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>{plan.desc}</p>
                  <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase' }}>{plan.group}</span>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center' }}>
            <button style={st.bulkBtn} onClick={() => setJmSelected(new Set(jmPlans.map(p => p.id)))}>Select All</button>
            <button style={st.bulkBtn} onClick={() => setJmSelected(new Set())}>Deselect All</button>
            <span style={{ fontSize: 13, color: '#94a3b8', marginLeft: 8 }}>{jmSelected.size}/{jmPlans.length}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: '#94a3b8' }}>Threads:</label>
              <input type="number" value={jmThreads} onChange={e => setJmThreads(Number(e.target.value))} style={{ ...st.input, width: 80, padding: '6px 10px' }} />
              <label style={{ fontSize: 12, color: '#94a3b8' }}>Duration (s):</label>
              <input type="number" value={jmDuration} onChange={e => setJmDuration(Number(e.target.value))} style={{ ...st.input, width: 80, padding: '6px 10px' }} />
            </div>
          </div>

          <button style={{ ...st.runBtn, background: 'linear-gradient(135deg, #f97316, #ef4444)', boxShadow: '0 0 20px rgba(249,115,22,0.35)', cursor: (jmSelected.size === 0 || jmPhase === 'running' || !envConfigured) ? 'not-allowed' : 'pointer', opacity: (jmSelected.size === 0 || jmPhase === 'running' || !envConfigured) ? 0.6 : 1 }}
            disabled={jmSelected.size === 0 || jmPhase === 'running' || !envConfigured}
            onClick={() => {
              if (!envConfigured) { alert('No environment selected.'); return; }
              setJmPhase('running'); setJmResults(null); setJmLogs([]);
              const socket = getSocket();
              socket.off('jm-progress'); socket.off('jm-complete');
              socket.on('jm-progress', evt => {
                if (evt.type === 'jm_plan_start') setJmLogs(p => [...p, { text: `🔥 ▶ ${evt.planName} starting...`, color: '#f97316' }]);
                if (evt.type === 'jm_sample') setJmLogs(p => [...p, { text: `  ${evt.success ? '✓' : '✗'} ${evt.label} ${evt.ms}ms [${evt.status}]`, color: evt.success ? '#10b981' : '#ef4444' }]);
                if (evt.type === 'jm_plan_done') setJmLogs(p => [...p, { text: `🔥 ■ ${evt.planId} — ${evt.result?.summary?.total || 0} samples, ${evt.result?.summary?.avgMs || 0}ms avg, ${evt.result?.summary?.errorRate}`, color: evt.result?.status === 'PASS' ? '#10b981' : '#ef4444' }]);
              });
              socket.on('jm-complete', data => { setJmPhase('done'); setJmResults(data); });
              socket.emit('run-jmeter', { grafanaUrl, token, plans: Array.from(jmSelected), threads: jmThreads, duration: jmDuration, datasourceFilter });
            }}>
            {jmPhase === 'running' && <span style={st.spinner} />}
            {jmPhase === 'running' ? 'Running Performance Tests...' : `🔥 Run ${jmSelected.size || 'All'} Performance Plans`}
          </button>

          {/* Live + Results */}
          {(jmPhase === 'running' || jmPhase === 'done') && (
            <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: jmResults ? '1fr 1fr' : '1fr', gap: 20 }}>
              <div>
                <div style={st.logPanelTitle}>🔥 JMeter Live Log</div>
                <div style={st.logPanel} ref={jmLogRef}>
                  {jmLogs.map((l, i) => <div key={i} style={{ color: l.color || '#94a3b8', whiteSpace: 'pre-wrap' }}>{l.text}</div>)}
                  {jmPhase === 'running' && <div style={{ color: '#f97316', animation: 'trFadeIn 0.5s ease' }}>Running...</div>}
                </div>
              </div>
              {jmResults && (
                <div>
                  <div style={st.logPanelTitle}>Performance Summary — {jmResults.summary?.errorRate} error rate</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
                    {[
                      { label: 'Avg RT', value: `${jmResults.summary?.avgResponseTime || 0}ms`, color: '#3b82f6' },
                      { label: 'p95', value: `${jmResults.summary?.p95 || 0}ms`, color: '#eab308' },
                      { label: 'p99', value: `${jmResults.summary?.p99 || 0}ms`, color: '#ef4444' },
                      { label: 'Throughput', value: jmResults.summary?.throughput || '0', color: '#10b981' },
                      { label: 'Total Reqs', value: jmResults.summary?.totalRequests || 0, color: '#818cf8' },
                      { label: 'Error Rate', value: jmResults.summary?.errorRate || '0%', color: '#ef4444' },
                    ].map((m, i) => (
                      <div key={i} style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 12, textAlign: 'center' }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: m.color }}>{m.value}</div>
                        <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase' }}>{m.label}</div>
                      </div>
                    ))}
                  </div>
                  {(jmResults.plans || []).map(plan => (
                    <div key={plan.id} style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: '10px 14px', marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span><span style={{ marginRight: 6 }}>{plan.icon}</span><strong style={{ color: '#e2e8f0', fontSize: 13 }}>{plan.name}</strong></span>
                        <StatusBadge status={plan.status} size="sm" />
                      </div>
                      {plan.summary && (
                        <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11, color: '#94a3b8' }}>
                          <span>{plan.summary.total} samples</span>
                          <span>avg {plan.summary.avgMs}ms</span>
                          <span>p95 {plan.summary.p95}ms</span>
                          <span style={{ color: '#10b981' }}>{plan.summary.throughput}</span>
                          <span style={{ color: parseFloat(plan.summary.errorRate) > 1 ? '#ef4444' : '#94a3b8' }}>{plan.summary.errorRate} errors</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
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

      {/* ── Target Env (driven by sidebar selector) ── */}
      <div style={st.sectionLabel}>Target Environment</div>
      {envConfigured ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 16px', borderRadius: 8,
          background: '#0f172a', border: `1.5px solid ${envColor}`,
          marginBottom: 16,
        }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: envColor }} />
          <span style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>{envLabel}</span>
          <span style={{ fontSize: 13, color: '#94a3b8' }}>{grafanaUrl}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b' }}>
            {token ? '🔑 token set' : '⚠ no token'}
          </span>
        </div>
      ) : (
        <div style={{
          padding: '14px 16px', borderRadius: 8, marginBottom: 16,
          background: 'rgba(234, 179, 8, 0.1)',
          border: '1.5px solid rgba(234, 179, 8, 0.4)',
          color: '#fbbf24', fontSize: 13, lineHeight: 1.5,
        }}>
          <strong>No environment selected.</strong> Pick a target env in the sidebar, or go to <strong>Settings</strong> to configure DEV/PERF/PROD URLs and tokens first.
        </div>
      )}

      {/* ── Scope by Datasource (optional) ── */}
      {envConfigured && (
        <div style={{ marginBottom: 16 }} data-tour="ds-scope">
          <div style={st.sectionLabel}>Scope by Datasource (optional)</div>
          <div style={{
            padding: '12px 16px', borderRadius: 8,
            background: '#0f172a',
            border: `1.5px solid ${datasourceUid ? '#6366f1' : '#1e293b'}`,
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>🗄</span>
              <select
                value={datasourceUid}
                onChange={(e) => setDatasourceUid(e.target.value)}
                disabled={dsLoading}
                style={{
                  flex: 1, padding: '8px 12px', borderRadius: 6,
                  background: '#030712', border: '1px solid #1e293b', color: '#e2e8f0',
                  fontSize: 13, fontFamily: 'inherit',
                }}
              >
                <option value="">— All resources (no filter) —</option>
                {datasources.map((d) => (
                  <option key={d.uid} value={d.uid}>
                    {d.name} ({d.type}){d.isDefault ? ' · default' : ''}
                  </option>
                ))}
              </select>
              {datasourceUid && (
                <button
                  onClick={() => setDatasourceUid('')}
                  style={{
                    background: 'none', border: '1px solid #334155',
                    color: '#94a3b8', borderRadius: 6, padding: '6px 10px',
                    fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  Clear
                </button>
              )}
            </div>
            {dsLoading && (
              <div style={{ fontSize: 11, color: '#64748b' }}>Loading datasources...</div>
            )}
            {!dsLoading && datasources.length === 0 && (
              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                No datasources found — verify env credentials in Settings.
              </div>
            )}
            {datasourceUid && dsImpact && (
              <div style={{
                padding: '10px 12px', borderRadius: 6,
                background: 'rgba(99, 102, 241, 0.08)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                fontSize: 12, color: '#cbd5e1', lineHeight: 1.5,
              }}>
                <strong style={{ color: '#a5b4fc' }}>Blast radius:</strong>{' '}
                {dsImpact.summary?.dashboardCount || 0} dashboard(s),{' '}
                {dsImpact.summary?.alertCount || 0} alert rule(s) use this datasource.
                Tests will be scoped to these resources only.
              </div>
            )}
            {datasourceUid && !dsImpact && (
              <div style={{ fontSize: 11, color: '#64748b' }}>Computing blast radius...</div>
            )}
          </div>
        </div>
      )}

      {/* ── Run Button ── */}
      <button
        style={{ ...st.runBtn, opacity: (!envConfigured || selected.size === 0) ? 0.5 : 1 }}
        onClick={handleRun}
        disabled={selected.size === 0 || phase === 'running' || !envConfigured}
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
