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
