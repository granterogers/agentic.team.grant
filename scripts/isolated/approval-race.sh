#!/usr/bin/env bash
# The isolated proof of 0596 (R-approval-race): two overlapping answers to one
# question perform the answer ONCE. Run against a copy of `base` (without 0596,
# the control: must show 2) and a copy of `post` (with it: must show 1).
set -uo pipefail
P="psql -h /tmp/pgs -p 55432 -U postgres -qAtX"
race() {
  local tpl=$1 db="race_$1"
  $P -d postgres -c "drop database if exists $db" -c "create database $db template $tpl" >/dev/null
  [ "$($P -d $db -c "select to_regclass('public.isolated_replica_marker') is not null")" = t ] || { echo "not the replica"; exit 2; }
  local ids
  ids=$($P -d $db -c "
    with j as (insert into public.jobs (correlation_id, kind, state, requested_by, announce, idempotency_key)
               values (gen_random_uuid(), 'verify.approval_race', 'queued', 'teamhq:verify-apprace-iso', false, 'verify-apprace-iso')
               returning job_id)
    insert into public.blockers (job_id, requested_action, why_needed, consequences_of_delay,
                                 approval_options, originating_agent, work_can_continue, on_answer)
    select job_id, 'race', 'a probe', 'none', array['Yes','No'], 'chief-of-staff', true,
           jsonb_build_object('option','Yes','kind','verify.approval_race_child','payloads', jsonb_build_array('{}'::jsonb))
      from j returning blocker_id || ' ' || job_id")
  local b=${ids% *} j=${ids#* }
  # 0608: the candidate takes who is answering as a third argument; the control
  # ("base") is the schema BEFORE that existed and takes two.
  local who="'Yes'"; [ "$tpl" = base ] || who="'Yes','grant'"
  $P -d $db -c "update public.jobs set state='cancelled', state_reason='fixture' where job_id='$j'" >/dev/null
  ( $P -d $db -c "begin" -c "select app.hq_answer_blocker('$b'::uuid,$who)" -c "select pg_sleep(4)" -c "commit" >/dev/null 2>&1 ) &
  sleep 1
  local second
  second=$($P -d $db -c "select app.hq_answer_blocker('$b'::uuid,$who)::text" 2>&1 | cut -c1-120)
  wait
  local n
  n=$($P -d $db -c "select count(*) from public.jobs where parent_job_id='$j' and kind='verify.approval_race_child'")
  echo "$tpl: children=$n  second answer: $second"
  $P -d postgres -c "drop database $db" >/dev/null
  echo "$n"
}
c=$(race base | tee /dev/stderr | tail -1)
t=$(race post | tee /dev/stderr | tail -1)
[ "$c" = 2 ] && echo "CONTROL red as it must be: without 0596 two answers performed it twice" || echo "CONTROL DID NOT REPRODUCE (children=$c)"
[ "$t" = 1 ] && echo "PASS: with 0596 two overlapping answers performed it once" || { echo "FAIL: with 0596 children=$t"; exit 1; }
[ "$c" = 2 ] || exit 1
