const express = require('express');
const llmService = require('../services/llmService');
const databaseService = require('../services/databaseService');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /health
 * Basic health check
 */
router.get('/', (req, res) => {
    const healthData = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'retell-webhook-processor',
        version: process.env.npm_package_version || '1.0.0',
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    };

    logger.debug('Basic health check performed', healthData);

    res.status(200).json(healthData);
});

/**
 * GET /health/detailed
 * Detailed health check including dependencies
 */
router.get('/detailed', async (req, res) => {
    const requestId = req.headers['x-request-id'] || `health_${Date.now()}`;

    logger.info('Starting detailed health check', { requestId });

    const healthChecks = {
        service: {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: process.env.npm_package_version || '1.0.0'
        }
    };

    let overallStatus = 'healthy';

    try {
        // Check database health
        logger.info('Checking database health', { requestId });
        healthChecks.database = await databaseService.healthCheck();

        if (healthChecks.database.status !== 'healthy') {
            logger.warn('Database health check failed', {
                requestId,
                status: healthChecks.database.status,
                error: healthChecks.database.error
            });
            overallStatus = 'unhealthy';
        } else {
            logger.info('Database health check passed', { requestId });
        }
    } catch (error) {
        logger.error('Database health check error', {
            requestId,
            error: error.message
        });

        healthChecks.database = {
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        };
        overallStatus = 'unhealthy';
    }

    try {
        // Check LLM service health
        logger.info('Checking LLM service health', { requestId });
        healthChecks.llm = await llmService.healthCheck();

        if (healthChecks.llm.status !== 'healthy') {
            logger.warn('LLM service health check failed', {
                requestId,
                status: healthChecks.llm.status,
                error: healthChecks.llm.error
            });
            // LLM being down is not critical for basic operation
            if (overallStatus === 'healthy') {
                overallStatus = 'degraded';
            }
        } else {
            logger.info('LLM service health check passed', {
                requestId,
                modelCount: healthChecks.llm.models?.length || 0
            });
        }
    } catch (error) {
        logger.error('LLM service health check error', {
            requestId,
            error: error.message
        });

        healthChecks.llm = {
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        };

        // LLM being down is not critical for basic operation
        if (overallStatus === 'healthy') {
            overallStatus = 'degraded';
        }
    }

    const statusCode = overallStatus === 'healthy' ? 200 :
        overallStatus === 'degraded' ? 200 : 503;

    const response = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        checks: healthChecks,
        requestId
    };

    logger.info('Detailed health check completed', {
        requestId,
        overallStatus,
        databaseStatus: healthChecks.database?.status,
        llmStatus: healthChecks.llm?.status
    });

    res.status(statusCode).json(response);
});

/**
 * GET /health/readiness
 * Kubernetes readiness probe
 */
router.get('/readiness', async (req, res) => {
    const requestId = req.headers['x-request-id'] || `readiness_${Date.now()}`;

    logger.debug('Readiness probe check started', { requestId });

    try {
        // Check if database is accessible
        const dbHealth = await databaseService.healthCheck();

        if (dbHealth.status === 'healthy') {
            const response = {
                status: 'ready',
                timestamp: new Date().toISOString(),
                requestId
            };

            logger.debug('Readiness probe passed', { requestId });
            res.status(200).json(response);
        } else {
            const response = {
                status: 'not ready',
                reason: 'Database not accessible',
                timestamp: new Date().toISOString(),
                requestId
            };

            logger.warn('Readiness probe failed - database not accessible', {
                requestId,
                dbError: dbHealth.error
            });

            res.status(503).json(response);
        }
    } catch (error) {
        const response = {
            status: 'not ready',
            reason: error.message,
            timestamp: new Date().toISOString(),
            requestId
        };

        logger.error('Readiness probe failed with error', {
            requestId,
            error: error.message
        });

        res.status(503).json(response);
    }
});

/**
 * GET /health/liveness
 * Kubernetes liveness probe
 */
router.get('/liveness', (req, res) => {
    const requestId = req.headers['x-request-id'] || `liveness_${Date.now()}`;

    const response = {
        status: 'alive',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        requestId
    };

    logger.debug('Liveness probe check', { requestId, uptime: process.uptime() });

    res.status(200).json(response);
});

/**
 * GET /health/startup
 * Kubernetes startup probe
 */
router.get('/startup', async (req, res) => {
    const requestId = req.headers['x-request-id'] || `startup_${Date.now()}`;

    logger.info('Startup probe check', { requestId });

    try {
        // Basic checks to ensure service is ready to accept traffic
        const dbHealth = await databaseService.healthCheck();

        if (dbHealth.status === 'healthy') {
            const response = {
                status: 'started',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                requestId
            };

            logger.info('Startup probe passed', { requestId });
            res.status(200).json(response);
        } else {
            const response = {
                status: 'starting',
                reason: 'Database not ready',
                timestamp: new Date().toISOString(),
                requestId
            };

            logger.warn('Startup probe failed - database not ready', {
                requestId,
                dbError: dbHealth.error
            });

            res.status(503).json(response);
        }
    } catch (error) {
        const response = {
            status: 'starting',
            reason: error.message,
            timestamp: new Date().toISOString(),
            requestId
        };

        logger.error('Startup probe failed with error', {
            requestId,
            error: error.message
        });

        res.status(503).json(response);
    }
});

module.exports = router;