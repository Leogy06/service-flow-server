#!/bin/bash

set -e

echo "Service Flow - Development"

# --- Check Docker is running ---
if ! docker info > /dev/null 2>&1; then
  echo "Docker is not running. Please start Docker Desktop and try again."
  exit 1
fi

# --- Confirm Redis (external container "redis") is reachable ---
echo "⏳ Waiting for Redis to be ready..."
until docker exec redis redis-cli ping > /dev/null 2>&1; do
  printf "."
  sleep 1
done
echo ""
echo "Redis is ready."

# --- Install deps, generate Prisma client, run dev server ---
# npm install
npm run generate
npm run dev