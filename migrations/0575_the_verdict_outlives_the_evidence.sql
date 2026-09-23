/*
  A third of what the office calls his conversation is a job whose origin a
  suite deleted.

  Measured after 0574: of 206 `office.instruction` jobs `app.harness_job`
  counts as real and that carry a `command_id`, **138 still have their inbound
  row and 68 do not**. Across all kinds it is 1,189 jobs with a deleted origin,
  68 of them counted as real, the newest today.

  Only SUITE TEARDOWNS delete `public.inbound_commands`. There is no product
  path, no retention sweep and no SQL function that does - every deleter is in
  `scripts/verify/` or `scripts/poc/`, removing rows by origin_ref prefix or by
  project. And a job can never be deleted, so what survives is a job with no
  evidence of who it belonged to, counted as Grant's for ever.

  0574 taught `app.harness_job` to read the suite's own signature in
  `inbound_commands.dedupe_key`. This is the case where that signature is
  destroyed a moment later.

  ## Preserve the EVIDENCE at the moment it goes - not the verdict

  The first draft of this migration stamped `jobs.synthetic` and was refused:

      synthetic is decided when the work is created and cannot be changed
      (f -> t). The defect this refuses is a suite rewriting its attribution
      around a send.

  That rule is right and outranks this fix. A suite that can flip its own
  attribution after the fact is how an escape gets laundered.

  So this copies the EVIDENCE rather than a verdict: the dedupe namespace goes
  into the job's `pinned_config`, and `app.harness_job` derives from it exactly
  as it derives from the inbound row while that row still exists. Nothing is
  decided here that was not already true.

  The inverse of 0310's rule. That one says do not store a fact you can
  already read; here the fact becomes unreadable, so it has to be stored - and
  the one moment it is still legible is the DELETE itself.

  Nothing widens: a command that is not suite-signed leaves its jobs exactly as
  they were, so a real message deleted by mistake keeps its real attribution.
  It can only ever move a job from "counted as his" to "counted as harness",
  which is the direction that cannot cost him a delivery he was waiting for -
  because by the time an inbound row is being deleted, the turn is long over.

  The 68 already stranded cannot be recovered: the evidence is gone, and
  guessing would be the fabrication this office exists not to do. They are
  counted and named by `npm run check:leaks` instead, and this trigger is what
  stops the number growing.
*/

create or replace function app.remember_a_deleted_origin()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if coalesce(old.synthetic, false)
     or split_part(coalesce(old.dedupe_key, ''), ':', 1) = 'verify' then
    /*
      The namespace, not a verdict. `harness_job` reads it the same way it
      reads the inbound row, so nothing is decided here - the evidence simply
      survives the row that carried it.
    */
    update public.jobs j
       set pinned_config = coalesce(j.pinned_config, '{}'::jsonb)
             || jsonb_build_object('origin_namespace',
                                   split_part(coalesce(old.dedupe_key, ''), ':', 1))
     where j.pinned_config ->> 'command_id' = old.command_id::text
       and j.pinned_config ->> 'origin_namespace' is null;
  end if;
  return old;
end
$function$;

comment on function app.remember_a_deleted_origin() is
  'A suite teardown deletes the inbound command and the job outlives it. This '
  'copies the dedupe NAMESPACE onto the job while it is still legible. Not a '
  'verdict: jobs.synthetic is immutable on purpose, so a suite cannot rewrite '
  'its own attribution around a send.';

drop trigger if exists inbound_commands_remember_origin on public.inbound_commands;
create trigger inbound_commands_remember_origin
  before delete on public.inbound_commands
  for each row execute function app.remember_a_deleted_origin();


/*
  And `app.harness_job` reads the surviving namespace, exactly as it reads the
  inbound row. One more true-signal, never a false one: a job can only ever
  become MORE harness this way, so the asymmetry 0574 relies on is unchanged.
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
              or (j.pinned_config ->> 'origin_namespace') = 'verify'
              or exists (
                   select 1 from public.inbound_commands c
                    where c.command_id = (j.pinned_config ->> 'command_id')::uuid
                      and split_part(c.dedupe_key, ':', 1) = 'verify')
       from public.jobs j
       left join public.projects p on p.project_id = j.project_id
      where j.job_id = p_job_id),
    false)
$function$;

/*
  DRIVE IT, and say what could not be driven.

  A NEGATIVE CONTROL CANNOT BE BUILT HERE, and that is the product being
  right. `app.stamp_synthetic_inbound` denies by default - *"anything that did
  not come through a production door is synthetic, whatever it calls itself"* -
  so every command this block can insert is synthetic before the trigger under
  test ever sees it. The first draft asserted on a hand-made "real" command and
  failed with A REAL TURN WAS STAMPED, which was the fixture being wrong rather
  than the trigger.

  What CAN be built is the mis-scoped-update control, which is the realistic
  way a trigger like this goes wrong: deleting one command must not stamp a
  job that belongs to another. That is asserted below.

  The direction argument covers the rest. The stamp only ever adds a
  true-signal to `harness_job`, so it can move a job from "his" to "harness"
  and never back; and by the time an inbound row is being deleted the turn is
  long over, so it cannot cost him an answer he is waiting for.
*/
do $drive$
declare
  v_suite_cmd uuid;
  v_other_cmd uuid;
  v_suite_job uuid;
  v_other_job uuid;
begin
  /*
    A SUBTRANSACTION, so the fixtures roll back and the trigger does not.

    The first version raised at the end to undo its own rows and took the DDL
    above with it - the migration applied nothing and reported success on the
    marker. A job can never be deleted, so leaving the fixtures behind was not
    an option either: they would be two permanent `telegram:grant` jobs, which
    is precisely the contamination this migration exists to stop.
  */
  begin
  insert into public.inbound_commands (origin_channel, origin_ref, actor, subject, instruction, dedupe_key)
  values ('telegram', '9990099:1', 'verify-origin', 'verify-origin', 'a suite turn', 'verify:origin:drive')
  returning command_id into v_suite_cmd;
  insert into public.inbound_commands (origin_channel, origin_ref, actor, subject, instruction, dedupe_key)
  values ('telegram', '9990099:2', 'verify-origin', 'verify-origin', 'a bystander', 'verify:origin:other')
  returning command_id into v_other_cmd;

  insert into public.jobs (kind, requested_by, state, pinned_config, correlation_id, idempotency_key)
  values ('office.instruction', 'telegram:grant', 'queued',
          jsonb_build_object('command_id', v_suite_cmd), gen_random_uuid(), 'origin-drive-suite')
  returning job_id into v_suite_job;
  insert into public.jobs (kind, requested_by, state, pinned_config, correlation_id, idempotency_key)
  values ('office.instruction', 'telegram:grant', 'queued',
          jsonb_build_object('command_id', v_other_cmd), gen_random_uuid(), 'origin-drive-other')
  returning job_id into v_other_job;

  -- Delete ONE of them.
  delete from public.inbound_commands where command_id = v_suite_cmd;

  if (select pinned_config ->> 'origin_namespace' from public.jobs where job_id = v_suite_job)
       is distinct from 'verify' then
    raise exception 'a suite-signed origin was deleted and the job kept no trace of it';
  end if;
  if not app.harness_job(v_suite_job) then
    raise exception 'the job is still counted as his after its suite origin was deleted';
  end if;

  -- CONTROL: the bystander, whose own command is untouched, was not stamped.
  if (select pinned_config ->> 'origin_namespace' from public.jobs where job_id = v_other_job)
       is not null then
    raise exception 'DELETING ONE COMMAND STAMPED ANOTHER COMMAND''S JOB';
  end if;

    raise exception 'rollback-the-fixtures';
  exception
    when others then
      if sqlerrm <> 'rollback-the-fixtures' then
        raise;
      end if;
  end;
end
$drive$;
