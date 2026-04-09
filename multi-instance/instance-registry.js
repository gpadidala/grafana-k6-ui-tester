'use strict';
/**
 * multi-instance/instance-registry.js — Register and manage multiple Grafana instances.
 * Loads from config/instances.yaml or DB.
 */

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { GrafanaClient } = require('../core/grafana-client');

class InstanceRegistry {
  /**
   * @param {object} db  - better-sqlite3 Database instance (optional)
   */
  constructor(db = null) {
    this.db        = db;
    this._instances = new Map();
    if (db) this._ensureSchema();
  }

  _ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS grafana_instances (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        label       TEXT,
        url         TEXT NOT NULL,
        token       TEXT,
        org_id      INTEGER DEFAULT 1,
        environment TEXT DEFAULT 'unknown',
        tags        TEXT,
        enabled     INTEGER DEFAULT 1,
        last_seen   TEXT,
        version     TEXT,
        created_at  TEXT DEFAULT (datetime('now'))
      )
    `);
  }

  /**
   * Load instances from YAML file.
   * Expected format:
   *   instances:
   *     - id: prod, name: Production, url: http://..., token: ..., environment: production
   */
  loadFromYaml(filePath) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) throw new Error(`Instances YAML not found: ${resolved}`);

    const data  = yaml.load(fs.readFileSync(resolved, 'utf8'));
    const items = data.instances || data;

    if (!Array.isArray(items)) throw new Error('Expected an array of instances in YAML');

    for (const inst of items) {
      this.register(inst);
    }
    return this;
  }

  /**
   * Load instances from DB.
   */
  loadFromDb() {
    if (!this.db) return this;
    const rows = this.db.prepare('SELECT * FROM grafana_instances WHERE enabled = 1').all();
    for (const row of rows) {
      this._instances.set(row.id, {
        ...row,
        tags: row.tags ? JSON.parse(row.tags) : [],
      });
    }
    return this;
  }

  /**
   * Register a new instance.
   */
  register(config) {
    const instance = {
      id:          config.id || `inst-${Date.now()}`,
      name:        config.name || config.id,
      label:       config.label || config.environment || 'unknown',
      url:         config.url.replace(/\/$/, ''),
      token:       config.token || config.api_token || '',
      org_id:      config.org_id || 1,
      environment: config.environment || 'unknown',
      tags:        config.tags || [],
      enabled:     config.enabled !== false,
    };

    this._instances.set(instance.id, instance);

    if (this.db) {
      this.db.prepare(`
        INSERT OR REPLACE INTO grafana_instances
          (id, name, label, url, token, org_id, environment, tags, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        instance.id, instance.name, instance.label, instance.url,
        instance.token, instance.org_id, instance.environment,
        JSON.stringify(instance.tags), instance.enabled ? 1 : 0,
      );
    }

    return instance.id;
  }

  /**
   * Get an instance by ID.
   */
  get(id) {
    return this._instances.get(id) || null;
  }

  /**
   * Get all instances.
   */
  getAll(filter = {}) {
    const instances = [...this._instances.values()];
    if (filter.environment) return instances.filter(i => i.environment === filter.environment);
    if (filter.enabled !== undefined) return instances.filter(i => i.enabled === filter.enabled);
    return instances;
  }

  /**
   * Create a GrafanaClient for a registered instance.
   */
  getClient(id) {
    const inst = this.get(id);
    if (!inst) throw new Error(`Instance "${id}" not registered`);
    return new GrafanaClient(inst.url, inst.token, { orgId: inst.org_id });
  }

  /**
   * Test connectivity for all registered instances.
   * Returns array of { id, name, url, ok, version, ms }
   */
  async testAll() {
    const results = await Promise.allSettled(
      this.getAll().map(async inst => {
        const client = this.getClient(inst.id);
        const start  = Date.now();
        const health = await client.getHealth();
        const ms     = Date.now() - start;
        const version = health.ok ? await client.getVersion().catch(() => 'unknown') : null;

        // Update last_seen and version in DB
        if (this.db && health.ok) {
          this.db.prepare(`
            UPDATE grafana_instances SET last_seen = datetime('now'), version = ? WHERE id = ?
          `).run(version, inst.id);
        }

        return { id: inst.id, name: inst.name, url: inst.url, ok: health.ok, version, ms };
      }),
    );

    return results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message });
  }

  remove(id) {
    this._instances.delete(id);
    if (this.db) this.db.prepare('DELETE FROM grafana_instances WHERE id = ?').run(id);
  }
}

module.exports = { InstanceRegistry };
