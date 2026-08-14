#!/bin/bash

set -e

echo "🚀 Service Flow - Production"

npm ci
npm run generate
npm run build
npm start