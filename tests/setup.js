// Test setup file for Jest
// This file runs before each test file

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5432';
process.env.DB_NAME = 'test_db';
process.env.DB_USER = 'test_user';
process.env.DB_PASSWORD = 'test_password';
process.env.DB_TABLE_NAME = 'test_call_summaries';
process.env.OLLAMA_URL = 'http://localhost:11434';
process.env.OLLAMA_MODEL = 'qwen3:30b';
process.env.MAX_TOKENS_PER_CHUNK = '2048';
process.env.LOG_LEVEL = 'error'; // Reduce log noise during tests

// Mock Odoo environment variables for testing
process.env.ODOO_URL = 'http://localhost:8069';
process.env.ODOO_DATABASE = 'test_db';
process.env.ODOO_USERNAME = 'test_user';
process.env.ODOO_API_KEY = 'test_api_key';

// Mock console methods to reduce test output noise
const originalConsole = { ...console };

beforeAll(() => {
    // Suppress console output during tests unless explicitly needed
    console.log = jest.fn();
    console.info = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
});

afterAll(() => {
    // Restore console methods
    Object.assign(console, originalConsole);
});

// Global test utilities
global.testUtils = {
    createMockWebhookPayload: (overrides = {}) => ({
        event: 'call_ended',
        call: {
            call_type: 'phone_call',
            from_number: '+12137771234',
            to_number: '+12137771235',
            direction: 'inbound',
            call_id: 'test_call_id_123',
            agent_id: 'test_agent_id_456',
            call_status: 'registered',
            metadata: {},
            retell_llm_dynamic_variables: {
                customer_name: 'Test Customer'
            },
            start_timestamp: Date.now() - 60000,
            end_timestamp: Date.now(),
            disconnection_reason: 'user_hangup',
            transcript: 'This is a test transcript for testing purposes.',
            opt_out_sensitive_data_storage: false,
            id: 12345,
            ...overrides
        }
    }),

    createMockDatabaseRecord: (overrides = {}) => ({
        id: 12345,
        call_summary: 'Test summary',
        processed: true,
        created_at: new Date(),
        updated_at: new Date(),
        ...overrides
    }),

    delay: (ms) => new Promise(resolve => setTimeout(resolve, ms))
};