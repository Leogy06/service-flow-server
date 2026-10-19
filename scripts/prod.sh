#!/bin/bash

set -e

# Resolve paths from this script, including when invoked from the project root.
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

export NODE_ENV=production
export LOG_LEVEL=info

echo "===Service Flow - Production==="

echo "===Checking dependency locks==="
node scripts/check-dependency-locks.mjs

echo "===Deleting node_modules and Installing dependencies==="
npm ci --include=dev

echo "===Running lint==="
npm run lint

echo "===Generating Prisma Client==="
npm run generate

echo "===Building application==="
npm run build

echo "===Pruning dev dependencies==="
npm prune --omit=dev

echo "===Starting application==="
npm start
