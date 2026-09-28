#!/bin/bash
# Every isolated proof, each on a fresh copy of the replica.
#   sudo scripts/isolated/replica.sh && scripts/isolated/run-all.sh
ROOT=$(cd "$(dirname "$0")/../.." && pwd); cd "$ROOT"
SOCK=${ISOLATED_PG_SOCKET:-/tmp/pgs}; PORT=${ISOLATED_PG_PORT:-55432}; P="psql -h $SOCK -p $PORT -U postgres -q"
fresh() { $P -c "drop database if exists $1" >/dev/null 2>&1; $P -c "create database $1 template $2"; }
status=0
echo "== R48 recovery matrix"; bash scripts/isolated/recovery-matrix.sh > /tmp/iso-matrix.txt 2>&1 && echo PASS || { echo FAIL; status=1; }
echo "== R48 drain survives a raising sweep (on pre)"; fresh drain_proof pre; npx tsx scripts/isolated/drain-survives-sweep.ts drain_proof 2>&1 | tail -1; [ ${PIPESTATUS[0]} -eq 0 ] || status=1
for t in approval-execution:r45 approval-delivery:r46 containment:r37 acknowledgement:ack374; do
  f=${t%%:*}; db=${t##*:}; echo "== $f"; fresh $db post
  npx tsx scripts/isolated/$f.ts $db > /tmp/iso-$f.txt 2>&1; rc=$?; grep -E "passed|^FAIL" /tmp/iso-$f.txt | tail -3; [ $rc -eq 0 ] || status=1
done
echo "== 0596 overlapping answers"; bash scripts/isolated/approval-race.sh > /tmp/iso-race.txt 2>&1 && tail -1 /tmp/iso-race.txt || { cat /tmp/iso-race.txt; status=1; }
exit $status
