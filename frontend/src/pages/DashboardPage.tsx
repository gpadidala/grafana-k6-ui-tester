import React, { useState, useEffect, useCallback } from 'react';
import { StatCard } from '../components/Card';
import Card from '../components/Card';
import StatusBadge from '../components/StatusBadge';
import { getEnvironments, getCronJobs } from '../api/store';
import { getReports, deleteReport, deleteAllReports } from '../api/runner';

interface ReportSummary {
  file: string;
  id: string;
  status: string;
  startedAt: string;
  grafanaUrl?: string;
  summary?: { total: number; passed: number; failed: number; warnings: number; pass_rate: string };
}

export default function DashboardPage() {
  const [runs, setRuns] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const envs = getEnvironments();
  const jobs = getCronJobs();

  const loadRuns = useCallback(() => {
    setLoading(true);
    getReports()
      .then(data => setRuns(data))
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  const latest = runs[0];
  const totalRuns = runs.length;
  const passedRuns = runs.filter(r => r.status === 'passed').length;
  const failedRuns = runs.filter(r => r.status === 'failed').length;
  const passRate = totalRuns > 0 ? `${((passedRuns / totalRuns) * 100).toFixed(0)}%` : '-';
  const activeJobs = jobs.filter(j => j.enabled);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">📊 Dashboard</h2>
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted">Last run: {latest?.startedAt ? new Date(latest.startedAt).toLocaleString() : 'Never'}</p>
          <button onClick={() => { setLoading(true); getReports().then(setRuns).finally(() => setLoading(false)); }}
            className="text-xs text-accent hover:text-accent-hover transition">🔄</button>
        </div>
      </div>

      {loading ? (
        <Card className="flex items-center justify-center py-8">
          <span className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin mr-3" />
          <span className="text-muted">Loading from backend...</span>
        </Card>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total Runs" value={totalRuns} color="text-blue-400" />
            <StatCard label="Passed" value={passedRuns} color="text-green-400" />
            <StatCard label="Failed" value={failedRuns} color="text-red-400" />
            <StatCard label="Pass Rate" value={passRate} color={passedRuns >= totalRuns * 0.9 ? 'text-green-400' : 'text-red-400'} />
          </div>

          {/* Environment Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {envs.map(env => {
              // Match runs by grafanaUrl since backend doesn't track envId
              const envRuns = runs.filter(r => r.grafanaUrl === env.grafanaUrl);
              const lastRun = envRuns[0];
              return (
                <Card key={env.id}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: env.color }} />
                      <h3 className="font-semibold text-white">{env.name}</h3>
                    </div>
                    {lastRun && <StatusBadge status={lastRun.status} />}
                  </div>
                  <p className="text-xs text-muted truncate">{env.grafanaUrl || 'Not configured'}</p>
                  {lastRun?.summary && (
                    <div className="mt-3 flex gap-3 text-xs">
                      <span className="text-green-400">✅ {lastRun.summary.passed}</span>
                      <span className="text-red-400">❌ {lastRun.summary.failed}</span>
                      <span className="text-yellow-400">⚠️ {lastRun.summary.warnings}</span>
                      <span className="text-muted">{lastRun.summary.pass_rate}</span>
                    </div>
                  )}
                  {!lastRun && <p className="mt-3 text-xs text-muted italic">No runs yet</p>}
                </Card>
              );
            })}
          </div>

          {/* Recent Runs with Pagination + Delete */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white">Recent Runs</h3>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  <span>Show</span>
                  <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                    className="bg-surface-200 border border-surface-300 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-accent">
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                  <span>per page</span>
                </div>
                {runs.length > 0 && (
                  <button onClick={() => {
                    if (window.confirm(`Are you sure you want to delete ALL ${runs.length} report(s)?\n\nThis action cannot be undone.`)) {
                      deleteAllReports().then(() => loadRuns());
                    }
                  }} className="px-2 py-1 text-xs bg-red-900/30 hover:bg-red-900/50 text-red-400 hover:text-red-300 border border-red-800/50 rounded transition">
                    🗑️ Delete All
                  </button>
                )}
              </div>
            </div>

            {runs.length === 0 ? (
              <p className="text-sm text-muted">No test runs yet. Go to "Run Tests" to start.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted uppercase tracking-wider border-b border-surface-300">
                        <th className="pb-2 pr-4">Status</th>
                        <th className="pb-2 pr-4">Grafana URL</th>
                        <th className="pb-2 pr-4">Tests</th>
                        <th className="pb-2 pr-4">Pass Rate</th>
                        <th className="pb-2 pr-4">Passed</th>
                        <th className="pb-2 pr-4">Failed</th>
                        <th className="pb-2 pr-4">Started</th>
                        <th className="pb-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.slice((page - 1) * pageSize, page * pageSize).map(run => (
                        <tr key={run.id} className="border-b border-surface-300/50 hover:bg-surface-200 transition">
                          <td className="py-2.5 pr-4"><StatusBadge status={run.status} /></td>
                          <td className="py-2.5 pr-4 text-white text-xs truncate max-w-[200px]">{run.grafanaUrl || '-'}</td>
                          <td className="py-2.5 pr-4 text-muted">{run.summary?.total || '-'}</td>
                          <td className="py-2.5 pr-4">
                            <span className={parseFloat(run.summary?.pass_rate || '0') >= 90 ? 'text-green-400' : 'text-red-400'}>
                              {run.summary?.pass_rate || '-'}
                            </span>
                          </td>
                          <td className="py-2.5 pr-4 text-green-400">{run.summary?.passed || 0}</td>
                          <td className="py-2.5 pr-4 text-red-400">{run.summary?.failed || 0}</td>
                          <td className="py-2.5 pr-4 text-muted text-xs">{run.startedAt ? new Date(run.startedAt).toLocaleString() : '-'}</td>
                          <td className="py-2.5">
                            <button onClick={() => {
                              if (window.confirm('Are you sure you want to delete this report?')) {
                                deleteReport(run.file).then(() => loadRuns());
                              }
                            }} className="text-red-500/40 hover:text-red-400 transition text-sm" title="Delete">🗑️</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                {runs.length > pageSize && (
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-surface-300">
                    <span className="text-xs text-muted">
                      Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, runs.length)} of {runs.length}
                    </span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setPage(1)} disabled={page === 1}
                        className={`px-2 py-1 rounded text-xs transition ${page === 1 ? 'text-gray-600 cursor-not-allowed' : 'text-muted hover:text-white hover:bg-surface-200'}`}>
                        «
                      </button>
                      <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                        className={`px-2 py-1 rounded text-xs transition ${page === 1 ? 'text-gray-600 cursor-not-allowed' : 'text-muted hover:text-white hover:bg-surface-200'}`}>
                        ‹
                      </button>
                      {Array.from({ length: Math.ceil(runs.length / pageSize) }, (_, i) => i + 1)
                        .filter(p => p === 1 || p === Math.ceil(runs.length / pageSize) || Math.abs(p - page) <= 1)
                        .map((p, idx, arr) => (
                          <React.Fragment key={p}>
                            {idx > 0 && arr[idx - 1] !== p - 1 && <span className="text-gray-600 px-1">...</span>}
                            <button onClick={() => setPage(p)}
                              className={`px-2.5 py-1 rounded text-xs transition ${p === page ? 'bg-accent text-white' : 'text-muted hover:text-white hover:bg-surface-200'}`}>
                              {p}
                            </button>
                          </React.Fragment>
                        ))}
                      <button onClick={() => setPage(p => Math.min(Math.ceil(runs.length / pageSize), p + 1))} disabled={page >= Math.ceil(runs.length / pageSize)}
                        className={`px-2 py-1 rounded text-xs transition ${page >= Math.ceil(runs.length / pageSize) ? 'text-gray-600 cursor-not-allowed' : 'text-muted hover:text-white hover:bg-surface-200'}`}>
                        ›
                      </button>
                      <button onClick={() => setPage(Math.ceil(runs.length / pageSize))} disabled={page >= Math.ceil(runs.length / pageSize)}
                        className={`px-2 py-1 rounded text-xs transition ${page >= Math.ceil(runs.length / pageSize) ? 'text-gray-600 cursor-not-allowed' : 'text-muted hover:text-white hover:bg-surface-200'}`}>
                        »
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>

          {/* Active Schedules */}
          {activeJobs.length > 0 && (
            <Card>
              <h3 className="font-semibold text-white mb-3">Active Schedules</h3>
              <div className="space-y-2">
                {activeJobs.map(job => (
                  <div key={job.id} className="flex items-center justify-between py-2 border-b border-surface-300/50">
                    <div>
                      <span className="text-white font-medium">{job.envName}</span>
                      <span className="text-muted text-xs ml-2">{job.schedule}</span>
                    </div>
                    <span className="text-xs text-muted">{job.testLevel}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
