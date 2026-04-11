import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import StatusBadge from '../Common/StatusBadge';

/* ───────────────────────── helpers ───────────────────────── */
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function pct(n, total) {
  if (!total) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

/* ───────────────────────── keyframes + hover CSS (injected once) ───────────────────────── */
const KEYFRAMES = `
@keyframes dashSpin { to { transform: rotate(360deg); } }
@keyframes dashLift {
  0% { transform: translateY(0); box-shadow: 0 0 0 rgba(0,0,0,0); }
  100% { transform: translateY(-4px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
}
/* CSS hover — replaces JS state to avoid stuck-hover bugs */
.gp-stat-card { transition: transform 0.2s ease, box-shadow 0.2s ease; }
.gp-stat-card:hover { transform: translateY(-4px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
.gp-cat-card { transition: border-color 0.2s ease, box-shadow 0.2s ease; }
.gp-cat-card:hover { border-color: #6366f1 !important; box-shadow: 0 4px 16px rgba(99,102,241,0.15); }
.gp-table-row { transition: background-color 0.15s ease; }
.gp-table-row:hover { background-color: rgba(99,102,241,0.06); }
.gp-cat-run-btn { transition: all 0.15s ease; }
.gp-cat-run-btn:hover { background-color: rgba(99,102,241,0.2); border-color: #6366f1; }
`;
let kfInjected = false;
function injectKF() {
  if (kfInjected || typeof document === 'undefined') return;
  const s = document.createElement('style');
  s.textContent = KEYFRAMES;
  document.head.appendChild(s);
  kfInjected = true;
}

/* ───────────────────────── component ───────────────────────── */
export default function DashboardPage() {
  const navigate = useNavigate();
  const { userName } = useApp();

  const [reports, setReports] = useState([]);
  const [categories, setCategories] = useState([]);
  const [running, setRunning] = useState(false);
  // hover handled via CSS classes — no JS state needed

  useEffect(() => { injectKF(); }, []);

  /* fetch data */
  const fetchData = useCallback(async () => {
    try {
      const [reps, cats] = await Promise.all([api.getReports(), api.getCategories()]);
      setReports(Array.isArray(reps) ? reps : []);
      setCategories(Array.isArray(cats) ? cats : []);
    } catch (e) {
      console.error('Dashboard fetch error:', e);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* compute stats from latest run */
  const latest = reports[0] || {};
  const latestSummary = latest.summary || {};
  const totalTests = latestSummary.total || 0;
  const passedTests = latestSummary.passed || 0;
  const failedTests = latestSummary.failed || 0;
  const passRate = totalTests ? Math.round((passedTests / totalTests) * 100) : 0;
  const avgLatency = latestSummary.avgLatency || latestSummary.avg_latency || 0;
  const catCount = categories.length || 0;

  const statsData = [
    { icon: '🎯', value: `${passRate}%`, label: 'Pass Rate', color: passRate >= 80 ? '#10b981' : passRate >= 50 ? '#eab308' : '#ef4444' },
    { icon: '✅', value: passedTests, label: 'Passed', color: '#10b981' },
    { icon: '❌', value: failedTests, label: 'Failed', color: '#ef4444' },
    { icon: '📊', value: totalTests, label: 'Total Tests', color: '#6366f1' },
    { icon: '📁', value: catCount, label: 'Categories', color: '#a78bfa' },
    { icon: '⚡', value: avgLatency ? `${Math.round(avgLatency)}ms` : '—', label: 'Avg Latency', color: '#eab308' },
  ];

  /* run all */
  const handleRunAll = async () => {
    setRunning(true);
    try {
      const grafanaUrl = localStorage.getItem('grafanaprobe_grafanaUrl') || '';
      const token = localStorage.getItem('grafanaprobe_token') || '';
      const catIds = categories.map((c) => c.id);
      await api.runTests({ grafanaUrl, token, categories: catIds });
      await fetchData();
    } catch (e) {
      console.error('Run all error:', e);
    } finally {
      setRunning(false);
    }
  };

  /* recent runs (last 5) */
  const recentRuns = reports.slice(0, 5);

  /* ─── styles ─── */
  const s = {
    page: {
      padding: '8px 8px',
      minHeight: '100vh',
      backgroundColor: '#030712',
    },

    /* hero */
    heroRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 32,
    },
    greeting: {
      fontSize: 28,
      fontWeight: 700,
      color: '#e2e8f0',
      letterSpacing: '-0.5px',
    },
    wave: {
      display: 'inline-block',
      marginLeft: 8,
      fontSize: 28,
    },
    runAllBtn: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '12px 28px',
      fontSize: 15,
      fontWeight: 600,
      color: '#ffffff',
      background: 'linear-gradient(135deg, #6366f1, #818cf8)',
      border: 'none',
      borderRadius: 10,
      cursor: running ? 'not-allowed' : 'pointer',
      opacity: running ? 0.7 : 1,
      boxShadow: '0 0 20px rgba(99,102,241,0.35)',
      transition: 'all 0.2s ease',
    },
    spinner: {
      display: 'inline-block',
      width: 16,
      height: 16,
      border: '2px solid rgba(255,255,255,0.3)',
      borderTopColor: '#fff',
      borderRadius: '50%',
      animation: 'dashSpin 0.6s linear infinite',
    },

    /* stats grid */
    statsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(6, 1fr)',
      gap: 16,
      marginBottom: 40,
    },
    statCard: {
      backgroundColor: '#111827',
      border: '1px solid #1e293b',
      borderRadius: 12,
      padding: '20px 16px',
      textAlign: 'center',
      transition: 'all 0.2s ease',
      cursor: 'default',
    },
    statCardHover: {
      transform: 'translateY(-4px)',
      boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
    },
    statIcon: {
      fontSize: 24,
      marginBottom: 8,
      display: 'block',
    },
    statValue: {
      fontSize: 28,
      fontWeight: 700,
      lineHeight: 1.2,
    },
    statLabel: {
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.8px',
      color: '#94a3b8',
      marginTop: 4,
    },

    /* section header */
    sectionHeader: {
      fontSize: 18,
      fontWeight: 600,
      color: '#e2e8f0',
      marginBottom: 16,
    },

    /* category grid */
    catGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 1fr)',
      gap: 12,
      marginBottom: 40,
    },
    catCard: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      backgroundColor: '#111827',
      border: '1px solid #1e293b',
      borderRadius: 12,
      padding: '14px 16px',
      transition: 'all 0.2s ease',
      cursor: 'default',
    },
    catCardHover: {
      borderColor: '#6366f1',
      boxShadow: '0 4px 16px rgba(99,102,241,0.15)',
    },
    catIcon: {
      fontSize: 22,
      width: 32,
      textAlign: 'center',
      flexShrink: 0,
    },
    catName: {
      flex: 1,
      fontSize: 14,
      fontWeight: 500,
      color: '#e2e8f0',
    },
    catRunBtn: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '6px 14px',
      fontSize: 12,
      fontWeight: 600,
      color: '#6366f1',
      backgroundColor: 'rgba(99,102,241,0.1)',
      border: '1px solid rgba(99,102,241,0.25)',
      borderRadius: 8,
      cursor: 'pointer',
      transition: 'all 0.15s ease',
      whiteSpace: 'nowrap',
    },

    /* recent runs table */
    tableWrap: {
      backgroundColor: '#111827',
      border: '1px solid #1e293b',
      borderRadius: 12,
      overflow: 'hidden',
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse',
    },
    th: {
      textAlign: 'left',
      padding: '12px 16px',
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.8px',
      color: '#94a3b8',
      backgroundColor: '#0f172a',
      borderBottom: '1px solid #1e293b',
    },
    td: {
      padding: '12px 16px',
      fontSize: 14,
      color: '#e2e8f0',
      borderBottom: '1px solid #1e293b',
    },
    tableRow: {
      cursor: 'pointer',
      transition: 'background-color 0.15s ease',
    },
    tableRowHover: {
      backgroundColor: 'rgba(99,102,241,0.06)',
    },
    urlText: {
      maxWidth: 260,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      color: '#818cf8',
    },
    emptyState: {
      textAlign: 'center',
      padding: '40px 20px',
      color: '#94a3b8',
      fontSize: 14,
    },
  };

  /* ─── render ─── */
  const displayName = userName || 'User';

  return (
    <div style={s.page} data-tour="dashboard-page">
      {/* Hero Row */}
      <div style={s.heroRow}>
        <h1 style={s.greeting}>
          {getGreeting()}, {displayName}
          <span style={s.wave} role="img" aria-label="wave">👋</span>
        </h1>
        <button
          style={s.runAllBtn}
          onClick={handleRunAll}
          disabled={running}
        >
          {running && <span style={s.spinner} />}
          {running ? 'Running...' : 'Run All Tests'}
        </button>
      </div>

      {/* Stats Row */}
      <div style={s.statsGrid}>
        {statsData.map((stat, idx) => (
          <div key={idx} className="gp-stat-card" style={s.statCard}>
            <span style={s.statIcon}>{stat.icon}</span>
            <div style={{ ...s.statValue, color: stat.color }}>{stat.value}</div>
            <div style={s.statLabel}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Categories */}
      <h2 style={s.sectionHeader}>Test Categories</h2>
      <div style={s.catGrid}>
        {categories.map((cat, idx) => {
          const status = latestSummary.categories
            ? (latestSummary.categories[cat.id] || {}).status
            : undefined;
          return (
            <div key={cat.id} className="gp-cat-card" style={s.catCard}>
              <span style={s.catIcon}>{cat.icon || '📦'}</span>
              <span style={s.catName}>{cat.name}</span>
              {status && <StatusBadge status={status} size="sm" />}
              <button
                className="gp-cat-run-btn"
                style={s.catRunBtn}
                onClick={() => navigate('/run', { state: { preselectCategory: cat.id } })}
              >
                ▶ Run
              </button>
            </div>
          );
        })}
      </div>

      {/* Recent Runs Table */}
      <h2 style={s.sectionHeader}>Recent Runs</h2>
      {recentRuns.length === 0 ? (
        <div style={{ ...s.tableWrap }}>
          <div style={s.emptyState}>No test runs yet. Click "Run All Tests" to get started.</div>
        </div>
      ) : (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Status</th>
                <th style={s.th}>Grafana URL</th>
                <th style={s.th}>Tests</th>
                <th style={s.th}>Pass Rate</th>
                <th style={s.th}>Date</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((run, idx) => {
                const sum = run.summary || {};
                const total = sum.total || 0;
                const passed = sum.passed || 0;
                const rate = pct(passed, total);
                const status = run.status || (sum.failed > 0 ? 'failed' : 'passed');

                return (
                  <tr key={run.id || idx} className="gp-table-row" style={s.tableRow} onClick={() => navigate('/reports')}>
                    <td style={s.td}>
                      <StatusBadge status={status} size="sm" />
                    </td>
                    <td style={s.td}>
                      <div style={s.urlText}>{run.grafana_url || run.grafanaUrl || '—'}</div>
                    </td>
                    <td style={s.td}>{total}</td>
                    <td style={s.td}>
                      <span style={{ color: passed === total ? '#10b981' : '#eab308', fontWeight: 600 }}>
                        {rate}
                      </span>
                    </td>
                    <td style={{ ...s.td, color: '#94a3b8', fontSize: 13 }}>
                      {fmtDate(run.start_time || run.startTime)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
