#!/bin/bash

set -e

echo "Service Flow - Development"

# --- Set environment ---
export NODE_ENV=development
export LOG_LEVEL=debug

# --- Install deps, generate Prisma client, run dev server ---
# npm install
npm run generate
npm run dev