import { Environment, TestRun, CronJob } from '../types';

// Local storage-based store (replace with real API backend later)
const STORAGE_KEYS = {
  environments: 'k6ui_environments',
  testRuns: 'k6ui_test_runs',
  cronJobs: 'k6ui_cron_jobs',
};

const DEFAULT_ENVS: Environment[] = [
  { id: 'dev', name: 'DEV', label: 'Development', grafanaUrl: '', token: '', color: '#3b82f6' },
  { id: 'perf', name: 'PERF', label: 'Performance', grafanaUrl: '', token: '', color: '#eab308' },
  { id: 'prod', name: 'PROD', label: 'Production', grafanaUrl: '', token: '', color: '#ef4444' },
];

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function save<T>(key: string, data: T) {
  localStorage.setItem(key, JSON.stringify(data));
}

// Environments
export function getEnvironments(): Environment[] {
  return load(STORAGE_KEYS.environments, DEFAULT_ENVS);
}

export function saveEnvironments(envs: Environment[]) {
  save(STORAGE_KEYS.environments, envs);
}

export function updateEnvironment(env: Environment) {
  const envs = getEnvironments().map(e => e.id === env.id ? env : e);
  saveEnvironments(envs);
}

// Test Runs
export function getTestRuns(): TestRun[] {
  return load(STORAGE_KEYS.testRuns, []);
}

export function addTestRun(run: TestRun) {
  const runs = getTestRuns();
  runs.unshift(run);
  save(STORAGE_KEYS.testRuns, runs.slice(0, 100)); // keep last 100
}

export function updateTestRun(run: TestRun) {
  const runs = getTestRuns().map(r => r.id === run.id ? run : r);
  save(STORAGE_KEYS.testRuns, runs);
}

// Cron Jobs
export function getCronJobs(): CronJob[] {
  return load(STORAGE_KEYS.cronJobs, []);
}

export function saveCronJobs(jobs: CronJob[]) {
  save(STORAGE_KEYS.cronJobs, jobs);
}

export function addCronJob(job: CronJob) {
  const jobs = getCronJobs();
  jobs.push(job);
  saveCronJobs(jobs);
}

export function removeCronJob(id: string) {
  saveCronJobs(getCronJobs().filter(j => j.id !== id));
}

export function toggleCronJob(id: string) {
  const jobs = getCronJobs().map(j => j.id === id ? { ...j, enabled: !j.enabled } : j);
  saveCronJobs(jobs);
}
