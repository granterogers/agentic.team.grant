-- 0537 — The operational reading can see the backup, and the restore is recorded
--
-- `app.office_health()` reports finished, failed, in-flight, stalled, waiting,
-- open provider breakers and budget holds. It has no idea whether a backup
-- exists.
--
-- So on 17 September, when the nightly backup died and there was no copy of
-- the database from that date, the health reading said this:
--
--     failed: 1, stalled: 0, waiting: 0
--
-- and the next day, with the 17th still missing for ever, it said this:
--
--     failed: 0, stalled: 0, waiting: 0
--
-- which is what it says now, and what it would say tonight if backups
-- stopped altogether. `failing_kinds` carried it for exactly 24 hours in a
-- reading nobody was watching, and then the window moved.
--
-- The brief this run works from forbids the equivalences by name, and two of
-- them are the whole of this migration:
--
--     backup file exists  =  recovery works      -- NO
--     cron fired          =  queue progressed    -- NO
--
-- ## What counts as a backup
--
-- Not "an object appeared in the bucket". `src/backup/portable.ts` writes one
-- object per table and the MANIFEST LAST — measured, not assumed: on every
-- one of the four per-table runs the manifest's timestamp is the last but one
-- and only its own checksum follows it. So a run folder containing a manifest
-- is a run that FINISHED, and a folder without one is a partial upload that
-- would restore short. The reading distinguishes them, because a partial
-- backup that counts as a backup is worse than no reading at all.
--
-- ## What counts as a proven restore
--
-- Invariant 13 of the brief: *backup health requires a recent backup AND a
-- proven restore.* Half of it was unmeasurable — `npm run backup:rehearse`
-- exists, is honest about what it proves, and **records nothing anywhere**, so
-- "when did a restore last work" had no answer at all.
--
-- It does not get a new table. `public.events` is the office's own ledger of
-- what it DID, 4,300 rows of it, and a rehearsal outcome is exactly that;
-- CLAUDE.md's rule against storing a fact you can already read applies to the
-- shape as well as the value. `action_type` is free text in the same dotted
-- vocabulary as `tool.granted` and `office.learned`, so `backup.rehearsed` is
-- a word the ledger already knows how to hold.
--
-- ## How Grant finds out
--
-- A CHORE, not a message. 0484's `app.chores_for_credentials` already solved
-- this problem and its reasoning is the reasoning here: the chore lands on My
-- Tasks, which is where he reads a list of things to do, and `chore_key` plus
-- `on conflict do nothing` means one row rather than one message an hour.
-- That is invariant 18 — persistent incidents dedupe rather than alert-storm —
-- satisfied by construction rather than by a cooldown somebody has to tune.
--
-- And it CLEARS in the same pass, for 0484's stated reason: a list that fills
-- up and never empties is one he stops trusting, and clearing is the half
-- nobody sees working.
--
-- ## The gap this reading states rather than hides
--
-- The backup lives in a private bucket **in the same Supabase project it
-- protects**. `src/handlers/backup.ts` says so in its header and says why —
-- anywhere else is a new vendor account or Grant's whole database emailed to
-- himself, and both are his decision. So `offsite` is reported as false with
-- the reason attached, every time, rather than being absent and inferred.

begin;

insert into public.system_config (key, value, description)
values
  ('backup.max_age_hours', '36'::jsonb,
   'How old the newest FINISHED backup may be before the office raises a '
   'chore. The duty is daily, so 36 hours tolerates one missed night '
   'without crying wolf and notices two.'),
  ('backup.rehearsal_max_age_hours', '192'::jsonb,
   'How long a proven restore stays proof. Eight days, so a weekly rehearsal '
   'has a day of slack. A backup nobody has restored from is a hope, not a '
   'backup (invariant 13).')
on conflict (key) do nothing;

-- ── The verdict of a restore rehearsal, into the ledger the office already has

create or replace function app.record_rehearsal(
  p_outcome text,
  p_detail  jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_event uuid;
begin
  if p_outcome not in ('passed', 'failed') then
    raise exception 'a rehearsal either passed or failed, not %', p_outcome;
  end if;

  select public.append_event(
    extensions.gen_random_uuid(),
    'system', 'backup:rehearse', 'restore_rehearsal',
    'backup.rehearsed',
    -- Nothing to undo: it restores into a scratch schema and drops it.
    false,
    null, null,
    jsonb_build_object('outcome', p_outcome) || coalesce(p_detail, '{}'::jsonb),
    format('A restore rehearsal %s.', p_outcome),
    '[]'::jsonb, null, null, null, null, null, null
  ) into v_event;

  return v_event;
end;
$fn$;

revoke all on function app.record_rehearsal(text, jsonb) from public;
grant execute on function app.record_rehearsal(text, jsonb) to service_role;

comment on function app.record_rehearsal(text, jsonb) is
  'Record that a restore rehearsal passed or failed. Into public.events as '
  'backup.rehearsed rather than a new table, because the ledger of what the '
  'office did is exactly what this is. Before 0537 the rehearsal recorded '
  'nothing and "when did a restore last work" had no answer.';

-- ── The reading

create or replace function app.backup_health()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  with finished as (
    -- A run that got as far as writing its manifest. See the header: the
    -- manifest is written last, so its presence is what "complete" means.
    select split_part(o.name, '/', 1) as run, max(o.created_at) as at
      from storage.objects o
     where o.bucket_id = 'backups'
       and o.name like '%manifest.json.gz'
     group by 1
  ),
  partial as (
    -- Objects with no manifest beside them: an upload that stopped halfway.
    -- Counted rather than ignored, because it looks exactly like a backup
    -- from the outside and would restore short.
    select count(*) as n
      from (select split_part(o.name, '/', 1) as run
              from storage.objects o
             where o.bucket_id = 'backups' and o.name like 'run-%'
             group by 1) r
     where not exists (select 1 from finished f where f.run = r.run)
  ),
  newest as (select run, at from finished order by at desc limit 1),
  sized as (
    select count(*) as objects, coalesce(sum((o.metadata->>'size')::bigint), 0) as bytes
      from storage.objects o, newest n
     where o.bucket_id = 'backups' and o.name like n.run || '/%'
  ),
  rehearsal as (
    select e.occurred_at as at, e.after_state->>'outcome' as outcome
      from public.events e
     where e.action_type = 'backup.rehearsed'
     order by e.occurred_at desc
     limit 1
  ),
  passed as (
    select max(e.occurred_at) as at
      from public.events e
     where e.action_type = 'backup.rehearsed'
       and e.after_state->>'outcome' = 'passed'
  ),
  limits as (
    select
      coalesce((select value::text::numeric from public.system_config
                 where key = 'backup.max_age_hours'), 36) as backup_h,
      coalesce((select value::text::numeric from public.system_config
                 where key = 'backup.rehearsal_max_age_hours'), 192) as rehearsal_h
  )
  select jsonb_build_object(
    'newest_backup_at', (select at from newest),
    'newest_backup_age_hours', (
      select round(extract(epoch from (app.now_utc() - at)) / 3600.0, 1) from newest),
    'newest_backup_objects', (select objects from sized),
    'newest_backup_bytes', (select bytes from sized),
    'finished_backups_kept', (select count(*) from finished),
    'partial_uploads', (select n from partial),
    'backup_overdue', (
      select (select at from newest) is null
          or extract(epoch from (app.now_utc() - (select at from newest))) / 3600.0
             > (select backup_h from limits)),
    'last_rehearsal_at', (select at from rehearsal),
    'last_rehearsal_outcome', (select outcome from rehearsal),
    'last_passing_rehearsal_at', (select at from passed),
    'last_passing_rehearsal_age_hours', (
      select round(extract(epoch from (app.now_utc() - at)) / 3600.0, 1) from passed),
    'rehearsal_overdue', (
      select (select at from passed) is null
          or extract(epoch from (app.now_utc() - (select at from passed))) / 3600.0
             > (select rehearsal_h from limits)),
    'thresholds', jsonb_build_object(
      'backup_max_age_hours', (select backup_h from limits),
      'rehearsal_max_age_hours', (select rehearsal_h from limits)),
    -- Stated every time rather than left to be discovered during a restore.
    'offsite', false,
    'offsite_note',
      'The only copy is a private bucket in the same Supabase project it '
      'protects. It survives losing the code, this machine and every other '
      'vendor account; it does not survive losing the project. Sending it '
      'elsewhere needs a new vendor account or the whole database emailed, '
      'and that is Grant''s decision.',
    -- The other half of RTO, and the one nothing measured: the dump excludes
    -- the vault, so a restore today produces a working database with no
    -- credentials in it at all.
    'vault_exported', (
      select coalesce((select true from public.responsibilities r
                        where r.job_kind = 'office.vault_export' and r.enabled
                          and r.last_run_at is not null limit 1), false))
  )
$fn$;

revoke all on function app.backup_health() from public;
grant execute on function app.backup_health() to service_role, authenticated;

comment on function app.backup_health() is
  'Whether there is a recent FINISHED backup and a recently PROVEN restore — '
  'invariant 13, both halves. A manifest is what makes a run complete; a '
  'backup.rehearsed event is what makes a restore proven. States the offsite '
  'gap and the empty-vault gap rather than leaving them to a real recovery.';

-- ── Did useful work actually move? The historical failure's own lesson.

create or replace function app.last_progress()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    -- Not "did the heartbeat fire". app.kick_worker() returns null silently
    -- when its secret is missing and cron records `succeeded, 1 row` either
    -- way, so the cron log cannot answer this and never could.
    'last_dequeue_at', (
      select max(t.occurred_at) from public.job_state_transitions t
       where t.to_state = 'running'),
    'last_completion_at', (
      select max(t.occurred_at) from public.job_state_transitions t
       where t.to_state = 'complete'),
    'last_delivery_at', (select max(d.sent_at) from public.deliveries d
                          where d.state = 'sent'),
    'minutes_since_dequeue', (
      select round(extract(epoch from (app.now_utc() - max(t.occurred_at))) / 60.0)
        from public.job_state_transitions t where t.to_state = 'running'),
    'minutes_since_completion', (
      select round(extract(epoch from (app.now_utc() - max(t.occurred_at))) / 60.0)
        from public.job_state_transitions t where t.to_state = 'complete'),
    -- A queue with nothing in it and no recent completion is IDLE, not stuck,
    -- and the difference is the whole reason this is reported beside the
    -- waiting count rather than instead of it.
    'runnable_now', (
      select count(*) from public.jobs j
       where j.state in ('queued', 'retrying')
         and not app.harness_job(j.job_id))
  )
$fn$;

revoke all on function app.last_progress() from public;
grant execute on function app.last_progress() to service_role, authenticated;

comment on function app.last_progress() is
  'When work last actually MOVED — dequeued, completed, delivered — beside '
  'how much is runnable now. A green heartbeat is not progress: the whole '
  'fifteen-hour outage happened while cron logged 1,440 successes.';

-- ── And the chore, so it reaches a person

create or replace function app.chores_for_backups()
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $fn$
declare
  h jsonb;
  v_raised int := 0;
  v_cleared int := 0;
  v_about text[] := '{}';

  -- One helper, two chores. Written as a loop over a literal list so the two
  -- cases cannot drift apart — an offer and its press in two places is how
  -- they came to differ everywhere else in this repository.
  r record;
begin
  h := app.backup_health();

  for r in
    select * from (values
      ('backup:stale', (h->>'backup_overdue')::boolean,
       'Check why the nightly backup has not finished',
       format('The newest finished backup is %s hours old and the office '
              'expects one every %s. Look at the last office.backup job: '
              'npm run q -- "select state, attempt, max_attempts, state_reason '
              'from public.jobs where kind = ''office.backup'' order by '
              'created_at desc limit 3". A backup that is not happening is '
              'the one failure nothing else in the office can compensate for.',
              coalesce(h->>'newest_backup_age_hours', 'an unknown number of'),
              h->>'backup_max_age_hours')),
      ('backup:unproven', (h->>'rehearsal_overdue')::boolean,
       'Prove the backup can still be restored',
       format('The last restore rehearsal that passed was %s. A backup '
              'nobody has restored from is a hope rather than a backup. Run '
              'npm run backup:rehearse — it restores the newest archive into '
              'a scratch schema, checks it, and drops it, and it now records '
              'the verdict so this chore clears itself.',
              coalesce(h->>'last_passing_rehearsal_at', 'never')))
    ) as v(chore_key, broken, title, detail)
  loop
    if r.broken then
      insert into public.tasks
        (project_id, title, detail, state, priority, assigned_to_human,
         added_by, labels, chore_key)
      values (null, r.title, left(r.detail, 2000), 'todo', 20, true,
              'the office', array['backup'], r.chore_key)
      on conflict do nothing;
      if found then
        v_raised := v_raised + 1;
        v_about := v_about || r.chore_key;
      end if;
    else
      update public.tasks
         set state = 'done', done_at = app.now_utc(), updated_at = app.now_utc()
       where chore_key = r.chore_key and state <> 'done';
      if found then v_cleared := v_cleared + 1; end if;
    end if;
  end loop;

  return jsonb_build_object('raised', v_raised, 'cleared', v_cleared,
                            'about', to_jsonb(v_about));
end;
$fn$;

revoke all on function app.chores_for_backups() from public;
grant execute on function app.chores_for_backups() to service_role;

comment on function app.chores_for_backups() is
  'Raise a chore on My Tasks when there is no recent finished backup or no '
  'recently proven restore, and clear it in the same pass when there is. '
  'A chore rather than a message, for 0484''s reason: chore_key dedupes to '
  'one row instead of one message an hour, which is invariant 18 by '
  'construction.';

commit;
