#!/bin/bash

set -e

export NODE_ENV=production
export LOG_LEVEL=info

echo "===Service Flow - Production==="

echo "===Installing dependencies==="
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