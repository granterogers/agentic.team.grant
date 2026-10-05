#!/bin/bash
# Build the two OLDER schema generations beside the replica's `post`, so a cost can be compared before and after the multi-user
# work (Supabase degradation forensics, 4 October 2026). Run after `bash scripts/isolated/replica.sh`, which builds `pre` and `post`.
#
#   bash scripts/forensics/replica-generations.sh
#
#   pre646 : pre + every migration through 0646. The schema the repository had when the multi-user research began (1 October).
#            Pair it with a worktree of commit 72a35490 (the parent of the first multi-user code change, 2e1afb3e):
#              git worktree add /tmp/wt-pre 72a35490 && ln -s "$PWD/node_modules" /tmp/wt-pre/node_modules
#              cp scripts/forensics/*.ts /tmp/wt-pre/scripts/forensics/ && (cd /tmp/wt-pre && npx tsx scripts/forensics/idle-pass-cost.ts pre646_i 30)
#   premu  : pre + every migration through 0653, the last before 0654_offices. No office column exists in it.
#
# Both use the replica's own marked, local-socket database server (guard.ts refuses anything else). Nothing here touches production.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SOCK=${ISOLATED_PG_SOCKET:-/tmp/pgs}; PORT=${ISOLATED_PG_PORT:-55432}
P="psql -h $SOCK -p $PORT -U postgres -q"
build() { # name, last migration number to include
  local name=$1 last=$2 stop
  stop=$(printf '%04d' $((10#$last + 1)))
  $P -c "drop database if exists $name"
  $P -c "create database $name template pre"
  $P -d "$name" -v ON_ERROR_STOP=1 -1 -f "$ROOT/migrations/0599_one_stalled_job_must_not_stop_the_office.sql" >/dev/null
  for f in $(cd "$ROOT/migrations" && ls [0-9][0-9][0-9][0-9]_*.sql | sort); do
    n=${f%%_*}; [ "$n" \> "0599" ] || continue; [ "$n" \< "$stop" ] || break
    $P -d "$name" -v ON_ERROR_STOP=1 -1 -f "$ROOT/migrations/$f" >/dev/null
  done
  echo "built $name (through $last)"
}
build pre646 0646
build premu 0653
