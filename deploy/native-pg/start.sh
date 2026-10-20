#!/usr/bin/env bash
set -euo pipefail
# The local DB is disposable and binds only to loopback. Neon remains untouched.
pg_ctlcluster 15 main start
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "CREATE ROLE judge_local WITH LOGIN PASSWORD 'local_only_judge_pw_2026'" 2>/dev/null || true
runuser -u postgres -- createdb -O judge_local judge_sandbox 2>/dev/null || true
export JUDGE_DATABASE_URL='postgresql://judge_local:local_only_judge_pw_2026@127.0.0.1:5432/judge_sandbox'
export PGLITE_PILOT=true
export PGLITE_PREWARM=true
exec node --import tsx apps/worker/render-service.ts
