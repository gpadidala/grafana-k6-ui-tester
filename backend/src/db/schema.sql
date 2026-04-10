-- GrafanaProbe v2 Schema

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  env_id TEXT,
  strategy TEXT,
  mode TEXT DEFAULT 'isolated',
  status TEXT NOT NULL DEFAULT 'running',
  start_time TEXT NOT NULL,
  end_time TEXT,
  duration_ms INTEGER,
  grafana_url TEXT,
  grafana_version TEXT,
  summary TEXT NOT NULL DEFAULT '{}',
  config TEXT,
  trigger_type TEXT DEFAULT 'manual',
  html_file TEXT
);

CREATE TABLE IF NOT EXISTS test_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  test_name TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT,
  tags TEXT,
  details TEXT,
  error TEXT,
  screenshot_path TEXT,
  metadata TEXT,
  uid TEXT,
  duration_ms INTEGER
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

CREATE TABLE IF NOT EXISTS baselines (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  env_id TEXT,
  run_id TEXT NOT NULL REFERENCES runs(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dep_graph_nodes (
  id TEXT PRIMARY KEY,
  node_type TEXT NOT NULL,
  node_id TEXT NOT NULL,
  label TEXT,
  metadata TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dep_graph_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  metadata TEXT,
  UNIQUE(source_id, target_id, edge_type)
);

CREATE TABLE IF NOT EXISTS plugin_versions (
  plugin_id TEXT PRIMARY KEY,
  installed_version TEXT,
  latest_version TEXT,
  update_type TEXT,
  risk_score INTEGER,
  impacted_dashboards INTEGER,
  checked_at TEXT
);

CREATE TABLE IF NOT EXISTS latency_measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
  dashboard_uid TEXT,
  dashboard_title TEXT,
  panel_id INTEGER,
  panel_title TEXT,
  datasource_uid TEXT,
  query_hash TEXT,
  response_time_ms INTEGER NOT NULL,
  response_size_bytes INTEGER,
  status TEXT DEFAULT 'success',
  measured_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS screenshots (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  test_id TEXT,
  resource_type TEXT,
  resource_id TEXT,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS environments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  grafana_url TEXT NOT NULL,
  org_id TEXT DEFAULT '1',
  color TEXT DEFAULT '#6366f1',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_test_results_run ON test_results(run_id);
CREATE INDEX IF NOT EXISTS idx_test_results_category ON test_results(run_id, category);
CREATE INDEX IF NOT EXISTS idx_category_results_run ON category_results(run_id);
CREATE INDEX IF NOT EXISTS idx_dep_edges_source ON dep_graph_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_dep_edges_target ON dep_graph_edges(target_id);
CREATE INDEX IF NOT EXISTS idx_latency_run ON latency_measurements(run_id);
CREATE INDEX IF NOT EXISTS idx_latency_dashboard ON latency_measurements(dashboard_uid);
CREATE INDEX IF NOT EXISTS idx_screenshots_run ON screenshots(run_id);

-- DSUD: Dashboard Snapshot & Upgrade Diff
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  environment TEXT,
  grafana_version TEXT,
  grafana_url TEXT,
  dashboard_count INTEGER DEFAULT 0,
  panel_count INTEGER DEFAULT 0,
  plugin_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  created_by TEXT,
  storage_path TEXT,
  manifest_checksum TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS snapshot_dashboards (
  snapshot_id TEXT NOT NULL,
  dashboard_uid TEXT NOT NULL,
  title TEXT,
  folder TEXT,
  fingerprint TEXT,
  panel_count INTEGER DEFAULT 0,
  schema_version INTEGER,
  PRIMARY KEY (snapshot_id, dashboard_uid),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS snapshot_diffs (
  id TEXT PRIMARY KEY,
  baseline_snapshot_id TEXT NOT NULL,
  current_snapshot_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  summary_json TEXT,
  total_changes INTEGER DEFAULT 0,
  critical_count INTEGER DEFAULT 0,
  high_count INTEGER DEFAULT 0,
  medium_count INTEGER DEFAULT 0,
  low_count INTEGER DEFAULT 0,
  info_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending_review',
  FOREIGN KEY (baseline_snapshot_id) REFERENCES snapshots(id),
  FOREIGN KEY (current_snapshot_id) REFERENCES snapshots(id)
);

CREATE TABLE IF NOT EXISTS snapshot_diff_items (
  id TEXT PRIMARY KEY,
  diff_id TEXT NOT NULL,
  dashboard_uid TEXT,
  dashboard_title TEXT,
  panel_id INTEGER,
  panel_title TEXT,
  path TEXT,
  change_type TEXT,
  risk_level TEXT,
  before_value TEXT,
  after_value TEXT,
  ai_explanation TEXT,
  ai_recommendation TEXT,
  acknowledged INTEGER DEFAULT 0,
  FOREIGN KEY (diff_id) REFERENCES snapshot_diffs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshot_dashboards_snap ON snapshot_dashboards(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_diff_items_diff ON snapshot_diff_items(diff_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_diff_items_risk ON snapshot_diff_items(diff_id, risk_level);
