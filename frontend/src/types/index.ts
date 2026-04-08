export interface Environment {
  id: string;
  name: string;           // DEV, PERF, PROD
  label: string;
  grafanaUrl: string;
  token: string;
  color: string;
}

export interface TestRun {
  id: string;
  envId: string;
  envName: string;
  grafanaUrl: string;
  status: 'running' | 'passed' | 'failed' | 'pending';
  startedAt: string;
  completedAt?: string;
  testLevel: string;
  summary?: TestSummary;
  results?: TestResult[];
  reportHtml?: string;
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
  pass_rate: string;
}

export interface TestResult {
  category: string;
  name: string;
  uid: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  load_time_ms: number;
  error: string | null;
  created_by?: string;
  updated_by?: string;
  created?: string;
  updated?: string;
}

export interface CronJob {
  id: string;
  envId: string;
  envName: string;
  schedule: string;       // cron expression
  testLevel: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
}

export interface LLMConfig {
  provider: 'openai' | 'claude' | 'none';
  apiKey: string;
  model: string;
}

export type Page = 'dashboard' | 'run-test' | 'history' | 'environments' | 'cron';
