#!/bin/bash
# The R48 recovery matrix against pre (0599 absent) and post (0599 applied).
# Expect: pre - the sweep raises and nothing recovers; post - every row "ok",
# the malformed row contained as a WARNING, the healthy job dequeued.
ROOT=$(cd "$(dirname "$0")/../.." && pwd); SOCK=${ISOLATED_PG_SOCKET:-/tmp/pgs}; PORT=${ISOLATED_PG_PORT:-55432}
P="psql -h $SOCK -p $PORT -U postgres -q"; bad=0
for db in pre post; do
  echo "===== $db"; $P -c "drop database if exists m_$db"; $P -c "create database m_$db template $db"
  $P -d m_$db -v ON_ERROR_STOP=1 -f "$ROOT/scripts/isolated/recovery-matrix.sql"
  out=$(psql -h $SOCK -p $PORT -U postgres -d m_$db -f "$ROOT/scripts/isolated/recovery-matrix-run.sql" 2>&1)
  echo "$out" | grep -E "ERROR|WARNING|\| (ok|WRONG)|healthy dequeued" | sed 's/psql:[^ ]* //' | cut -c1-150
  if [ $db = post ] && echo "$out" | grep -q "WRONG"; then bad=1; fi
  if [ $db = pre ] && ! echo "$out" | grep -q "ERROR:  illegal job transition"; then echo "CONTROL FAILED: pre did not reproduce the outage"; bad=1; fi
done
exit $bad
