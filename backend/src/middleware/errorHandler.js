const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  logger.error('Unhandled error', {
    method: req.method,
    path: req.path,
    error: err.message,
    stack: err.stack,
  });

  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
}

module.exports = errorHandler;
