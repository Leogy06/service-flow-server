#!/bin/bash

set -e

echo "🚀 Service Flow - Development"

npm install
npm run generate
npm run dev