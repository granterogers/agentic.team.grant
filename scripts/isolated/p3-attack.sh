#!/bin/bash
# Build the throwaway database the P3 application attack suite runs in: the replica `post` plus every migration from
# 0654 up (P2 and P3). Mirrors p2-attack.sh, so the P2 suite can also be pointed at it.
#   scripts/isolated/p3-attack.sh [name]          # default p3_attack
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NAME=${1:-p3_attack}
case "$NAME" in p3_attack*) ;; *) echo "REFUSED: $NAME is not a p3_attack clone" >&2; exit 2;; esac
P="psql -h ${ISOLATED_PG_SOCKET:-/tmp/pgs} -p ${ISOLATED_PG_PORT:-55432} -U postgres -q"
$P -d postgres -c "drop database if exists $NAME"
$P -d postgres -c "create database $NAME template post"
$P -d "$NAME" -c "insert into auth.users(id,email) select gen_random_uuid(), e from (values ('grant.e.rogers@gmail.com'),('verify.operator@example.com')) v(e) where not exists (select 1 from auth.users u where lower(u.email) = v.e)"
for f in "$ROOT"/migrations/06[5-9][0-9]_*.sql; do
  [ -e "$f" ] || continue
  n=$(basename "$f" | cut -c1-4)
  [ "$n" \< "0654" ] && continue
  case " ${P3_SKIP:-} " in *" $n "*) echo "skipping $n"; continue;; esac
  $P -d "$NAME" -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done
echo "$NAME ready: $($P -d "$NAME" -tA -c 'select count(*) from public.offices') office(s)"
