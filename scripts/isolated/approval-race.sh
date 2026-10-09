#!/usr/bin/env bash
# The isolated proof of 0596 (R-approval-race): two overlapping answers to one
# question perform the answer ONCE. Run against a copy of `base` (without 0596,
# the control: must show 2) and a copy of `post` (with it: must show 1).
set -uo pipefail
P="psql -h ${ISOLATED_PG_SOCKET:-/tmp/pgs} -p ${ISOLATED_PG_PORT:-55432} -U postgres -qAtX"
race() {
  # The gate gives each run its own names (GATE_DB_PREFIX) and the candidate to use as `post` (ISOLATED_POST); by hand the
  # old names and `post` itself are used, and `post` is only ever a template.
  local tpl=$1 db="${GATE_DB_PREFIX:-race}_$1" from=$1
  [ "$tpl" = post ] && from=${ISOLATED_POST:-post}
  $P -d postgres -c "drop database if exists $db" -c "create database $db template $from" >/dev/null
  [ "$($P -d $db -c "select to_regclass('public.isolated_replica_marker') is not null")" = t ] || { echo "not the replica"; exit 2; }
  # The fixture is shaped by the schema it finds. Since the office model a job and a blocker carry a NOT NULL
  # office_id (the blocker's project in the same office) and hq_answer_blocker takes the office first; the control
  # ("base") is the schema from before the office model and before 0596, and has none of that.
  local office=f ocols="" ovals="" bcols="" bvals="" oarg=""
  [ "$($P -d $db -c "select to_regprocedure('app.test_office()') is not null")" = t ] && office=t
  if [ "$office" = t ]; then
    ocols="office_id, "; ovals="app.test_office(), "
    bcols="office_id, project_id, "; bvals="app.test_office(), app.unnamed_project(app.test_office()), "
    oarg="app.test_office(),"
  fi
  local ids
  ids=$($P -d $db -c "
    with j as (insert into public.jobs (${ocols}correlation_id, kind, state, requested_by, announce, idempotency_key)
               values (${ovals}gen_random_uuid(), 'verify.approval_race', 'queued', 'teamhq:verify-apprace-iso', false, 'verify-apprace-iso')
               returning job_id)
    insert into public.blockers (${bcols}job_id, requested_action, why_needed, consequences_of_delay,
                                 approval_options, originating_agent, work_can_continue, on_answer)
    select ${bvals}job_id, 'race', 'a probe', 'none', array['Yes','No'], 'chief-of-staff', true,
           jsonb_build_object('option','Yes','kind','verify.approval_race_child','payloads', jsonb_build_array('{}'::jsonb))
      from j returning blocker_id || ' ' || job_id")
  local b=${ids% *} j=${ids#* }
  # 0608: the candidate takes who is answering as a third argument; the control
  # ("base") is the schema BEFORE that existed and takes two.
  local who="'Yes'"; [ "$tpl" = base ] || who="'Yes','grant'"
  # The parent is deliberately left QUEUED. This used to cancel it "as a fixture", which stops nothing (a replica has no
  # worker) and which the current product answers correctly by starting NOTHING from a cancelled parent
  # (started: 0), so with it the post run counted 0 children and read as the race fixed for the wrong reason.
  ( $P -d $db -c "begin" -c "select app.hq_answer_blocker($oarg'$b'::uuid,$who)" -c "select pg_sleep(4)" -c "commit" >/dev/null 2>&1 ) &
  sleep 1
  local second
  second=$($P -d $db -c "select app.hq_answer_blocker($oarg'$b'::uuid,$who)::text" 2>&1 | cut -c1-120)
  wait
  local n
  n=$($P -d $db -c "select count(*) from public.jobs where parent_job_id='$j' and kind='verify.approval_race_child'")
  echo "$tpl: children=$n  second answer: $second"
  $P -d postgres -c "drop database $db" >/dev/null
  echo "$n"
}
# Each run's lines are shown, and its last line (the child count) is what is compared. `tee /dev/stderr` is not used: when
# the caller's stderr is a socket (the gate runner's pipes are) opening /dev/stderr fails with ENXIO.
out_c=$(race base); echo "$out_c" >&2; c=$(echo "$out_c" | tail -1)
out_t=$(race post); echo "$out_t" >&2; t=$(echo "$out_t" | tail -1)
[ "$c" = 2 ] && echo "CONTROL red as it must be: without 0596 two answers performed it twice" || echo "CONTROL DID NOT REPRODUCE (children=$c)"
[ "$t" = 1 ] && echo "PASS: with 0596 two overlapping answers performed it once" || { echo "FAIL: with 0596 children=$t"; exit 1; }
[ "$c" = 2 ] || exit 1
