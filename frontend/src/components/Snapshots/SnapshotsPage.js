import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { getSocket } from '../../services/socket';
import { useActiveEnv } from '../../context/AppContext';

/* ── theme tokens (matches ReportsPage) ── */
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
  yellow: '#eab308',
  orange: '#ea580c',
  blue: '#3b82f6',
  gray: '#6b7280',
};

const RISK_COLORS = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#f59e0b',
  low: '#3b82f6',
  info: '#6b7280',
};

/* ── shared styles ── */
const s = {
  page: { color: C.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  header: { marginBottom: 20 },
  titleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontSize: 28, fontWeight: 700, margin: 0, color: C.text },
  subtitle: { fontSize: 13, color: C.muted, margin: 0 },
  primaryBtn: {
    background: C.accent, color: '#fff', border: 'none',
    padding: '9px 18px', borderRadius: 8, cursor: 'pointer',
    fontWeight: 600, fontSize: 13, transition: 'all .2s',
  },
  secondaryBtn: {
    background: C.accent + '15', color: C.accent,
    border: `1px solid ${C.accent}30`,
    padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
    fontWeight: 600, fontSize: 13,
  },
  dangerBtn: {
    background: C.redBg, color: C.red, border: `1px solid ${C.red}40`,
    padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
    fontWeight: 600, fontSize: 12,
  },
  ghostBtn: {
    background: 'transparent', color: C.muted,
    border: `1px solid ${C.border}`,
    padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
    fontWeight: 600, fontSize: 12,
  },
  tabBar: {
    display: 'flex', gap: 4, borderBottom: `1px solid ${C.border}`,
    marginBottom: 20,
  },
  tab: {
    background: 'transparent', color: C.muted, border: 'none',
    padding: '10px 18px', cursor: 'pointer',
    fontSize: 13, fontWeight: 600,
    borderBottom: '2px solid transparent',
    fontFamily: 'inherit',
  },
  tabActive: {
    background: 'transparent', color: C.text, border: 'none',
    padding: '10px 18px', cursor: 'pointer',
    fontSize: 13, fontWeight: 600,
    borderBottom: `2px solid ${C.accent}`,
    fontFamily: 'inherit',
  },
  /* snapshot grid */
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: 16,
  },
  snapCard: {
    background: C.card, border: `1px solid ${C.border}`,
    borderRadius: 12, padding: 18, transition: 'border-color .2s',
  },
  snapName: { fontWeight: 700, fontSize: 16, color: C.text, marginBottom: 6 },
  snapMeta: { fontSize: 12, color: C.muted, marginBottom: 4 },
  snapSummary: {
    fontSize: 12, color: C.text, marginTop: 10, paddingTop: 10,
    borderTop: `1px solid ${C.border}`,
  },
  snapActions: { display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' },
  /* compare */
  compareWrap: {
    background: C.card, border: `1px solid ${C.border}`,
    borderRadius: 12, padding: 24, maxWidth: 680,
  },
  compareRow: { display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' },
  compareField: { flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 12, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' },
  select: {
    background: C.input, color: C.text, border: `1px solid ${C.border}`,
    borderRadius: 8, padding: '9px 12px', fontSize: 13, outline: 'none',
    cursor: 'pointer', appearance: 'auto',
  },
  input: {
    background: C.input, color: C.text, border: `1px solid ${C.border}`,
    borderRadius: 8, padding: '9px 12px', fontSize: 13, outline: 'none',
    fontFamily: 'inherit',
  },
  textarea: {
    background: C.input, color: C.text, border: `1px solid ${C.border}`,
    borderRadius: 8, padding: '10px 12px', fontSize: 13, outline: 'none',
    fontFamily: 'inherit', minHeight: 90, resize: 'vertical',
  },
  /* diffs */
  diffLayout: { display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16 },
  diffSidebar: {
    background: C.card, border: `1px solid ${C.border}`,
    borderRadius: 12, padding: 10, maxHeight: '72vh', overflowY: 'auto',
  },
  diffSideItem: (active) => ({
    padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
    marginBottom: 4, border: `1px solid ${active ? C.accent + '60' : 'transparent'}`,
    background: active ? C.accent + '15' : 'transparent',
  }),
  diffDetail: {
    background: C.card, border: `1px solid ${C.border}`,
    borderRadius: 12, padding: 20,
  },
  statGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
    gap: 10, marginBottom: 18,
  },
  statBox: (color) => ({
    background: color + '20', border: `1px solid ${color}50`,
    borderRadius: 10, padding: '12px 14px', textAlign: 'center',
  }),
  statNum: { fontSize: 22, fontWeight: 800, color: C.text, lineHeight: 1 },
  statLabel: { fontSize: 11, color: C.muted, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.5px' },
  filterBar: { display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' },
  itemTable: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: {
    textAlign: 'left', padding: '8px 10px', color: C.muted,
    borderBottom: `1px solid ${C.border}`,
    fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px',
  },
  td: { padding: '10px 10px', borderBottom: `1px solid ${C.border}55`, color: C.text, verticalAlign: 'top' },
  expandedRow: {
    background: C.input, padding: 14, borderRadius: 8, marginTop: 8,
    border: `1px solid ${C.border}`,
  },
  jsonCols: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8,
  },
  jsonBlock: {
    background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6,
    padding: 10, fontSize: 11, color: C.text, overflow: 'auto',
    maxHeight: 320, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    fontFamily: 'ui-monospace, Menlo, Monaco, monospace',
  },
  /* storage */
  storageWrap: {
    background: C.card, border: `1px solid ${C.border}`,
    borderRadius: 12, padding: 24, maxWidth: 680,
  },
  storageRow: {
    display: 'flex', justifyContent: 'space-between',
    padding: '12px 0', borderBottom: `1px solid ${C.border}`,
  },
  storageKey: { color: C.muted, fontSize: 13 },
  storageVal: { color: C.text, fontSize: 13, fontWeight: 600 },
  /* modal */
  modalOverlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.7)', zIndex: 2000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: C.card, border: `1px solid ${C.border}`,
    borderRadius: 12, padding: 24, width: 460, maxWidth: '90vw',
  },
  modalTitle: { fontSize: 18, fontWeight: 700, margin: '0 0 16px 0', color: C.text },
  modalRow: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 },
  modalActions: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 },
  /* progress */
  progressWrap: {
    background: C.card, border: `1px solid ${C.accent}60`,
    borderRadius: 10, padding: '12px 16px', marginBottom: 16,
  },
  progressHead: { display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.muted, marginBottom: 8 },
  progressBarOuter: {
    height: 6, background: C.input, borderRadius: 4, overflow: 'hidden',
  },
  progressBarInner: (pct) => ({
    height: '100%', width: `${pct}%`,
    background: `linear-gradient(90deg, ${C.accent}, #a78bfa)`,
    transition: 'width .2s',
  }),
  emptyState: {
    textAlign: 'center', padding: '60px 20px', color: C.muted, fontSize: 15,
    background: C.card, border: `1px dashed ${C.border}`, borderRadius: 12,
  },
  loadingBar: {
    height: 3, background: `linear-gradient(90deg, transparent, ${C.accent}, transparent)`,
    borderRadius: 2, animation: 'snapshotsLoadPulse 1.2s ease-in-out infinite',
    marginBottom: 16,
  },
};

/* ── diff-item normalizer ──
   Backend returns snake_case SQL columns (dashboard_uid, dashboard_title,
   before_value, after_value, change_type, risk_level, ai_explanation).
   The UI was written expecting camelCase. Normalize to a uniform shape
   so we only write the rendering code once. */
function normalizeDiffItem(raw) {
  if (!raw) return raw;
  const parseMaybe = (v) => {
    if (v == null) return null;
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch { return v; }
  };
  return {
    id: raw.id,
    dashboardUid: raw.dashboard_uid || raw.dashboardUid || null,
    dashboardTitle: raw.dashboard_title || raw.dashboardTitle || '',
    panelId: raw.panel_id ?? raw.panelId ?? null,
    panelTitle: raw.panel_title || raw.panelTitle || '',
    path: raw.path || '',
    changeType: raw.change_type || raw.changeType || 'UNKNOWN',
    risk: (raw.risk_level || raw.riskLevel || 'info').toLowerCase(),
    before: parseMaybe(raw.before_value ?? raw.before),
    after: parseMaybe(raw.after_value ?? raw.after),
    explanation: raw.ai_explanation || raw.explanation || '',
    recommendation: raw.ai_recommendation || raw.recommendation || '',
    acknowledged: !!(raw.acknowledged),
  };
}

/* ── line-level LCS diff ──
   Returns an array of {type: 'equal'|'added'|'removed', line} entries.
   Small enough to inline; avoids pulling in a diff library. */
function lineDiff(beforeStr, afterStr) {
  const a = (beforeStr || '').split('\n');
  const b = (afterStr || '').split('\n');
  const m = a.length;
  const n = b.length;
  // DP table: dp[i][j] = LCS length of a[i..] and b[j..]
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ type: 'equal', line: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'removed', line: a[i] }); i++; }
    else { out.push({ type: 'added', line: b[j] }); j++; }
  }
  while (i < m) { out.push({ type: 'removed', line: a[i++] }); }
  while (j < n) { out.push({ type: 'added', line: b[j++] }); }
  return out;
}

function toJsonString(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

/* inject keyframes once */
let kfInjected = false;
function injectKf() {
  if (kfInjected || typeof document === 'undefined') return;
  const el = document.createElement('style');
  el.textContent = `
    @keyframes snapshotsLoadPulse { 0%,100%{opacity:.3} 50%{opacity:1} }
  `;
  document.head.appendChild(el);
  kfInjected = true;
}

/* ── tiny inline components ── */
function Badge({ text, color }) {
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
      background: color, color: '#fff', display: 'inline-block',
      textTransform: 'uppercase', letterSpacing: '0.3px',
    }}>{text}</span>
  );
}

function ProgressBar({ evt }) {
  if (!evt) return null;
  const total = evt.total || 0;
  const done = evt.completed || 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div style={s.progressWrap}>
      <div style={s.progressHead}>
        <span>{evt.stage || 'working'}{evt.current ? ` — ${evt.current}` : ''}</span>
        <span>{done}/{total} ({pct}%)</span>
      </div>
      <div style={s.progressBarOuter}>
        <div style={s.progressBarInner(pct)} />
      </div>
    </div>
  );
}

function CreateModal({ onSave, onClose, saving }) {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave(name.trim(), notes.trim());
  };
  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <h2 style={s.modalTitle}>{'\uD83D\uDCF8'} Create Snapshot</h2>
        <form onSubmit={submit}>
          <div style={s.modalRow}>
            <label style={s.label}>Name *</label>
            <input style={s.input} value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. pre-upgrade-11.2.0" autoFocus />
          </div>
          <div style={s.modalRow}>
            <label style={s.label}>Notes</label>
            <textarea style={s.textarea} value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional description..." />
          </div>
          <div style={s.modalActions}>
            <button type="button" style={s.ghostBtn} onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" style={s.primaryBtn} disabled={saving || !name.trim()}>
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── main page ── */
export default function SnapshotsPage() {
  const { grafanaUrl, token, label: envLabel, isConfigured: envConfigured } = useActiveEnv();
  const [tab, setTab] = useState('snapshots');
  const [snapshots, setSnapshots] = useState([]);
  const [diffs, setDiffs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedDiffId, setSelectedDiffId] = useState(null);
  const [selectedDiff, setSelectedDiff] = useState(null);
  const [selectedBaseline, setSelectedBaseline] = useState('');
  const [selectedCurrent, setSelectedCurrent] = useState('');
  const [progress, setProgress] = useState(null);
  const [storageInfo, setStorageInfo] = useState(null);
  const [retention, setRetention] = useState(30);
  const [riskFilter, setRiskFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [expandedItemId, setExpandedItemId] = useState(null);

  useEffect(() => { injectKf(); }, []);

  /* loaders */
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [snaps, diffList] = await Promise.all([
        api.listSnapshots(),
        api.listDiffs(),
      ]);
      const snapArr = Array.isArray(snaps) ? snaps : (snaps?.snapshots || []);
      const diffArr = Array.isArray(diffList) ? diffList : (diffList?.diffs || []);
      snapArr.sort((a, b) => new Date(b.createdAt || b.timestamp || 0) - new Date(a.createdAt || a.timestamp || 0));
      diffArr.sort((a, b) => new Date(b.createdAt || b.timestamp || 0) - new Date(a.createdAt || a.timestamp || 0));
      setSnapshots(snapArr);
      setDiffs(diffArr);
      // auto-fill compare with 2 most recent
      if (snapArr.length >= 2) {
        setSelectedBaseline((prev) => prev || snapArr[1].id);
        setSelectedCurrent((prev) => prev || snapArr[0].id);
      }
    } catch (e) {
      console.error('Failed to load snapshots', e);
    }
    setLoading(false);
  }, []);

  const loadStorage = useCallback(async () => {
    try {
      const info = await api.getSnapshotStorageInfo();
      setStorageInfo(info || null);
    } catch (e) {
      console.error('Failed to load storage info', e);
      setStorageInfo(null);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { if (tab === 'storage') loadStorage(); }, [tab, loadStorage]);

  /* websocket for progress */
  useEffect(() => {
    const socket = getSocket();
    const onProgress = (evt) => {
      setProgress(evt);
      if (evt && evt.stage === 'complete') {
        setTimeout(() => setProgress(null), 1500);
        loadAll();
      }
    };
    socket.on('snapshot:progress', onProgress);
    socket.on('diff:progress', onProgress);
    return () => {
      socket.off('snapshot:progress', onProgress);
      socket.off('diff:progress', onProgress);
    };
  }, [loadAll]);

  /* handlers */
  async function handleCreateSnapshot(name, notes) {
    if (!envConfigured) {
      alert('No environment selected. Pick a target env in the sidebar (Settings → configure URL + token).');
      return;
    }
    setCreating(true);
    try {
      await api.createSnapshot({ name, notes, grafanaUrl, token });
      setCreateModalOpen(false);
      await loadAll();
    } catch (e) {
      console.error('Failed to create snapshot', e);
      alert('Failed to create snapshot: ' + (e?.message || 'unknown'));
    }
    setCreating(false);
  }

  async function handleDeleteSnapshot(id) {
    if (!window.confirm(`Delete snapshot "${id}"? This cannot be undone.`)) return;
    try {
      await api.deleteSnapshot(id);
      await loadAll();
    } catch (e) {
      console.error('Failed to delete snapshot', e);
    }
  }

  async function handleRunDiff() {
    if (!selectedBaseline || !selectedCurrent) {
      alert('Select both baseline and current snapshots.');
      return;
    }
    if (selectedBaseline === selectedCurrent) {
      alert('Baseline and current must be different.');
      return;
    }
    try {
      const diff = await api.createDiff(selectedBaseline, selectedCurrent);
      await loadAll();
      if (diff && diff.id) {
        setSelectedDiffId(diff.id);
        await handleViewDiff(diff.id);
      }
      setTab('diffs');
    } catch (e) {
      console.error('Failed to run diff', e);
      alert('Failed to run diff: ' + (e?.message || 'unknown'));
    }
  }

  async function handleViewDiff(diffId) {
    setSelectedDiffId(diffId);
    setExpandedItemId(null);
    try {
      const full = await api.getDiff(diffId);
      // Normalize items (backend returns snake_case) so the UI can read
      // camelCase fields uniformly
      const normalized = {
        ...full,
        items: Array.isArray(full?.items) ? full.items.map(normalizeDiffItem) : [],
      };
      setSelectedDiff(normalized);
    } catch (e) {
      console.error('Failed to load diff', e);
      setSelectedDiff(null);
    }
  }

  async function handleAcknowledge(itemId) {
    if (!selectedDiffId) return;
    try {
      await api.acknowledgeDiffItem(selectedDiffId, itemId);
      await handleViewDiff(selectedDiffId);
    } catch (e) {
      console.error('Failed to ack item', e);
    }
  }

  /* format helpers */
  const fmtDate = (d) => {
    if (!d) return '--';
    const dt = new Date(d);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const fmtBytes = (bytes) => {
    if (bytes == null || isNaN(bytes)) return 'N/A';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let n = Number(bytes);
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(1)} ${units[i]}`;
  };

  /* ── Tab 1: Snapshots ── */
  const renderSnapshotsTab = () => {
    if (!loading && snapshots.length === 0) {
      return (
        <div style={s.emptyState}>
          No snapshots yet. Click "Create Snapshot" to capture your first.
        </div>
      );
    }
    return (
      <div style={s.grid}>
        {snapshots.map((snap) => {
          const dashCount = snap.dashboard_count ?? snap.dashboardCount ?? snap.dashboards?.length ?? 0;
          const panelCount = snap.panel_count ?? snap.panelCount ?? 0;
          const alertCount = snap.alert_count ?? snap.alertCount ?? 0;
          const ver = snap.grafana_version || snap.grafanaVersion || snap.version || '--';
          const createdAt = snap.created_at || snap.createdAt || snap.timestamp;
          return (
            <div key={snap.id} style={s.snapCard}>
              <div style={s.snapName}>{snap.name || snap.id}</div>
              <div style={s.snapMeta}>{fmtDate(createdAt)}</div>
              <div style={s.snapMeta}>Grafana {ver}</div>
              {snap.notes && (
                <div style={{ ...s.snapMeta, fontStyle: 'italic', marginTop: 6 }}>{snap.notes}</div>
              )}
              <div style={s.snapSummary}>
                {dashCount} dashboards, {panelCount} panels{alertCount > 0 ? `, ${alertCount} alert rules` : ''}
              </div>
              <div style={s.snapActions}>
                <button style={s.secondaryBtn} onClick={() => {
                  setSelectedBaseline(snap.id);
                  setTab('compare');
                }}>Diff</button>
                <button style={s.ghostBtn} onClick={() => {
                  const url = `${process.env.REACT_APP_API_URL || 'http://localhost:4000'}/api/snapshots/${snap.id}/export`;
                  window.open(url, '_blank');
                }}>Export</button>
                <button style={s.dangerBtn} onClick={() => handleDeleteSnapshot(snap.id)}>Delete</button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  /* ── Tab 2: Compare ── */
  const renderCompareTab = () => {
    return (
      <div style={s.compareWrap}>
        <h3 style={{ marginTop: 0, color: C.text, fontSize: 16 }}>Create a new diff</h3>
        <p style={{ color: C.muted, fontSize: 13, marginTop: 0, marginBottom: 18 }}>
          Select a baseline and a current snapshot to compute changes between them.
        </p>
        <div style={s.compareRow}>
          <div style={s.compareField}>
            <label style={s.label}>Baseline</label>
            <select style={s.select} value={selectedBaseline}
              onChange={(e) => setSelectedBaseline(e.target.value)}>
              <option value="">-- choose --</option>
              {snapshots.map((snap) => (
                <option key={snap.id} value={snap.id}>
                  {snap.name || snap.id} — {fmtDate(snap.createdAt || snap.timestamp)}
                </option>
              ))}
            </select>
          </div>
          <div style={s.compareField}>
            <label style={s.label}>Current</label>
            <select style={s.select} value={selectedCurrent}
              onChange={(e) => setSelectedCurrent(e.target.value)}>
              <option value="">-- choose --</option>
              {snapshots.map((snap) => (
                <option key={snap.id} value={snap.id}>
                  {snap.name || snap.id} — {fmtDate(snap.createdAt || snap.timestamp)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ marginTop: 18 }}>
          <button style={s.primaryBtn} onClick={handleRunDiff}
            disabled={!selectedBaseline || !selectedCurrent}>
            Run Diff
          </button>
        </div>
      </div>
    );
  };

  /* ── Tab 3: Diff Review ── */
  const renderDiffsTab = () => {
    if (!loading && diffs.length === 0) {
      return (
        <div style={s.emptyState}>
          No diffs yet. Go to the Compare tab to create one.
        </div>
      );
    }

    const detail = selectedDiff || {};
    const summary = detail.summary || {};
    const items = (detail.items || []).filter((it) => {
      if (riskFilter !== 'all' && (it.risk || '').toLowerCase() !== riskFilter) return false;
      if (searchText) {
        const hay = [it.dashboardTitle, it.dashboardUid, it.panelTitle, it.path, it.explanation, it.changeType].join(' ').toLowerCase();
        if (!hay.includes(searchText.toLowerCase())) return false;
      }
      return true;
    });

    return (
      <div style={s.diffLayout}>
        <div style={s.diffSidebar}>
          {diffs.map((d) => {
            const total = d.total_changes ?? d.summary?.total ?? 0;
            const crit = d.critical_count ?? 0;
            const high = d.high_count ?? 0;
            const created = d.created_at || d.createdAt;
            return (
              <div key={d.id} style={s.diffSideItem(selectedDiffId === d.id)}
                onClick={() => handleViewDiff(d.id)}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                  {total} {total === 1 ? 'change' : 'changes'}
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                  {fmtDate(created)}
                </div>
                {(crit > 0 || high > 0) && (
                  <div style={{ fontSize: 10, marginTop: 4, display: 'flex', gap: 6 }}>
                    {crit > 0 && <span style={{ color: '#ef4444', fontWeight: 700 }}>{crit} critical</span>}
                    {high > 0 && <span style={{ color: '#f97316', fontWeight: 700 }}>{high} high</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={s.diffDetail}>
          {!selectedDiffId && (
            <div style={{ color: C.muted, fontSize: 14, padding: 20, textAlign: 'center' }}>
              Select a diff on the left to view details.
            </div>
          )}
          {selectedDiffId && !selectedDiff && (
            <div style={{ color: C.muted, fontSize: 13, padding: 20 }}>Loading diff...</div>
          )}
          {selectedDiff && (
            <>
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ margin: 0, color: C.text, fontSize: 18 }}>
                  {detail.name || detail.id}
                </h3>
                <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
                  {detail.baselineName || detail.baselineId} → {detail.currentName || detail.currentId}
                </div>
              </div>

              <div style={s.statGrid}>
                {['critical', 'high', 'medium', 'low', 'info'].map((k) => (
                  <div key={k} style={s.statBox(RISK_COLORS[k])}>
                    <div style={s.statNum}>{summary[k] ?? 0}</div>
                    <div style={s.statLabel}>{k}</div>
                  </div>
                ))}
              </div>

              <div style={s.filterBar}>
                <input style={{ ...s.input, flex: '1 1 220px' }}
                  placeholder="Search dashboard, panel, path..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)} />
                <select style={s.select} value={riskFilter}
                  onChange={(e) => setRiskFilter(e.target.value)}>
                  <option value="all">All risks</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                  <option value="info">Info</option>
                </select>
              </div>

              {items.length === 0 ? (
                <div style={{ color: C.muted, fontSize: 13, padding: 20, textAlign: 'center' }}>
                  No diff items match these filters.
                </div>
              ) : (
                <table style={s.itemTable}>
                  <thead>
                    <tr>
                      <th style={s.th}>Dashboard</th>
                      <th style={s.th}>Panel</th>
                      <th style={s.th}>Change</th>
                      <th style={s.th}>Risk</th>
                      <th style={s.th}>Path</th>
                      <th style={s.th}>Explanation</th>
                      <th style={s.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => {
                      const id = it.id || `${idx}`;
                      const isOpen = expandedItemId === id;
                      const risk = (it.risk || 'info').toLowerCase();
                      const beforeStr = toJsonString(it.before);
                      const afterStr = toJsonString(it.after);
                      const grafanaUrl = (selectedDiff?.grafana_url || snapshots.find(sn => sn.id === selectedDiff?.current_snapshot_id)?.grafana_url || '').replace(/\/+$/, '');
                      const liveLink = (grafanaUrl && it.dashboardUid && it.changeType !== 'DASHBOARD_REMOVED')
                        ? `${grafanaUrl}/d/${it.dashboardUid}`
                        : null;
                      return (
                        <React.Fragment key={id}>
                          <tr style={{ cursor: 'pointer' }}
                            onClick={() => setExpandedItemId(isOpen ? null : id)}>
                            <td style={s.td}>
                              <div style={{ fontWeight: 600, color: C.text, fontSize: 13 }}>
                                {it.dashboardTitle || '(untitled)'}
                              </div>
                              {it.dashboardUid && (
                                <div style={{ fontSize: 10, color: C.muted, marginTop: 2, fontFamily: 'ui-monospace, Menlo, monospace' }}>
                                  {it.dashboardUid}
                                </div>
                              )}
                            </td>
                            <td style={s.td}>
                              {it.panelTitle ? (
                                <>
                                  <div style={{ fontSize: 12, color: C.text }}>{it.panelTitle}</div>
                                  {it.panelId != null && (
                                    <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>id {it.panelId}</div>
                                  )}
                                </>
                              ) : '--'}
                            </td>
                            <td style={s.td}>
                              <Badge text={it.changeType || 'change'} color={C.accent} />
                            </td>
                            <td style={s.td}>
                              <Badge text={risk} color={RISK_COLORS[risk] || C.gray} />
                            </td>
                            <td style={{ ...s.td, fontFamily: 'ui-monospace, Menlo, monospace', color: C.muted, maxWidth: 220, wordBreak: 'break-all', fontSize: 11 }}>
                              {it.path || '--'}
                            </td>
                            <td style={{ ...s.td, color: C.muted, maxWidth: 260, fontSize: 12 }}>
                              {it.explanation || '--'}
                            </td>
                            <td style={s.td}>
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                {liveLink && (
                                  <a href={liveLink} target="_blank" rel="noopener noreferrer"
                                    style={{ color: '#818cf8', fontSize: 11, textDecoration: 'none' }}
                                    onClick={(e) => e.stopPropagation()}
                                    title={`Open in Grafana: ${liveLink}`}>
                                    Open ↗
                                  </a>
                                )}
                                {!it.acknowledged ? (
                                  <button style={s.ghostBtn}
                                    onClick={(e) => { e.stopPropagation(); handleAcknowledge(id); }}>
                                    Ack
                                  </button>
                                ) : (
                                  <span style={{ color: C.green, fontSize: 11, fontWeight: 600 }}>✓</span>
                                )}
                              </div>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td colSpan={7} style={{ padding: 0, borderBottom: `1px solid ${C.border}55` }}>
                                <div style={s.expandedRow}>
                                  {/* Unified diff — the "what actually changed" view */}
                                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                    What changed
                                  </div>
                                  <pre style={{
                                    background: '#0a0f1c', border: `1px solid ${C.border}`, borderRadius: 8,
                                    padding: 12, margin: 0, fontSize: 11, lineHeight: 1.5,
                                    fontFamily: 'ui-monospace, Menlo, monospace',
                                    overflowX: 'auto', maxHeight: 400,
                                  }}>
                                    {(() => {
                                      if (!beforeStr && afterStr) {
                                        return afterStr.split('\n').map((ln, i) => (
                                          <div key={i} style={{ color: '#10b981', background: 'rgba(16,185,129,0.08)', padding: '0 8px' }}>
                                            + {ln}
                                          </div>
                                        ));
                                      }
                                      if (beforeStr && !afterStr) {
                                        return beforeStr.split('\n').map((ln, i) => (
                                          <div key={i} style={{ color: '#ef4444', background: 'rgba(239,68,68,0.08)', padding: '0 8px' }}>
                                            - {ln}
                                          </div>
                                        ));
                                      }
                                      const diff = lineDiff(beforeStr, afterStr);
                                      // Collapse long runs of unchanged lines into "..." markers
                                      const compact = [];
                                      let equalRun = 0;
                                      for (let i = 0; i < diff.length; i++) {
                                        const d = diff[i];
                                        if (d.type === 'equal') {
                                          equalRun++;
                                          // Show up to 2 context lines around changes
                                          const nextChange = diff.slice(i + 1, i + 3).some(x => x.type !== 'equal');
                                          const prevChange = compact.length > 0 && compact[compact.length - 1].type !== 'equal';
                                          if (nextChange || prevChange || equalRun <= 2) compact.push(d);
                                          else if (compact[compact.length - 1]?.type !== 'gap') compact.push({ type: 'gap', line: '...' });
                                        } else {
                                          equalRun = 0;
                                          compact.push(d);
                                        }
                                      }
                                      return compact.map((d, i) => {
                                        if (d.type === 'equal')
                                          return <div key={i} style={{ color: '#64748b', padding: '0 8px' }}>  {d.line}</div>;
                                        if (d.type === 'gap')
                                          return <div key={i} style={{ color: '#475569', padding: '2px 8px', fontStyle: 'italic' }}>...</div>;
                                        if (d.type === 'removed')
                                          return <div key={i} style={{ color: '#ef4444', background: 'rgba(239,68,68,0.08)', padding: '0 8px' }}>- {d.line}</div>;
                                        if (d.type === 'added')
                                          return <div key={i} style={{ color: '#10b981', background: 'rgba(16,185,129,0.08)', padding: '0 8px' }}>+ {d.line}</div>;
                                        return null;
                                      });
                                    })()}
                                  </pre>

                                  {/* Side-by-side raw JSON */}
                                  <div style={{ fontSize: 12, color: C.muted, marginTop: 16, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                    Before · After (raw)
                                  </div>
                                  <div style={s.jsonCols}>
                                    <pre style={s.jsonBlock}>{beforeStr || '(none)'}</pre>
                                    <pre style={s.jsonBlock}>{afterStr || '(none)'}</pre>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  /* ── Tab 4: Storage ── */
  const renderStorageTab = () => {
    const totalDisk = storageInfo?.totalBytes ?? storageInfo?.diskUsage ?? null;
    const snapCount = storageInfo?.snapshotCount ?? snapshots.length;
    return (
      <div style={s.storageWrap}>
        <h3 style={{ marginTop: 0, color: C.text, fontSize: 16 }}>Storage</h3>
        <div style={s.storageRow}>
          <span style={s.storageKey}>Total snapshots</span>
          <span style={s.storageVal}>{snapCount}</span>
        </div>
        <div style={s.storageRow}>
          <span style={s.storageKey}>Total disk usage</span>
          <span style={s.storageVal}>{fmtBytes(totalDisk)}</span>
        </div>
        <div style={s.storageRow}>
          <span style={s.storageKey}>Retention (days)</span>
          <input type="number" min={1} max={365}
            style={{ ...s.input, width: 100, textAlign: 'right' }}
            value={retention}
            onChange={(e) => setRetention(Number(e.target.value) || 0)} />
        </div>
        <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
          <button style={s.secondaryBtn} onClick={loadStorage}>Refresh</button>
          <button style={s.dangerBtn}
            onClick={() => alert('Cleanup endpoint not implemented yet.')}>
            Cleanup old snapshots
          </button>
        </div>
      </div>
    );
  };

  return (
    <div style={s.page} data-tour="snapshots-page">
      <header style={s.header}>
        <div style={s.titleRow}>
          <h1 style={s.title}>{'\uD83D\uDCF8'} Dashboard Snapshots</h1>
          {tab === 'snapshots' && (
            <button style={s.primaryBtn} onClick={() => setCreateModalOpen(true)}>
              + Create Snapshot
            </button>
          )}
        </div>
        <p style={s.subtitle}>
          Time-machine for Grafana dashboards — capture, compare, and catch upgrade breakage.
        </p>
      </header>

      <div style={s.tabBar}>
        <button style={tab === 'snapshots' ? s.tabActive : s.tab}
          onClick={() => setTab('snapshots')}>
          Snapshots ({snapshots.length})
        </button>
        <button style={tab === 'compare' ? s.tabActive : s.tab}
          onClick={() => setTab('compare')}>
          Compare
        </button>
        <button style={tab === 'diffs' ? s.tabActive : s.tab}
          onClick={() => setTab('diffs')}>
          Diff Review ({diffs.length})
        </button>
        <button style={tab === 'storage' ? s.tabActive : s.tab}
          onClick={() => setTab('storage')}>
          Storage
        </button>
      </div>

      {progress && <ProgressBar evt={progress} />}
      {loading && <div style={s.loadingBar} />}

      {tab === 'snapshots' && renderSnapshotsTab()}
      {tab === 'compare' && renderCompareTab()}
      {tab === 'diffs' && renderDiffsTab()}
      {tab === 'storage' && renderStorageTab()}

      {createModalOpen && (
        <CreateModal
          saving={creating}
          onSave={handleCreateSnapshot}
          onClose={() => setCreateModalOpen(false)}
        />
      )}
    </div>
  );
}
