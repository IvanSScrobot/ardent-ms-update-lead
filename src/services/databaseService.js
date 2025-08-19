const { query } = require('../database/connection');
const logger = require('../utils/logger');

class DatabaseService {
    constructor() {
        this.tableName = process.env.DB_TABLE_NAME || 'survey_responses';
    }

    /**
     * Check if a record exists and is already processed
     */
    async isRecordProcessed(surveyId) {
        try {
            logger.info('Checking if record is already processed', { surveyId });

            const selectQuery = `
        SELECT id, processed, call_summary, created_at, updated_at
        FROM ${this.tableName}
        WHERE id = $1
      `;

            const result = await query(selectQuery, [surveyId]);

            if (result.rows.length > 0) {
                const record = result.rows[0];
                const isProcessed = record.processed === true;

                logger.info('Record found in database', {
                    surveyId,
                    processed: isProcessed,
                    hasSummary: !!record.call_summary,
                    createdAt: record.created_at,
                    updatedAt: record.updated_at
                });

                return {
                    exists: true,
                    processed: isProcessed,
                    record: record
                };
            }

            logger.info('No existing record found', { surveyId });
            return {
                exists: false,
                processed: false,
                record: null
            };
        } catch (error) {
            logger.error('Error checking record processed status', {
                surveyId,
                error: error.message
            });
            throw new Error(`Failed to check record status: ${error.message}`);
        }
    }

    /**
     * Update call summary in the database
     */
    async updateCallSummary(surveyId, callSummary) {
        try {
            logger.info('Starting database update process', {
                surveyId,
                summaryLength: callSummary.length
            });

            // First check if record exists and is processed
            const recordStatus = await this.isRecordProcessed(surveyId);

            if (recordStatus.exists && recordStatus.processed) {
                logger.warn('Record already processed, skipping update', {
                    surveyId,
                    existingRecord: {
                        createdAt: recordStatus.record.created_at,
                        updatedAt: recordStatus.record.updated_at,
                        hasSummary: !!recordStatus.record.call_summary
                    }
                });

                return {
                    action: 'skipped',
                    reason: 'already_processed',
                    surveyId,
                    existingRecord: recordStatus.record
                };
            }

            if (recordStatus.exists) {
                // Update existing record
                logger.info('Updating existing record', { surveyId });

                const updateQuery = `
          UPDATE ${this.tableName} 
          SET call_summary = $1, processed = true, updated_at = NOW() 
          WHERE id = $2
          RETURNING id, processed, created_at, updated_at
        `;

                const updateResult = await query(updateQuery, [callSummary, surveyId]);

                if (updateResult.rowCount > 0) {
                    const updatedRecord = updateResult.rows[0];
                    logger.info('Successfully updated existing record', {
                        surveyId,
                        processed: updatedRecord.processed,
                        updatedAt: updatedRecord.updated_at
                    });

                    return {
                        action: 'updated',
                        surveyId,
                        record: updatedRecord
                    };
                }

                throw new Error('Failed to update existing record');
            } else {
                // Insert new record
                logger.info('Inserting new record', { surveyId });

                const insertQuery = `
          INSERT INTO ${this.tableName} (id, call_summary, processed, created_at, updated_at)
          VALUES ($1, $2, true, NOW(), NOW())
          RETURNING id, processed, created_at, updated_at
        `;

                const insertResult = await query(insertQuery, [surveyId, callSummary]);

                if (insertResult.rowCount > 0) {
                    const newRecord = insertResult.rows[0];
                    logger.info('Successfully inserted new record', {
                        surveyId,
                        processed: newRecord.processed,
                        createdAt: newRecord.created_at
                    });

                    return {
                        action: 'inserted',
                        surveyId,
                        record: newRecord
                    };
                }

                throw new Error('Failed to insert new record');
            }
        } catch (error) {
            logger.error('Database operation failed', {
                surveyId,
                error: error.message,
                stack: error.stack
            });
            throw new Error(`Database operation failed: ${error.message}`);
        }
    }

    /**
     * Get call summary by survey ID
     */
    async getCallSummary(surveyId) {
        try {
            logger.info('Retrieving call summary', { surveyId });

            const selectQuery = `
        SELECT id, call_summary, processed, created_at, updated_at
        FROM ${this.tableName}
        WHERE id = $1
      `;

            const result = await query(selectQuery, [surveyId]);

            if (result.rows.length > 0) {
                const record = result.rows[0];
                logger.info('Call summary retrieved successfully', {
                    surveyId,
                    processed: record.processed,
                    hasSummary: !!record.call_summary,
                    summaryLength: record.call_summary ? record.call_summary.length : 0
                });

                return record;
            }

            logger.info('No call summary found', { surveyId });
            return null;
        } catch (error) {
            logger.error('Error retrieving call summary', {
                surveyId,
                error: error.message
            });
            throw new Error(`Failed to retrieve call summary: ${error.message}`);
        }
    }

    /**
     * Update transcript in the survey_responses table
     */
    async updateTranscript(surveyId, transcript) {
        try {
            logger.info('Updating transcript in survey_responses table', {
                surveyId,
                transcriptLength: transcript.length
            });

            const updateQuery = `
                UPDATE ${this.tableName}
                SET transcript = $1, updated_at = NOW()
                WHERE id = $2
                RETURNING id, updated_at
            `;

            const result = await query(updateQuery, [transcript, surveyId]);

            if (result.rowCount > 0) {
                const updatedRecord = result.rows[0];
                logger.info('Successfully updated transcript', {
                    surveyId,
                    updatedAt: updatedRecord.updated_at,
                    transcriptLength: transcript.length
                });

                return {
                    success: true,
                    surveyId,
                    updatedAt: updatedRecord.updated_at
                };
            } else {
                logger.warn('No record found to update transcript', { surveyId });
                return {
                    success: false,
                    reason: 'record_not_found',
                    surveyId
                };
            }
        } catch (error) {
            logger.error('Error updating transcript', {
                surveyId,
                error: error.message,
                stack: error.stack
            });
            throw new Error(`Failed to update transcript: ${error.message}`);
        }
    }

    /**
     * Create table if it doesn't exist (for development/testing)
     */
    // ToDo: Uncomment and provide actual table schema to create the table automatically
    // async createTableIfNotExists() {
    //     try {
    //         logger.info('Creating table if not exists', { tableName: this.tableName });

    //         const createTableQuery = `
    //     CREATE TABLE IF NOT EXISTS ${this.tableName} (
    //       id INTEGER PRIMARY KEY,
    //       call_summary TEXT,
    //       processed BOOLEAN DEFAULT FALSE,
    //       created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    //       updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    //     )
    //   `;

    //         await query(createTableQuery);
    //         logger.info('Table creation completed', { tableName: this.tableName });
    //     } catch (error) {
    //         logger.error('Table creation failed', {
    //             tableName: this.tableName,
    //             error: error.message
    //         });
    //         throw new Error(`Failed to create table: ${error.message}`);
    //     }
    // }

    /**
     * Health check for database
     */
    async healthCheck() {
        try {
            logger.debug('Performing database health check');

            const result = await query('SELECT 1 as health_check, NOW() as current_time');

            logger.debug('Database health check successful');
            return {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                currentTime: result.rows[0].current_time
            };
        } catch (error) {
            logger.error('Database health check failed', { error: error.message });
            return {
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
}

module.exports = new DatabaseService();