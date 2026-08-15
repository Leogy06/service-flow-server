#!/bin/bash

set -e

echo "🚀 Service Flow - Production"

echo "📦 Installing dependencies..."
npm ci

echo "🔍 Running lint..."
npm run lint

echo "🔧 Generating Prisma Client..."
npm run generate

echo "🏗️ Building application..."
npm run build

echo "🔥 Starting application..."
npm start