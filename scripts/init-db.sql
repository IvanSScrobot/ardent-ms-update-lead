-- Database initialization script for Retell Webhook Processor
-- This script creates the necessary table and indexes

-- Create the call_summaries table
CREATE TABLE IF NOT EXISTS call_summaries (
    id INTEGER PRIMARY KEY,
    call_summary TEXT,
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_call_summaries_processed ON call_summaries(processed);
CREATE INDEX IF NOT EXISTS idx_call_summaries_created_at ON call_summaries(created_at);
CREATE INDEX IF NOT EXISTS idx_call_summaries_updated_at ON call_summaries(updated_at);

-- Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at on row updates
DROP TRIGGER IF EXISTS update_call_summaries_updated_at ON call_summaries;
CREATE TRIGGER update_call_summaries_updated_at
    BEFORE UPDATE ON call_summaries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insert some sample data for testing (optional)
-- Uncomment the following lines if you want sample data

-- INSERT INTO call_summaries (id, call_summary, processed) VALUES
-- (1, 'Sample call summary for testing purposes', true),
-- (2, 'Another test summary with different content', true),
-- (3, NULL, false)
-- ON CONFLICT (id) DO NOTHING;

-- Grant permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON call_summaries TO your_app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO your_app_user;

-- Display table information
\d call_summaries;

-- Show current data (if any)
SELECT COUNT(*) as total_records, 
       COUNT(CASE WHEN processed = true THEN 1 END) as processed_records,
       COUNT(CASE WHEN processed = false THEN 1 END) as unprocessed_records
FROM call_summaries;

COMMENT ON TABLE call_summaries IS 'Stores call summaries generated from Retell webhook processing';
COMMENT ON COLUMN call_summaries.id IS 'Unique identifier for the survey/call';
COMMENT ON COLUMN call_summaries.call_summary IS 'Generated summary of the call transcript';
COMMENT ON COLUMN call_summaries.processed IS 'Flag indicating if the record has been processed';
COMMENT ON COLUMN call_summaries.created_at IS 'Timestamp when the record was created';
COMMENT ON COLUMN call_summaries.updated_at IS 'Timestamp when the record was last updated';