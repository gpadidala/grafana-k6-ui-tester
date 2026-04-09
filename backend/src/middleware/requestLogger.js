const logger = require('../utils/logger');

function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const level = res.statusCode >= 400 ? 'warn' : 'info';
    logger[level](`${req.method} ${req.path} → ${res.statusCode} (${Math.round(ms)}ms)`);
  });
  next();
}

module.exports = requestLogger;
