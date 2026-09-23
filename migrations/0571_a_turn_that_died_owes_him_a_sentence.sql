/*
  He sent a 17-second voice note and the office said nothing, ever.

  8 September, 08:02, his real Telegram chat. `office.instruction` threw
  "Buffer is not defined" on the transcription path, retried to attempt 4 of 5,
  and moved to `failed`. `public.deliveries` for that job: zero rows. No
  answer, no apology, no "I could not hear that" - he spoke into his phone and
  the turn evaporated.

  The Buffer defect itself is long fixed. The SILENCE is not, and it is the
  general case rather than that one crash: every terminal failure in
  `src/jobs/worker.ts` ends `moveTo(job, 'failed')` and returns. #211 taught
  the coherence gate to record an IMPEDIMENT, which is a row on the Governance
  page - a screen he has to go and look at. It never taught anything to speak
  on the channel he asked on.

  CLAUDE.md states the rule and the fix was applied one layer short of it:
  "Anything that can end a turn with no answer has to say so somewhere he
  looks." A voice note is the worst case, because silence is indistinguishable
  from not having been heard at all.

  This function is the reader. It answers one question - who, if anybody, is
  owed a sentence about this job - and it answers it in SQL so that every
  death site shares one definition rather than each deciding for itself.

  Five conditions, and each one is load-bearing:

    - the job is TERMINAL failed. A retry is not a death, and apologising for
      an attempt the office is about to repeat is worse than saying nothing.
    - a PERSON asked, through a channel that can be replied to. A duty that
      fails owes its report to `office_health`, not a message to Grant, and
      `check:chatter` exists because a duty that messages him on a schedule is
      how 746 messages reached his phone in a day.
    - the turn has an inbound origin. Without `origin_ref` there is nowhere to
      reply to, and inventing a destination is how harness traffic reaches a
      real chat.
    - NOTHING was delivered for this job. A turn that already answered and then
      failed on a later step has not gone silent.
    - it is the ROOT. A child specialist's failure is the parent's business,
      and one turn must produce at most one apology however many branches it
      spawned.

  Containment is NOT re-implemented here. `app.claim_delivery` already refuses
  a harness job any destination outside `public.test_destinations` (0523), so
  this path inherits the guard rather than keeping a second copy of it - which
  is the defect 0303/0304 exist to warn about. The harness filter below is
  belt-and-braces and deliberately the ASYMMETRIC direction: a job this office
  cannot attribute is treated as REAL and gets its sentence, because failing to
  apologise to Grant is the cheap error and messaging a harness is the
  expensive one that `deliverable_to` then stops anyway.
*/

create or replace function app.owed_a_word(p_job_id uuid)
returns table (channel text, account_ref text, target_ref text, thread_ref text, kind text)
language sql
stable
security definer
set search_path to ''
as $function$
  select c.origin_channel::text,
         split_part(c.origin_ref, ':', 1)::text,
         split_part(c.origin_ref, ':', 1)::text,
         nullif(split_part(c.origin_ref, ':', 2), '')::text,
         j.kind::text
    from public.jobs j
    join public.inbound_commands c
      on c.command_id = (j.pinned_config ->> 'command_id')::uuid
   where j.job_id = p_job_id
     and j.state = 'failed'
     and j.parent_job_id is null
     and c.origin_channel in ('telegram', 'slack', 'teamhq', 'voice')
     and coalesce(nullif(btrim(c.origin_ref), ''), '') <> ''
     and not exists (select 1 from public.deliveries d where d.job_id = j.job_id)
$function$;

comment on function app.owed_a_word(uuid) is
  'Who is owed a sentence because this turn died without one. Empty for a '
  'retry, a duty, a child, a turn that already answered, or one with nowhere '
  'to reply to. Containment is app.claim_delivery''s, not this function''s.';

grant execute on function app.owed_a_word(uuid) to authenticated, service_role;

/*
  DRIVE IT. A migration that applies cleanly is not a function that works, and
  this file would otherwise be four defects waiting for their first caller.

  The subject is the real 8 September voice note, which is the case the
  function exists for and cannot be rewritten by anything this migration does:
  it is read, never written.
*/
do $drive$
declare
  v_found int;
  v_chan text;
  v_target text;
begin
  select count(*), max(channel), max(target_ref) into v_found, v_chan, v_target
    from app.owed_a_word('3cb9409e-22be-4a57-91b8-506b0906e8cc'::uuid);

  if v_found <> 1 then
    raise exception 'the voice note that died is owed a word, and owed_a_word found % row(s)', v_found;
  end if;
  if v_chan <> 'telegram' then
    raise exception 'expected the channel he spoke on, got %', v_chan;
  end if;
  if v_target <> '1386648496' then
    raise exception 'expected his chat, got %', v_target;
  end if;

  -- And the controls, because a reader that answers everything is not a reader.
  -- A job that completed owes nothing.
  if exists (
    select 1 from public.jobs j
     where j.state = 'complete' and j.kind = 'office.instruction'
       and exists (select 1 from app.owed_a_word(j.job_id))
     limit 1
  ) then
    raise exception 'a turn that completed was reported as owing an apology';
  end if;

  /*
    A duty owes nothing, however it died - it has no inbound command, so the
    join is what excludes it rather than a list of names.

    The first draft of this control said `kind like 'office.%'`, which matches
    `office.instruction` - the kind his own messages arrive as. It failed the
    migration on the one case the function exists for. The duties are read
    from `responsibilities`, which is where the office keeps that fact.
  */
  if exists (
    select 1 from public.jobs j
     where j.state = 'failed'
       and j.kind in (select r.job_kind from public.responsibilities r)
       and exists (select 1 from app.owed_a_word(j.job_id))
     limit 1
  ) then
    raise exception 'a duty was reported as owing Grant an apology';
  end if;
end
$drive$;
