#!/usr/bin/env bash
# Runs INSIDE the `validate` container: wires the stack together, then runs the repository's validation kit (the single source of truth).
set -euo pipefail
cd /work
eval "$(node scripts/ci/make_env.mjs --export)"
node scripts/ci/wait_for.mjs "${GOTRUE_URL}/health" 240
node scripts/ci/wait_for.mjs "${POSTGREST_URL}/" 120
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f database/tests/ci/01_ci_auth_compat.sql
mkdir -p reports/ci
nohup node scripts/ci/api_gateway.mjs > reports/ci/gateway.log 2>&1 &
node scripts/ci/wait_for.mjs "http://127.0.0.1:${GATEWAY_PORT}/auth/v1/health" 60
if [ -f package-lock.json ]; then npm ci; else npm install; fi
npx playwright install chromium >/dev/null 2>&1 || true
set +e
npm run --silent validate:phase7 -- --db-url "$DATABASE_URL" --shim-auth 2>&1 | tee reports/ci/gate-output.txt
code=${PIPESTATUS[0]}
node scripts/ci/scrub.mjs reports || true
echo "validation kit exit code: $code (reports/phase7/latest.md)"
exit "$code"
