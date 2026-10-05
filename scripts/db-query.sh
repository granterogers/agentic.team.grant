#!/usr/bin/env bash
# Execute SQL against the Supabase project over HTTPS.
#
# This exists because a Claude Code cloud session cannot reach Postgres on 5432
# or 6543 — all non-443 TCP egress is blocked, and the direct host is IPv6-only
# while the container has no IPv6 at all. See ADR-0007. The Management API is
# the only working transport for DDL from a build session.
#
# Verified 2026-09-03: CREATE TABLE, INSERT, SELECT, REVOKE, ALTER TABLE …
# ENABLE ROW LEVEL SECURITY, CREATE POLICY, SET LOCAL ROLE and DROP all execute,
# and a REVOKE is genuinely enforced (42501 on a forbidden UPDATE).
#
# Usage:  scripts/db-query.sh "select 1;"
#         scripts/db-query.sh --file migrations/0001_init.sql
#
# Exits non-zero when the API reports an error, so it is safe in a pipeline.
set -euo pipefail

# Production gate (docs/production-access-guard.md): holding a token is not permission to use it.
# Every statement is sent to the real project, so a person has to say so on purpose.
if [[ "${ALLOW_PRODUCTION_CHECKS:-}" != "1" ]]; then
  echo "REFUSED: scripts/db-query.sh would contact PRODUCTION (the Supabase Management API). Having credentials in the environment is not permission: an earlier autonomous run touched the real office by accident because they were there. To do this on purpose run: ALLOW_PRODUCTION_CHECKS=1 scripts/db-query.sh ... (a write also needs ALLOW_PRODUCTION_WRITES=1). Nothing was sent." >&2
  exit 78
fi

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is not set}"
PROJECT_REF="${SUPABASE_PROJECT_REF:-baujwlzcziasnfhhkchg}"
API="https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query"

if [[ "${1:-}" == "--file" ]]; then
  [[ -n "${2:-}" ]] || { echo "--file needs a path" >&2; exit 2; }
  SQL="$(cat "$2")"
else
  SQL="${1:?pass SQL as the first argument, or --file <path>}"
fi

BODY="$(SQL="$SQL" python3 -c 'import json,os;print(json.dumps({"query":os.environ["SQL"]}))')"

RESPONSE="$(mktemp)"; trap 'rm -f "$RESPONSE"' EXIT
STATUS="$(curl -sS -o "$RESPONSE" -w '%{http_code}' -X POST "$API" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data-binary "$BODY")"

cat "$RESPONSE"; echo
[[ "$STATUS" =~ ^2 ]] || { echo "HTTP ${STATUS}" >&2; exit 1; }
