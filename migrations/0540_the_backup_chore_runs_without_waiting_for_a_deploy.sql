-- 0540 — The backup chore runs tonight, not after a merge
--
-- 0537 built `app.chores_for_backups()`: it raises a chore on My Tasks when
-- there is no recent FINISHED backup or no recently PROVEN restore, and
-- clears it in the same pass. Driven, controlled, and correct.
--
-- And it was not running, because the thing that calls it is a TypeScript
-- handler on an unmerged branch. CLAUDE.md's rule states the gap exactly:
--
--     A migration is not a deploy.
--
-- It cost this repository a day once already — 0283 taught `syncNotion` to
-- skip Notion containers and deleted the three that existed, and fifteen
-- minutes later the duty put all three back, because the deployed worker had
-- been built before 0283.
--
-- ## Why the worker is not simply deployed
--
-- Because it is not this workstream's to deploy. `worker` was redeployed at
-- 19:16 on 21 September by the parallel session, from a branch carrying 54
-- files this one has never seen. Deploying it from here would publish this
-- branch's `src/` over theirs and silently roll their work back — which is
-- the one thing the deployment policy for a parallel run forbids by name.
--
-- So the choice is between a feature that works and is not running, and a
-- database-only change that makes it run tonight. The second is obviously
-- better for Grant, and it is reversible in one statement.
--
-- ## The delegation, and why double-calling is safe
--
-- `office.chores` is deployed and calls `app.chores_for_credentials()` every
-- hour. That function now finishes by calling the backup pass, which is
-- 0472's shape: the second door DELEGATES rather than restating the rule, so
-- a future change to what a backup chore means cannot land in one and not the
-- other.
--
-- When the handler change merges, the backup pass will be called twice in one
-- pass. That is harmless and it is harmless BY CONSTRUCTION rather than by
-- luck: raising is `on conflict do nothing` on `chore_key`, and clearing is
-- an idempotent update of rows already `done`. The second call reports zero
-- raised and zero cleared. This is asserted in `verify:backups` — the drive
-- runs the pass twice and requires exactly one open chore.
--
-- ## What it must not do
--
-- Break the credential pass. A backup reading that throws must not stop Grant
-- being told about a dead credential, so the call is wrapped and its failure
-- is returned in the result rather than raised. Silence is not an option
-- either: an unreported backup check looks exactly like a backup that is
-- fine, which is the whole defect 0535 and 0537 exist for.

begin;

create or replace function app.chores_for_credentials()
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  r record;
  v_key text;
  v_raised int := 0;
  v_cleared int := 0;
  v_names text[] := '{}';
  v_backup jsonb;
begin
  for r in
    select service, credential, state, coalesce(action, '') as action,
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
        (project_id, title, detail, state, priority, assigned_to_human,
         added_by, labels, chore_key)
      values (null,
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
       where chore_key = v_key and state <> 'done';
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

comment on function app.chores_for_credentials() is
  'Raise and clear the chores a person has to act on: a dead credential, and '
  '(0540) the backup, by delegating to app.chores_for_backups. The delegation '
  'is here because office.chores is deployed and calls this function by name, '
  'while the handler that should call the backup pass directly is on an '
  'unmerged branch — a migration is not a deploy.';

commit;
