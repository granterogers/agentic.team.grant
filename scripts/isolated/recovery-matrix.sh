#!/bin/bash
# The R48 recovery matrix against pre (0599 absent) and post (0599 applied).
# Expect: pre - the sweep raises and nothing recovers; post - every row "ok",
# the malformed row contained as a WARNING, the healthy job dequeued.
ROOT=$(cd "$(dirname "$0")/../.." && pwd); SOCK=${ISOLATED_PG_SOCKET:-/tmp/pgs}; PORT=${ISOLATED_PG_PORT:-55432}
P="psql -h $SOCK -p $PORT -U postgres -q"; bad=0
# The gate gives each run its own database names (GATE_DB_PREFIX) and the candidate to use as `post` (ISOLATED_POST), so
# parallel runs never meet. Run by hand, the old names and `post` itself are used, and `post` is only ever a template.
PREFIX=${GATE_DB_PREFIX:-m}; POST=${ISOLATED_POST:-post}
for db in pre post; do
  tpl=$db; [ $db = post ] && tpl=$POST
  w=${PREFIX}_$db
  echo "===== $db"; $P -c "drop database if exists $w"; $P -c "create database $w template $tpl"
  $P -d $w -v ON_ERROR_STOP=1 -f "$ROOT/scripts/isolated/recovery-matrix.sql"
  out=$(psql -h $SOCK -p $PORT -U postgres -d $w -f "$ROOT/scripts/isolated/recovery-matrix-run.sql" 2>&1)
  $P -c "drop database if exists $w" >/dev/null 2>&1
  echo "$out" | grep -E "ERROR|WARNING|\| (ok|WRONG)|healthy dequeued" | sed 's/psql:[^ ]* //' | cut -c1-150
  if [ $db = post ] && echo "$out" | grep -q "WRONG"; then bad=1; fi
  if [ $db = pre ] && ! echo "$out" | grep -q "ERROR:  illegal job transition"; then echo "CONTROL FAILED: pre did not reproduce the outage"; bad=1; fi
done
exit $bad
