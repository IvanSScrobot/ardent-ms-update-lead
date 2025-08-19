const express = require('express');
const llmService = require('../services/llmService');
const databaseService = require('../services/databaseService');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Validate webhook payload
 */
function validateWebhookPayload(body) {
    const errors = [];

    logger.debug('Validating webhook payload structure');

    if (!body.call) {
        errors.push('Missing call object');
        return errors;
    }

    if (!body.call.transcript) {
        errors.push('Missing transcript in call object');
    }

    if (body.call.metadata.survey_id === undefined || body.call.metadata.survey_id === null) {
        errors.push('Missing survey_id in call object');
    }

    logger.debug('Payload validation completed', {
        errorCount: errors.length,
        errors: errors
    });

    return errors;
}

/**
 * Extract relevant data from webhook payload
 */
function extractWebhookData(body) {
    logger.debug('Extracting webhook data');

    const { call } = body;

    const extractedData = {
        transcript: call.transcript,
        dynamicVariables: call.retell_llm_dynamic_variables || {},
        surveyId: call.metadata.survey_id,
        callId: call.call_id,
        metadata: {
            event: body.event,
            callType: call.call_type,
            direction: call.direction,
            fromNumber: call.from_number,
            toNumber: call.to_number,
            startTimestamp: call.start_timestamp,
            endTimestamp: call.end_timestamp,
            disconnectionReason: call.disconnection_reason
        }
    };

    logger.info('Webhook data extracted successfully', {
        surveyId: extractedData.surveyId,
        callId: extractedData.callId,
        transcriptLength: extractedData.transcript.length,
        dynamicVariableKeys: Object.keys(extractedData.dynamicVariables),
        event: extractedData.metadata.event,
        callType: extractedData.metadata.callType,
        direction: extractedData.metadata.direction
    });

    return extractedData;
}

/**
 * POST /api/webhook/retell
 * Process Retell webhook payload
 */
router.post('/retell', async (req, res) => {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    logger.info('=== WEBHOOK PROCESSING STARTED ===', {
        requestId,
        timestamp: new Date().toISOString(),
        userAgent: req.get('User-Agent'),
        contentLength: req.get('Content-Length')
    });

    try {
        // Log initial payload info
        logger.info('Received webhook payload', {
            requestId,
            event: req.body.event,
            callId: req.body.call?.call_id,
            surveyId: req.body.call?.metadata.survey_id,
            payloadSize: JSON.stringify(req.body).length
        });

        // Step 1: Validate payload
        logger.info('STEP 1: Validating webhook payload', { requestId });
        logger.info('Request body:', { requestId, body: req.body });

        const validationErrors = validateWebhookPayload(req.body);
        if (validationErrors.length > 0) {
            logger.error('Payload validation failed', {
                requestId,
                errors: validationErrors
            });

            return res.status(400).json({
                success: false,
                error: 'Invalid payload',
                details: validationErrors,
                requestId
            });
        }
        logger.info('Payload validation successful', { requestId });

        // Step 2: Extract data
        logger.info('STEP 2: Extracting webhook data', { requestId });
        const { transcript, dynamicVariables, surveyId, callId, metadata } = extractWebhookData(req.body);

        // Step 3: Check if record is already processed
        logger.info('STEP 3: Checking if record is already processed', {
            requestId,
            surveyId
        });

        const recordStatus = await databaseService.isRecordProcessed(surveyId);

        if (!recordStatus.exists) {
            const processingTime = Date.now() - startTime;

            logger.warn('No existing record found, returning 404 error', {
                requestId,
                surveyId,
                callId
            });

            return res.status(404).json({
                success: false,
                message: 'Record is not found',
                data: {
                    surveyId,
                    callId,
                    action: 'skipped',
                    reason: 'record_not_found',
                    existingRecord: null,
                    processingTimeMs: processingTime
                },
                requestId
            });

        }

        if (recordStatus.exists && recordStatus.processed) {
            const processingTime = Date.now() - startTime;

            logger.warn('Record already processed, returning early', {
                requestId,
                surveyId,
                callId,
                existingRecord: {
                    createdAt: recordStatus.record.created_at,
                    updatedAt: recordStatus.record.updated_at
                },
                processingTime: `${processingTime}ms`
            });

            return res.status(200).json({
                success: true,
                message: 'Record already processed',
                data: {
                    surveyId,
                    callId,
                    action: 'skipped',
                    reason: 'already_processed',
                    existingRecord: recordStatus.record,
                    processingTimeMs: processingTime
                },
                requestId
            });
        }

        if (recordStatus.exists && !recordStatus.processed) {
            logger.info('Record not processed yet, proceeding with transcript update and summary generation', {
                requestId,
                surveyId,
                recordExists: recordStatus.exists
            });

            // Step 3.5: Update transcript in survey_responses table
            logger.info('STEP 3.5: Updating transcript in survey_responses table', {
                requestId,
                surveyId,
                transcriptLength: transcript.length
            });

            const transcriptUpdateResult = await databaseService.updateTranscript(surveyId, transcript);

            if (transcriptUpdateResult.success) {
                logger.info('Transcript update completed successfully', {
                    requestId,
                    surveyId,
                    updatedAt: transcriptUpdateResult.updatedAt,
                    transcriptLength: transcript.length
                });
            } else {
                logger.warn('Transcript update failed', {
                    requestId,
                    surveyId,
                    reason: transcriptUpdateResult.reason
                });
            }

            // Step 4: Generate summary using LLM
            logger.info('STEP 4: Generating summary with LLM', {
                requestId,
                surveyId,
                callId,
                transcriptLength: transcript.length,
                dynamicVariables: Object.keys(dynamicVariables)
            });

            const summary = await llmService.generateSummary(transcript, dynamicVariables);

            logger.info('Summary generation completed', {
                requestId,
                surveyId,
                summaryLength: summary.length,
                summaryPreview: summary.substring(0, 100) + (summary.length > 100 ? '...' : '')
            });

            // Step 5: Update database
            logger.info('STEP 5: Updating database with summary', {
                requestId,
                surveyId,
                summaryLength: summary.length
            });

            const dbResult = await databaseService.updateCallSummary(surveyId, summary);

            logger.info('Database update completed', {
                requestId,
                surveyId,
                action: dbResult.action,
                recordCreated: dbResult.record?.created_at,
                recordUpdated: dbResult.record?.updated_at
            });

            const processingTime = Date.now() - startTime;

            logger.info('=== WEBHOOK PROCESSING COMPLETED SUCCESSFULLY ===', {
                requestId,
                surveyId,
                callId,
                processingTime: `${processingTime}ms`,
                action: dbResult.action,
                summaryLength: summary.length
            });

            // Return success response
            res.status(200).json({
                success: true,
                message: 'Webhook processed successfully',
                data: {
                    surveyId,
                    callId,
                    summaryLength: summary.length,
                    databaseAction: dbResult.action,
                    processingTimeMs: processingTime,
                    record: dbResult.record
                },
                requestId
            });
        }

    } catch (error) {
        const processingTime = Date.now() - startTime;

        logger.error('=== WEBHOOK PROCESSING FAILED ===', {
            requestId,
            error: error.message,
            stack: error.stack,
            processingTime: `${processingTime}ms`,
            surveyId: req.body.call?.metadata.survey_id,
            callId: req.body.call?.call_id
        });

        res.status(500).json({
            success: false,
            error: 'Failed to process webhook',
            message: error.message,
            processingTimeMs: processingTime,
            requestId
        });
    }
});

/**
 * GET /api/webhook/summary/:surveyId
 * Retrieve call summary by survey ID
 */
router.get('/summary/:surveyId', async (req, res) => {
    const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
        const { surveyId } = req.params;

        logger.info('Retrieving call summary', {
            requestId,
            surveyId,
            method: 'GET'
        });

        if (!surveyId || isNaN(parseInt(surveyId))) {
            logger.warn('Invalid survey ID provided', {
                requestId,
                surveyId
            });

            return res.status(400).json({
                success: false,
                error: 'Invalid survey ID',
                requestId
            });
        }

        const summary = await databaseService.getCallSummary(parseInt(surveyId));

        if (!summary) {
            logger.info('Summary not found', {
                requestId,
                surveyId: parseInt(surveyId)
            });

            return res.status(404).json({
                success: false,
                error: 'Summary not found',
                surveyId: parseInt(surveyId),
                requestId
            });
        }

        logger.info('Summary retrieved successfully', {
            requestId,
            surveyId: parseInt(surveyId),
            processed: summary.processed,
            summaryLength: summary.call_summary ? summary.call_summary.length : 0
        });

        res.status(200).json({
            success: true,
            data: summary,
            requestId
        });

    } catch (error) {
        logger.error('Error retrieving summary', {
            requestId,
            surveyId: req.params.surveyId,
            error: error.message,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            error: 'Failed to retrieve summary',
            message: error.message,
            requestId
        });
    }
});

module.exports = router;