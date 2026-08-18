#!/bin/bash

set -e

echo "🚀 Service Flow - Development"

# --- Check Docker is running ---
if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker is not running. Please start Docker Desktop and try again."
  exit 1
fi

# --- Start Docker services (Redis, and DB if defined in compose) ---
echo "🐳 Starting Docker services..."
docker compose up -d

# --- Wait for Redis to be healthy before continuing ---
echo "⏳ Waiting for Redis to be ready..."
until docker compose exec -T redis redis-cli ping > /dev/null 2>&1; do
  printf "."
  sleep 1
done
echo ""
echo "✅ Redis is ready."

# --- Install deps, generate Prisma client, run dev server ---
npm install
npm run generate
npm run dev