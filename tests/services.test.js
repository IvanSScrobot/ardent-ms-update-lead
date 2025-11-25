const llmService = require('../src/services/llmService');
const databaseService = require('../src/services/databaseService');

// Mock axios for LLM service tests
jest.mock('axios');
const axios = require('axios');

// Mock database connection for database service tests
jest.mock('../src/database/connection');
const { query } = require('../src/database/connection');

describe('LLM Service Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('estimateTokens', () => {
        test('should estimate tokens correctly', () => {
            const text = 'This is a test text with some words';
            const tokens = llmService.estimateTokens(text);
            expect(tokens).toBe(Math.ceil(text.length / 4));
        });
    });

    describe('chunkText', () => {
        test('should return single chunk for short text', () => {
            const shortText = 'This is a short text.';
            const chunks = llmService.chunkText(shortText, 2048);
            expect(chunks).toHaveLength(1);
            expect(chunks[0]).toBe(shortText);
        });

        test('should split long text into multiple chunks', () => {
            const longText = 'This is a very long text. '.repeat(200);
            const chunks = llmService.chunkText(longText, 100); // Small chunk size for testing
            expect(chunks.length).toBeGreaterThan(1);
            chunks.forEach(chunk => {
                expect(chunk.length).toBeLessThanOrEqual(400); // 100 tokens * 4 chars
            });
        });
    });

    describe('constructPrompt', () => {
        test('should construct prompt correctly with variables', () => {
            const transcript = 'Test transcript';
            const variables = { customer_name: 'John Doe' };
            const prompt = llmService.constructPrompt(transcript, variables);

            expect(prompt).toContain(transcript);
            expect(prompt).toContain('John Doe');
            expect(prompt).toContain('OUTPUT SCHEMA:');
        });

        test('should construct prompt correctly without variables', () => {
            const transcript = 'Test transcript';
            const prompt = llmService.constructPrompt(transcript, {});

            expect(prompt).toContain(transcript);
            expect(prompt).toContain('No additional variables provided');
            expect(prompt).toContain('OUTPUT SCHEMA:');
        });

        test('should include chunk information for multiple chunks', () => {
            const transcript = 'Test transcript';
            const prompt = llmService.constructPrompt(transcript, {}, 2, 3);

            expect(prompt).toContain('(Part 2 of 3)');
        });
    });

    describe('callOllama', () => {
        test('should call Ollama API successfully', async () => {
            const mockResponse = {
                data: {
                    response: 'This is a test summary from Ollama.'
                }
            };

            axios.post.mockResolvedValue(mockResponse);

            const result = await llmService.callOllama('Test prompt');

            expect(result).toBe('This is a test summary from Ollama.');
            expect(axios.post).toHaveBeenCalledWith(
                expect.stringContaining('/api/generate'),
                expect.objectContaining({
                    model: expect.any(String),
                    prompt: 'Test prompt',
                    stream: false
                }),
                expect.objectContaining({
                    timeout: 600000,
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json'
                    })
                })
            );
        });

        test('should handle connection refused error', async () => {
            const error = new Error('Connection refused');
            error.code = 'ECONNREFUSED';
            axios.post.mockRejectedValue(error);

            await expect(llmService.callOllama('Test prompt'))
                .rejects.toThrow('Cannot connect to Ollama service');
        });

        test('should handle invalid response format', async () => {
            const mockResponse = {
                data: {} // Missing response field
            };

            axios.post.mockResolvedValue(mockResponse);

            await expect(llmService.callOllama('Test prompt'))
                .rejects.toThrow('Invalid response format from Ollama');
        });
    });

    describe('generateSummary', () => {
        test('should generate summary for single chunk', async () => {
            const transcript = 'Short transcript';
            const variables = { customer_name: 'John' };

            // Mock chunkText to return single chunk
            jest.spyOn(llmService, 'chunkText').mockReturnValue([transcript]);
            jest.spyOn(llmService, 'callOllama').mockResolvedValue('Test summary');

            const result = await llmService.generateSummary(transcript, variables);

            expect(result).toBe('Test summary');
            expect(llmService.callOllama).toHaveBeenCalledTimes(1);
        });

        test('should generate summary for multiple chunks', async () => {
            const transcript = 'Long transcript';
            const variables = { customer_name: 'John' };

            // Mock chunkText to return multiple chunks
            jest.spyOn(llmService, 'chunkText').mockReturnValue(['chunk1', 'chunk2']);
            jest.spyOn(llmService, 'callOllama')
                .mockResolvedValueOnce('Summary 1')
                .mockResolvedValueOnce('Summary 2')
                .mockResolvedValueOnce('Final summary');

            const result = await llmService.generateSummary(transcript, variables);

            expect(result).toBe('Final summary');
            expect(llmService.callOllama).toHaveBeenCalledTimes(3); // 2 chunks + 1 final
        });
    });

    describe('healthCheck', () => {
        test('should return healthy status', async () => {
            const mockResponse = {
                data: {
                    models: [{ name: 'llama2' }]
                }
            };

            axios.get.mockResolvedValue(mockResponse);

            const result = await llmService.healthCheck();

            expect(result.status).toBe('healthy');
            expect(result.models).toHaveLength(1);
        });

        test('should return unhealthy status on error', async () => {
            axios.get.mockRejectedValue(new Error('Connection failed'));

            const result = await llmService.healthCheck();

            expect(result.status).toBe('unhealthy');
            expect(result.error).toBe('Connection failed');
        });
    });
});

describe('Database Service Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('isRecordProcessed', () => {
        test('should return processed status for existing record', async () => {
            const mockResult = {
                rows: [{
                    id: 12345,
                    processed: true,
                    call_summary: 'Existing summary',
                    created_at: new Date(),
                    updated_at: new Date()
                }]
            };

            query.mockResolvedValue(mockResult);

            const result = await databaseService.isRecordProcessed(12345);

            expect(result.exists).toBe(true);
            expect(result.processed).toBe(true);
            expect(result.record).toEqual(mockResult.rows[0]);
        });

        test('should return not processed status for existing unprocessed record', async () => {
            const mockResult = {
                rows: [{
                    id: 12345,
                    processed: false,
                    call_summary: null,
                    created_at: new Date(),
                    updated_at: new Date()
                }]
            };

            query.mockResolvedValue(mockResult);

            const result = await databaseService.isRecordProcessed(12345);

            expect(result.exists).toBe(true);
            expect(result.processed).toBe(false);
            expect(result.record).toEqual(mockResult.rows[0]);
        });

        test('should return not exists for non-existent record', async () => {
            const mockResult = { rows: [] };
            query.mockResolvedValue(mockResult);

            const result = await databaseService.isRecordProcessed(12345);

            expect(result.exists).toBe(false);
            expect(result.processed).toBe(false);
            expect(result.record).toBe(null);
        });
    });

    describe('updateCallSummary', () => {
        test('should skip update for already processed record', async () => {
            // Mock isRecordProcessed to return processed record
            jest.spyOn(databaseService, 'isRecordProcessed').mockResolvedValue({
                exists: true,
                processed: true,
                record: { id: 12345, processed: true }
            });

            const result = await databaseService.updateCallSummary(12345, 'New summary');

            expect(result.action).toBe('skipped');
            expect(result.reason).toBe('already_processed');
        });

        test('should update existing unprocessed record', async () => {
            // Mock isRecordProcessed to return unprocessed record
            jest.spyOn(databaseService, 'isRecordProcessed').mockResolvedValue({
                exists: true,
                processed: false,
                record: { id: 12345, processed: false }
            });

            const mockUpdateResult = {
                rowCount: 1,
                rows: [{
                    id: 12345,
                    processed: true,
                    created_at: new Date(),
                    updated_at: new Date()
                }]
            };

            query.mockResolvedValue(mockUpdateResult);

            const result = await databaseService.updateCallSummary(12345, 'New summary');

            expect(result.action).toBe('updated');
            expect(result.surveyId).toBe(12345);
        });

        test('should insert new record', async () => {
            // Mock isRecordProcessed to return no record
            jest.spyOn(databaseService, 'isRecordProcessed').mockResolvedValue({
                exists: false,
                processed: false,
                record: null
            });

            const mockInsertResult = {
                rowCount: 1,
                rows: [{
                    id: 12345,
                    processed: true,
                    created_at: new Date(),
                    updated_at: new Date()
                }]
            };

            query.mockResolvedValue(mockInsertResult);

            const result = await databaseService.updateCallSummary(12345, 'New summary');

            expect(result.action).toBe('inserted');
            expect(result.surveyId).toBe(12345);
        });
    });

    describe('getCallSummary', () => {
        test('should retrieve existing summary', async () => {
            const mockResult = {
                rows: [{
                    id: 12345,
                    call_summary: 'Test summary',
                    processed: true,
                    created_at: new Date(),
                    updated_at: new Date()
                }]
            };

            query.mockResolvedValue(mockResult);

            const result = await databaseService.getCallSummary(12345);

            expect(result).toEqual(mockResult.rows[0]);
        });

        test('should return null for non-existent summary', async () => {
            const mockResult = { rows: [] };
            query.mockResolvedValue(mockResult);

            const result = await databaseService.getCallSummary(12345);

            expect(result).toBe(null);
        });
    });

    describe('healthCheck', () => {
        test('should return healthy status', async () => {
            const mockResult = {
                rows: [{ health_check: 1, current_time: new Date() }]
            };

            query.mockResolvedValue(mockResult);

            const result = await databaseService.healthCheck();

            expect(result.status).toBe('healthy');
            expect(result.currentTime).toBeDefined();
        });

        test('should return unhealthy status on error', async () => {
            query.mockRejectedValue(new Error('Database error'));

            const result = await databaseService.healthCheck();

            expect(result.status).toBe('unhealthy');
            expect(result.error).toBe('Database error');
        });
    });
});