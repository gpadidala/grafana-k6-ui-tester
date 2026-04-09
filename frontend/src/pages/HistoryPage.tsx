import React, { useState, useEffect, useCallback } from 'react';
import Card from '../components/Card';
import StatusBadge from '../components/StatusBadge';
import AIAnalysis from '../components/AIAnalysis';
import { getReports, getReport, deleteReport, deleteAllReports } from '../api/runner';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:4000';

interface ReportSummary {
  file: string;
  htmlFile?: string | null;
  id: string;
  status: string;
  startedAt: string;
  summary?: { total: number; passed: number; failed: number; warnings: number; pass_rate: string };
  grafanaUrl?: string;
}

export default function HistoryPage() {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getReports();
      setReports(data);
    } catch {
      setReports([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadReports(); }, [loadReports]);

  async function handleExpand(file: string) {
    if (selectedFile === file) {
      setSelectedFile(null);
      setSelectedReport(null);
      return;
    }
    setSelectedFile(file);
    try {
      const detail = await getReport(file);
      setSelectedReport(detail);
    } catch {
      setSelectedReport(null);
    }
  }

  async function handleDeleteOne(file: string) {
    if (!window.confirm('Are you sure you want to delete this report?')) return;
    await deleteReport(file);
    if (selectedFile === file) { setSelectedFile(null); setSelectedReport(null); }
    loadReports();
  }

  async function handleDeleteAll() {
    if (!window.confirm(`Are you sure you want to delete ALL ${reports.length} report(s)?\n\nThis action cannot be undone.`)) return;
    const count = await deleteAllReports();
    setSelectedFile(null);
    setSelectedReport(null);
    loadReports();
    alert(`${count} report(s) deleted.`);
  }

  const filtered = reports.filter(r => {
    if (statusFilter && r.status !== statusFilter) return false;
    return true;
  });

  // Build a shape that AIAnalysis can consume from a backend report
  function toAIRun(report: any) {
    if (!report) return null;
    return {
      ...report,
      envName: report.grafanaUrl || 'unknown',
      testLevel: 'full',
      results: (report.categories || []).flatMap((c: any) =>
        (c.tests || []).map((t: any) => ({
          category: c.name, name: t.name, uid: t.uid || '', status: t.status,
          load_time_ms: t.ms || 0, error: t.detail || null,
        }))
      ),
    };
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">📋 Report History</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">{reports.length} report(s)</span>
          {reports.length > 0 && (
            <button onClick={handleDeleteAll}
              className="px-3 py-1.5 text-xs bg-red-900/30 hover:bg-red-900/50 text-red-400 hover:text-red-300 border border-red-800/50 rounded-lg transition">
              🗑️ Delete All
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <Card className="flex flex-wrap gap-3 items-center">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="bg-surface-200 border border-surface-300 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent">
          <option value="">All Statuses</option>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
        </select>
        <button onClick={loadReports} className="px-3 py-2 text-xs bg-surface-200 hover:bg-surface-300 text-muted hover:text-white rounded-lg transition">
          🔄 Refresh
        </button>
        <span className="text-sm text-muted ml-auto">{filtered.length} results</span>
      </Card>

      {/* Loading */}
      {loading && (
        <Card className="flex items-center justify-center py-8">
          <span className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin mr-3" />
          <span className="text-muted">Loading reports...</span>
        </Card>
      )}

      {/* Report List */}
      {!loading && filtered.length === 0 && (
        <Card><p className="text-muted text-sm">No reports found. Go to "Run Tests" to generate one.</p></Card>
      )}

      {!loading && filtered.map(rpt => (
        <Card key={rpt.file} className={`transition ${selectedFile === rpt.file ? 'border-accent' : 'hover:border-accent/30'}`}>
          {/* Header Row */}
          <div className="flex items-center justify-between cursor-pointer" onClick={() => handleExpand(rpt.file)}>
            <div className="flex items-center gap-3">
              <StatusBadge status={rpt.status} size="md" />
              <div>
                <p className="font-semibold text-white text-sm">{rpt.file.replace('.json', '')}</p>
                <p className="text-xs text-muted truncate max-w-[300px]">{rpt.grafanaUrl || '-'}</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {rpt.summary && (
                <div className="text-right">
                  <p className="text-sm text-white">{rpt.summary.passed}/{rpt.summary.total} passed</p>
                  <p className="text-xs text-muted">{rpt.summary.pass_rate}</p>
                </div>
              )}
              <div className="text-right">
                <p className="text-xs text-muted">{rpt.startedAt ? new Date(rpt.startedAt).toLocaleString() : '-'}</p>
              </div>
              {rpt.htmlFile && (
                <a href={`${API_BASE}/api/reports/html/${rpt.htmlFile}`} target="_blank" rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="px-2 py-1 text-xs bg-accent/20 hover:bg-accent/30 text-accent rounded transition" title="Open HTML report">
                  📄 HTML
                </a>
              )}
              <button onClick={(e) => { e.stopPropagation(); handleDeleteOne(rpt.file); }}
                className="text-red-500/50 hover:text-red-400 text-sm transition p-1" title="Delete report">
                🗑️
              </button>
              <span className="text-muted text-sm">{selectedFile === rpt.file ? '▲' : '▼'}</span>
            </div>
          </div>

          {/* Summary Stats Row */}
          {rpt.summary && (
            <div className="flex gap-4 mt-2 text-xs">
              <span className="text-green-400">✅ {rpt.summary.passed} passed</span>
              <span className="text-red-400">❌ {rpt.summary.failed} failed</span>
              <span className="text-yellow-400">⚠️ {rpt.summary.warnings} warnings</span>
            </div>
          )}

          {/* Expanded Detail */}
          {selectedFile === rpt.file && selectedReport && (
            <div className="mt-4 pt-4 border-t border-surface-300 space-y-4">
              {/* Category-level results */}
              {(selectedReport.categories || []).map((cat: any) => (
                <details key={cat.id} className="group">
                  <summary className="flex items-center justify-between p-3 bg-surface-200 rounded-lg cursor-pointer hover:bg-surface-300 transition">
                    <div className="flex items-center gap-2">
                      <span>{cat.icon}</span>
                      <span className="font-medium text-white">{cat.name}</span>
                      <span className="text-xs text-muted">{cat.summary?.passed}/{cat.summary?.total}</span>
                    </div>
                    <StatusBadge status={cat.status} />
                  </summary>
                  <div className="mt-1 space-y-0">
                    <table className="w-full text-sm ml-6">
                      <tbody>
                        {(cat.tests || []).map((t: any, i: number) => (
                          <tr key={i} className="border-b border-surface-300/20 hover:bg-surface-200 transition">
                            <td className="py-1.5 pr-3 w-8">
                              <StatusBadge status={t.status} />
                            </td>
                            <td className="py-1.5 pr-3 text-white">{t.name}</td>
                            <td className="py-1.5 pr-3 text-xs text-muted w-16">{t.ms ? `${t.ms}ms` : ''}</td>
                            <td className="py-1.5 text-xs text-muted max-w-md truncate">{t.detail || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))}

              {/* AI Analysis */}
              {selectedReport.categories?.some((c: any) => c.tests?.some((t: any) => t.status === 'FAIL' || t.status === 'WARN')) && (
                <AIAnalysis run={toAIRun(selectedReport)} />
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
