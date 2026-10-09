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
# The gate gives each run its own database names (GATE_DB_PREFIX) and the candidate to start from (ISOLATED_POST), which
# already carries every newer migration, so none is re-applied. By hand the old names, `post` and MIG_FLOOR are used.
PREFIX=${GATE_DB_PREFIX:-brt}
BASE=${PREFIX}_base; SRC=${PREFIX}_src; DST=${PREFIX}_dst
drop() { $P -c "drop database if exists $SRC" >/dev/null 2>&1; $P -c "drop database if exists $DST" >/dev/null 2>&1; $P -c "drop database if exists $BASE" >/dev/null 2>&1; }
drop; trap drop EXIT
$P -c "create database $BASE template ${ISOLATED_POST:-post}"
if [ -z "${ISOLATED_POST:-}" ]; then
  for m in $(ls migrations/*.sql | awk -F/ '{print $2}' | awk -v f="${MIG_FLOOR:-1026}" '$0 >= f'); do
    $P -d "$BASE" -v ON_ERROR_STOP=1 -1 -f "migrations/$m" >/dev/null
  done
fi
$P -d "$BASE" -v ON_ERROR_STOP=1 -1 -f scripts/isolated/restore-probe-schema.sql
$P -c "create database $SRC template $BASE"; $P -c "create database $DST template $BASE"
env -u SUPABASE_ACCESS_TOKEN -u SUPABASE_PROJECT_REF -u SUPABASE_SERVICE_ROLE_KEY -u SUPABASE_DB_URL \
  npx tsx scripts/isolated/backup-restore-typed.ts "$SRC" "$DST"
