-- 0682 - the task writers that were not reached by a person say whose list they write to (multi-user P3, wave 2).
--
-- Four writers put rows in `tasks` without being handed an office, and relied on the compatibility bridge to guess:
--   * blocker_makes_a_task    a question that stops a job becomes a to-do: it is the BLOCKER's office's to-do;
--   * tasks_repeat_on_done    the next occurrence of a repeating task is the same office's;
--   * chores_for_credentials  a dead credential becomes a chore on the list of the office whose credential it is;
--   * chores_for_backups      a backup chore is the deployment OPERATOR's - one per operator office, never a guess.
-- And an open chore is unique within an office, not across them.

drop index public.tasks_one_open_chore;
create unique index tasks_one_open_chore on public.tasks (office_id, chore_key)
  where chore_key is not null and state <> 'done';

-- The offices of the deployment's operators: whose list a deployment-level chore belongs on.
create function app.operator_offices()
returns setof uuid
language sql
stable
security definer
set search_path to ''
as $f$
  select distinct o.office_id
    from public.deployment_operators d
    join public.office_members m on m.owner_key = d.owner_key and m.kind = 'person'
    join auth.users u on lower(u.email) = lower(m.email)
    join public.offices o on o.auth_user_id = u.id and o.state = 'active' and o.kind = 'person'
$f$;
revoke all on function app.operator_offices() from public, anon, authenticated, service_role;

create or replace function app.blocker_makes_a_task()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_answer text;
begin
  /*
    Only a blocker that actually STOPS the job. A blocker raised while work
    continues is a question, and a question belongs on the Governance page
    rather than on a to-do list -- putting every one of them on his list is
    how a list stops being read.
  */
  if new.work_can_continue then return new; end if;
  if new.job_id is null then return new; end if;

  v_answer := new.approval_options[1];
  if v_answer is null then return new; end if;

  insert into public.tasks
    (office_id, project_id, title, detail, state, assigned_to_human, job_id,
     satisfies_blocker, satisfies_answer, added_by, priority)
  values
    (new.office_id, new.project_id,
     new.requested_action,
     /*
       The task says WHY, because a task called "Authorize Google Drive" with
       no context is one he will look at in a week and not know the cost of
       leaving. The blockers own words, not a summary of them.
     */
     new.why_needed ||
       case when coalesce(new.consequences_of_delay, '') = '' then ''
            else ' If it waits: ' || new.consequences_of_delay end,
     'todo', true, new.job_id,
     new.blocker_id, v_answer,
     coalesce(new.originating_agent, 'the office'),
     2)
  on conflict do nothing;
  return new;
end;
$function$;

create or replace function app.tasks_repeat_on_done()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_due date; v_remind timestamptz;
begin
  if new.state <> 'done' or coalesce(old.state, '') = 'done' then return new; end if;
  if new.repeat_every is null then return new; end if;

  -- `due` keeps the schedule; `done` starts the clock again now. Both from the
  -- anchor the row already has, so a task finished late does not silently
  -- reschedule itself into the past.
  v_due := case
             when new.repeat_from = 'done'
               then ((app.now_utc() + new.repeat_every) at time zone 'UTC')::date
             else new.due_on + new.repeat_every
           end;
  -- A schedule that has fallen behind catches up rather than creating a
  -- backlog of one occurrence per missed period.
  while v_due < (app.now_utc() at time zone 'UTC')::date loop
    v_due := v_due + new.repeat_every;
  end loop;

  v_remind := case
                when new.remind_at is null or new.due_on is null then null
                -- `date - date` is an INTEGER of days, and timestamptz plus
                -- integer is not an operator. The reminder keeps its distance
                -- from the due date, so it has to be days as an interval.
                else new.remind_at + ((v_due - new.due_on) * interval '1 day')
              end;

  insert into public.tasks
    (office_id, project_id, title, detail, state, priority, due_on, remind_at,
     assigned_to_human, added_by, labels, repeat_every, repeat_from, parent_task_id)
  values (new.office_id, new.project_id, new.title, new.detail, 'todo', new.priority, v_due, v_remind,
          new.assigned_to_human, new.added_by, new.labels,
          new.repeat_every, new.repeat_from, new.parent_task_id);

  -- The finished one stops repeating, or every completion makes another.
  update public.tasks set repeat_every = null, repeat_from = null
   where task_id = new.task_id and office_id = new.office_id;
  return new;
end;
$function$;

create or replace function app.chores_for_credentials()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  r record;
  v_key text;
  v_raised int := 0;
  v_cleared int := 0;
  v_names text[] := '{}';
  v_backup jsonb;
begin
  for r in
    select office_id, service, credential, state, coalesce(action, '') as action,
           coalesce(owner, '') as owner
      from public.connection_health
  loop
    v_key := format('credential:%s:%s', lower(r.service), lower(r.credential));

    if r.state in ('dead', 'missing')
       and r.action <> ''
       -- Not a parked one. Grant asked on 6 September for Groq, OpenAI and
       -- OpenRouter to be left alone, and the owner column is where that
       -- decision lives. A chore he has already declined is the fastest way
       -- to make him stop reading the list.
       and r.owner not ilike '%parked%'
       and r.action not ilike 'parked%'
       and r.action not ilike 'nothing%'
    then
      insert into public.tasks
        (office_id, project_id, title, detail, state, priority, assigned_to_human,
         added_by, labels, chore_key)
      values (r.office_id, null,
              format('Reconnect %s — %s', r.service, r.credential),
              -- The office's own words for what to do, verbatim. A task that
              -- says "fix Google" is a task he has to go and work out; the
              -- action column already says where the button is.
              format('%s. The office cannot do this itself: %s.',
                     r.action, case r.state when 'dead' then 'the credential is refused'
                                            else 'it is not there' end),
              'todo', 20, true, 'the office', array['credential'], v_key)
      on conflict do nothing;
      if found then
        v_raised := v_raised + 1;
        v_names := v_names || format('%s / %s', r.service, r.credential);
      end if;
    else
      -- Healthy again, parked, or nothing to do — so the chore is finished.
      -- By the same pass that raises them, because a list that fills up and
      -- never empties is one he stops trusting, and clearing is the half
      -- nobody sees working.
      update public.tasks
         set state = 'done', done_at = app.now_utc(), updated_at = app.now_utc()
       where office_id = r.office_id and chore_key = v_key and state <> 'done';
      if found then v_cleared := v_cleared + 1; end if;
    end if;
  end loop;

  -- 0540. The backup pass, from the door that is actually deployed. See the
  -- header: the handler that should call it is on an unmerged branch, and a
  -- feature that works and is not running is worth nothing tonight.
  begin
    v_backup := app.chores_for_backups();
  exception when others then
    -- Never fatal and never silent. A dead credential must still reach him if
    -- the backup reading throws, and an unreported backup check looks exactly
    -- like a backup that is fine.
    v_backup := jsonb_build_object('error', left(sqlerrm, 200));
  end;

  return jsonb_build_object('raised', v_raised, 'cleared', v_cleared,
                            'about', to_jsonb(v_names),
                            'backup', v_backup);
end;
$function$;

create or replace function app.chores_for_backups()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  h jsonb;
  v_raised int := 0;
  v_cleared int := 0;
  v_about text[] := '{}';

  -- One helper, two chores. Written as a loop over a literal list so the two
  -- cases cannot drift apart — an offer and its press in two places is how
  -- they came to differ everywhere else in this repository.
  r record;
  o uuid;
begin
  h := app.backup_health();
  -- A deployment-level chore belongs on the list of each operator's office.
  for o in select * from app.operator_offices() loop

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
        (office_id, project_id, title, detail, state, priority, assigned_to_human,
         added_by, labels, chore_key)
      values (o, null, r.title, left(r.detail, 2000), 'todo', 20, true,
              'the office', array['backup'], r.chore_key)
      on conflict do nothing;
      if found then
        v_raised := v_raised + 1;
        v_about := v_about || r.chore_key;
      end if;
    else
      update public.tasks
         set state = 'done', done_at = app.now_utc(), updated_at = app.now_utc()
       where office_id = o and chore_key = r.chore_key and state <> 'done';
      if found then v_cleared := v_cleared + 1; end if;
    end if;
  end loop;
  end loop;

  return jsonb_build_object('raised', v_raised, 'cleared', v_cleared,
                            'about', to_jsonb(v_about));
end;
$function$;
