#!/bin/bash
# Build the throwaway database the ownership attack suite runs in: the replica `post` plus the P2 migrations.
#   scripts/isolated/p2-attack.sh [name]          # default p2_attack
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NAME=${1:-p2_attack}
case "$NAME" in p2_attack*) ;; *) echo "REFUSED: $NAME is not a p2_attack clone" >&2; exit 2;; esac
P="psql -h ${ISOLATED_PG_SOCKET:-/tmp/pgs} -p ${ISOLATED_PG_PORT:-55432} -U postgres -q"
$P -d postgres -c "drop database if exists $NAME"
# ISOLATED_TEMPLATE names the candidate to clone (the gate passes its own, which holds the branch's newer migrations);
# `post` itself is only ever a template here, never modified.
$P -d postgres -c "create database $NAME template ${ISOLATED_TEMPLATE:-post}"
# the replica has no logins for the two office_members; production does
$P -d "$NAME" -c "insert into auth.users(id,email) select gen_random_uuid(), e from (values ('grant.e.rogers@gmail.com'),('verify.operator@example.com')) v(e) where not exists (select 1 from auth.users u where lower(u.email) = v.e)"
# `post` is the whole candidate (replica.sh replays EVERY migration above 0599 into it), so it already holds 0654..0669.
# Replaying them fails on the first statement ("offices already exists") and the suite never gets a database. Replay only
# when the template genuinely predates them (an older replica); P2_SKIP therefore only has an effect on such a template.
if [ "$($P -d "$NAME" -tA -c "select to_regclass('public.offices') is not null")" = "t" ]; then
  echo "template already holds 0654 and later: nothing to replay (P2_SKIP has no effect on it)"
  echo "$NAME ready: $($P -d "$NAME" -tA -c 'select count(*) from public.offices') office(s)"
  exit 0
fi
for f in "$ROOT"/migrations/065[4-9]_*.sql "$ROOT"/migrations/066[0-9]_*.sql; do
  [ -e "$f" ] || continue
  # P2_SKIP="0664 ..." leaves migrations out, to show the suite goes red without them
  case " ${P2_SKIP:-} " in *" $(basename "$f" | cut -c1-4) "*) echo "skipping $(basename "$f")"; continue;; esac
  $P -d "$NAME" -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done
echo "$NAME ready: $($P -d "$NAME" -tA -c 'select count(*) from public.offices') office(s)"
