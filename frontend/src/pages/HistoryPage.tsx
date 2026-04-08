import React, { useState } from 'react';
import Card from '../components/Card';
import StatusBadge from '../components/StatusBadge';
import AIAnalysis from '../components/AIAnalysis';
import { getTestRuns } from '../api/store';
import { TestRun } from '../types';

export default function HistoryPage() {
  const [runs] = useState(getTestRuns());
  const [selectedRun, setSelectedRun] = useState<TestRun | null>(null);
  const [envFilter, setEnvFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const filtered = runs.filter(r => {
    if (envFilter && r.envId !== envFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    return true;
  });

  const envIds = Array.from(new Set(runs.map(r => r.envId)));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Report History</h2>
        <p className="text-sm text-muted">{runs.length} total runs</p>
      </div>

      {/* Filters */}
      <Card className="flex flex-wrap gap-3 items-center">
        <select
          value={envFilter}
          onChange={e => setEnvFilter(e.target.value)}
          className="bg-surface-200 border border-surface-300 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
        >
          <option value="">All Environments</option>
          {envIds.map(id => (
            <option key={id} value={id}>{runs.find(r => r.envId === id)?.envName || id}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-surface-200 border border-surface-300 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
        >
          <option value="">All Statuses</option>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
          <option value="running">Running</option>
        </select>
        <span className="text-sm text-muted ml-auto">{filtered.length} results</span>
      </Card>

      {/* Runs List */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <Card><p className="text-muted text-sm">No test runs found.</p></Card>
        ) : (
          filtered.map(run => (
            <Card
              key={run.id}
              className={`cursor-pointer hover:border-accent/50 transition ${selectedRun?.id === run.id ? 'border-accent' : ''}`}
            >
              <div onClick={() => setSelectedRun(selectedRun?.id === run.id ? null : run)}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={run.status} size="md" />
                    <div>
                      <span className="font-semibold text-white">{run.envName}</span>
                      <span className="text-muted text-xs ml-2">{run.testLevel}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-white">{run.summary ? `${run.summary.passed}/${run.summary.total} passed` : '-'}</p>
                    <p className="text-xs text-muted">{new Date(run.startedAt).toLocaleString()}</p>
                  </div>
                </div>

                {run.summary && (
                  <div className="flex gap-4 mt-3 text-xs">
                    <span className="text-green-400">{run.summary.passed} passed</span>
                    <span className="text-red-400">{run.summary.failed} failed</span>
                    <span className="text-yellow-400">{run.summary.warnings} warnings</span>
                    <span className="text-muted">Pass rate: {run.summary.pass_rate}</span>
                    <span className="text-muted truncate max-w-[300px]">{run.grafanaUrl}</span>
                  </div>
                )}
              </div>

              {/* Expanded Detail */}
              {selectedRun?.id === run.id && run.results && (
                <div className="mt-4 pt-4 border-t border-surface-300">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted uppercase tracking-wider border-b border-surface-300">
                          <th className="pb-2 pr-3">#</th>
                          <th className="pb-2 pr-3">Category</th>
                          <th className="pb-2 pr-3">Name</th>
                          <th className="pb-2 pr-3">Status</th>
                          <th className="pb-2 pr-3">Load</th>
                          <th className="pb-2">Error / Comment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {run.results.map((r, i) => (
                          <tr key={i} className="border-b border-surface-300/20 hover:bg-surface-200 transition">
                            <td className="py-1.5 pr-3 text-muted">{i + 1}</td>
                            <td className="py-1.5 pr-3 text-muted">{r.category}</td>
                            <td className="py-1.5 pr-3 text-white">{r.name}</td>
                            <td className="py-1.5 pr-3"><StatusBadge status={r.status} /></td>
                            <td className="py-1.5 pr-3 text-muted">{r.load_time_ms}ms</td>
                            <td className="py-1.5 text-xs text-muted max-w-sm truncate">{r.error || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4">
                    <AIAnalysis run={run} />
                  </div>
                </div>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
