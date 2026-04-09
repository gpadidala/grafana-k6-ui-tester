const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../data/grafana-probe.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema Migration ───
db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    start_time TEXT NOT NULL,
    end_time TEXT,
    duration_ms INTEGER,
    status TEXT NOT NULL DEFAULT 'running',
    mode TEXT DEFAULT 'isolated',
    trigger_type TEXT DEFAULT 'manual',
    grafana_url TEXT,
    grafana_version TEXT,
    summary TEXT NOT NULL DEFAULT '{}',
    html_file TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS category_results (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL,
    category_name TEXT NOT NULL,
    icon TEXT,
    status TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '{}',
    duration_ms INTEGER,
    UNIQUE(run_id, category_id)
  );

  CREATE TABLE IF NOT EXISTS test_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL,
    test_name TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT,
    uid TEXT,
    ms INTEGER,
    metadata TEXT,
    screenshot_path TEXT
  );

  CREATE TABLE IF NOT EXISTS dependency_graph (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_name TEXT,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    target_name TEXT,
    edge_type TEXT NOT NULL,
    metadata TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS baselines (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES runs(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS latency_measurements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    dashboard_uid TEXT NOT NULL,
    dashboard_title TEXT,
    panel_id INTEGER,
    panel_title TEXT,
    datasource_uid TEXT,
    response_time_ms INTEGER NOT NULL,
    response_size_bytes INTEGER,
    status TEXT DEFAULT 'success',
    measured_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_test_results_run ON test_results(run_id);
  CREATE INDEX IF NOT EXISTS idx_category_results_run ON category_results(run_id);
  CREATE INDEX IF NOT EXISTS idx_dep_graph_source ON dependency_graph(source_type, source_id);
  CREATE INDEX IF NOT EXISTS idx_dep_graph_target ON dependency_graph(target_type, target_id);
  CREATE INDEX IF NOT EXISTS idx_latency_run ON latency_measurements(run_id);
`);

// ─── Prepared Statements ───
const stmts = {
  insertRun: db.prepare(`INSERT INTO runs (id, start_time, status, mode, trigger_type, grafana_url, summary) VALUES (?, ?, ?, ?, ?, ?, ?)`),
  updateRun: db.prepare(`UPDATE runs SET end_time=?, duration_ms=?, status=?, summary=?, grafana_version=?, html_file=? WHERE id=?`),
  getRun: db.prepare(`SELECT * FROM runs WHERE id=?`),
  listRuns: db.prepare(`SELECT id, start_time, end_time, duration_ms, status, mode, trigger_type, grafana_url, grafana_version, summary, html_file, created_at FROM runs ORDER BY start_time DESC LIMIT ?`),
  deleteRun: db.prepare(`DELETE FROM runs WHERE id=?`),
  deleteAllRuns: db.prepare(`DELETE FROM runs`),

  insertCategoryResult: db.prepare(`INSERT OR REPLACE INTO category_results (id, run_id, category_id, category_name, icon, status, summary, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  getCategoryResults: db.prepare(`SELECT * FROM category_results WHERE run_id=? ORDER BY rowid`),

  insertTestResult: db.prepare(`INSERT INTO test_results (run_id, category_id, test_name, status, detail, uid, ms, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  getTestResults: db.prepare(`SELECT * FROM test_results WHERE run_id=? ORDER BY id`),
  getTestResultsByCategory: db.prepare(`SELECT * FROM test_results WHERE run_id=? AND category_id=? ORDER BY id`),

  insertLatency: db.prepare(`INSERT INTO latency_measurements (run_id, dashboard_uid, dashboard_title, panel_id, panel_title, datasource_uid, response_time_ms, response_size_bytes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  getLatencyByRun: db.prepare(`SELECT * FROM latency_measurements WHERE run_id=? ORDER BY response_time_ms DESC`),
  getSlowestQueries: db.prepare(`SELECT * FROM latency_measurements ORDER BY response_time_ms DESC LIMIT ?`),

  clearGraph: db.prepare(`DELETE FROM dependency_graph`),
  insertEdge: db.prepare(`INSERT INTO dependency_graph (source_type, source_id, source_name, target_type, target_id, target_name, edge_type, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  getEdgesFrom: db.prepare(`SELECT * FROM dependency_graph WHERE source_type=? AND source_id=?`),
  getEdgesTo: db.prepare(`SELECT * FROM dependency_graph WHERE target_type=? AND target_id=?`),
  getFullGraph: db.prepare(`SELECT * FROM dependency_graph`),

  insertBaseline: db.prepare(`INSERT INTO baselines (id, label, run_id) VALUES (?, ?, ?)`),
  listBaselines: db.prepare(`SELECT b.*, r.summary, r.grafana_url, r.start_time FROM baselines b JOIN runs r ON b.run_id = r.id ORDER BY b.created_at DESC`),
  deleteBaseline: db.prepare(`DELETE FROM baselines WHERE id=?`),
};

module.exports = { db, stmts };
