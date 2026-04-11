const winston = require('winston');
const config = require('../config');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'heimdall' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, category, ...rest }) => {
          const cat = category ? ` [${category}]` : '';
          const extra = Object.keys(rest).filter(k => k !== 'service').length > 0
            ? ` ${JSON.stringify(rest)}` : '';
          return `${timestamp} ${level}${cat}: ${message}${extra}`;
        })
      ),
    }),
    new winston.transports.File({
      filename: 'heimdall.log',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 3,
    }),
  ],
});

module.exports = logger;
