import React, { useState, useEffect } from 'react';
import { StatCard } from '../components/Card';
import Card from '../components/Card';
import StatusBadge from '../components/StatusBadge';
import { getEnvironments, getCronJobs } from '../api/store';
import { getReports } from '../api/runner';

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
  const envs = getEnvironments();
  const jobs = getCronJobs();

  useEffect(() => {
    getReports()
      .then(data => setRuns(data))
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, []);

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

          {/* Recent Runs */}
          <Card>
            <h3 className="font-semibold text-white mb-4">Recent Runs</h3>
            {runs.length === 0 ? (
              <p className="text-sm text-muted">No test runs yet. Go to "Run Tests" to start.</p>
            ) : (
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
                      <th className="pb-2">Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.slice(0, 10).map(run => (
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
                        <td className="py-2.5 text-muted text-xs">{run.startedAt ? new Date(run.startedAt).toLocaleString() : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
