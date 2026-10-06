#!/bin/bash
# The typed-restore proof, end to end, on fresh copies of the isolated replica (G-2).
#
#   bash scripts/isolated/backup-restore-typed.sh
#
# brt_base = post (every migration through the candidate) + any migration newer than the replica was built with that this
#            branch carries (MIG_FLOOR, default 1026) + the proof-only probe tables;
# brt_src  = a copy of it, seeded by the proof through the product's own writers;
# brt_dst  = a second copy, which the restore empties and fills.
# Nothing here touches `post`, production, or a person: the proof refuses any database that is not a marked local socket.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd); cd "$ROOT"
SOCK=${ISOLATED_PG_SOCKET:-/tmp/pgs}; PORT=${ISOLATED_PG_PORT:-55432}
P="psql -h $SOCK -p $PORT -U postgres -q"
$P -c "drop database if exists brt_src"; $P -c "drop database if exists brt_dst"; $P -c "drop database if exists brt_base"
$P -c "create database brt_base template post"
for m in $(ls migrations/*.sql | awk -F/ '{print $2}' | awk -v f="${MIG_FLOOR:-1026}" '$0 >= f'); do
  $P -d brt_base -v ON_ERROR_STOP=1 -1 -f "migrations/$m" >/dev/null
done
$P -d brt_base -v ON_ERROR_STOP=1 -1 -f scripts/isolated/restore-probe-schema.sql
$P -c "create database brt_src template brt_base"; $P -c "create database brt_dst template brt_base"
env -u SUPABASE_ACCESS_TOKEN -u SUPABASE_PROJECT_REF -u SUPABASE_SERVICE_ROLE_KEY -u SUPABASE_DB_URL \
  npx tsx scripts/isolated/backup-restore-typed.ts brt_src brt_dst
