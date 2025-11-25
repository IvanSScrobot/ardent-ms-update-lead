const express = require('express');
const llmService = require('../services/llmService');
const databaseService = require('../services/databaseService');
const odooService = require('../services/odooService');
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

    if (body.call.transcript === undefined || body.call.transcript === null) {
        errors.push('Missing transcript in call object');
    }

    if (!body.call.metadata || body.call.metadata.survey_id === undefined || body.call.metadata.survey_id === null) {
        errors.push('Missing survey_id in call object');
    }

    logger.debug('Payload validation completed', {
        errorCount: errors.length,
        errors: errors
    });

    return errors;
}

/**
 * Normalize call analysis shape from webhook payload
 * Handles objects, arrays, and JSON strings.
 */
function normalizeCallAnalysis(callAnalysis) {
    if (!callAnalysis) {
        return {};
    }

    if (typeof callAnalysis === 'string') {
        try {
            const parsed = JSON.parse(callAnalysis);
            return normalizeCallAnalysis(parsed);
        } catch (error) {
            return { call_summary: callAnalysis };
        }
    }

    if (Array.isArray(callAnalysis)) {
        const withSummary = callAnalysis.find(item =>
            item && typeof item === 'object' && item.call_summary !== undefined
        );
        if (withSummary) {
            return withSummary;
        }

        const firstObject = callAnalysis.find(item => item && typeof item === 'object');
        if (firstObject) {
            return firstObject;
        }

        const hasStringEntries = callAnalysis.some(item => typeof item === 'string');
        if (hasStringEntries) {
            return { call_summary: callAnalysis };
        }

        return {};
    }

    if (typeof callAnalysis === 'object') {
        return callAnalysis;
    }

    return {};
}

/**
 * Extract relevant data from webhook payload
 */
function extractWebhookData(body, requestId) {
    logger.debug('Extracting webhook data', { requestId });

    const { call } = body;
    const normalizedCallAnalysis = normalizeCallAnalysis(call.call_analysis);

    const extractedData = {
        transcript: call.transcript,
        dynamicVariables: call.retell_llm_dynamic_variables || {},
        surveyId: call.metadata.survey_id,
        callId: call.call_id,
        agentId: call.agent_id,
        callAnalysis: normalizedCallAnalysis,
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
    logger.info('Extracted webhook data', {
        ...extractedData,
        requestId
    });
    logger.info('=== Webhook data extracted successfully ===', {
        requestId,
        surveyId: extractedData.surveyId,
        callId: extractedData.callId,
        transcriptLength: extractedData.transcript.length,
        dynamicVariableKeys: Object.keys(extractedData.dynamicVariables),
        event: extractedData.metadata.event,
        callType: extractedData.metadata.callType,
        direction: extractedData.metadata.direction,
        callAnalysisShape: Array.isArray(call.call_analysis) ? 'array' : typeof call.call_analysis
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
            surveyId: req.body.call?.metadata?.survey_id,
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
        const {
            transcript,
            dynamicVariables,
            surveyId,
            callId,
            agentId,
            callAnalysis,
            metadata
        } = extractWebhookData(req.body, requestId);
        logger.info('STEP 2: Webhook data extracted', {
            requestId,
            surveyId,
            callId,
            transcriptLength: transcript?.length || 0,
            dynamicVariableKeys: Object.keys(dynamicVariables || {}),
            hasCallAnalysis: !!callAnalysis,
            callAnalysisKeys: callAnalysis ? Object.keys(callAnalysis) : [],
            callAnalysisType: Array.isArray(callAnalysis) ? 'array' : typeof callAnalysis
        });

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
            // if (recordStatus.exists) {
            logger.info('Record not processed yet, proceeding with transcript update and summary generation', {
                // logger.info('Proceeding with transcript update and summary generation', {
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

            // Step 4: Get company settings and determine how to get summary
            logger.info('STEP 4: Getting company settings', {
                requestId,
                surveyId,
                callId,
                agentId
            });

            let summaryText = null;
            let summarySource = 'retell'; // Default to retell

            // Get company settings to check if we should use Ollama
            const company = agentId ? await databaseService.getCompanyByAgentId(agentId) : null;

            if (company && company.summary_by_ollama === true) {
                // Use Ollama to generate summary
                logger.info('Using Ollama for summary generation', {
                    requestId,
                    surveyId,
                    companyId: company.id,
                    companyName: company.name
                });

                summaryText = await llmService.generateSummary(transcript, dynamicVariables);
                summarySource = 'ollama';

                logger.info('Ollama summary generation completed', {
                    requestId,
                    surveyId,
                    summaryLength: summaryText.length,
                    summaryPreview: summaryText.substring(0, 100) + (summaryText.length > 100 ? '...' : '')
                });
            } else {
                const callSummaryRaw = callAnalysis?.call_summary;

                // Use summary from Retell call_analysis
                logger.info('Using Retell call_analysis summary', {
                    requestId,
                    surveyId,
                    companyId: company?.id || null,
                    companyName: company?.name || null,
                    summaryByOllamaDisabled: company ? !company.summary_by_ollama : 'no_company_found',
                    hasCallAnalysis: !!callAnalysis,
                    hasCallSummary: !!callSummaryRaw,
                    callSummaryType: Array.isArray(callSummaryRaw) ? 'array' : typeof callSummaryRaw
                });

                if (callSummaryRaw && typeof callSummaryRaw === 'string') {
                    // Trim the summary to remove any leading/trailing whitespace
                    summaryText = callSummaryRaw.trim();

                    if (summaryText.length > 0) {
                        logger.info('Summary extracted from call_analysis', {
                            requestId,
                            surveyId,
                            summaryLength: summaryText.length,
                            summaryPreview: summaryText.substring(0, 100)
                        });
                    } else {
                        logger.warn('call_summary exists but is empty after trimming', {
                            requestId,
                            surveyId,
                            originalLength: callSummaryRaw.length
                        });
                        summaryText = '';
                    }
                } else if (Array.isArray(callSummaryRaw)) {
                    // Join array summaries into a single string
                    const cleanedSummaries = callSummaryRaw
                        .filter(item => typeof item === 'string')
                        .map(item => item.trim())
                        .filter(item => item.length > 0);

                    summaryText = cleanedSummaries.join(' ');

                    if (summaryText.length > 0) {
                        logger.info('Summary extracted from call_analysis array', {
                            requestId,
                            surveyId,
                            summaryLength: summaryText.length,
                            summaryPreview: summaryText.substring(0, 100),
                            summaryItemCount: cleanedSummaries.length
                        });
                    } else {
                        logger.warn('call_summary array exists but yielded no usable content', {
                            requestId,
                            surveyId,
                            originalLength: callSummaryRaw.length
                        });
                    }
                } else {
                    logger.warn('No valid call_summary found in call_analysis', {
                        requestId,
                        surveyId,
                        hasCallAnalysis: !!callAnalysis,
                        callAnalysisKeys: callAnalysis ? Object.keys(callAnalysis) : [],
                        callSummaryValue: callAnalysis?.call_summary
                    });
                    summaryText = '';
                }
            }

            // Step 4.5: Build summary object with custom_analysis_data if available
            let summaryObject = {
                summary: summaryText
            };

            // Check if custom_analysis_data exists and is not empty
            const customAnalysisData = callAnalysis?.custom_analysis_data;
            if (customAnalysisData && typeof customAnalysisData === 'object' && Object.keys(customAnalysisData).length > 0) {
                logger.info('Adding custom_analysis_data to summary object', {
                    requestId,
                    surveyId,
                    customDataKeys: Object.keys(customAnalysisData)
                });

                // Merge custom_analysis_data into summary object
                summaryObject = {
                    ...summaryObject,
                    ...customAnalysisData
                };
            }

            // Convert summary object to JSON string for database storage
            const summary = JSON.stringify(summaryObject);

            logger.info('Summary object created', {
                requestId,
                surveyId,
                summarySource,
                summaryLength: summary.length,
                hasCustomData: !!customAnalysisData
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

            // Step 6: Create lead in Odoo CRM
            logger.info('STEP 6: Creating lead in Odoo CRM', {
                requestId,
                surveyId,
                callId
            });

            let odooResult = null;
            try {
                // Extract customer name from dynamic variables or use a default
                const customerName = dynamicVariables.customer_name ||
                    dynamicVariables.customerName ||
                    dynamicVariables.name ||
                    `Survey Respondent ${surveyId}`;

                const leadData = {
                    customerName: customerName,
                    surveyId: surveyId,
                    summary: summary,
                    phone: metadata.toNumber,
                    email: dynamicVariables.email || dynamicVariables.emailAddress || null
                };

                logger.info('=== Prepared lead data for Odoo ===', {
                    requestId,
                    surveyId,
                    customerName: leadData.customerName,
                    phone: leadData.phone,
                    email: leadData.email
                });

                const uid = await odooService.authenticate();
                console.log('Authenticated uid:', uid);
                odooResult = await odooService.createLead(leadData);

                logger.info('Odoo lead creation completed', {
                    requestId,
                    surveyId,
                    leadId: odooResult.leadId,
                    customerName: odooResult.customerName
                });

                const updated = await databaseService.markAsSentToOdoo(surveyId);

                if (updated) {
                    logger.info({
                        surveyId,
                        leadId: odooResult.leadId,
                        customerName: leadData.customerName
                    }, 'Successfully created Odoo lead and marked survey as sent');
                } else {
                    logger.warn({
                        surveyId,
                        leadId: odooResult.leadId
                    }, 'Created Odoo lead but failed to update survey status');
                }

            } catch (odooError) {
                logger.error('Odoo lead creation failed', {
                    requestId,
                    surveyId,
                    error: odooError.message,
                    stack: odooError.stack,
                    errorType: odooError.message.includes('Missing required Odoo environment variables') ? 'configuration' : 'runtime'
                });
                // Continue processing even if Odoo fails
                odooResult = {
                    success: false,
                    error: odooError.message,
                    errorType: odooError.message.includes('Missing required Odoo environment variables') ? 'configuration' : 'runtime'
                };
            }

            const processingTime = Date.now() - startTime;

            logger.info('=== WEBHOOK PROCESSING COMPLETED SUCCESSFULLY ===', {
                requestId,
                surveyId,
                callId,
                processingTime: `${processingTime}ms`,
                action: dbResult.action,
                summaryLength: summary.length,
                summarySource,
                odooLeadCreated: odooResult?.success || false
            });

            // Return success response
            res.status(200).json({
                success: true,
                message: 'Webhook processed successfully',
                data: {
                    surveyId,
                    callId,
                    summaryLength: summary.length,
                    summarySource,
                    databaseAction: dbResult.action,
                    processingTimeMs: processingTime,
                    record: dbResult.record,
                    odooLead: odooResult
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
            surveyId: req.body.call?.metadata?.survey_id,
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
