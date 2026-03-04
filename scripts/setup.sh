#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env.local ]; then
  if [ -f .env.example ]; then
    cp .env.example .env.local
    echo "Created .env.local from .env.example. Fill in DATABASE_URL and provider API key before running again."
    exit 0
  else
    echo "Missing .env.example and .env.local. Cannot continue."
    exit 1
  fi
fi

npm install
node scripts/check-env.mjs .env.local
npm run db:bootstrap

echo "Setup complete. Start with: npm run dev"
