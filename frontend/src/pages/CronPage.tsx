import React, { useState } from 'react';
import Card from '../components/Card';
import { getEnvironments, getCronJobs, addCronJob, removeCronJob, toggleCronJob } from '../api/store';
import { CronJob } from '../types';

const SCHEDULE_PRESETS = [
  { label: 'Every 30 minutes', cron: '*/30 * * * *' },
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Daily at 6 AM', cron: '0 6 * * *' },
  { label: 'Weekly Monday 6 AM', cron: '0 6 * * 1' },
  { label: 'Custom', cron: '' },
];

export default function CronPage() {
  const envs = getEnvironments();
  const [jobs, setJobs] = useState(getCronJobs());
  const [showAdd, setShowAdd] = useState(false);
  const [newEnv, setNewEnv] = useState(envs[0]?.id || '');
  const [newSchedule, setNewSchedule] = useState('0 6 * * *');
  const [newLevel, setNewLevel] = useState('full');
  const [customCron, setCustomCron] = useState('');

  function handleAdd() {
    const env = envs.find(e => e.id === newEnv);
    if (!env?.grafanaUrl) { alert('Configure the environment URL first'); return; }

    const schedule = newSchedule || customCron;
    if (!schedule) { alert('Select or enter a schedule'); return; }

    const job: CronJob = {
      id: `cron-${Date.now()}`,
      envId: env.id,
      envName: env.name,
      schedule,
      testLevel: newLevel,
      enabled: true,
      nextRun: 'Pending backend setup',
    };

    addCronJob(job);
    setJobs(getCronJobs());
    setShowAdd(false);
  }

  function handleToggle(id: string) {
    toggleCronJob(id);
    setJobs(getCronJobs());
  }

  function handleDelete(id: string) {
    if (!window.confirm('Delete this schedule?')) return;
    removeCronJob(id);
    setJobs(getCronJobs());
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Scheduled Tests</h2>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition"
        >
          {showAdd ? 'Cancel' : '+ Add Schedule'}
        </button>
      </div>

      <p className="text-sm text-muted">Schedule recurring test runs. These will run automatically via the backend cron service.</p>

      {/* Add Form */}
      {showAdd && (
        <Card className="border-accent">
          <h3 className="font-semibold text-white mb-4">New Schedule</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-muted uppercase tracking-wider mb-2">Environment</label>
              <select
                value={newEnv}
                onChange={e => setNewEnv(e.target.value)}
                className="w-full bg-surface-200 border border-surface-300 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-accent"
              >
                {envs.map(e => (
                  <option key={e.id} value={e.id}>{e.name} — {e.grafanaUrl || 'Not configured'}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-muted uppercase tracking-wider mb-2">Schedule</label>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                {SCHEDULE_PRESETS.map(preset => (
                  <button
                    key={preset.label}
                    onClick={() => setNewSchedule(preset.cron)}
                    className={`p-2.5 rounded-lg border text-left text-sm transition ${
                      newSchedule === preset.cron
                        ? 'border-accent bg-accent/10 text-white'
                        : 'border-surface-300 bg-surface-200 text-muted hover:text-white'
                    }`}
                  >
                    <span className="block">{preset.label}</span>
                    {preset.cron && <span className="block text-xs text-muted font-mono">{preset.cron}</span>}
                  </button>
                ))}
              </div>
              {newSchedule === '' && (
                <input
                  type="text"
                  value={customCron}
                  onChange={e => setCustomCron(e.target.value)}
                  placeholder="*/15 * * * *"
                  className="w-full mt-2 bg-surface-200 border border-surface-300 rounded-lg px-4 py-2.5 text-white font-mono placeholder-gray-500 focus:outline-none focus:border-accent"
                />
              )}
            </div>

            <div>
              <label className="block text-xs text-muted uppercase tracking-wider mb-2">Test Level</label>
              <div className="flex gap-2">
                {['smoke', 'standard', 'full'].map(l => (
                  <button
                    key={l}
                    onClick={() => setNewLevel(l)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition capitalize ${
                      newLevel === l ? 'bg-accent text-white' : 'bg-surface-200 text-muted hover:text-white'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleAdd}
              className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition"
            >
              Create Schedule
            </button>
          </div>
        </Card>
      )}

      {/* Schedules List */}
      {jobs.length === 0 ? (
        <Card><p className="text-muted text-sm">No scheduled tests. Click "+ Add Schedule" to create one.</p></Card>
      ) : (
        <div className="space-y-3">
          {jobs.map(job => (
            <Card key={job.id} className={!job.enabled ? 'opacity-50' : ''}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => handleToggle(job.id)}
                    className={`w-10 h-5 rounded-full transition relative ${job.enabled ? 'bg-accent' : 'bg-surface-300'}`}
                  >
                    <span className={`absolute w-4 h-4 rounded-full bg-white top-0.5 transition-all ${job.enabled ? 'left-5' : 'left-0.5'}`} />
                  </button>
                  <div>
                    <span className="font-semibold text-white">{job.envName}</span>
                    <span className="text-muted text-xs ml-2">{job.testLevel}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-mono text-muted">{job.schedule}</span>
                  <button
                    onClick={() => handleDelete(job.id)}
                    className="text-red-400 hover:text-red-300 text-sm transition"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {job.lastRun && <p className="text-xs text-muted mt-2">Last run: {job.lastRun}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
