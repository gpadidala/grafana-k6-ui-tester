'use strict';
/**
 * monitor/scheduler.js — Cron-based scheduler for automated Sentinel runs.
 * Uses node-cron for expression parsing. Persists schedule in SQLite.
 */

const cron = require('node-cron');

class Scheduler {
  /**
   * @param {object} db          - better-sqlite3 Database instance
   * @param {function} runFn     - async (job) => void — called for each scheduled run
   * @param {object} [logger]
   */
  constructor(db, runFn, logger = console) {
    this.db     = db;
    this.runFn  = runFn;
    this.logger = logger;
    this._jobs  = new Map(); // jobId → { task, config }
    this._ensureTable();
  }

  _ensureTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        schedule    TEXT NOT NULL,
        grafana_url TEXT NOT NULL,
        token       TEXT,
        test_level  TEXT DEFAULT 'standard',
        enabled     INTEGER DEFAULT 1,
        last_run    TEXT,
        next_run    TEXT,
        run_count   INTEGER DEFAULT 0,
        created_at  TEXT DEFAULT (datetime('now'))
      )
    `);
  }

  /**
   * Load all enabled jobs from DB and schedule them.
   */
  loadAndScheduleAll() {
    const jobs = this.db.prepare('SELECT * FROM scheduled_jobs WHERE enabled = 1').all();
    for (const job of jobs) {
      this.scheduleJob(job);
    }
    this.logger.info(`[Scheduler] Loaded ${jobs.length} scheduled job(s)`);
  }

  /**
   * Add a new job (saved to DB and scheduled).
   */
  addJob(config) {
    const { id, name, schedule, grafana_url, token, test_level = 'standard' } = config;

    if (!cron.validate(schedule)) throw new Error(`Invalid cron expression: ${schedule}`);

    const jobId = id || `job-${Date.now()}`;
    this.db.prepare(`
      INSERT OR REPLACE INTO scheduled_jobs
        (id, name, schedule, grafana_url, token, test_level, enabled)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(jobId, name, schedule, grafana_url, token, test_level);

    this.scheduleJob({ id: jobId, name, schedule, grafana_url, token, test_level, enabled: 1 });
    return jobId;
  }

  /**
   * Schedule a single job in memory (does not persist to DB).
   */
  scheduleJob(jobConfig) {
    const { id, schedule } = jobConfig;

    // Stop existing instance
    this.stopJob(id);

    if (!cron.validate(schedule)) {
      this.logger.warn(`[Scheduler] Invalid cron: ${schedule} for job ${id}`);
      return;
    }

    const task = cron.schedule(schedule, async () => {
      this.logger.info(`[Scheduler] Running job: ${id} (${jobConfig.name})`);
      const startedAt = new Date().toISOString();

      try {
        await this.runFn(jobConfig);
        this.db.prepare(`
          UPDATE scheduled_jobs
          SET last_run = ?, run_count = run_count + 1
          WHERE id = ?
        `).run(startedAt, id);
      } catch (err) {
        this.logger.error(`[Scheduler] Job ${id} failed: ${err.message}`);
      }
    }, { timezone: 'UTC' });

    this._jobs.set(id, { task, config: jobConfig });
    this.logger.info(`[Scheduler] Scheduled job ${id} (${jobConfig.name}) at: ${schedule}`);
  }

  /**
   * Stop and remove a job.
   */
  stopJob(id) {
    const existing = this._jobs.get(id);
    if (existing) {
      existing.task.destroy();
      this._jobs.delete(id);
    }
  }

  /**
   * Enable/disable a job.
   */
  setEnabled(id, enabled) {
    this.db.prepare('UPDATE scheduled_jobs SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
    if (enabled) {
      const job = this.db.prepare('SELECT * FROM scheduled_jobs WHERE id = ?').get(id);
      if (job) this.scheduleJob(job);
    } else {
      this.stopJob(id);
    }
  }

  /**
   * Delete a job entirely.
   */
  deleteJob(id) {
    this.stopJob(id);
    this.db.prepare('DELETE FROM scheduled_jobs WHERE id = ?').run(id);
  }

  /**
   * List all jobs from DB.
   */
  listJobs() {
    return this.db.prepare('SELECT * FROM scheduled_jobs ORDER BY created_at DESC').all();
  }

  /**
   * Immediately trigger a job by ID.
   */
  async triggerNow(id) {
    const job = this.db.prepare('SELECT * FROM scheduled_jobs WHERE id = ?').get(id);
    if (!job) throw new Error(`Job not found: ${id}`);
    return this.runFn(job);
  }

  /**
   * Stop all scheduled jobs (for graceful shutdown).
   */
  stopAll() {
    for (const [id, { task }] of this._jobs) {
      task.destroy();
    }
    this._jobs.clear();
    this.logger.info('[Scheduler] All jobs stopped');
  }
}

module.exports = { Scheduler };
