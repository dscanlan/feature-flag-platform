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

# Setup environment file for resolver if it doesn't exist
if [ ! -f "apps/resolver/.env" ]; then
  echo "⚙️  Setting up resolver environment..."
  cp apps/resolver/.env.example apps/resolver/.env
fi

echo ""
echo "✅ Starting dev servers..."
echo "📡 Admin API will run on http://localhost:4000"
echo "🧭 Resolver will run on http://localhost:4001"
echo "🎨 Admin UI will run on http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop all servers"
echo ""

# Start all dev servers in parallel. Each service's .env is loaded in its
# own subshell so PORT (and other vars) don't leak between processes.
(set -a; . apps/admin-api/.env; set +a; pnpm --filter admin-api dev) &
ADMIN_API_PID=$!

(set -a; . apps/resolver/.env; set +a; pnpm --filter @ffp/resolver dev) &
RESOLVER_PID=$!

pnpm --filter admin-ui dev &
ADMIN_UI_PID=$!

# Handle cleanup on exit
trap "kill $ADMIN_API_PID $RESOLVER_PID $ADMIN_UI_PID 2>/dev/null" EXIT

# Wait for all processes
wait $ADMIN_API_PID $RESOLVER_PID $ADMIN_UI_PID
