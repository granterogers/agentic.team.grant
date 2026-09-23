/*
  A fifth of what the office calls Grant's conversation is a test suite.

  `app.harness_job` reads three signals: `jobs.synthetic`, `jobs.is_fixture`
  (GENERATED from `requested_by`) and the project's own fixture flag. A suite
  driving the REAL enqueue path defeats all three on purpose: #45 says a suite
  testing something that filters fixtures must use real subjects, and
  `app.enqueue_inbound` composes `requested_by` from
  `<origin_channel>:<subject>` - so a suite that sets a realistic subject
  produces a job indistinguishable from one of his.

  Measured: **35 of 173** `office.instruction` jobs this function calls real
  were written by a suite. Only 12 of those look like a probe by name, so the
  27 others would survive any list of names - and CLAUDE.md already records
  that chasing harness traffic by name fails.

  There IS a structural marker and nothing reads it. Every suite composes a
  dedupe key in its own namespace, and the namespaces separate completely:

      teamhq    1520   used on teamhq only
      slack      207   used on slack only
      telegram   166   used on telegram only
      voice       74   used on voice only
      verify      59   used on slack, telegram AND voice
      asset        1   used on teamhq only

  A dedupe key is written by the adapter that received the message. No real
  adapter writes `verify:`, and the one namespace spanning three channels is
  the signature of a suite impersonating all of them.

  ## This is a containment fix, not only a measurement one

  `app.claim_delivery` refuses a harness job any destination outside
  `public.test_destinations` - and asks THIS function. So the blind spot is
  the guard's too: on 14 September six `verify:chaos` deliveries went to
  `slack:C0BVD21Q9S5` and to **his real Telegram chat**, and they are not
  counted as escapes because `app.harness_escapes()` asks the same question.
  Those six predate the guard (21 September) and sit in its "before it
  existed" bucket; the defect is that the same run today would send them
  again.

  ## Direction

  Widening this can only make containment STRICTER - more traffic refused a
  real destination. The cost of a false positive is a real message suppressed,
  which is why the drive block below asserts that not one command in a real
  channel namespace is newly called harness.
*/

create or replace function app.harness_job(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(
    (select j.synthetic or j.is_fixture or coalesce(p.is_fixture, false)
              /*
                Or the suite signed the message it sent. `inbound_commands`
                is written by whichever adapter received the turn, and no real
                adapter writes a `verify:` namespace (0574).
              */
              or exists (
                   select 1 from public.inbound_commands c
                    where c.command_id = (j.pinned_config ->> 'command_id')::uuid
                      and split_part(c.dedupe_key, ':', 1) = 'verify')
       from public.jobs j
       left join public.projects p on p.project_id = j.project_id
      where j.job_id = p_job_id),
    false)
$function$;

comment on function app.harness_job(uuid) is
  'Is this job the harness talking? Four signals: the job says so, its name '
  'says so, its project says so, or the suite signed the inbound message with '
  'a verify: dedupe namespace no real adapter writes.';

do $drive$
declare
  v_now int;
  v_real_lost int;
  v_seen int;
begin
  -- The 35 are now harness.
  select count(*) into v_now
    from public.inbound_commands c
    join public.jobs j on j.pinned_config ->> 'command_id' = c.command_id::text
   where c.dedupe_key like 'verify:%'
     and not app.harness_job(j.job_id);
  if v_now > 0 then
    raise exception '% suite job(s) are still counted as his', v_now;
  end if;

  -- And the control that matters: NOT ONE message from a real channel
  -- namespace became harness. A false positive here costs him a delivery.
  select count(*) into v_real_lost
    from public.inbound_commands c
    join public.jobs j on j.pinned_config ->> 'command_id' = c.command_id::text
   where split_part(c.dedupe_key, ':', 1) in ('teamhq', 'slack', 'telegram', 'voice')
     and app.harness_job(j.job_id)
     and not (select jj.synthetic or jj.is_fixture from public.jobs jj where jj.job_id = j.job_id)
     and not exists (select 1 from public.projects p
                      where p.project_id = j.project_id and p.is_fixture);
  if v_real_lost > 0 then
    raise exception '% real message(s) would now be treated as harness', v_real_lost;
  end if;

  -- A found-nothing check proves nothing until its subject is non-empty.
  select count(*) into v_seen from public.inbound_commands where dedupe_key like 'verify:%';
  if v_seen = 0 then
    raise exception 'no suite-signed commands at all - the checks above proved nothing';
  end if;
end
$drive$;
