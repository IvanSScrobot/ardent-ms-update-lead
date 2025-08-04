const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
require('dotenv').config();

const logger = require('./utils/logger');
const webhookRoutes = require('./routes/webhook');
const healthRoutes = require('./routes/health');
const { connectDatabase } = require('./database/connection');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Request logging middleware
app.use(logger.requestLogger);

// Routes
app.use('/api/webhook', webhookRoutes);
app.use('/health', healthRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error', {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method
    });

    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// 404 handler
app.use('*', (req, res) => {
    logger.warn('Route not found', {
        url: req.url,
        method: req.method
    });

    res.status(404).json({ error: 'Route not found' });
});

// Start server
async function startServer() {
    try {
        logger.info('Starting retell-webhook-processor service');

        // Test database connection
        await connectDatabase();
        logger.info('Database connection established successfully');

        app.listen(PORT, '0.0.0.0', () => {
            logger.info('Server started successfully', {
                port: PORT,
                environment: process.env.NODE_ENV || 'development',
                healthEndpoint: `http://localhost:${PORT}/health`
            });
        });
    } catch (error) {
        logger.error('Failed to start server', {
            error: error.message,
            stack: error.stack
        });
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received, initiating graceful shutdown');
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('SIGINT received, initiating graceful shutdown');
    process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', {
        error: error.message,
        stack: error.stack
    });
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection', {
        reason: reason,
        promise: promise
    });
    process.exit(1);
});

startServer();

module.exports = app;