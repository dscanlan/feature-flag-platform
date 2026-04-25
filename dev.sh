#!/bin/bash

set -e

echo "🚀 Starting Feature Flag Platform development environment..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker is not running. Please start Docker and try again."
  exit 1
fi

# Check if Docker Compose services are running
if ! docker compose ps --services --filter "status=running" > /dev/null 2>&1; then
  echo "📦 Starting Docker Compose services..."
  docker compose up -d
  sleep 2
fi

# Setup environment file for admin-api if it doesn't exist
if [ ! -f "apps/admin-api/.env" ]; then
  echo "⚙️  Setting up admin-api environment..."
  cp apps/admin-api/.env.example apps/admin-api/.env
fi

echo ""
echo "✅ Starting dev servers..."
echo "📡 Admin API will run on http://localhost:4000"
echo "🎨 Admin UI will run on http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both servers"
echo ""

# Load environment variables from admin-api .env file
export $(cat apps/admin-api/.env | grep -v '^#' | grep -v '^$' | xargs)

# Start both dev servers in parallel
pnpm --filter admin-api dev &
ADMIN_API_PID=$!

pnpm --filter admin-ui dev &
ADMIN_UI_PID=$!

# Handle cleanup on exit
trap "kill $ADMIN_API_PID $ADMIN_UI_PID 2>/dev/null" EXIT

# Wait for both processes
wait $ADMIN_API_PID $ADMIN_UI_PID
