/*
  0484 — a credential Grant has to fix belongs on his list (#259).

  #259's human-action bridge, with a real source rather than an invented one:

    > An Agent Job blocked on human action may create a LINKED but SEPARATE
    > Personal Task. Example: an agent job `Integrate Google Drive` becomes
    > `BLOCKED — HUMAN ACTION REQUIRED` and creates `Authorize Google Drive`
    > for the user.

  ## Why not `blockers`

  The obvious home looked wrong the moment it was inspected. All five open
  blockers today are APPROVALS — `approval_options` is `{Go ahead, Not now}` —
  and an approval is a decision on the Governance page, not an errand. Building
  the bridge there would be a mechanism with nothing feeding it, which is the
  dial-with-no-reader defect this repository keeps finding.

  `public.connection_health` is the table that already records exactly what the
  bridge needs: a thing the office cannot do, WHO has to do it (`owner`) and
  WHAT they have to do (`action`). Two rows need him today —
  `google_calendar / oauth_client` is **dead** with `invalid_grant`, and
  `Telegram / chief bot token` is **missing** — and neither appears anywhere he
  looks. Gmail and Calendar have been returning nothing since the 17th and the
  only way to find out is to open Settings.

  ## The three narrowings, each the difference between a list and noise

  1. **Only a credential that is actually broken.** `dead` and `missing`;
     `degraded` is the office coping and `parked` is a decision.
  2. **Only one he owns.** Three rows are owned by "⏸ parked" — Groq, OpenAI,
     OpenRouter — and Grant asked for those to be left alone on 6 September. A
     chore he has already declined is the fastest way to make him stop reading
     the list.
  3. **Only when there is something to DO.** A row with no `action` is a
     status, not an errand.

  ## And it clears itself

  A chore whose credential is healthy again is finished, by the same pass that
  raised it. A to-do list that fills up and never empties is one he stops
  trusting — and this is the half that is easy to leave out, because raising is
  the visible behaviour and clearing is the one nobody sees working.
*/

/*
  The idempotency key.

  A stable name for "this chore, about this thing", so a pass that runs hourly
  raises one task rather than twenty-four a day. Not the title, which is prose
  and will be reworded; not the service alone, because one service can have
  several credentials — Telegram has a chief bot token and eight staff bots,
  and only one of them is missing.
*/
alter table public.tasks
  add column if not exists chore_key text;

comment on column public.tasks.chore_key is
  'A stable key for a task the office raised on Grant''s behalf (#259). '
  'Null for anything he typed himself.';

/*
  One OPEN chore per key. Finished ones are kept — "when did I last have to
  reconnect Google" is a question the list should be able to answer, and a
  single row whose date moves cannot.
*/
create unique index if not exists tasks_one_open_chore
  on public.tasks (chore_key)
  where chore_key is not null and state <> 'done';

create or replace function app.chores_for_credentials()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  r record;
  v_key text;
  v_raised int := 0;
  v_cleared int := 0;
  v_names text[] := '{}';
begin
  for r in
    select service, credential, state, coalesce(action, '') as action,
           coalesce(owner, '') as owner
      from public.connection_health
  loop
    v_key := format('credential:%s:%s', lower(r.service), lower(r.credential));

    if r.state in ('dead', 'missing')
       and r.action <> ''
       /*
          Not a parked one. Grant asked on 6 September for Groq, OpenAI and
          OpenRouter to be left alone, and the owner column is where that
          decision lives. A chore he has already declined is the fastest way to
          make him stop reading the list.
       */
       and r.owner not ilike '%parked%'
       and r.action not ilike 'parked%'
       and r.action not ilike 'nothing%'
    then
      insert into public.tasks
        (project_id, title, detail, state, priority, assigned_to_human,
         added_by, labels, chore_key)
      values (null,
              format('Reconnect %s — %s', r.service, r.credential),
              /*
                The office's own words for what to do, verbatim. A task that
                says "fix Google" is a task he has to go and work out; the
                action column already says where the button is.
              */
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
      /*
        Healthy again, parked, or nothing to do — so the chore is finished.

        By the same pass that raises them, because a list that fills up and
        never empties is one he stops trusting, and clearing is the half nobody
        sees working.
      */
      update public.tasks
         set state = 'done', done_at = app.now_utc(), updated_at = app.now_utc()
       where chore_key = v_key and state <> 'done';
      if found then v_cleared := v_cleared + 1; end if;
    end if;
  end loop;

  return jsonb_build_object('raised', v_raised, 'cleared', v_cleared,
                            'about', to_jsonb(v_names));
end;
$function$;

create or replace function public.chores_for_credentials()
returns jsonb
language sql
security definer
set search_path to ''
as $function$ select app.chores_for_credentials() $function$;

revoke all on function public.chores_for_credentials() from public;
grant execute on function public.chores_for_credentials() to service_role;

/*
  And something that calls it.

  CLAUDE.md's #72 in one line: a capability nothing calls is a capability Grant
  does not have, and 0473 had to add a duty for `raise_proposals` for exactly
  this reason — the function existed for weeks and every row on the Governance
  page was a suite's fixture.

  Hourly, owned by the operations director, because a dead credential is an
  operational fact and the owner column is what `responsibilities` requires.
*/
insert into public.responsibilities
  (slug, description, staff_id, job_kind, period_minutes, enabled, created_by)
select 'credential-chores',
       'Put a credential the office cannot fix on Grant''s own list, and take '
       || 'it off again when it is healthy',
       s.staff_id,
       'office.chores',
       60,
       true,
       'grant'
  from public.staff s
 where s.slug = 'operations-director'
on conflict (slug) do update
   set job_kind = excluded.job_kind,
       period_minutes = excluded.period_minutes,
       enabled = true;

-- ---------------------------------------------------------------------------
-- Drive it, in BOTH directions. Raising is the visible half and clearing is
-- the one that quietly never works.
-- ---------------------------------------------------------------------------

do $drive$
declare
  v_said jsonb;
  v_key text := 'credential:drive probe 0484:token';
  v_open int;
begin
  insert into public.connection_health
    (service, credential, state, detail, owner, action, checked_at)
  values ('Drive probe 0484', 'token', 'dead', 'refused, inside this migration',
          '✅ grant', 'Settings → somewhere on the web front end', app.now_utc());

  v_said := app.chores_for_credentials();
  select count(*) into v_open from public.tasks
   where chore_key = v_key and state <> 'done';
  if v_open <> 1 then
    raise exception '0484: a dead credential raised % chores, not 1 — %', v_open, v_said;
  end if;

  -- Twice is once. The pass runs hourly.
  perform app.chores_for_credentials();
  select count(*) into v_open from public.tasks
   where chore_key = v_key and state <> 'done';
  if v_open <> 1 then
    raise exception '0484: running it again made % open chores', v_open;
  end if;

  -- And it clears itself when the credential is healthy.
  update public.connection_health set state = 'ok'
   where service = 'Drive probe 0484' and credential = 'token';
  perform app.chores_for_credentials();
  select count(*) into v_open from public.tasks
   where chore_key = v_key and state <> 'done';
  if v_open <> 0 then
    raise exception '0484: a healthy credential left % chore(s) open', v_open;
  end if;

  raise notice '0484: raised once, not twice, and cleared itself — %', v_said;

  delete from public.tasks where chore_key = v_key;
  delete from public.connection_health
   where service = 'Drive probe 0484' and credential = 'token';
end $drive$;
