const winston = require('winston');

// Create logger instance with structured logging
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: {
        service: 'retell-webhook-processor',
        version: process.env.npm_package_version || '1.0.0'
    },
    transports: [
        // Console transport for stdout (required for Kubernetes)
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
                    return `${timestamp} [${level}]: ${message} ${metaStr}`;
                })
            )
        })
    ]
});

// Add request logging middleware
logger.requestLogger = (req, res, next) => {
    const start = Date.now();

    logger.info('Incoming request', {
        method: req.method,
        url: req.url,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        requestId: req.headers['x-request-id'] || 'unknown'
    });

    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info('Request completed', {
            method: req.method,
            url: req.url,
            statusCode: res.statusCode,
            duration: `${duration}ms`,
            requestId: req.headers['x-request-id'] || 'unknown'
        });
    });

    next();
};

module.exports = logger;