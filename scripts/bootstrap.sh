#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/configure.mjs
docker build --target postgres -f Dockerfile.sandbox -t sql-arena-postgres .
docker build --target mysql -f Dockerfile.sandbox -t sql-arena-mysql .
docker compose build
docker compose up -d db redis api web worker
docker compose exec -T api npm run seed
printf '%s\n' 'Open http://localhost:3000. Create an administrator with: python3 scripts/create_admin.py --docker' 'The bank is seeded as drafts. Validate and publish with: bash scripts/publish-bank.sh'
