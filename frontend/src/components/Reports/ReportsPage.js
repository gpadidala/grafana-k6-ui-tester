import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import StatusBadge from '../Common/StatusBadge';

/* Build a live Grafana URL for a test result based on its category + uid. */
function linkForResource(grafanaUrl, categoryId, uid, metadata) {
  if (!grafanaUrl || !uid) return null;
  const base = String(grafanaUrl).replace(/\/+$/, '');
  switch (categoryId) {
    case 'panels': {
      const pid = metadata && metadata.panelId;
      return pid ? `${base}/d/${uid}?viewPanel=${pid}` : `${base}/d/${uid}`;
    }
    case 'datasources':
      return `${base}/connections/datasources/edit/${uid}`;
    case 'folders':
      return `${base}/dashboards/f/${uid}`;
    case 'plugins':
    case 'app-plugins':
      return `${base}/plugins/${uid}`;
    case 'alerts':
    case 'alert-e2e':
      return `${base}/alerting/grafana/${uid}/view`;
    case 'dashboards':
    case 'annotations':
    default:
      return `${base}/d/${uid}`;
  }
}

/* ── theme tokens ── */
const C = {
  bg: '#030712',
  card: '#111827',
  input: '#0f172a',
  text: '#e2e8f0',
  muted: '#94a3b8',
  accent: '#6366f1',
  border: '#1e293b',
  red: '#ef4444',
  redBg: '#450a0a',
  green: '#10b981',
};

/* ── shared styles ── */
const s = {
  page: { color: C.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  title: { fontSize: 28, fontWeight: 700, margin: 0, color: C.text },
  badge: {
    background: C.accent + '20', color: C.accent, fontSize: 13, fontWeight: 600,
    padding: '4px 12px', borderRadius: 9999,
  },
  deleteAllBtn: {
    background: C.redBg, color: C.red, border: `1px solid ${C.red}40`,
    padding: '8px 18px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
    transition: 'all .2s',
  },
  filtersRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
  select: {
    background: C.input, color: C.text, border: `1px solid ${C.border}`,
    borderRadius: 8, padding: '8px 14px', fontSize: 13, outline: 'none', cursor: 'pointer',
    appearance: 'auto',
  },
  refreshBtn: {
    background: C.accent + '15', color: C.accent, border: `1px solid ${C.accent}30`,
    padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
  },
  card: (hovered) => ({
    background: C.card, border: `1px solid ${hovered ? C.accent + '50' : C.border}`,
    borderRadius: 12, marginBottom: 10, overflow: 'hidden', transition: 'border-color .2s',
    cursor: 'pointer',
  }),
  cardRow: {
    display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', flexWrap: 'wrap',
  },
  filename: { fontWeight: 600, fontSize: 14, color: C.text, flex: '1 1 200px', wordBreak: 'break-all' },
  meta: { fontSize: 12, color: C.muted },
  passRate: (rate) => ({
    fontSize: 13, fontWeight: 700,
    color: rate >= 100 ? C.green : rate >= 80 ? '#eab308' : C.red,
  }),
  htmlLink: {
    color: C.accent, textDecoration: 'none', fontSize: 13, fontWeight: 600,
    padding: '4px 10px', borderRadius: 6, background: C.accent + '15',
    display: 'inline-flex', alignItems: 'center', gap: 4,
  },
  delBtn: {
    background: 'transparent', border: 'none', color: C.red, cursor: 'pointer',
    fontSize: 16, padding: '4px 8px', borderRadius: 6, transition: 'background .15s',
  },
  expandArea: { padding: '0 20px 16px 20px' },
  catRow: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
    background: C.input, borderRadius: 8, marginBottom: 6, cursor: 'pointer',
    border: `1px solid ${C.border}`,
  },
  catIcon: { fontSize: 18 },
  catName: { fontWeight: 600, fontSize: 13, flex: 1, color: C.text },
  catCount: { fontSize: 12, color: C.muted },
  testTable: {
    width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 6, marginBottom: 10,
  },
  th: {
    textAlign: 'left', padding: '6px 10px', color: C.muted, borderBottom: `1px solid ${C.border}`,
    fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px',
  },
  td: { padding: '6px 10px', borderBottom: `1px solid ${C.border}22`, color: C.text },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, flexWrap: 'wrap', gap: 12 },
  pageBtn: (active) => ({
    background: active ? C.accent : C.input, color: active ? '#fff' : C.text,
    border: `1px solid ${active ? C.accent : C.border}`, borderRadius: 6,
    padding: '6px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 13,
    minWidth: 36, textAlign: 'center',
  }),
  pageSizeSelect: {
    background: C.input, color: C.text, border: `1px solid ${C.border}`,
    borderRadius: 6, padding: '6px 10px', fontSize: 13, cursor: 'pointer', appearance: 'auto',
  },
  emptyState: {
    textAlign: 'center', padding: '60px 20px', color: C.muted, fontSize: 15,
  },
  loadingBar: {
    height: 3, background: `linear-gradient(90deg, transparent, ${C.accent}, transparent)`,
    borderRadius: 2, animation: 'reportsLoadPulse 1.2s ease-in-out infinite',
    marginBottom: 16,
  },
};

/* inject keyframes once */
let kfInjected = false;
function injectKf() {
  if (kfInjected || typeof document === 'undefined') return;
  const el = document.createElement('style');
  el.textContent = `
    @keyframes reportsLoadPulse { 0%,100%{opacity:.3} 50%{opacity:1} }
  `;
  document.head.appendChild(el);
  kfInjected = true;
}

export default function ReportsPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [expandedReport, setExpandedReport] = useState(null);
  const [expandedCats, setExpandedCats] = useState({});
  const [hoveredId, setHoveredId] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  // Email button state — track which row is sending and result toast
  const [emailingId, setEmailingId] = useState(null);
  const [emailToast, setEmailToast] = useState(null);

  // Send a failure notification email for a given test result
  const sendFailureEmail = async (test, report, category) => {
    const rowId = `${report.id}:${category.id}:${test.name}`;
    setEmailingId(rowId);
    setEmailToast(null);
    try {
      const grafanaUrl = report.grafana_url || '';
      const dashboardTitle = (test.metadata && test.metadata.dashboardTitle)
        || ((test.name || '').match(/^\[(.+?)\]/) || [])[1]
        || 'Dashboard';
      const dashboardUrl = test.uid && grafanaUrl
        ? `${String(grafanaUrl).replace(/\/+$/, '')}/d/${test.uid}`
        : '';
      const screenshotUrl = test.metadata && test.metadata.screenshot
        ? `http://localhost:4000/api/test-screenshots/${test.metadata.screenshot}`
        : '';
      const r = await api.notifyFailure({
        test,
        dashboardTitle,
        dashboardUrl,
        screenshotUrl,
        runId: report.id,
        runDate: report.start_time || report.startedAt,
        grafanaUrl,
      });
      if (r && r.ok) {
        setEmailToast({ ok: true, msg: `Sent to ${(r.sentTo || []).join(', ')}${r.cc?.length ? ' (cc: ' + r.cc.join(', ') + ')' : ''}` });
      } else {
        setEmailToast({ ok: false, msg: (r && r.error) || 'Failed to send' });
      }
    } catch (e) {
      setEmailToast({ ok: false, msg: e.message || 'Failed to send' });
    }
    setEmailingId(null);
    setTimeout(() => setEmailToast(null), 5000);
  };

  useEffect(() => { injectKf(); }, []);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getReports();
      const sorted = (data || []).sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
      setReports(sorted);
    } catch (e) { console.error('Failed to fetch reports', e); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  /* filters */
  const filtered = reports.filter((r) => {
    if (filter === 'all') return true;
    return r.status === filter;
  });

  /* pagination */
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const paged = filtered.slice(start, start + pageSize);

  /* expand a report */
  const handleExpand = async (report) => {
    if (expandedId === report.id) {
      setExpandedId(null);
      setExpandedReport(null);
      setExpandedCats({});
      return;
    }
    setExpandedId(report.id);
    setExpandedCats({});
    try {
      const file = report.html_file || report.id;
      const full = await api.getReport(file.replace('.html', '.json'));
      setExpandedReport(full);
    } catch (e) {
      console.error('Failed to load report detail', e);
      setExpandedReport(null);
    }
  };

  const toggleCat = (catId) => {
    setExpandedCats((prev) => ({ ...prev, [catId]: !prev[catId] }));
  };

  /* delete single */
  const handleDelete = async (e, report) => {
    e.stopPropagation();
    if (!window.confirm(`Delete report "${report.id}"?`)) return;
    await api.deleteReport(report.id);
    fetchReports();
  };

  /* delete all */
  const handleDeleteAll = async () => {
    if (!window.confirm('Delete ALL reports? This cannot be undone.')) return;
    await api.deleteAllReports();
    setExpandedId(null);
    setExpandedReport(null);
    fetchReports();
  };

  /* format helpers */
  const fmtDate = (d) => {
    if (!d) return '--';
    const dt = new Date(d);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const fmtGrafanaUrl = (url) => {
    if (!url) return '';
    try { return new URL(url).hostname; } catch { return url; }
  };

  /* page buttons */
  const renderPageButtons = () => {
    const btns = [];
    const addBtn = (label, pg, disabled = false) => {
      btns.push(
        <button key={label + pg} style={{ ...s.pageBtn(pg === safePage), opacity: disabled ? 0.4 : 1 }}
          disabled={disabled} onClick={() => !disabled && setPage(pg)}>{label}</button>
      );
    };
    addBtn('\u00AB', 1, safePage === 1);
    addBtn('\u2039', Math.max(1, safePage - 1), safePage === 1);

    const range = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) range.push(i);
    } else {
      range.push(1);
      if (safePage > 3) range.push('...');
      for (let i = Math.max(2, safePage - 1); i <= Math.min(totalPages - 1, safePage + 1); i++) range.push(i);
      if (safePage < totalPages - 2) range.push('...');
      range.push(totalPages);
    }
    range.forEach((p, idx) => {
      if (p === '...') {
        btns.push(<span key={'ell' + idx} style={{ color: C.muted, padding: '0 4px' }}>...</span>);
      } else {
        addBtn(String(p), p);
      }
    });

    addBtn('\u203A', Math.min(totalPages, safePage + 1), safePage === totalPages);
    addBtn('\u00BB', totalPages, safePage === totalPages);
    return btns;
  };

  return (
    <div style={s.page} data-tour="reports-page">
      {/* header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <h1 style={s.title}>{'\uD83D\uDCCB'} Reports</h1>
          <span style={s.badge}>{filtered.length}</span>
        </div>
        {reports.length > 0 && (
          <button style={s.deleteAllBtn} onClick={handleDeleteAll}>
            {'\uD83D\uDDD1\uFE0F'} Delete All
          </button>
        )}
      </div>

      {/* email send result toast */}
      {emailToast && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, marginBottom: 12,
          background: emailToast.ok ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
          border: `1px solid ${emailToast.ok ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`,
          color: emailToast.ok ? '#10b981' : '#fca5a5',
          fontSize: 13,
        }}>
          {emailToast.ok ? '✉️ Email sent — ' : '✗ '} {emailToast.msg}
        </div>
      )}

      {/* filters */}
      <div style={s.filtersRow}>
        <select style={s.select} value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
          <option value="all">All Statuses</option>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
        </select>
        <button style={s.refreshBtn} onClick={fetchReports}>{'\u21BB'} Refresh</button>
      </div>

      {/* loading */}
      {loading && <div style={s.loadingBar} />}

      {/* empty */}
      {!loading && filtered.length === 0 && (
        <div style={s.emptyState}>No reports found{filter !== 'all' ? ` with status "${filter}"` : ''}.</div>
      )}

      {/* report list */}
      {paged.map((r) => {
        const isExpanded = expandedId === r.id;
        const sm = r.summary || {};
        return (
          <div key={r.id} style={s.card(hoveredId === r.id)}
            onMouseEnter={() => setHoveredId(r.id)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={() => handleExpand(r)}>

            <div style={s.cardRow}>
              <StatusBadge status={r.status} size="sm" />
              <span style={s.filename}>{r.id}</span>
              {r.grafana_url && (
                <span style={s.meta} title={r.grafana_url}>{fmtGrafanaUrl(r.grafana_url)}</span>
              )}
              <span style={s.meta}>{sm.passed ?? 0}/{sm.total ?? 0} passed</span>
              <span style={s.passRate(sm.pass_rate ?? 0)}>
                {sm.pass_rate != null ? `${sm.pass_rate}%` : '--'}
              </span>
              <span style={s.meta}>{fmtDate(r.start_time)}</span>
              {r.html_file && (
                <a style={s.htmlLink} href={api.getHtmlReportUrl(r.html_file)}
                  target="_blank" rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}>
                  {'\uD83D\uDCC4'} HTML
                </a>
              )}
              <button style={s.delBtn} title="Delete report"
                onClick={(e) => handleDelete(e, r)}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.redBg; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                {'\uD83D\uDDD1\uFE0F'}
              </button>
            </div>

            {/* Category tags: shows exactly which test suites were run.
                Condenses to a single "all" pill when the full suite ran. */}
            {Array.isArray(r.categories_run) && r.categories_run.length > 0 && (
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8,
                paddingLeft: 2,
              }}>
                {(() => {
                  const ran = r.categories_run;
                  const total = r.total_categories || 22;
                  // If the full suite was run, just show a single "all" pill
                  if (ran.length >= total) {
                    return (
                      <span style={{
                        padding: '2px 10px', borderRadius: 9999,
                        background: 'rgba(99,102,241,0.15)',
                        border: '1px solid rgba(99,102,241,0.4)',
                        color: '#a5b4fc', fontSize: 10, fontWeight: 700,
                        textTransform: 'uppercase', letterSpacing: 0.5,
                      }}>
                        all · {ran.length} categories
                      </span>
                    );
                  }
                  // Otherwise list every category as an individual pill
                  return ran.map((catId) => (
                    <span key={catId} style={{
                      padding: '2px 9px', borderRadius: 9999,
                      background: C.input, border: `1px solid ${C.border}`,
                      color: C.muted, fontSize: 10, fontWeight: 600,
                      textTransform: 'uppercase', letterSpacing: 0.3,
                    }}>
                      {catId}
                    </span>
                  ));
                })()}
              </div>
            )}

            {/* expanded detail */}
            {isExpanded && expandedReport && (
              <div style={s.expandArea}>
                {(expandedReport.categories || []).map((cat) => (
                  <div key={cat.id}>
                    <div style={s.catRow} onClick={(e) => { e.stopPropagation(); toggleCat(cat.id); }}>
                      <span style={s.catIcon}>{cat.icon || '\uD83D\uDCC1'}</span>
                      <span style={s.catName}>{cat.name}</span>
                      <span style={s.catCount}>
                        {cat.summary ? `${cat.summary.passed}/${cat.summary.total}` : ''}
                      </span>
                      <StatusBadge status={cat.status} size="sm" />
                      <span style={{ color: C.muted, fontSize: 12 }}>
                        {expandedCats[cat.id] ? '\u25B2' : '\u25BC'}
                      </span>
                    </div>

                    {expandedCats[cat.id] && cat.tests && (
                      <table style={s.testTable}>
                        <thead>
                          <tr>
                            <th style={s.th}>Status</th>
                            <th style={s.th}>Test Name</th>
                            <th style={s.th}>ms</th>
                            <th style={s.th}>Detail</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cat.tests.map((t, i) => {
                            const isIssue = t.status === 'WARN' || t.status === 'FAIL';
                            const link = linkForResource(r.grafana_url, cat.id, t.uid, t.metadata);
                            const canEmail = isIssue && t.metadata && t.metadata.dashboardMeta;
                            const rowId = `${r.id}:${cat.id}:${t.name}`;
                            const isEmailing = emailingId === rowId;
                            return (
                            <tr key={i}>
                              <td style={s.td}><StatusBadge status={t.status} size="sm" /></td>
                              <td style={s.td}>
                                {link ? (
                                  <a href={link} target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: isIssue ? '#818cf8' : C.accent, textDecoration: 'none', fontWeight: isIssue ? 500 : 400 }}
                                    onClick={(e) => e.stopPropagation()}
                                    title={`Open in Grafana: ${link}`}>
                                    {t.name}
                                    {isIssue && <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.8 }}>↗</span>}
                                  </a>
                                ) : t.name}
                                {canEmail && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); sendFailureEmail(t, r, cat); }}
                                    disabled={isEmailing}
                                    style={{
                                      marginLeft: 8, padding: '2px 8px', borderRadius: 5,
                                      border: '1px solid #6366f1',
                                      background: 'rgba(99,102,241,0.1)',
                                      color: '#a5b4fc', fontSize: 11, cursor: isEmailing ? 'wait' : 'pointer',
                                      fontFamily: 'inherit',
                                    }}
                                    title="Email this failure to the dashboard's createdBy/updatedBy + default CC"
                                  >
                                    {isEmailing ? '⏳' : '📧'}
                                  </button>
                                )}
                              </td>
                              <td style={{ ...s.td, color: C.muted }}>{t.ms ?? '--'}</td>
                              <td style={{ ...s.td, color: C.muted, maxWidth: 300, wordBreak: 'break-word' }}>
                                {t.detail || '--'}
                              </td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}
                {!expandedReport.categories?.length && (
                  <div style={{ color: C.muted, fontSize: 13, padding: 10 }}>No category data available.</div>
                )}
              </div>
            )}

            {isExpanded && !expandedReport && (
              <div style={{ ...s.expandArea, color: C.muted, fontSize: 13 }}>Loading detail...</div>
            )}
          </div>
        );
      })}

      {/* pagination */}
      {filtered.length > 0 && (
        <div style={s.pagination}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: C.muted, fontSize: 13 }}>Rows per page:</span>
            <select style={s.pageSizeSelect} value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
              {[5, 10, 25].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {renderPageButtons()}
          </div>

          <span style={{ color: C.muted, fontSize: 13 }}>
            Showing {start + 1}–{Math.min(start + pageSize, filtered.length)} of {filtered.length}
          </span>
        </div>
      )}
    </div>
  );
}
