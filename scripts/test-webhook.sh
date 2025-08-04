#!/bin/bash

# Test Webhook Script
# This script sends a test webhook payload to the Retell webhook processor

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
WEBHOOK_URL="${WEBHOOK_URL:-http://localhost:3000}"
ENDPOINT="/api/webhook/retell"
CONTENT_TYPE="application/json"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Test webhook payload based on the example from requirements
create_test_payload() {
    local survey_id="$1"
    cat << 'EOF'
{
  "event": "call_ended",
  "call": {
    "call_type": "phone_call",
    "from_number": "+12137771234",
    "to_number": "+12137771235",
    "direction": "inbound",
    "call_id": "Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6",
    "agent_id": "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD",
    "call_status": "registered",
    "metadata": {},
    "retell_llm_dynamic_variables": {
      "customer_name": "John Doe"
    },
    "start_timestamp": 1714608475945,
    "end_timestamp": 1714608491736,
    "disconnection_reason": "user_hangup",
    "transcript": "Hello, thank you for calling our customer service. My name is Sarah, how can I help you today? Hi Sarah, I'm calling because I've been having issues with my internet connection for the past few days. It keeps dropping out every few hours and it's really frustrating. I work from home so I need a reliable connection. I understand how frustrating that must be, especially when you're working from home. Let me look into your account and see what might be causing these connection issues. Can you please provide me with your account number or the phone number associated with your service? Sure, my account number is 123456789. Thank you. I can see your account here. I notice there have been some reported outages in your area over the past week due to maintenance work on our network infrastructure. However, those should have been resolved by now. Let me run a diagnostic test on your connection. I can see that your modem is showing some signal issues. The signal strength is lower than it should be. This could be due to a loose cable connection or an issue with the modem itself. Have you tried unplugging your modem for about 30 seconds and then plugging it back in? Yes, I've tried that several times but it doesn't seem to help for very long. The connection comes back but then drops again after a few hours. I see. In that case, I think we should schedule a technician to come out and check your equipment and the line connection. There's no charge for this service call since you're experiencing ongoing issues. Would tomorrow afternoon work for you? That would be great, yes. What time would the technician arrive? We have availability between 2 PM and 5 PM tomorrow. The technician will call you about 30 minutes before arriving. Perfect, that works for me. Is there anything else I should do in the meantime? Just make sure someone over 18 is available to let the technician in, and if possible, please have your modem accessible. The technician will test everything and replace any faulty equipment if needed. Okay, sounds good. Thank you so much for your help, Sarah. You're very welcome! I've scheduled the appointment for tomorrow between 2 and 5 PM. You should receive a confirmation text shortly. Is there anything else I can help you with today? No, that covers everything. Thanks again! Have a great day! You too, goodbye!",
    "opt_out_sensitive_data_storage": false,
    "survey_id": $survey_id
  }
}
EOF
}

# Create a shorter test payload for quick testing
create_short_test_payload() {
local survey_id="$1"

    cat << 'EOF'
{
  "event": "call_ended",
  "call": {
    "call_type": "phone_call",
    "from_number": "+12137771234",
    "to_number": "+12137771235",
    "direction": "inbound",
    "call_id": "TestCall123",
    "agent_id": "TestAgent456",
    "call_status": "registered",
    "metadata": {},
    "retell_llm_dynamic_variables": {
      "customer_name": "John Doe",
      "issue_type": "technical_support"
    },
    "start_timestamp": 1714608475945,
    "end_timestamp": 1714608491736,
    "disconnection_reason": "user_hangup",
    "transcript": "Hello, this is a short test call transcript for testing the webhook processing functionality.",
    "opt_out_sensitive_data_storage": false,
    "survey_id": $survey_id
  }
}
EOF
}

# Test health endpoint first
test_health() {
    log_info "Testing health endpoint..."
    
    local health_response
    health_response=$(curl -s -w "\n%{http_code}" "${WEBHOOK_URL}/health" || echo "000")
    local http_code=$(echo "$health_response" | tail -n1)
    local response_body=$(echo "$health_response" | head -n -1)
    
    if [ "$http_code" = "200" ]; then
        log_success "Health check passed"
        echo "Response: $response_body"
    else
        log_error "Health check failed (HTTP $http_code)"
        echo "Response: $response_body"
        return 1
    fi
}

# Send webhook payload
send_webhook() {
    local payload="$1"
    local test_name="$2"
    
    log_info "Sending $test_name webhook payload to ${WEBHOOK_URL}${ENDPOINT}"
    
    local response
    response=$(curl -s -w "\n%{http_code}" \
        -X POST \
        -H "Content-Type: ${CONTENT_TYPE}" \
        -H "X-Request-ID: test-$(date +%s)" \
        -d "$payload" \
        "${WEBHOOK_URL}${ENDPOINT}" || echo "000")
    
    local http_code=$(echo "$response" | tail -n1)
    local response_body=$(echo "$response" | head -n -1)
    
    echo
    echo "=== $test_name Test Results ==="
    echo "HTTP Status Code: $http_code"
    echo "Response Body:"
    echo "$response_body" | jq . 2>/dev/null || echo "$response_body"
    echo
    
    if [ "$http_code" = "200" ]; then
        log_success "$test_name webhook test passed"
        
        # Extract survey_id from response if available
        local survey_id
        survey_id=$(echo "$response_body" | jq -r '.data.surveyId // empty' 2>/dev/null)
        if [ -n "$survey_id" ]; then
            log_info "Testing summary retrieval for survey_id: $survey_id"
            test_summary_retrieval "$survey_id"
        fi
    else
        log_error "$test_name webhook test failed (HTTP $http_code)"
        return 1
    fi
}

# Test summary retrieval
test_summary_retrieval() {
    local survey_id="$1"
    
    log_info "Retrieving summary for survey_id: $survey_id"
    
    local response
    response=$(curl -s -w "\n%{http_code}" \
        -H "X-Request-ID: test-summary-$(date +%s)" \
        "${WEBHOOK_URL}/api/webhook/summary/${survey_id}" || echo "000")
    
    local http_code=$(echo "$response" | tail -n1)
    local response_body=$(echo "$response" | head -n -1)
    
    echo "=== Summary Retrieval Results ==="
    echo "HTTP Status Code: $http_code"
    echo "Response Body:"
    echo "$response_body" | jq . 2>/dev/null || echo "$response_body"
    echo
    
    if [ "$http_code" = "200" ]; then
        log_success "Summary retrieval test passed"
    elif [ "$http_code" = "404" ]; then
        log_warning "Summary not found (this is expected if processing is still in progress)"
    else
        log_error "Summary retrieval test failed (HTTP $http_code)"
    fi
}

# Test invalid payload
test_invalid_payload() {
    log_info "Testing invalid payload handling..."
    
    local invalid_payload='{"event": "call_ended", "invalid": "payload"}'
    
    local response
    response=$(curl -s -w "\n%{http_code}" \
        -X POST \
        -H "Content-Type: ${CONTENT_TYPE}" \
        -H "X-Request-ID: test-invalid-$(date +%s)" \
        -d "$invalid_payload" \
        "${WEBHOOK_URL}${ENDPOINT}" || echo "000")
    
    local http_code=$(echo "$response" | tail -n1)
    local response_body=$(echo "$response" | head -n -1)
    
    echo "=== Invalid Payload Test Results ==="
    echo "HTTP Status Code: $http_code"
    echo "Response Body:"
    echo "$response_body" | jq . 2>/dev/null || echo "$response_body"
    echo
    
    if [ "$http_code" = "400" ]; then
        log_success "Invalid payload test passed (correctly rejected)"
    else
        log_error "Invalid payload test failed - should return 400 but got $http_code"
    fi
}

# Show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo "Options:"
    echo "  --url URL         Webhook service URL (default: http://localhost:3000)"
    echo "  --short           Use short test payload instead of full example"
    echo "  --health-only     Only test health endpoint"
    echo "  --invalid-only    Only test invalid payload handling"
    echo "  --no-health       Skip health check"
    echo "  --help           Show this help message"
    echo
    echo "Examples:"
    echo "  $0                                    # Test with full payload on localhost"
    echo "  $0 --url http://webhook-service       # Test against different URL"
    echo "  $0 --short                           # Test with shorter payload"
    echo "  $0 --health-only                     # Only check if service is healthy"
}

# Main function
main() {
    local use_short_payload=false
    local health_only=false
    local invalid_only=false
    local skip_health=false
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --url)
                WEBHOOK_URL="$2"
                shift 2
                ;;
            --short)
                use_short_payload=true
                shift
                ;;
            --health-only)
                health_only=true
                shift
                ;;
            --invalid-only)
                invalid_only=true
                shift
                ;;
            --no-health)
                skip_health=true
                shift
                ;;
            --help)
                show_usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
    
    log_info "Testing Retell Webhook Processor"
    log_info "Target URL: ${WEBHOOK_URL}"
    
    # Check if jq is available for pretty printing
    if ! command -v jq &> /dev/null; then
        log_warning "jq not found - JSON responses will not be pretty-printed"
    fi
    
    # Test health endpoint unless skipped
    if [ "$skip_health" = false ]; then
        if ! test_health; then
            log_error "Health check failed - service may not be running"
            exit 1
        fi
        echo
    fi
    
    # Exit early if health-only
    if [ "$health_only" = true ]; then
        log_success "Health-only test completed"
        exit 0
    fi
    
    # Test invalid payload if requested
    if [ "$invalid_only" = true ]; then
        test_invalid_payload
        log_success "Invalid payload test completed"
        exit 0
    fi
    
    # Send webhook payload
    if [ "$use_short_payload" = true ]; then
        local payload
        payload=$(create_short_test_payload)
        send_webhook "$payload" "Short"
    else
        local payload
        payload=$(create_test_payload)
        send_webhook "$payload" "Full"
    fi
    
    echo
    
    # Test invalid payload handling
    test_invalid_payload
    
    log_success "All webhook tests completed!"
    log_info "Check the service logs for detailed processing information"
}

# Run main function
main "$@"