#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose run --rm tools npm run validate:bank
docker compose exec -T api npm run seed -- --publish
