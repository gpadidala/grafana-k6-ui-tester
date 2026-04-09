const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

const DB_PATH = path.resolve(config.paths.db);
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Ensure directories
[path.dirname(DB_PATH), path.resolve(config.paths.screenshots), path.resolve(config.paths.reports)].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

let db = null;

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();

  // Load existing DB or create new
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Run schema migration
  try {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    db.run(schema);
    saveDb();
    logger.info('Database initialized', { path: DB_PATH });
  } catch (err) {
    logger.error('Database migration failed', { error: err.message });
  }

  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// ─── Query Helpers ───

async function run(sql, params = []) {
  const d = await getDb();
  d.run(sql, params);
  saveDb();
}

async function get(sql, params = []) {
  const d = await getDb();
  const stmt = d.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

async function all(sql, params = []) {
  const d = await getDb();
  const results = [];
  const stmt = d.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// ─── Domain Operations ───

const ops = {
  // Runs
  insertRun: (id, envId, strategy, mode, status, startTime, grafanaUrl, summary, trigger) =>
    run(`INSERT INTO runs (id,env_id,strategy,mode,status,start_time,grafana_url,summary,trigger_type) VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, envId, strategy, mode, status, startTime, grafanaUrl, summary, trigger]),

  updateRun: (id, endTime, durationMs, status, summary, version, htmlFile) =>
    run(`UPDATE runs SET end_time=?,duration_ms=?,status=?,summary=?,grafana_version=?,html_file=? WHERE id=?`,
      [endTime, durationMs, status, summary, version, htmlFile, id]),

  getRun: (id) => get(`SELECT * FROM runs WHERE id=?`, [id]),
  listRuns: (limit = 50) => all(`SELECT * FROM runs ORDER BY start_time DESC LIMIT ?`, [limit]),
  deleteRun: (id) => run(`DELETE FROM runs WHERE id=?`, [id]),
  deleteAllRuns: () => run(`DELETE FROM runs`),

  // Category Results
  insertCatResult: (id, runId, catId, catName, icon, status, summary, durationMs) =>
    run(`INSERT OR REPLACE INTO category_results (id,run_id,category_id,category_name,icon,status,summary,duration_ms) VALUES (?,?,?,?,?,?,?,?)`,
      [id, runId, catId, catName, icon, status, summary, durationMs]),
  getCatResults: (runId) => all(`SELECT * FROM category_results WHERE run_id=? ORDER BY rowid`, [runId]),

  // Test Results
  insertTestResult: (id, runId, category, testName, status, priority, tags, details, error, screenshot, metadata, uid, durationMs) =>
    run(`INSERT INTO test_results (id,run_id,category,test_name,status,priority,tags,details,error,screenshot_path,metadata,uid,duration_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, runId, category, testName, status, priority, tags, details, error, screenshot, metadata, uid, durationMs]),
  getTestResults: (runId) => all(`SELECT * FROM test_results WHERE run_id=? ORDER BY rowid`, [runId]),
  getFailedTests: (runId) => all(`SELECT * FROM test_results WHERE run_id=? AND status IN ('failed','FAIL') ORDER BY rowid`, [runId]),

  // Dependency Graph
  clearGraph: async () => { await run(`DELETE FROM dep_graph_edges`); await run(`DELETE FROM dep_graph_nodes`); },
  insertNode: (id, type, nodeId, label, metadata) =>
    run(`INSERT OR REPLACE INTO dep_graph_nodes (id,node_type,node_id,label,metadata,updated_at) VALUES (?,?,?,?,?,datetime('now'))`,
      [id, type, nodeId, label, metadata]),
  insertEdge: (sourceId, targetId, edgeType, metadata) =>
    run(`INSERT OR IGNORE INTO dep_graph_edges (source_id,target_id,edge_type,metadata) VALUES (?,?,?,?)`,
      [sourceId, targetId, edgeType, metadata]),
  getEdgesFrom: (sourceId) => all(`SELECT * FROM dep_graph_edges WHERE source_id=?`, [sourceId]),
  getEdgesTo: (targetId) => all(`SELECT * FROM dep_graph_edges WHERE target_id=?`, [targetId]),
  getAllEdges: () => all(`SELECT * FROM dep_graph_edges`),
  getAllNodes: () => all(`SELECT * FROM dep_graph_nodes`),

  // Latency
  insertLatency: (runId, dashUid, dashTitle, panelId, panelTitle, dsUid, timeMs, sizeBytes, status) =>
    run(`INSERT INTO latency_measurements (run_id,dashboard_uid,dashboard_title,panel_id,panel_title,datasource_uid,response_time_ms,response_size_bytes,status) VALUES (?,?,?,?,?,?,?,?,?)`,
      [runId, dashUid, dashTitle, panelId, panelTitle, dsUid, timeMs, sizeBytes, status]),
  getLatencyByRun: (runId) => all(`SELECT * FROM latency_measurements WHERE run_id=? ORDER BY response_time_ms DESC`, [runId]),
  getSlowestQueries: (limit = 20) => all(`SELECT * FROM latency_measurements ORDER BY response_time_ms DESC LIMIT ?`, [limit]),

  // Baselines
  insertBaseline: (id, label, envId, runId) => run(`INSERT INTO baselines (id,label,env_id,run_id) VALUES (?,?,?,?)`, [id, label, envId, runId]),
  listBaselines: () => all(`SELECT b.*,r.summary,r.grafana_url,r.start_time FROM baselines b JOIN runs r ON b.run_id=r.id ORDER BY b.created_at DESC`),
  deleteBaseline: (id) => run(`DELETE FROM baselines WHERE id=?`, [id]),

  // Environments
  insertEnv: (id, name, url, orgId, color) => run(`INSERT OR REPLACE INTO environments (id,name,grafana_url,org_id,color) VALUES (?,?,?,?,?)`, [id, name, url, orgId, color]),
  listEnvs: () => all(`SELECT * FROM environments WHERE is_active=1 ORDER BY name`),

  // Plugin Versions
  upsertPluginVersion: (pluginId, installed, latest, updateType, risk, impacted) =>
    run(`INSERT OR REPLACE INTO plugin_versions (plugin_id,installed_version,latest_version,update_type,risk_score,impacted_dashboards,checked_at) VALUES (?,?,?,?,?,?,datetime('now'))`,
      [pluginId, installed, latest, updateType, risk, impacted]),
  getPluginVersions: () => all(`SELECT * FROM plugin_versions ORDER BY risk_score DESC`),

  // Screenshots
  insertScreenshot: (id, runId, testId, resType, resId, filePath, fileSize) =>
    run(`INSERT INTO screenshots (id,run_id,test_id,resource_type,resource_id,file_path,file_size) VALUES (?,?,?,?,?,?,?)`,
      [id, runId, testId, resType, resId, filePath, fileSize]),
  getScreenshots: (limit = 50) => all(`SELECT * FROM screenshots ORDER BY created_at DESC LIMIT ?`, [limit]),
};

module.exports = { getDb, saveDb, run, get, all, ops };
