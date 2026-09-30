#!/bin/bash
# Every isolated proof, each on a fresh copy of the replica.
#   sudo scripts/isolated/replica.sh && scripts/isolated/run-all.sh
ROOT=$(cd "$(dirname "$0")/../.." && pwd); cd "$ROOT"
SOCK=${ISOLATED_PG_SOCKET:-/tmp/pgs}; PORT=${ISOLATED_PG_PORT:-55432}; P="psql -h $SOCK -p $PORT -U postgres -q"
fresh() { $P -c "drop database if exists $1" >/dev/null 2>&1; $P -c "create database $1 template $2"; }
status=0
# The candidate: production's schema (post, through 0612) plus every migration on this branch after it (MIG_FLOOR).
fresh cand post
for m in $(ls migrations/*.sql | awk -F/ '{print $2}' | awk -v f="${MIG_FLOOR:-0613}" '$0 >= f'); do
  $P -d cand -v ON_ERROR_STOP=1 -f migrations/$m >/dev/null || { echo "FAIL applying $m to cand"; exit 1; }
  echo "   cand + $m"
done
echo "== R48 recovery matrix"; bash scripts/isolated/recovery-matrix.sh > /tmp/iso-matrix.txt 2>&1 && echo PASS || { echo FAIL; status=1; }
echo "== R48 drain survives a raising sweep (on pre)"; fresh drain_proof pre; npx tsx scripts/isolated/drain-survives-sweep.ts drain_proof 2>&1 | tail -1; [ ${PIPESTATUS[0]} -eq 0 ] || status=1
for t in destination-retirement:ret381 history-shapes:hist381 test-origins:orig381 witness-test-origins:witorig381 legit-origins:legit379 synthetic-origins:syn379 task-content-containment:task379 narration-containment:narr378 external-containment:ext378 correction-containment:corr378 chat-containment:chat378 witness-independence:wit378 approval-execution:r45 approval-delivery:r46 containment:r37 acknowledgement:ack374 acknowledgement-sequence:seq374 project-provenance:prov373 paused-incoherent:pinc ask-unasked-loop:aunq sender-authorization:sa607 approver-identity:ap608 open-question:oq fan-in-waits:fw609 outward-options:ow609 drive-options:dr610 channel-options:ch610 blocker-failure:bf7 turn-entitlement:te611 mixed-turns:mx611 authority-characterization:ac611 authority:au611 exactly-once:eo611 refusal-reversal:rr612 anon-surface:an613 principals:pr614 slack-sender:ss615 approval-binding:ab616 vault-export-door:vd616 job-origin:jo619 job-lifecycle:jl620 typed-yes:ty622 job-delegation:jd620 question-binding:qb623 forwarded-authority:fa624 job-fence:jf625 ci-voice-ledger:ci626 audit-closure:ac631 guidance-stated:gs633 telegram-voice-test-origin:tvo633 enumeration-agreement:en633 parked-turn-owes-a-word:pk634 retrieval-scope:rs634 project-ownership:po634; do
  f=${t%%:*}; db=${t##*:}; echo "== $f"; fresh $db cand
  npx tsx scripts/isolated/$f.ts $db > /tmp/iso-$f.txt 2>&1; rc=$?; grep -E "passed|^FAIL" /tmp/iso-$f.txt | tail -3; [ $rc -eq 0 ] || status=1
done
echo "== version skew: new worker on the old schema (before 0619 and 0620)"; $P -c "drop database if exists skew_old" >/dev/null 2>&1; $P -c "create database skew_old template post"
for m in $(ls migrations/*.sql | awk -F/ '{print $2}' | awk '$0 >= "0613" && $0 < "0619"'); do $P -d skew_old -v ON_ERROR_STOP=1 -f migrations/$m >/dev/null || { echo "FAIL applying $m to skew_old"; exit 1; }; done
npx tsx scripts/isolated/job-skew.ts skew_old > /tmp/iso-job-skew.txt 2>&1; rc=$?; grep -E "passed|^FAIL" /tmp/iso-job-skew.txt | tail -3; [ $rc -eq 0 ] || status=1
echo "== 0596 overlapping answers"; bash scripts/isolated/approval-race.sh > /tmp/iso-race.txt 2>&1 && tail -1 /tmp/iso-race.txt || { cat /tmp/iso-race.txt; status=1; }
exit $status
