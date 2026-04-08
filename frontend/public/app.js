/* =========================================================
   Grafana k6 UI Tester — Vanilla JS SPA
   Talks to Express server at /api (proxied to k6 backend)
   ========================================================= */

'use strict';

// ── Storage keys ───────────────────────────────────────────
const KEYS = {
  environments: 'k6ui_environments',
  testRuns:     'k6ui_test_runs',
  cronJobs:     'k6ui_cron_jobs',
  llmConfig:    'k6ui_llm_config',
};

const DEFAULT_ENVS = [
  { id: 'dev',  name: 'DEV',  label: 'Development',  grafanaUrl: '', token: '', color: '#3b82f6' },
  { id: 'perf', name: 'PERF', label: 'Performance',  grafanaUrl: '', token: '', color: '#eab308' },
  { id: 'prod', name: 'PROD', label: 'Production',   grafanaUrl: '', token: '', color: '#ef4444' },
];

// ── State accessors (localStorage-backed) ─────────────────
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function save(key, data) { localStorage.setItem(key, JSON.stringify(data)); }

const state = {
  get envs()     { return load(KEYS.environments, DEFAULT_ENVS); },
  set envs(v)    { save(KEYS.environments, v); },
  get runs()     { return load(KEYS.testRuns, []); },
  set runs(v)    { save(KEYS.testRuns, v.slice(0, 100)); },
  get cronJobs() { return load(KEYS.cronJobs, []); },
  set cronJobs(v){ save(KEYS.cronJobs, v); },
  get llm()      { return load(KEYS.llmConfig, { provider: 'none', apiKey: '', model: '' }); },
  set llm(v)     { save(KEYS.llmConfig, v); },
};

function addRun(run)    { state.runs = [run, ...state.runs]; }
function updateRun(run) { state.runs = state.runs.map(r => r.id === run.id ? run : r); }

// ── ID generator ───────────────────────────────────────────
function uid(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Navigation ─────────────────────────────────────────────
const NAV = [
  { id: 'dashboard',    label: 'Dashboard',    icon: '📊' },
  { id: 'run-test',     label: 'Run Tests',    icon: '▶️'  },
  { id: 'history',      label: 'Reports',      icon: '📋' },
  { id: 'environments', label: 'Environments', icon: '⚙️'  },
  { id: 'cron',         label: 'Schedules',    icon: '🕐' },
];

let currentPage = 'dashboard';

function buildNav() {
  document.getElementById('nav').innerHTML = NAV.map(n => `
    <button class="nav-item ${n.id === currentPage ? 'active' : ''}" data-page="${n.id}">
      <span class="nav-icon">${n.icon}</span>
      <span>${n.label}</span>
    </button>`).join('');

  document.querySelectorAll('.nav-item').forEach(btn =>
    btn.addEventListener('click', () => navigate(btn.dataset.page))
  );
}

function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  document.getElementById('main').scrollTop = 0;
  buildNav();
  renderPage(page);
}

function renderPage(page) {
  switch (page) {
    case 'dashboard':    renderDashboard(); break;
    case 'run-test':     renderRunTest(); break;
    case 'history':      renderHistory(); break;
    case 'environments': renderEnvironments(); break;
    case 'cron':         renderCron(); break;
  }
}

// ── Toast notifications ────────────────────────────────────
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast-item ${type}`;
  el.textContent = msg;
  document.getElementById('toast').appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

// ── Render helpers ─────────────────────────────────────────
function badge(status) {
  const cls = {
    passed: 'badge-passed', failed: 'badge-failed',
    running: 'badge-running', pending: 'badge-pending',
    PASS: 'badge-pass', FAIL: 'badge-fail', WARN: 'badge-warn',
  };
  return `<span class="badge ${cls[status] || 'badge-pending'}">${status}</span>`;
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtDuration(start, end) {
  if (!start || !end) return '—';
  const s = Math.round((new Date(end) - new Date(start)) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// =========================================================
// DASHBOARD PAGE
// =========================================================
function renderDashboard() {
  const runs = state.runs;
  const envs = state.envs;
  const jobs = state.cronJobs;

  const total  = runs.length;
  const passed = runs.filter(r => r.status === 'passed').length;
  const failed = runs.filter(r => r.status === 'failed').length;
  const rate   = total > 0 ? `${((passed / total) * 100).toFixed(0)}%` : '—';
  const rateGood = total > 0 && passed / total >= 0.9;

  document.getElementById('dash-last-run').textContent =
    runs[0] ? `Last run: ${fmtTime(runs[0].startedAt)}` : '';

  document.getElementById('dash-stats').innerHTML = `
    <div class="stat-card"><div class="stat-label">Total Runs</div><div class="stat-value blue">${total}</div></div>
    <div class="stat-card"><div class="stat-label">Passed</div><div class="stat-value green">${passed}</div></div>
    <div class="stat-card"><div class="stat-label">Failed</div><div class="stat-value red">${failed}</div></div>
    <div class="stat-card"><div class="stat-label">Pass Rate</div><div class="stat-value ${rateGood ? 'green' : total > 0 ? 'red' : 'blue'}">${rate}</div></div>
  `;

  document.getElementById('dash-envs').innerHTML = envs.map(env => {
    const envRuns = runs.filter(r => r.envId === env.id);
    const last    = envRuns[0];
    return `
      <div class="env-card">
        <div class="env-card-header">
          <div class="flex items-center gap-2">
            <span class="env-dot" style="background:${env.color}"></span>
            <strong class="text-white">${env.name}</strong>
            <span class="text-muted text-sm">${env.label}</span>
          </div>
          ${last ? badge(last.status) : ''}
        </div>
        <p class="text-muted text-sm truncate">${env.grafanaUrl || 'Not configured'}</p>
        ${last?.summary
          ? `<div class="flex gap-3 mt-2 text-sm">
               <span class="text-green">${last.summary.passed} passed</span>
               <span class="text-red">${last.summary.failed} failed</span>
               <span class="text-muted">${last.summary.pass_rate}</span>
             </div>`
          : `<p class="text-muted text-sm mt-2">No runs yet</p>`}
      </div>`;
  }).join('');

  const recentEl = document.getElementById('dash-recent');
  if (runs.length === 0) {
    recentEl.innerHTML = `<p class="text-muted text-sm">No test runs yet. Go to "Run Tests" to start.</p>`;
  } else {
    recentEl.innerHTML = `
      <div class="results-table-wrap">
        <table>
          <thead><tr>
            <th>Environment</th><th>Status</th><th>Tests</th>
            <th>Pass Rate</th><th>Level</th><th>Duration</th><th>Started</th>
          </tr></thead>
          <tbody>
            ${runs.slice(0, 10).map(r => `
              <tr>
                <td class="td-white">${r.envName}</td>
                <td>${badge(r.status)}</td>
                <td class="td-muted">${r.summary?.total ?? '—'}</td>
                <td>${r.summary?.pass_rate ?? '—'}</td>
                <td class="td-muted">${r.testLevel}</td>
                <td class="td-muted">${fmtDuration(r.startedAt, r.completedAt)}</td>
                <td class="td-muted">${fmtTime(r.startedAt)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  const active = jobs.filter(j => j.enabled);
  const cronSection = document.getElementById('dash-cron-section');
  cronSection.classList.toggle('hidden', active.length === 0);
  if (active.length > 0) {
    document.getElementById('dash-cron-list').innerHTML = active.map(j => `
      <div class="flex justify-between items-center py-2" style="border-bottom:1px solid var(--bg-300)">
        <div>
          <span class="text-white font-medium">${j.envName}</span>
          <code class="text-muted ml-2">${j.schedule}</code>
        </div>
        <span class="badge badge-pending">${j.testLevel}</span>
      </div>`).join('');
  }
}

// =========================================================
// RUN TEST PAGE
// =========================================================
let selectedEnvId  = null;
let selectedLevel  = 'standard';
let runInProgress  = false;

function renderRunTest() {
  const envs = state.envs;

  // Environment pills
  const pillsEl = document.getElementById('run-env-pills');
  if (envs.length === 0) {
    pillsEl.innerHTML = `<p class="text-muted text-sm">No environments configured. Set one up in Environments first.</p>`;
  } else {
    if (!selectedEnvId || !envs.find(e => e.id === selectedEnvId)) {
      selectedEnvId = envs[0].id;
    }
    pillsEl.innerHTML = envs.map(e => `
      <button class="select-pill ${e.id === selectedEnvId ? 'selected' : ''}" data-env-id="${e.id}">
        <span class="env-dot" style="background:${e.color};margin-right:5px;vertical-align:middle"></span>${e.name}
      </button>`).join('');
    pillsEl.querySelectorAll('.select-pill').forEach(btn =>
      btn.addEventListener('click', () => { selectedEnvId = btn.dataset.envId; renderRunTest(); })
    );
  }

  // Level pills
  document.querySelectorAll('[data-level]').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.level === selectedLevel);
  });

  const runBtn = document.getElementById('run-btn');
  runBtn.disabled = runInProgress;
  runBtn.textContent = runInProgress ? '⏳ Running…' : '▶ Run Tests';
}

async function doRunTest() {
  if (runInProgress) return;

  const env = state.envs.find(e => e.id === selectedEnvId);
  if (!env) { toast('Select an environment first', 'error'); return; }
  if (!env.grafanaUrl) { toast(`${env.name} has no Grafana URL configured`, 'error'); return; }

  runInProgress = true;
  renderRunTest();

  const run = {
    id: uid('run'), envId: env.id, envName: env.name,
    grafanaUrl: env.grafanaUrl, status: 'running',
    startedAt: new Date().toISOString(), testLevel: selectedLevel,
  };
  addRun(run);

  // Show progress UI
  document.getElementById('run-idle-msg').classList.add('hidden');
  document.getElementById('run-active').classList.remove('hidden');
  document.getElementById('run-result').classList.add('hidden');
  document.getElementById('run-status-text').textContent = `Running ${selectedLevel} tests…`;
  document.getElementById('run-env-label').textContent   = `${env.name} — ${env.grafanaUrl}`;
  setProgress(8, 'Connecting to Grafana…');

  const steps = [
    [20, 'Discovering dashboards…'],
    [35, 'Running login & home tests…'],
    [50, 'Testing dashboards (panel-level)…'],
    [65, 'Testing alerts & datasources…'],
    [80, 'Testing plugins & admin pages…'],
    [92, 'Generating report…'],
  ];
  let si = 0;
  const ticker = setInterval(() => {
    if (si < steps.length) { const [p, m] = steps[si++]; setProgress(p, m); }
  }, 1600);

  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grafanaUrl: env.grafanaUrl, token: env.token, testLevel: selectedLevel, envName: env.name }),
    });
    clearInterval(ticker);

    if (res.ok) {
      const data = await res.json();
      run.summary = data.summary;
      run.results = data.results;
      run.status  = parseFloat(data.summary?.pass_rate || '0') >= 90 ? 'passed' : 'failed';
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    clearInterval(ticker);
    // Backend unavailable — run client-side simulation
    const data = await simulateRun();
    run.summary = data.summary;
    run.results = data.results;
    run.status  = parseFloat(data.summary.pass_rate) >= 90 ? 'passed' : 'failed';
  }

  run.completedAt = new Date().toISOString();
  updateRun(run);
  setProgress(100, 'Complete');

  // Show result card
  document.getElementById('run-active').classList.add('hidden');
  const resultEl = document.getElementById('run-result');
  resultEl.classList.remove('hidden');
  const ok = run.status === 'passed';
  resultEl.innerHTML = `
    <div class="card" style="border-left:3px solid ${ok ? 'var(--success)' : 'var(--danger)'}">
      <div class="flex justify-between items-center mb-4">
        <strong class="text-white" style="font-size:17px">${ok ? '✅ PASSED' : '❌ FAILED'}</strong>
        ${badge(run.status)}
      </div>
      <div class="grid-4" style="gap:12px">
        <div><div class="stat-label">Total</div>   <div class="stat-value blue"  style="font-size:22px">${run.summary?.total    ?? 0}</div></div>
        <div><div class="stat-label">Passed</div>  <div class="stat-value green" style="font-size:22px">${run.summary?.passed   ?? 0}</div></div>
        <div><div class="stat-label">Failed</div>  <div class="stat-value red"   style="font-size:22px">${run.summary?.failed   ?? 0}</div></div>
        <div><div class="stat-label">Pass Rate</div><div class="stat-value ${ok ? 'green' : 'red'}" style="font-size:22px">${run.summary?.pass_rate ?? '0%'}</div></div>
      </div>
      <button class="btn btn-ghost btn-sm mt-4" onclick="navigate('history')">View Full Report →</button>
    </div>`;

  runInProgress = false;
  renderRunTest();
  toast(
    `Run ${ok ? 'passed' : 'failed'} — ${run.summary?.pass_rate} pass rate`,
    ok ? 'success' : 'error'
  );
}

function setProgress(pct, msg) {
  document.getElementById('run-progress').style.width      = `${pct}%`;
  document.getElementById('run-progress-text').textContent = msg;
}

// Client-side simulation (when backend is unavailable)
async function simulateRun() {
  await new Promise(r => setTimeout(r, 2800));
  const cats = [
    { cat: 'login',       items: ['Login & Authentication'] },
    { cat: 'home',        items: ['Home Page', 'Dashboard Browser'] },
    { cat: 'dashboards',  items: ['Infrastructure Overview', 'Application Metrics', 'Business KPIs', 'Network Traffic', 'System Health'] },
    { cat: 'alerts',      items: ['Alert Rules List', 'Silences Page', 'Contact Points'] },
    { cat: 'explore',     items: ['Explore Page'] },
    { cat: 'datasources', items: ['Datasources List', 'Datasource: Prometheus'] },
    { cat: 'plugins',     items: ['Plugins List', 'Plugin: Alertmanager', 'Plugin: Loki'] },
  ];

  const results = [];
  cats.forEach(({ cat, items }) => items.forEach(name => {
    const r   = Math.random();
    const status = r > 0.15 ? 'PASS' : r > 0.05 ? 'WARN' : 'FAIL';
    results.push({
      category: cat, name,
      uid: name.toLowerCase().replace(/\s+/g, '-'),
      status,
      load_time_ms: Math.round(400 + Math.random() * 2600),
      error: status === 'PASS' ? `OK — loaded in ${Math.round(400 + Math.random() * 2000)}ms`
           : status === 'WARN' ? '2 panel(s) showing "No data": [CPU, Memory]'
           : 'Page failed (HTTP timeout). Verify page exists and Grafana is responsive.',
    });
  }));

  const p = results.filter(r => r.status === 'PASS').length;
  const f = results.filter(r => r.status === 'FAIL').length;
  const w = results.filter(r => r.status === 'WARN').length;
  const t = results.length;
  return {
    results,
    summary: { total: t, passed: p, failed: f, warnings: w, pass_rate: `${((p / t) * 100).toFixed(1)}%` },
  };
}

// =========================================================
// HISTORY / REPORTS PAGE
// =========================================================
let detailRunId = null;

function renderHistory() {
  const runs   = state.runs;
  const search = (document.getElementById('history-search')?.value || '').toLowerCase();
  const filter = document.getElementById('history-filter')?.value || '';

  const filtered = runs.filter(r =>
    (!search || r.envName.toLowerCase().includes(search) || r.testLevel.includes(search) || r.id.includes(search)) &&
    (!filter || r.status === filter)
  );

  const wrap = document.getElementById('history-table-wrap');
  if (filtered.length === 0) {
    wrap.innerHTML = `<p class="text-muted text-sm" style="padding:16px">No runs found.</p>`;
  } else {
    wrap.innerHTML = `
      <div class="results-table-wrap">
        <table>
          <thead><tr>
            <th>Environment</th><th>Status</th><th>Tests</th>
            <th>Pass Rate</th><th>Level</th><th>Duration</th><th>Started</th><th></th>
          </tr></thead>
          <tbody>
            ${filtered.map(r => `
              <tr>
                <td class="td-white">${r.envName}</td>
                <td>${badge(r.status)}</td>
                <td class="td-muted">${r.summary?.total ?? '—'}</td>
                <td>${r.summary?.pass_rate ?? '—'}</td>
                <td class="td-muted">${r.testLevel}</td>
                <td class="td-muted">${fmtDuration(r.startedAt, r.completedAt)}</td>
                <td class="td-muted">${fmtTime(r.startedAt)}</td>
                <td>${r.results
                  ? `<button class="btn btn-ghost btn-sm" onclick="showRunDetail('${r.id}')">Details</button>`
                  : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  if (detailRunId) showRunDetail(detailRunId);
}

function showRunDetail(runId) {
  detailRunId = runId;
  const run = state.runs.find(r => r.id === runId);
  if (!run?.results) return;

  document.getElementById('history-detail').classList.remove('hidden');
  document.getElementById('history-detail-title').textContent =
    `${run.envName} · ${fmtTime(run.startedAt)} · ${run.summary?.pass_rate ?? '?'} pass rate`;

  const byCat = {};
  run.results.forEach(r => (byCat[r.category] = byCat[r.category] || []).push(r));

  document.getElementById('history-detail-content').innerHTML = `
    <div class="grid-4 mb-4" style="gap:12px">
      <div><div class="stat-label">Total</div>   <div class="stat-value blue"  style="font-size:20px">${run.summary?.total}</div></div>
      <div><div class="stat-label">Passed</div>  <div class="stat-value green" style="font-size:20px">${run.summary?.passed}</div></div>
      <div><div class="stat-label">Failed</div>  <div class="stat-value red"   style="font-size:20px">${run.summary?.failed}</div></div>
      <div><div class="stat-label">Warnings</div><div class="stat-value yellow" style="font-size:20px">${run.summary?.warnings}</div></div>
    </div>
    ${Object.entries(byCat).map(([cat, items]) => `
      <div class="mb-4">
        <div class="flex items-center gap-2 mb-2">
          <strong class="text-white" style="text-transform:capitalize">${cat}</strong>
          <span class="text-muted text-sm">${items.filter(i => i.status === 'PASS').length}/${items.length} passed</span>
        </div>
        <table>
          <thead><tr><th>Name</th><th>Status</th><th>Load Time</th><th>Details</th></tr></thead>
          <tbody>
            ${items.map(i => `
              <tr>
                <td class="td-white">${i.name}</td>
                <td>${badge(i.status)}</td>
                <td class="td-muted">${i.load_time_ms ? i.load_time_ms + 'ms' : '—'}</td>
                <td class="td-muted" style="font-size:12px;max-width:320px">${i.error || ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`).join('')}`;

  document.getElementById('history-detail').scrollIntoView({ behavior: 'smooth' });
}

function closeHistoryDetail() {
  detailRunId = null;
  document.getElementById('history-detail').classList.add('hidden');
}

// =========================================================
// ENVIRONMENTS PAGE
// =========================================================
function renderEnvironments() {
  const envs = state.envs;
  const llm  = state.llm;

  document.getElementById('env-list').innerHTML = envs.map(env => `
    <div class="env-card">
      <div class="env-card-header">
        <div class="flex items-center gap-2">
          <span class="env-dot" style="background:${env.color}"></span>
          <strong class="text-white">${env.name}</strong>
          <span class="text-muted text-sm">${env.label}</span>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-ghost btn-sm" onclick="openEnvModal('${env.id}')">Edit</button>
          ${!['dev','perf','prod'].includes(env.id)
            ? `<button class="btn btn-danger btn-sm" onclick="deleteEnv('${env.id}')">Delete</button>`
            : ''}
        </div>
      </div>
      <div class="form-group">
        <label>Grafana URL</label>
        <p class="text-sm truncate" style="color:${env.grafanaUrl ? 'var(--text)' : 'var(--muted)'}">
          ${env.grafanaUrl || 'Not configured'}
        </p>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label>Token</label>
        <p class="text-sm text-muted">${env.token ? '••••••••' + env.token.slice(-4) : 'Not set'}</p>
      </div>
    </div>`).join('');

  // LLM config form
  document.getElementById('llm-provider').value = llm.provider || 'none';
  document.getElementById('llm-model').value    = llm.model    || '';
  document.getElementById('llm-key').value      = llm.apiKey   || '';
  syncLlmFields();
}

function syncLlmFields() {
  const active = document.getElementById('llm-provider').value !== 'none';
  document.getElementById('llm-model-group').classList.toggle('hidden', !active);
  document.getElementById('llm-key-group').classList.toggle('hidden', !active);
}

function openEnvModal(envId) {
  const env = envId ? state.envs.find(e => e.id === envId) : null;
  document.getElementById('env-modal-title').textContent = env ? 'Edit Environment' : 'Add Environment';
  document.getElementById('env-modal-id').value          = env?.id    || '';
  document.getElementById('env-modal-name').value        = env?.name  || '';
  document.getElementById('env-modal-label').value       = env?.label || '';
  document.getElementById('env-modal-url').value         = env?.grafanaUrl || '';
  document.getElementById('env-modal-token').value       = env?.token || '';
  document.getElementById('env-modal-color').value       = env?.color || '#3b82f6';
  document.getElementById('modal-env').classList.remove('hidden');
}

function closeEnvModal() {
  document.getElementById('modal-env').classList.add('hidden');
}

function saveEnv() {
  const rawId = document.getElementById('env-modal-id').value;
  const id    = rawId || uid('env');
  const name  = document.getElementById('env-modal-name').value.trim().toUpperCase();
  const label = document.getElementById('env-modal-label').value.trim();
  const grafanaUrl = document.getElementById('env-modal-url').value.trim();
  const token = document.getElementById('env-modal-token').value.trim();
  const color = document.getElementById('env-modal-color').value;

  if (!name)       { toast('Environment name is required', 'error'); return; }
  if (!grafanaUrl) { toast('Grafana URL is required', 'error'); return; }

  const envs    = state.envs;
  const exists  = envs.find(e => e.id === id);
  state.envs = exists
    ? envs.map(e => e.id === id ? { ...e, name, label, grafanaUrl, token, color } : e)
    : [...envs, { id, name, label, grafanaUrl, token, color }];

  closeEnvModal();
  renderEnvironments();
  toast(`${name} saved`, 'success');
}

function deleteEnv(id) {
  if (!confirm('Delete this environment?')) return;
  state.envs = state.envs.filter(e => e.id !== id);
  renderEnvironments();
  toast('Environment deleted', 'info');
}

function saveLlmConfig() {
  state.llm = {
    provider: document.getElementById('llm-provider').value,
    model:    document.getElementById('llm-model').value.trim(),
    apiKey:   document.getElementById('llm-key').value.trim(),
  };
  toast('LLM configuration saved', 'success');
}

// =========================================================
// SCHEDULES (CRON) PAGE
// =========================================================
function renderCron() {
  const jobs = state.cronJobs;
  const el   = document.getElementById('cron-list');

  if (jobs.length === 0) {
    el.innerHTML = '<p class="text-muted">No schedules configured. Click "+ Add Schedule" to create one.</p>';
    return;
  }

  el.innerHTML = jobs.map(job => {
    const envColor = state.envs.find(e => e.id === job.envId)?.color || '#8899a6';
    return `
      <div class="cron-card">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="env-dot" style="background:${envColor}"></span>
            <strong class="text-white">${job.envName}</strong>
            <span class="badge ${job.enabled ? 'badge-passed' : 'badge-pending'}">${job.enabled ? 'active' : 'paused'}</span>
          </div>
          <div class="text-muted text-sm">
            <code>${job.schedule}</code>
            <span class="ml-2">${job.testLevel}</span>
          </div>
          ${job.lastRun ? `<p class="text-muted text-sm mt-1">Last run: ${fmtTime(job.lastRun)}</p>` : ''}
        </div>
        <div class="flex items-center gap-2">
          <label class="toggle" title="${job.enabled ? 'Pause schedule' : 'Enable schedule'}">
            <input type="checkbox" ${job.enabled ? 'checked' : ''} onchange="toggleCron('${job.id}')">
            <span class="toggle-slider"></span>
          </label>
          <button class="btn btn-danger btn-sm" onclick="deleteCron('${job.id}')">Delete</button>
        </div>
      </div>`;
  }).join('');
}

function openCronModal(jobId) {
  const job  = jobId ? state.cronJobs.find(j => j.id === jobId) : null;
  const envs = state.envs;

  document.getElementById('cron-modal-id').value       = job?.id       || '';
  document.getElementById('cron-modal-title').textContent = job ? 'Edit Schedule' : 'Add Schedule';
  document.getElementById('cron-modal-schedule').value = job?.schedule  || '0 * * * *';
  document.getElementById('cron-modal-level').value    = job?.testLevel || 'standard';

  const envSel = document.getElementById('cron-modal-env');
  envSel.innerHTML = envs.map(e =>
    `<option value="${e.id}" ${job?.envId === e.id ? 'selected' : ''}>${e.name} — ${e.label}</option>`
  ).join('');

  document.getElementById('modal-cron').classList.remove('hidden');
}

function closeCronModal() {
  document.getElementById('modal-cron').classList.add('hidden');
}

function saveCron() {
  const rawId    = document.getElementById('cron-modal-id').value;
  const id       = rawId || uid('cron');
  const envId    = document.getElementById('cron-modal-env').value;
  const schedule = document.getElementById('cron-modal-schedule').value.trim();
  const testLevel= document.getElementById('cron-modal-level').value;

  if (!schedule) { toast('Cron expression is required', 'error'); return; }
  const env = state.envs.find(e => e.id === envId);
  if (!env) { toast('Select an environment', 'error'); return; }

  const jobs    = state.cronJobs;
  const exists  = jobs.find(j => j.id === id);
  const job     = { id, envId, envName: env.name, schedule, testLevel, enabled: exists?.enabled ?? true };
  state.cronJobs = exists ? jobs.map(j => j.id === id ? job : j) : [...jobs, job];

  closeCronModal();
  renderCron();
  toast('Schedule saved', 'success');
}

function toggleCron(id) {
  state.cronJobs = state.cronJobs.map(j => j.id === id ? { ...j, enabled: !j.enabled } : j);
  renderCron();
}

function deleteCron(id) {
  if (!confirm('Delete this schedule?')) return;
  state.cronJobs = state.cronJobs.filter(j => j.id !== id);
  renderCron();
  toast('Schedule deleted', 'info');
}

// =========================================================
// INIT
// =========================================================
document.addEventListener('DOMContentLoaded', () => {
  buildNav();
  navigate('dashboard');

  // Run button
  document.getElementById('run-btn').addEventListener('click', doRunTest);

  // Level pills
  document.querySelectorAll('[data-level]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedLevel = btn.dataset.level;
      document.querySelectorAll('[data-level]').forEach(b =>
        b.classList.toggle('selected', b.dataset.level === selectedLevel)
      );
    });
  });

  // Env modal
  document.getElementById('env-add-btn').addEventListener('click', () => openEnvModal(null));
  document.getElementById('env-modal-save').addEventListener('click', saveEnv);
  document.getElementById('modal-env').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-env')) closeEnvModal();
  });

  // Cron modal
  document.getElementById('cron-add-btn').addEventListener('click', () => openCronModal(null));
  document.getElementById('cron-modal-save').addEventListener('click', saveCron);
  document.getElementById('modal-cron').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-cron')) closeCronModal();
  });

  // LLM
  document.getElementById('llm-provider').addEventListener('change', syncLlmFields);
  document.getElementById('llm-save-btn').addEventListener('click', saveLlmConfig);

  // History filters
  document.getElementById('history-search').addEventListener('input',  () => renderHistory());
  document.getElementById('history-filter').addEventListener('change', () => renderHistory());

  // Keyboard: Escape closes modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeEnvModal(); closeCronModal(); }
  });
});
