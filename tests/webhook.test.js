const request = require('supertest');
const app = require('../src/app');

// Mock the services
jest.mock('../src/services/llmService');
jest.mock('../src/services/databaseService');

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
                metadata: {},
                retell_llm_dynamic_variables: {
                    customer_name: 'John Doe'
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
                exists: false,
                processed: false,
                record: null
            });

            databaseService.updateCallSummary.mockResolvedValue({
                action: 'inserted',
                surveyId: 12345,
                record: {
                    id: 12345,
                    processed: true,
                    created_at: new Date(),
                    updated_at: new Date()
                }
            });

            // Mock LLM service
            llmService.generateSummary.mockResolvedValue('This is a test summary of the call.');

            const response = await request(app)
                .post('/api/webhook/retell')
                .send(validPayload)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.message).toBe('Webhook processed successfully');
            expect(response.body.data.surveyId).toBe(12345);
            expect(response.body.data.databaseAction).toBe('inserted');

            expect(llmService.generateSummary).toHaveBeenCalledWith(
                validPayload.call.transcript,
                validPayload.call.retell_llm_dynamic_variables
            );
            expect(databaseService.updateCallSummary).toHaveBeenCalledWith(
                12345,
                'This is a test summary of the call.'
            );
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
                exists: false,
                processed: false,
                record: null
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
            expect(response.body.data).toEqual(mockSummary);
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