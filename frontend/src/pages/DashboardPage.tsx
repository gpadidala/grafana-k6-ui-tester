import React from 'react';
import { StatCard } from '../components/Card';
import Card from '../components/Card';
import StatusBadge from '../components/StatusBadge';
import { getTestRuns, getEnvironments, getCronJobs } from '../api/store';

export default function DashboardPage() {
  const runs = getTestRuns();
  const envs = getEnvironments();
  const jobs = getCronJobs();
  const latest = runs[0];

  const totalRuns = runs.length;
  const passedRuns = runs.filter(r => r.status === 'passed').length;
  const failedRuns = runs.filter(r => r.status === 'failed').length;
  const passRate = totalRuns > 0 ? `${((passedRuns / totalRuns) * 100).toFixed(0)}%` : '-';

  const activeJobs = jobs.filter(j => j.enabled);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Dashboard</h2>
        <p className="text-sm text-muted">Last run: {latest ? new Date(latest.startedAt).toLocaleString() : 'Never'}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Runs" value={totalRuns} color="text-blue-400" />
        <StatCard label="Passed" value={passedRuns} color="text-green-400" />
        <StatCard label="Failed" value={failedRuns} color="text-red-400" />
        <StatCard label="Pass Rate" value={passRate} color={passedRuns >= totalRuns * 0.9 ? 'text-green-400' : 'text-red-400'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {envs.map(env => {
          const envRuns = runs.filter(r => r.envId === env.id);
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
                  <span className="text-green-400">{lastRun.summary.passed} passed</span>
                  <span className="text-red-400">{lastRun.summary.failed} failed</span>
                  <span className="text-muted">{lastRun.summary.pass_rate}</span>
                </div>
              )}
              {!lastRun && <p className="mt-3 text-xs text-muted">No runs yet</p>}
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
                  <th className="pb-2 pr-4">Environment</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Tests</th>
                  <th className="pb-2 pr-4">Pass Rate</th>
                  <th className="pb-2 pr-4">Level</th>
                  <th className="pb-2">Started</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 10).map(run => (
                  <tr key={run.id} className="border-b border-surface-300/50 hover:bg-surface-200 transition">
                    <td className="py-2.5 pr-4 font-medium text-white">{run.envName}</td>
                    <td className="py-2.5 pr-4"><StatusBadge status={run.status} /></td>
                    <td className="py-2.5 pr-4 text-muted">{run.summary?.total || '-'}</td>
                    <td className="py-2.5 pr-4">{run.summary?.pass_rate || '-'}</td>
                    <td className="py-2.5 pr-4 text-muted">{run.testLevel}</td>
                    <td className="py-2.5 text-muted">{new Date(run.startedAt).toLocaleString()}</td>
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
    </div>
  );
}
