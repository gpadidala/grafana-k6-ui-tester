'use strict';
/**
 * reports/generator/json-report.js — Machine-readable JSON report.
 */

const fs   = require('fs');
const path = require('path');

function generateJsonReport(report, outputPath) {
  const outPath = outputPath || `./reports/report-${report.id || Date.now()}.json`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  return outPath;
}

module.exports = { generateJsonReport };
