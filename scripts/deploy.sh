#!/bin/bash

# Retell Webhook Processor Deployment Script
# This script builds and deploys the microservice to Kubernetes

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
IMAGE_NAME="retell-webhook-processor"
IMAGE_TAG="${IMAGE_TAG:-latest}"
NAMESPACE="${NAMESPACE:-default}"
KUBECTL_CONTEXT="${KUBECTL_CONTEXT:-}"

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

check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if Docker is available
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed or not in PATH"
        exit 1
    fi
    
    # Check if kubectl is available
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed or not in PATH"
        exit 1
    fi
    
    # Check if kubectl can connect to cluster
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

build_image() {
    log_info "Building Docker image..."
    
    if docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" .; then
        log_success "Docker image built successfully: ${IMAGE_NAME}:${IMAGE_TAG}"
    else
        log_error "Failed to build Docker image"
        exit 1
    fi
}

create_namespace() {
    if [ "$NAMESPACE" != "default" ]; then
        log_info "Creating namespace: $NAMESPACE"
        kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
        log_success "Namespace $NAMESPACE ready"
    fi
}

deploy_configmap() {
    log_info "Deploying ConfigMap..."
    
    if kubectl apply -f k8s/configmap.yaml -n "$NAMESPACE"; then
        log_success "ConfigMap deployed successfully"
    else
        log_error "Failed to deploy ConfigMap"
        exit 1
    fi
}

deploy_secret() {
    log_info "Deploying Secret..."
    
    # Check if secret already exists
    if kubectl get secret retell-webhook-secrets -n "$NAMESPACE" &> /dev/null; then
        log_warning "Secret already exists. Skipping creation."
        log_info "To update secret, run: kubectl delete secret retell-webhook-secrets -n $NAMESPACE"
    else
        if kubectl apply -f k8s/secret.yaml -n "$NAMESPACE"; then
            log_success "Secret deployed successfully"
        else
            log_error "Failed to deploy Secret"
            exit 1
        fi
    fi
}

deploy_application() {
    log_info "Deploying application..."
    
    # Update image tag in deployment if not latest
    if [ "$IMAGE_TAG" != "latest" ]; then
        sed -i.bak "s|image: ${IMAGE_NAME}:latest|image: ${IMAGE_NAME}:${IMAGE_TAG}|g" k8s/deployment.yaml
    fi
    
    if kubectl apply -f k8s/deployment.yaml -n "$NAMESPACE"; then
        log_success "Deployment applied successfully"
    else
        log_error "Failed to deploy application"
        exit 1
    fi
    
    # Restore original deployment file if modified
    if [ -f k8s/deployment.yaml.bak ]; then
        mv k8s/deployment.yaml.bak k8s/deployment.yaml
    fi
}

deploy_service() {
    log_info "Deploying Service..."
    
    if kubectl apply -f k8s/service.yaml -n "$NAMESPACE"; then
        log_success "Service deployed successfully"
    else
        log_error "Failed to deploy Service"
        exit 1
    fi
}

wait_for_deployment() {
    log_info "Waiting for deployment to be ready..."
    
    if kubectl wait --for=condition=available --timeout=300s deployment/retell-webhook-processor -n "$NAMESPACE"; then
        log_success "Deployment is ready"
    else
        log_error "Deployment failed to become ready within timeout"
        log_info "Check pod status with: kubectl get pods -l app=retell-webhook-processor -n $NAMESPACE"
        log_info "Check logs with: kubectl logs -l app=retell-webhook-processor -n $NAMESPACE"
        exit 1
    fi
}

show_status() {
    log_info "Deployment status:"
    echo
    
    echo "Pods:"
    kubectl get pods -l app=retell-webhook-processor -n "$NAMESPACE"
    echo
    
    echo "Services:"
    kubectl get services -l app=retell-webhook-processor -n "$NAMESPACE"
    echo
    
    echo "ConfigMaps:"
    kubectl get configmaps retell-webhook-config -n "$NAMESPACE"
    echo
    
    echo "Secrets:"
    kubectl get secrets retell-webhook-secrets -n "$NAMESPACE"
    echo
    
    log_info "To check logs: kubectl logs -l app=retell-webhook-processor -n $NAMESPACE"
    log_info "To port-forward: kubectl port-forward svc/retell-webhook-processor-service 8080:80 -n $NAMESPACE"
}

# Main deployment flow
main() {
    log_info "Starting deployment of Retell Webhook Processor"
    log_info "Image: ${IMAGE_NAME}:${IMAGE_TAG}"
    log_info "Namespace: $NAMESPACE"
    
    if [ -n "$KUBECTL_CONTEXT" ]; then
        log_info "Using kubectl context: $KUBECTL_CONTEXT"
        kubectl config use-context "$KUBECTL_CONTEXT"
    fi
    
    check_prerequisites
    build_image
    create_namespace
    deploy_configmap
    deploy_secret
    deploy_application
    deploy_service
    wait_for_deployment
    show_status
    
    log_success "Deployment completed successfully!"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --tag)
            IMAGE_TAG="$2"
            shift 2
            ;;
        --namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        --context)
            KUBECTL_CONTEXT="$2"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --tag TAG         Docker image tag (default: latest)"
            echo "  --namespace NS    Kubernetes namespace (default: default)"
            echo "  --context CTX     Kubectl context to use"
            echo "  --help           Show this help message"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Run main function
main