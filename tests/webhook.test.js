const request = require('supertest');

// Mock the database connection BEFORE importing app
jest.mock('../src/database/connection', () => ({
    query: jest.fn(),
    connectDatabase: jest.fn().mockResolvedValue(undefined),
    closeDatabase: jest.fn().mockResolvedValue(undefined)
}));

// Mock the services
jest.mock('../src/services/llmService');
jest.mock('../src/services/databaseService', () => ({
    isRecordProcessed: jest.fn(),
    updateCallSummary: jest.fn(),
    updateTranscript: jest.fn(),
    getCompanyByAgentId: jest.fn(),
    markAsSentToOdoo: jest.fn(),
    getCallSummary: jest.fn()
}));
jest.mock('../src/services/odooService', () => ({
    authenticate: jest.fn().mockResolvedValue(1),
    createLead: jest.fn().mockResolvedValue({ success: true, leadId: 123 })
}));

const app = require('../src/app');

const llmService = require('../src/services/llmService');
const databaseService = require('../src/services/databaseService');

describe('Webhook API Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /api/webhook/retell', () => {
        const validPayload = {
            event: 'call_ended',
            call: {
                call_type: 'phone_call',
                from_number: '+12137771234',
                to_number: '+12137771235',
                direction: 'inbound',
                call_id: 'Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6',
                agent_id: 'oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD',
                call_status: 'registered',
                metadata: { "survey_id": "9" },
                retell_llm_dynamic_variables: {
                    customer_name: 'John Doe'
                },
                call_analysis: {
                    call_summary: 'This is a test summary from Retell.',
                    custom_analysis_data: {
                        business_description: '',
                        next_steps: 'Agent will call John Mitchell back tomorrow as requested.',
                        target_market: '',
                        project_type: '',
                        specific_challenge: '',
                        previous_experience: '',
                        high_value_score: 0
                    }
                },
                start_timestamp: 1714608475945,
                end_timestamp: 1714608491736,
                disconnection_reason: 'user_hangup',
                transcript: 'Hello, this is a test transcript for the call summary generation.',
                opt_out_sensitive_data_storage: false,
                id: 12345
            }
        };

        test('should process webhook successfully when record is not processed', async () => {
            // Mock database service
            databaseService.isRecordProcessed.mockResolvedValue({
                exists: true,
                processed: false,
                record: null
            });

            databaseService.updateTranscript.mockResolvedValue({
                success: true,
                surveyId: 9,
                updatedAt: new Date()
            });

            databaseService.getCompanyByAgentId.mockResolvedValue({
                id: 1,
                name: 'Test Company',
                summary_by_ollama: true,
                agent_id: 'oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD'
            });

            databaseService.updateCallSummary.mockResolvedValue({
                action: 'updated',
                surveyId: 9,
                record: {
                    id: 9,
                    processed: true,
                    created_at: new Date(),
                    updated_at: new Date()
                }
            });

            databaseService.markAsSentToOdoo.mockResolvedValue(true);

            // Mock LLM service
            llmService.generateSummary.mockResolvedValue('This is a test summary of the call.');

            const response = await request(app)
                .post('/api/webhook/retell')
                .send(validPayload)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.message).toBe('Webhook processed successfully');
            expect(response.body.data.surveyId).toBe("9");
            expect(response.body.data.databaseAction).toBe('updated');
            expect(response.body.data.summarySource).toBe('ollama');

            expect(llmService.generateSummary).toHaveBeenCalledWith(
                validPayload.call.transcript,
                validPayload.call.retell_llm_dynamic_variables
            );

            // Verify the summary is a JSON string containing the summary and custom_analysis_data
            const callArgs = databaseService.updateCallSummary.mock.calls[0];
            expect(callArgs[0]).toBe("9");
            const summaryObj = JSON.parse(callArgs[1]);
            expect(summaryObj.summary).toBe('This is a test summary of the call.');
            // Verify custom_analysis_data fields are included if present in payload
            expect(summaryObj).toHaveProperty('business_description', '');
            expect(summaryObj).toHaveProperty('next_steps', 'Agent will call John Mitchell back tomorrow as requested.');
            expect(summaryObj.high_value_score).toBe(0);
        });

        test('should use Retell summary when summary_by_ollama is false', async () => {
            // Mock database service
            databaseService.isRecordProcessed.mockResolvedValue({
                exists: true,
                processed: false,
                record: null
            });

            databaseService.updateTranscript.mockResolvedValue({
                success: true,
                surveyId: 9,
                updatedAt: new Date()
            });

            databaseService.getCompanyByAgentId.mockResolvedValue({
                id: 1,
                name: 'Test Company',
                summary_by_ollama: false,
                agent_id: 'oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD'
            });

            databaseService.updateCallSummary.mockResolvedValue({
                action: 'updated',
                surveyId: 9,
                record: {
                    id: 9,
                    processed: true,
                    created_at: new Date(),
                    updated_at: new Date()
                }
            });

            databaseService.markAsSentToOdoo.mockResolvedValue(true);

            const response = await request(app)
                .post('/api/webhook/retell')
                .send(validPayload)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.message).toBe('Webhook processed successfully');
            expect(response.body.data.surveyId).toBe("9");
            expect(response.body.data.summarySource).toBe('retell');

            // Should NOT call LLM service when using Retell summary
            expect(llmService.generateSummary).not.toHaveBeenCalled();

            // Verify the summary is a JSON string containing the summary and custom_analysis_data
            const callArgs = databaseService.updateCallSummary.mock.calls[0];
            expect(callArgs[0]).toBe("9");
            const summaryObj = JSON.parse(callArgs[1]);
            expect(summaryObj.summary).toBe('This is a test summary from Retell.');
            // Verify custom_analysis_data fields are included if present in payload
            expect(summaryObj).toHaveProperty('business_description', '');
            expect(summaryObj).toHaveProperty('next_steps', 'Agent will call John Mitchell back tomorrow as requested.');
            expect(summaryObj.high_value_score).toBe(0);
        });

        test('should skip processing when record is already processed', async () => {
            // Mock database service to return processed record
            databaseService.isRecordProcessed.mockResolvedValue({
                exists: true,
                processed: true,
                record: {
                    id: 12345,
                    processed: true,
                    call_summary: 'Existing summary',
                    created_at: new Date(),
                    updated_at: new Date()
                }
            });

            const response = await request(app)
                .post('/api/webhook/retell')
                .send(validPayload)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.message).toBe('Record already processed');
            expect(response.body.data.action).toBe('skipped');
            expect(response.body.data.reason).toBe('already_processed');

            // Should not call LLM or update database
            expect(llmService.generateSummary).not.toHaveBeenCalled();
            expect(databaseService.updateCallSummary).not.toHaveBeenCalled();
        });

        test('should return 400 for invalid payload - missing call object', async () => {
            const invalidPayload = {
                event: 'call_ended'
                // Missing call object
            };

            const response = await request(app)
                .post('/api/webhook/retell')
                .send(invalidPayload)
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Invalid payload');
            expect(response.body.details).toContain('Missing call object');
        });

        test('should return 400 for invalid payload - missing transcript', async () => {
            const invalidPayload = {
                event: 'call_ended',
                call: {
                    call_id: 'test123',
                    id: 12345
                    // Missing transcript
                }
            };

            const response = await request(app)
                .post('/api/webhook/retell')
                .send(invalidPayload)
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Invalid payload');
            expect(response.body.details).toContain('Missing transcript in call object');
        });

        test('should return 400 for invalid payload - missing survey_id', async () => {
            const invalidPayload = {
                event: 'call_ended',
                call: {
                    call_id: 'test123',
                    transcript: 'Test transcript'
                    // Missing survey_id
                }
            };

            const response = await request(app)
                .post('/api/webhook/retell')
                .send(invalidPayload)
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Invalid payload');
            expect(response.body.details).toContain('Missing survey_id in call object');
        });

        test('should handle LLM service error', async () => {
            // Mock database service
            databaseService.isRecordProcessed.mockResolvedValue({
                exists: true,
                processed: false,
                record: null
            });

            databaseService.updateTranscript.mockResolvedValue({
                success: true,
                surveyId: 9,
                updatedAt: new Date()
            });

            databaseService.getCompanyByAgentId.mockResolvedValue({
                id: 1,
                name: 'Test Company',
                summary_by_ollama: true,
                agent_id: 'oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD'
            });

            // Mock LLM service to throw error
            llmService.generateSummary.mockRejectedValue(new Error('LLM service unavailable'));

            const response = await request(app)
                .post('/api/webhook/retell')
                .send(validPayload)
                .expect(500);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Failed to process webhook');
            expect(response.body.message).toContain('LLM service unavailable');
        });

        test('should handle database service error', async () => {
            // Mock database service to throw error
            databaseService.isRecordProcessed.mockRejectedValue(new Error('Database connection failed'));

            const response = await request(app)
                .post('/api/webhook/retell')
                .send(validPayload)
                .expect(500);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Failed to process webhook');
            expect(response.body.message).toContain('Database connection failed');
        });
    });

    describe('GET /api/webhook/summary/:surveyId', () => {
        test('should retrieve existing summary', async () => {
            const mockSummary = {
                id: 12345,
                call_summary: 'This is a test summary',
                processed: true,
                created_at: new Date(),
                updated_at: new Date()
            };

            databaseService.getCallSummary.mockResolvedValue(mockSummary);

            const response = await request(app)
                .get('/api/webhook/summary/12345')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.id).toBe(mockSummary.id);
            expect(response.body.data.call_summary).toBe(mockSummary.call_summary);
            expect(response.body.data.processed).toBe(mockSummary.processed);
            expect(databaseService.getCallSummary).toHaveBeenCalledWith(12345);
        });

        test('should return 404 for non-existent summary', async () => {
            databaseService.getCallSummary.mockResolvedValue(null);

            const response = await request(app)
                .get('/api/webhook/summary/99999')
                .expect(404);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Summary not found');
            expect(response.body.surveyId).toBe(99999);
        });

        test('should return 400 for invalid survey ID', async () => {
            const response = await request(app)
                .get('/api/webhook/summary/invalid')
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Invalid survey ID');
        });

        test('should handle database error', async () => {
            databaseService.getCallSummary.mockRejectedValue(new Error('Database error'));

            const response = await request(app)
                .get('/api/webhook/summary/12345')
                .expect(500);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Failed to retrieve summary');
        });
    });
});