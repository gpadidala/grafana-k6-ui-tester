import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import StatusBadge from '../Common/StatusBadge';

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
  yellow: '#eab308',
  blue: '#3b82f6',
};

/* ── shared styles ── */
const s = {
  page: { color: C.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  title: { fontSize: 28, fontWeight: 700, margin: '0 0 28px 0', color: C.text },
  selectRow: {
    display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap', alignItems: 'flex-end',
  },
  selectGroup: { flex: 1, minWidth: 260 },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 6 },
  select: {
    width: '100%', boxSizing: 'border-box',
    background: C.input, color: C.text, border: `1px solid ${C.border}`,
    borderRadius: 8, padding: '10px 14px', fontSize: 14, outline: 'none',
    appearance: 'auto', cursor: 'pointer',
  },
  btn: {
    background: C.accent, color: '#fff', border: 'none', borderRadius: 8,
    padding: '10px 28px', fontWeight: 600, fontSize: 14, cursor: 'pointer',
    transition: 'opacity .2s', alignSelf: 'flex-end', height: 42,
  },
  summaryRow: { display: 'flex', gap: 16, marginBottom: 28 },
  summaryCard: (color) => ({
    flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
    padding: 20, position: 'relative', overflow: 'hidden',
  }),
  summaryAccent: (color) => ({
    position: 'absolute', top: 0, left: 0, right: 0, height: 3,
    background: color,
  }),
  summaryLabel: { fontSize: 12, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 },
  summaryRate: (rate) => ({
    fontSize: 32, fontWeight: 800, lineHeight: 1,
    color: rate >= 100 ? C.green : rate >= 80 ? C.yellow : C.red,
  }),
  summaryMeta: { marginTop: 10, fontSize: 13, color: C.muted, display: 'flex', gap: 16 },
  metaVal: (color) => ({ color, fontWeight: 700 }),

  /* diff table */
  tableWrap: {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
    overflow: 'hidden', marginBottom: 24,
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left', padding: '10px 14px', color: C.muted,
    borderBottom: `1px solid ${C.border}`, fontWeight: 600, fontSize: 11,
    textTransform: 'uppercase', letterSpacing: '0.5px', background: C.input,
  },
  td: { padding: '10px 14px', borderBottom: `1px solid ${C.border}22`, color: C.text },
  changeBadge: (type) => {
    const map = {
      'new failure': { color: C.red, bg: '#450a0a' },
      resolved: { color: C.green, bg: '#064e3b' },
      unchanged: { color: C.muted, bg: '#1e293b' },
      'new test': { color: C.blue, bg: '#172554' },
    };
    const cfg = map[type] || map.unchanged;
    return {
      display: 'inline-block', padding: '3px 10px', borderRadius: 9999,
      fontSize: 11, fontWeight: 600, color: cfg.color, background: cfg.bg,
      textTransform: 'uppercase', letterSpacing: '0.3px',
    };
  },
  countsRow: { display: 'flex', gap: 16, flexWrap: 'wrap' },
  countCard: (color) => ({
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
    padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 10,
    flex: '1 1 160px',
  }),
  countNum: (color) => ({ fontSize: 24, fontWeight: 800, color }),
  countLabel: { fontSize: 13, color: C.muted, fontWeight: 600 },
  empty: { textAlign: 'center', padding: '48px 20px', color: C.muted, fontSize: 14 },
};

/* ── helpers ── */
function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function buildTestMap(report) {
  const map = {};
  if (!report?.categories) return map;
  for (const cat of report.categories) {
    for (const t of cat.tests || []) {
      map[t.name] = t.status;
    }
  }
  return map;
}

function classifyChange(statusA, statusB) {
  if (!statusA && statusB) return 'new test';
  const passA = statusA === 'PASS' || statusA === 'passed';
  const passB = statusB === 'PASS' || statusB === 'passed';
  if (passA && !passB) return 'new failure';
  if (!passA && passB) return 'resolved';
  return 'unchanged';
}

/* ═══════════════════════════════════════ */
export default function ComparePage() {
  const [reports, setReports] = useState([]);
  const [runA, setRunA] = useState('');
  const [runB, setRunB] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { reportA, reportB, diffs }

  const fetchReports = useCallback(async () => {
    try {
      const data = await api.getReports();
      const sorted = (data || []).sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
      setReports(sorted);
    } catch (e) { console.error('Failed to load reports', e); }
  }, []);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  const handleCompare = async () => {
    if (!runA || !runB) return;
    setLoading(true);
    setResult(null);
    try {
      const fileA = runA.replace('.html', '.json');
      const fileB = runB.replace('.html', '.json');
      const [reportA, reportB] = await Promise.all([
        api.getReport(fileA),
        api.getReport(fileB),
      ]);

      const mapA = buildTestMap(reportA);
      const mapB = buildTestMap(reportB);
      const allTests = [...new Set([...Object.keys(mapA), ...Object.keys(mapB)])].sort();

      const diffs = allTests.map((name) => ({
        name,
        statusA: mapA[name] || null,
        statusB: mapB[name] || null,
        change: classifyChange(mapA[name], mapB[name]),
      }));

      setResult({ reportA, reportB, diffs });
    } catch (e) {
      console.error('Compare failed', e);
    }
    setLoading(false);
  };

  /* summary counts */
  const counts = result ? {
    newFailures: result.diffs.filter((d) => d.change === 'new failure').length,
    resolved: result.diffs.filter((d) => d.change === 'resolved').length,
    unchanged: result.diffs.filter((d) => d.change === 'unchanged').length,
    newTests: result.diffs.filter((d) => d.change === 'new test').length,
  } : null;

  const metaA = reports.find((r) => r.id === runA);
  const metaB = reports.find((r) => r.id === runB);

  return (
    <div style={s.page} data-tour="compare-page">
      <h1 style={s.title}>{'\uD83D\uDD0D'} Compare Runs</h1>

      {/* selectors */}
      <div style={s.selectRow}>
        <div style={s.selectGroup}>
          <label style={s.label}>Run A (Baseline)</label>
          <select style={s.select} value={runA} onChange={(e) => { setRunA(e.target.value); setResult(null); }}>
            <option value="">-- Select baseline --</option>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} ({r.summary?.pass_rate ?? '--'}%) {fmtDate(r.start_time)}
              </option>
            ))}
          </select>
        </div>
        <div style={s.selectGroup}>
          <label style={s.label}>Run B (Current)</label>
          <select style={s.select} value={runB} onChange={(e) => { setRunB(e.target.value); setResult(null); }}>
            <option value="">-- Select current --</option>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} ({r.summary?.pass_rate ?? '--'}%) {fmtDate(r.start_time)}
              </option>
            ))}
          </select>
        </div>
        <button style={{ ...s.btn, opacity: (!runA || !runB || loading) ? 0.5 : 1 }}
          disabled={!runA || !runB || loading} onClick={handleCompare}>
          {loading ? 'Comparing...' : 'Compare'}
        </button>
      </div>

      {/* empty state */}
      {!result && !loading && (
        <div style={s.empty}>Select two runs and click Compare to see differences.</div>
      )}

      {/* results */}
      {result && (
        <>
          {/* side-by-side summary */}
          <div style={s.summaryRow}>
            {[
              { label: 'Run A \u2014 Baseline', meta: metaA, report: result.reportA, color: C.accent },
              { label: 'Run B \u2014 Current', meta: metaB, report: result.reportB, color: C.green },
            ].map(({ label, meta, report, color }) => {
              const sm = meta?.summary || report?.summary || {};
              return (
                <div key={label} style={s.summaryCard(color)}>
                  <div style={s.summaryAccent(color)} />
                  <div style={s.summaryLabel}>{label}</div>
                  <div style={s.summaryRate(sm.pass_rate ?? 0)}>
                    {sm.pass_rate != null ? `${sm.pass_rate}%` : '--'}
                  </div>
                  <div style={s.summaryMeta}>
                    <span>Total: <span style={s.metaVal(C.text)}>{sm.total ?? '--'}</span></span>
                    <span>Passed: <span style={s.metaVal(C.green)}>{sm.passed ?? '--'}</span></span>
                    <span>Failed: <span style={s.metaVal(C.red)}>{sm.failed ?? '--'}</span></span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* summary counts */}
          {counts && (
            <div style={{ ...s.countsRow, marginBottom: 24 }}>
              {[
                { n: counts.newFailures, label: 'New Failures', color: C.red },
                { n: counts.resolved, label: 'Resolved', color: C.green },
                { n: counts.unchanged, label: 'Unchanged', color: C.muted },
                { n: counts.newTests, label: 'New Tests', color: C.blue },
              ].map(({ n, label, color }) => (
                <div key={label} style={s.countCard(color)}>
                  <span style={s.countNum(color)}>{n}</span>
                  <span style={s.countLabel}>{label}</span>
                </div>
              ))}
            </div>
          )}

          {/* diff table */}
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Test Name</th>
                  <th style={{ ...s.th, width: 100 }}>Status A</th>
                  <th style={{ ...s.th, width: 100 }}>Status B</th>
                  <th style={{ ...s.th, width: 130 }}>Change</th>
                </tr>
              </thead>
              <tbody>
                {result.diffs.map((d) => (
                  <tr key={d.name}>
                    <td style={s.td}>{d.name}</td>
                    <td style={s.td}>
                      {d.statusA ? <StatusBadge status={d.statusA} size="sm" /> : <span style={{ color: C.muted }}>--</span>}
                    </td>
                    <td style={s.td}>
                      {d.statusB ? <StatusBadge status={d.statusB} size="sm" /> : <span style={{ color: C.muted }}>--</span>}
                    </td>
                    <td style={s.td}>
                      <span style={s.changeBadge(d.change)}>{d.change}</span>
                    </td>
                  </tr>
                ))}
                {result.diffs.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ ...s.td, textAlign: 'center', color: C.muted, padding: 30 }}>
                      No test differences found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
