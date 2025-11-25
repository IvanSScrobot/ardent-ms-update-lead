const axios = require('axios');
const logger = require('../utils/logger');

class LLMService {
    constructor() {
        // Ollama configuration from ConfigMap and Secret
        this.ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
        this.ollamaApiKey = process.env.OLLAMA_API_KEY; // Optional, from Secret if needed
        this.model = process.env.OLLAMA_MODEL || 'qwen3:30b';
        this.maxTokensPerChunk = parseInt(process.env.MAX_TOKENS_PER_CHUNK) || 2048;

        logger.info('LLM Service initialized', {
            ollamaUrl: this.ollamaUrl,
            model: this.model,
            maxTokensPerChunk: this.maxTokensPerChunk,
            hasApiKey: !!this.ollamaApiKey
        });

        // Validate required configuration
        if (!this.ollamaUrl) {
            const error = 'OLLAMA_URL environment variable is required';
            logger.error('LLM Service configuration error', { error });
            throw new Error(error);
        }
    }

    /**
     * Estimate token count (rough approximation: 1 token ≈ 4 characters)
     */
    estimateTokens(text) {
        const tokens = Math.ceil(text.length / 4);
        logger.debug('Token estimation', {
            textLength: text.length,
            estimatedTokens: tokens
        });
        return tokens;
    }

    /**
     * Split text into chunks that fit within token limits
     */
    chunkText(text, maxTokens = this.maxTokensPerChunk) {
        const estimatedTokens = this.estimateTokens(text);

        logger.info('Starting text chunking process', {
            textLength: text.length,
            estimatedTokens,
            maxTokensPerChunk: maxTokens
        });

        if (estimatedTokens <= maxTokens) {
            logger.info('Text fits in single chunk', { estimatedTokens, maxTokens });
            return [text];
        }

        const chunks = [];
        const maxCharsPerChunk = maxTokens * 4; // Rough conversion
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);

        logger.info('Splitting text by sentences', {
            sentenceCount: sentences.length,
            maxCharsPerChunk
        });

        let currentChunk = '';

        for (const sentence of sentences) {
            const sentenceWithPunctuation = sentence.trim() + '.';

            if ((currentChunk + sentenceWithPunctuation).length <= maxCharsPerChunk) {
                currentChunk += (currentChunk ? ' ' : '') + sentenceWithPunctuation;
            } else {
                if (currentChunk) {
                    chunks.push(currentChunk);
                    logger.debug('Created chunk', {
                        chunkNumber: chunks.length,
                        chunkLength: currentChunk.length
                    });
                    currentChunk = sentenceWithPunctuation;
                } else {
                    // Single sentence is too long, split by words
                    logger.warn('Sentence too long, splitting by words', {
                        sentenceLength: sentenceWithPunctuation.length
                    });

                    const words = sentenceWithPunctuation.split(' ');
                    let wordChunk = '';

                    for (const word of words) {
                        if ((wordChunk + word).length <= maxCharsPerChunk) {
                            wordChunk += (wordChunk ? ' ' : '') + word;
                        } else {
                            if (wordChunk) {
                                chunks.push(wordChunk);
                                logger.debug('Created word chunk', {
                                    chunkNumber: chunks.length,
                                    chunkLength: wordChunk.length
                                });
                                wordChunk = word;
                            } else {
                                // Single word is too long, truncate
                                logger.warn('Word too long, truncating', {
                                    wordLength: word.length,
                                    maxCharsPerChunk
                                });
                                chunks.push(word.substring(0, maxCharsPerChunk));
                            }
                        }
                    }

                    if (wordChunk) {
                        currentChunk = wordChunk;
                    }
                }
            }
        }

        if (currentChunk) {
            chunks.push(currentChunk);
            logger.debug('Created final chunk', {
                chunkNumber: chunks.length,
                chunkLength: currentChunk.length
            });
        }

        logger.info('Text chunking completed', {
            totalChunks: chunks.length,
            chunkLengths: chunks.map(chunk => chunk.length)
        });

        return chunks;
    }

    /**
     * Generate summary using Ollama API
     */
    async generateSummary(transcript, dynamicVariables = {}) {
        try {
            logger.info('Starting summary generation process', {
                transcriptLength: transcript.length,
                dynamicVariables: Object.keys(dynamicVariables)
            });

            const chunks = this.chunkText(transcript);
            logger.info('Text chunked for processing', { chunkCount: chunks.length });

            let summaries = [];

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const prompt = this.constructPrompt(chunk, dynamicVariables, i + 1, chunks.length);

                logger.info('Processing chunk', {
                    chunkNumber: i + 1,
                    totalChunks: chunks.length,
                    chunkLength: chunk.length,
                    promptLength: prompt.length
                });

                const summary = await this.callOllama(prompt);
                summaries.push(summary);

                logger.info('Chunk processed successfully', {
                    chunkNumber: i + 1,
                    summaryLength: summary.length
                });
            }

            // If multiple chunks, create a final summary
            if (summaries.length > 1) {
                const combinedSummaries = summaries.join('\n\n');
                const finalPrompt = `Please create a concise final summary from these partial summaries:\n\n${combinedSummaries}\n\nFINAL CONCISE SUMMARY:`;

                logger.info('Creating final summary from multiple chunks', {
                    partialSummaryCount: summaries.length,
                    combinedLength: combinedSummaries.length
                });

                const finalSummary = await this.callOllama(finalPrompt);

                logger.info('Final summary generation completed', {
                    finalSummaryLength: finalSummary.length
                });

                return finalSummary;
            }

            logger.info('Summary generation completed', {
                summaryLength: summaries[0].length
            });

            return summaries[0];
        } catch (error) {
            logger.error('Summary generation failed', {
                error: error.message,
                stack: error.stack,
                transcriptLength: transcript.length
            });
            throw new Error(`Failed to generate summary: ${error.message}`);
        }
    }

    /**
     * Construct prompt for LLM
     */
    constructPrompt(transcript, dynamicVariables, chunkNumber = 1, totalChunks = 1) {
        const variablesText = Object.keys(dynamicVariables).length > 0
            ? JSON.stringify(dynamicVariables, null, 2)
            : 'No additional variables provided';

        const chunkInfo = totalChunks > 1 ? ` (Part ${chunkNumber} of ${totalChunks})` : '';

        const prompt = `Write a concise summary of the following ${chunkInfo}:

"${transcript}"

Additional context: ${variablesText}
SYSTEM INSTRUCTIONS:

- Include only the most important fields from the call.

- Do not duplicate data across fields.

- Use bullet points for call_summary (3–6 items).

- Always output in valid JSON format.

- Never include commentary outside of the JSON object.

 

OUTPUT SCHEMA:

{

  "prospect_name": "{{full name}}",

  "prospect_contacts: "{{ email and phone number }}",,

  "business_name": "{{business name }",

  "business_details": "{{any relevant details about the business from the Additional context, else null}}",

  "service_type": "{{prospect’s business type if mentioned, else null}}",

  "frustration": "{{main challenge or pain point if it's clear from the call, else null}}",

  "emotional_tone": "{{rushed, skeptical, curious, engaged, burned out, resistant, or null}}",

  "energy_level": "{{low, medium, high}}",

  "appointment_booked": "{{true/false}}",

  "appointment_date": "{{if booked, else null}}",

  "appointment_time": "{{if booked, else null}}",

  "next_steps": "{{summary of agreed next step}}",

  "call_summary": [

    "{{bullet point 1: summary of the phone call}}",

    "{{bullet point 2: client's main pain or situation}}",

    "{{bullet point 3: secondary issue, objection, or concern}}",

    "{{bullet point 4: Voice agent's key action or response}}",

    "{{bullet point 5: agreed next step or booking detail}}"

  ]

}


EXAMPLE OUTPUT:

{

  "prospect_name": "Sarah Johnson",
  "prospect_contacts": "email@gmail.com, +123-456-7890",

  "business_name": "Johnson Landscaping",

  "business_details": "Number of employees: 15, Annual Revenue: $2M, Number of hours per week to be save by automation: 20, Most important outcome from automation: Better customer experience",

  "service_type": "Landscaping",

  "frustration": "Losing leads from missed after-hours calls",

  "emotional_tone": "frustrated but curious",

  "energy_level": "medium",

  "appointment_booked": true,

  "appointment_date": "2025-09-06",

  "appointment_time": "2:00 PM",

  "next_steps": "Strategy session booked with operations manager",

  "call_summary": [
    "1. During the call, agent Jennie introduced the AI answering service to Sarah, highlighting its 24/7 availability and lead capture capabilities. Sarah expressed interest but was concerned about reliability. Agrred to book a strategy session. Asked about pricing.",

    "2. Prospect losing leads due to missed after-hours calls",

    "3. Prospect mentioned extra costs from paying staff overtime to cover phones. Worries about AI handling customer interactions.",

    "4. Jennie reassured them about AI handling reliability",

    "5. Booking confirmed for Sept 6 at 2:00 PM with operations manager. The manager should be prepared to talk numbers and current call handling process."

  ]
}
`;

        logger.debug('Prompt constructed', {
            chunkNumber,
            totalChunks,
            promptLength: prompt.length,
            hasVariables: Object.keys(dynamicVariables).length > 0
        });

        return prompt;
    }

    /**
     * Call Ollama API
     */
    async callOllama(prompt) {
        const startTime = Date.now();

        try {
            logger.info('Making Ollama API call', {
                model: this.model,
                promptLength: prompt.length,
                url: this.ollamaUrl
            });

            const headers = {
                'Content-Type': 'application/json'
            };

            // Add API key if provided (some Ollama setups may require authentication)
            if (this.ollamaApiKey) {
                headers['Authorization'] = `Bearer ${this.ollamaApiKey}`;
                logger.debug('Using API key for authentication');
            }

            const requestPayload = {
                model: this.model,
                prompt: prompt,
                stream: false,
                options: {
                    temperature: 0.3,
                    top_p: 0.9,
                    max_tokens: 500
                }
            };

            const response = await axios.post(`${this.ollamaUrl}/api/generate`, requestPayload, {
                timeout: 600000, // 600 second timeout
                headers
            });

            const duration = Date.now() - startTime;

            if (response.data && response.data.response) {
                const summary = response.data.response.trim();

                logger.info('Ollama API call successful', {
                    duration: `${duration}ms`,
                    responseLength: summary.length,
                    model: this.model
                });

                return summary;
            } else {
                throw new Error('Invalid response format from Ollama');
            }
        } catch (error) {
            const duration = Date.now() - startTime;

            if (error.code === 'ECONNREFUSED') {
                const errorMsg = `Cannot connect to Ollama service at ${this.ollamaUrl}. Please ensure Ollama is running.`;
                logger.error('Ollama connection failed', {
                    error: errorMsg,
                    duration: `${duration}ms`,
                    url: this.ollamaUrl
                });
                throw new Error(errorMsg);
            }

            logger.error('Ollama API call failed', {
                error: error.message,
                duration: `${duration}ms`,
                url: this.ollamaUrl,
                model: this.model,
                responseStatus: error.response?.status,
                responseData: error.response?.data
            });

            throw new Error(`Ollama API call failed: ${error.message}`);
        }
    }

    /**
     * Health check for Ollama service
     */
    async healthCheck() {
        try {
            logger.debug('Performing Ollama health check');

            const headers = {};
            if (this.ollamaApiKey) {
                headers['Authorization'] = `Bearer ${this.ollamaApiKey}`;
            }

            const response = await axios.get(`${this.ollamaUrl}/api/tags`, {
                timeout: 5000,
                headers
            });

            const healthData = {
                status: 'healthy',
                models: response.data.models || [],
                url: this.ollamaUrl,
                model: this.model,
                timestamp: new Date().toISOString()
            };

            logger.debug('Ollama health check successful', {
                modelCount: healthData.models.length,
                availableModels: healthData.models.map(m => m.name)
            });

            return healthData;
        } catch (error) {
            const healthData = {
                status: 'unhealthy',
                error: error.message,
                url: this.ollamaUrl,
                timestamp: new Date().toISOString()
            };

            logger.error('Ollama health check failed', healthData);
            return healthData;
        }
    }
}

module.exports = new LLMService();