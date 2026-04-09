const { v4: uuid } = require('uuid');

class TestResult {
  constructor(category, testName, options = {}) {
    this.id = uuid();
    this.category = category;
    this.testName = testName;
    this.status = 'pending';
    this.priority = options.priority || 'P2';
    this.tags = options.tags || ['functional'];
    this.startTime = new Date().toISOString();
    this.endTime = null;
    this.duration = 0;
    this.details = null;
    this.error = null;
    this.screenshot = null;
    this.metadata = options.metadata || {};
    this.uid = options.uid || null;
    this.subTests = [];
  }

  pass(details, metadata) {
    this.status = 'passed';
    this.details = details;
    if (metadata) Object.assign(this.metadata, metadata);
    this._finish();
    return this;
  }

  fail(details, error, metadata) {
    this.status = 'failed';
    this.details = details;
    this.error = error ? { message: error.message || String(error), stack: error.stack || null } : null;
    if (metadata) Object.assign(this.metadata, metadata);
    this._finish();
    return this;
  }

  warn(details, metadata) {
    this.status = 'warning';
    this.details = details;
    if (metadata) Object.assign(this.metadata, metadata);
    this._finish();
    return this;
  }

  skip(details) {
    this.status = 'skipped';
    this.details = details;
    this._finish();
    return this;
  }

  setScreenshot(path) {
    this.screenshot = path;
    return this;
  }

  addSubTest(result) {
    this.subTests.push(result);
    return this;
  }

  _finish() {
    this.endTime = new Date().toISOString();
    this.duration = new Date(this.endTime) - new Date(this.startTime);
  }

  toJSON() {
    return {
      id: this.id,
      category: this.category,
      testName: this.testName,
      status: this.status,
      priority: this.priority,
      tags: this.tags,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.duration,
      details: this.details,
      error: this.error,
      screenshot: this.screenshot,
      metadata: this.metadata,
      uid: this.uid,
      subTests: this.subTests.map(s => s.toJSON ? s.toJSON() : s),
    };
  }

  // Legacy compat: convert to simple {name, status, detail, uid, ms} format
  toSimple() {
    return {
      name: this.testName,
      status: this.status === 'passed' ? 'PASS' : this.status === 'failed' ? 'FAIL' : this.status === 'warning' ? 'WARN' : 'SKIP',
      detail: this.details,
      uid: this.uid,
      ms: this.duration,
      metadata: this.metadata,
      screenshot: this.screenshot,
    };
  }
}

class CategoryReport {
  constructor(categoryId, categoryName, icon) {
    this.id = categoryId;
    this.name = categoryName;
    this.icon = icon;
    this.results = [];
    this.startTime = new Date().toISOString();
    this.endTime = null;
    this.duration = 0;
  }

  addResult(testResult) {
    this.results.push(testResult instanceof TestResult ? testResult : testResult);
    return this;
  }

  finish() {
    this.endTime = new Date().toISOString();
    this.duration = new Date(this.endTime) - new Date(this.startTime);
    return this;
  }

  get summary() {
    const simple = this.results.map(r => r.toSimple ? r.toSimple() : r);
    const passed = simple.filter(r => r.status === 'PASS').length;
    const failed = simple.filter(r => r.status === 'FAIL').length;
    const warnings = simple.filter(r => r.status === 'WARN').length;
    const skipped = simple.filter(r => r.status === 'SKIP').length;
    return { total: simple.length, passed, failed, warnings, skipped };
  }

  get status() {
    const s = this.summary;
    if (s.failed > 0) return 'FAIL';
    if (s.warnings > 0) return 'WARN';
    return 'PASS';
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      icon: this.icon,
      status: this.status,
      summary: this.summary,
      duration_ms: this.duration,
      tests: this.results.map(r => r.toSimple ? r.toSimple() : r),
    };
  }
}

module.exports = { TestResult, CategoryReport };
