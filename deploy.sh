#!/bin/bash

# News Chatbot Backend Deployment Script
# This script helps deploy the backend with proper environment configuration

set -e

echo "🚀 News Chatbot Backend Deployment Script"
echo "=========================================="

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo "📋 Checking prerequisites..."

if ! command_exists docker; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command_exists docker-compose; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

echo "✅ Prerequisites check passed"

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found. Please create one from .env.example"
    exit 1
fi

echo "✅ Environment file found"

# Parse command line arguments
ENVIRONMENT="development"
DETACHED=false
BUILD=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --env|-e)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --detached|-d)
            DETACHED=true
            shift
            ;;
        --build|-b)
            BUILD=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --env, -e ENVIRONMENT    Set environment (development|production) [default: development]"
            echo "  --detached, -d          Run in detached mode"
            echo "  --build, -b             Force rebuild of containers"
            echo "  --help, -h              Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option $1"
            exit 1
            ;;
    esac
done

echo "🔧 Configuration:"
echo "   Environment: $ENVIRONMENT"
echo "   Detached: $DETACHED"
echo "   Force Build: $BUILD"

# Prepare docker-compose command
COMPOSE_CMD="docker-compose -f docker-compose.yaml"

if [ "$ENVIRONMENT" = "production" ]; then
    COMPOSE_CMD="$COMPOSE_CMD -f docker-compose.prod.yaml"
    echo "🏭 Using production configuration"
else
    echo "🔨 Using development configuration"
fi

# Add build flag if requested
if [ "$BUILD" = true ]; then
    COMPOSE_CMD="$COMPOSE_CMD build"
    echo "🏗️  Building containers..."
    eval $COMPOSE_CMD
fi

# Prepare run command
RUN_CMD="$COMPOSE_CMD up"

if [ "$DETACHED" = true ]; then
    RUN_CMD="$RUN_CMD -d"
fi

echo "🚀 Starting services..."
echo "Running: $RUN_CMD"

eval $RUN_CMD

if [ "$DETACHED" = true ]; then
    echo ""
    echo "✅ Services started in detached mode"
    echo "📊 To view logs: docker-compose logs -f"
    echo "🛑 To stop: docker-compose down"
    echo "📋 To view status: docker-compose ps"
else
    echo ""
    echo "🛑 To stop services, press Ctrl+C"
fi