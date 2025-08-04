const { Pool } = require('pg');
const logger = require('../utils/logger');

let pool;

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'retell_db',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
};

async function connectDatabase() {
    if (!pool) {
        logger.info('Initializing database connection', {
            host: dbConfig.host,
            port: dbConfig.port,
            database: dbConfig.database,
            user: dbConfig.user ? '***' : 'not provided'
        });

        // Validate required environment variables
        if (!process.env.DB_USER || !process.env.DB_PASSWORD) {
            const error = 'Database credentials not provided. Check DB_USER and DB_PASSWORD environment variables.';
            logger.error('Database configuration error', { error });
            throw new Error(error);
        }

        pool = new Pool(dbConfig);

        // Test the connection
        try {
            const client = await pool.connect();
            const result = await client.query('SELECT NOW() as current_time, version() as pg_version');
            client.release();

            logger.info('Database connection test successful', {
                currentTime: result.rows[0].current_time,
                postgresVersion: result.rows[0].pg_version.split(' ')[0]
            });
        } catch (error) {
            logger.error('Database connection test failed', {
                error: error.message,
                host: dbConfig.host,
                port: dbConfig.port,
                database: dbConfig.database
            });
            throw error;
        }
    }
    return pool;
}

async function getPool() {
    if (!pool) {
        await connectDatabase();
    }
    return pool;
}

async function query(text, params) {
    const pool = await getPool();
    const start = Date.now();

    logger.debug('Executing database query', {
        query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        paramCount: params ? params.length : 0
    });

    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;

        logger.info('Database query executed successfully', {
            duration: `${duration}ms`,
            rowCount: res.rowCount,
            command: res.command
        });

        return res;
    } catch (error) {
        const duration = Date.now() - start;

        logger.error('Database query failed', {
            error: error.message,
            duration: `${duration}ms`,
            query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
            paramCount: params ? params.length : 0
        });

        throw error;
    }
}

module.exports = {
    connectDatabase,
    getPool,
    query
};