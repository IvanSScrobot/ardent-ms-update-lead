# Retell Processor

A Kubernetes-based microservice for processing Retell webhook payloads and generating call summaries using a local LLM (Ollama).

## Features

- **Webhook Processing**: Receives and processes Retell webhook payloads
- **LLM Integration**: Generates concise summaries using Ollama
- **PostgreSQL Storage**: Stores summaries with processed status tracking
- **Comprehensive Logging**: All steps logged to stdout for Kubernetes
- **Health Checks**: Multiple health endpoints for Kubernetes probes
- **Security**: Non-root container, read-only filesystem, security contexts
- **Scalability**: Horizontal pod autoscaling ready
- **Configuration**: Environment-based configuration via ConfigMaps and Secrets

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Retell API    │───▶│  Webhook Service │───▶│   PostgreSQL    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │  Ollama LLM     │
                       └─────────────────┘
```

## API Endpoints

### Webhook Processing
- `POST /api/webhook/retell` - Process Retell webhook payload
- `GET /api/webhook/summary/:surveyId` - Retrieve call summary by survey ID

### Health Checks
- `GET /health` - Basic health check
- `GET /health/detailed` - Detailed health check with dependencies
- `GET /health/readiness` - Kubernetes readiness probe
- `GET /health/liveness` - Kubernetes liveness probe
- `GET /health/startup` - Kubernetes startup probe

## Environment Variables

### Database Configuration (ConfigMap)
- `DB_HOST` - PostgreSQL host
- `DB_PORT` - PostgreSQL port (default: 5432)
- `DB_NAME` - Database name
- `DB_TABLE_NAME` - Table name for summaries

### Database Credentials (Secret)
- `DB_USER` - PostgreSQL username
- `DB_PASSWORD` - PostgreSQL password

### Ollama Configuration (ConfigMap)
- `OLLAMA_URL` - Ollama service URL
- `OLLAMA_MODEL` - LLM model to use (default: llama2)
- `MAX_TOKENS_PER_CHUNK` - Maximum tokens per chunk (default: 2048)

### Ollama Credentials (Secret)
- `OLLAMA_API_KEY` - Optional API key for Ollama authentication

### Application Configuration (ConfigMap)
- `PORT` - Service port (default: 3000)
- `NODE_ENV` - Environment (production/development)
- `LOG_LEVEL` - Logging level (info/debug/warn/error)

## Database Schema

The service expects a PostgreSQL table with the following structure:

ToDo: specify real table structure
```sql
-- CREATE TABLE call_summaries (
--     id INTEGER PRIMARY KEY,
--     call_summary TEXT,
--     processed BOOLEAN DEFAULT FALSE,
--     created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
--     updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
-- );
```

## Processing Logic

1. **Webhook Validation**: Validates incoming payload structure
2. **Processed Check**: Checks if record already has `processed = true`
3. **Skip if Processed**: Returns early if already processed
4. **Extract Data**: Extracts transcript, dynamic variables, and survey_id
5. **Text Chunking**: Splits long transcripts into manageable chunks
6. **LLM Processing**: Generates summary using Ollama
7. **Database Update**: Stores summary and sets `processed = true`
8. **Comprehensive Logging**: All steps logged with structured data

## Deployment

### Prerequisites

1. **Kubernetes Cluster**: Running Kubernetes cluster
2. **PostgreSQL**: Accessible PostgreSQL database
3. **Ollama**: Running Ollama service with desired model

### Build and Deploy

1. **Build Docker Image**:
```bash
docker build -t retell-webhook-processor:latest .
```

2. **Apply Kubernetes Manifests**:
```bash
# Apply in order
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

3. **Verify Deployment**:
```bash
kubectl get pods -l app=retell-webhook-processor
kubectl logs -l app=retell-webhook-processor
```

### Configuration

1. **Update ConfigMap** (`k8s/configmap.yaml`):
   - Set correct database and Ollama service URLs
   - Adjust model and token settings as needed

2. **Update Secret** (`k8s/secret.yaml`):
   - Encode credentials in base64:
   ```bash
   echo -n "your_password" | base64
   ```
   - Or create secret via kubectl:
   ```bash
   kubectl create secret generic retell-webhook-secrets \
     --from-literal=DB_USER=postgres \
     --from-literal=DB_PASSWORD=your_secure_password \
     --from-literal=OLLAMA_API_KEY=your_ollama_key_if_needed
   ```

## Testing

### Run Tests
```bash
npm test
```

### Run Tests with Coverage
```bash
npm run test
```

### Test Webhook Endpoint

Use the provided test script to send webhook payloads:

```bash
# Test with full example payload (from requirements)
./scripts/test-webhook.sh

# Test with shorter payload for quick testing
./scripts/test-webhook.sh --short

# Test against different URL (e.g., Kubernetes service)
./scripts/test-webhook.sh --url http://retell-webhook-processor-service

# Only test health endpoint
./scripts/test-webhook.sh --health-only

# Test invalid payload handling
./scripts/test-webhook.sh --invalid-only
```

Or manually with curl:
```bash
curl -X POST http://localhost:3000/api/webhook/retell \
  -H "Content-Type: application/json" \
  -d '{
    "event": "call_ended",
    "call": {
      "call_id": "test123",
      "transcript": "This is a test call transcript.",
      "retell_llm_dynamic_variables": {
      "customer_name": "John Doe",
      "metadata": {
        "survey_id": "9"
        }
      }
    }
  }'
```

## Monitoring

### Health Checks
- **Liveness**: `/health/liveness` - Pod restart if fails
- **Readiness**: `/health/readiness` - Traffic routing control
- **Startup**: `/health/startup` - Initial startup validation

### Logging
All operations are logged to stdout with structured JSON format:
- Request/response logging
- Processing steps with timing
- Error details with stack traces
- Database operations
- LLM service interactions

### Metrics
The service exposes health endpoints that can be scraped by Prometheus:
- Response times
- Success/failure rates
- Database connection status
- LLM service availability

## Security

- **Non-root container**: Runs as user 1001
- **Read-only filesystem**: Prevents runtime modifications
- **Security contexts**: Drops all capabilities
- **Secret management**: Credentials stored in Kubernetes Secrets
- **Network policies**: Can be restricted via Kubernetes NetworkPolicies

## Scaling

The service is designed for horizontal scaling:
- **Stateless**: No local state, all data in PostgreSQL
- **Resource limits**: Configured for efficient resource usage
- **Pod disruption budget**: Ensures availability during updates
- **Anti-affinity**: Spreads pods across nodes

## Troubleshooting

### Common Issues

1. **Database Connection Failed**:
   - Check ConfigMap values for DB_HOST, DB_PORT, DB_NAME
   - Verify Secret contains correct DB_USER and DB_PASSWORD
   - Ensure PostgreSQL is accessible from cluster

2. **Ollama Service Unavailable**:
   - Check OLLAMA_URL in ConfigMap
   - Verify Ollama service is running and accessible
   - Check if model is available: `ollama list`

3. **Pod Startup Issues**:
   - Check logs: `kubectl logs -l app=retell-webhook-processor`
   - Verify all ConfigMaps and Secrets are applied
   - Check resource limits and node capacity

### Debug Commands

```bash
# Check pod status
kubectl get pods -l app=retell-webhook-processor

# View logs
kubectl logs -l app=retell-webhook-processor --tail=100

# Describe pod for events
kubectl describe pod <pod-name>

# Test health endpoints
kubectl port-forward svc/retell-webhook-processor-service 8080:80
curl http://localhost:8080/health/detailed

# Check configuration
kubectl get configmap retell-processor-config -o yaml
kubectl get secret retell-processor-secrets -o yaml
```

## Development

### Local Development

1. **Install Dependencies**:
```bash
npm install
```

2. **Set Environment Variables**:
```bash
export DB_HOST=localhost
export DB_USER=postgres
export DB_PASSWORD=password
export OLLAMA_URL=http://localhost:11434
```

3. **Run Locally**:
```bash
npm run dev
```

### Testing Changes

1. **Run Tests**:
```bash
npm test
```

2. **Build and Test Container**:
```bash
docker build -t retell-webhook-processor:test .
docker run -p 3000:3000 retell-webhook-processor:test
```

## License

MIT License - see LICENSE file for details.