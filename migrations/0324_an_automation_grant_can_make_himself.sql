begin;

/**
 * An automation Grant can make himself.
 *
 * Issue #36, under #25, and the acceptance criterion that matters most:
 *
 *   > At least one automation can be created, edited and disabled entirely in
 *   > the UI.
 *
 * Because of this, which outranks nearly everything else in CLAUDE.md:
 *
 *   > *"I want to reduce my dependence on Claude or another coding interface
 *   > for maintaining and extending the system."*
 *
 * An automation that needs a migration written for it is not an automation he
 * has.
 *
 * ## No new table, and that is the point
 *
 * `public.responsibilities` is the automation table. It has had `project_id`,
 * `staff_id`, `job_kind`, `period_minutes`, `at_time`, `timezone` and `enabled`
 * since it was written, `app.dispatch_due_responsibilities` fires them every
 * tick, and twelve rows in it are running the office right now. What it has
 * never had is a WRITER — every one of those twelve was inserted by a
 * migration — and all twelve are global, so no project has ever had one of its
 * own.
 *
 * This is #169's rule applied to the noun "Automation" before inventing it:
 * the office already has one, and it is called a responsibility.
 *
 * ## What an automation says
 *
 * Grant's own example is *"when a document lands in this collection, have Emma
 * summarise it"*, and the shape underneath it is: **somebody, doing something,
 * on a schedule, on this project.**
 *
 * A dropdown of `job_kind` would be the easy version and the wrong one. Half
 * the kinds are plumbing — `office.prune_job_traces` is not a thing a person
 * asks for — and offering him a list of them is #64's trap in its original
 * direction: a control that claims a capability the caller cannot use. Worse,
 * a kind with no handler produces jobs that fail forever, and nothing in SQL
 * can know which kinds have handlers, because the handlers are TypeScript.
 *
 * So an automation is **a standing instruction**: the same sentence he would
 * type into Slack, addressed to one of the team, repeated on a schedule.
 * `office.instruction` is the handler that already understands every sentence
 * he types — the router reads it, picks a roster, and the work happens the way
 * it happens when he asks. There is exactly one kind to validate and it always
 * has a handler.
 *
 * Two columns make that possible: the payload the handler reads, and the
 * person it is addressed to. Both were dropped on the floor by the dispatcher,
 * which is why this migration changes it too.
 */

-- ---------------------------------------------------------------------------
-- What a duty carries
-- ---------------------------------------------------------------------------

alter table public.responsibilities
  add column if not exists pinned_config jsonb not null default '{}'::jsonb,
  add column if not exists recipient_agent text references public.staff (slug),
  add column if not exists created_by text not null default 'migration';

comment on column public.responsibilities.pinned_config is
  '#36. What the job is told, copied onto every job this duty fires. For an '
  'automation Grant wrote, this holds the instruction. Empty for the twelve '
  'duties that pre-date it, which need no payload. 0324.';
comment on column public.responsibilities.recipient_agent is
  '#36. Who the standing instruction is addressed to, when it is addressed to '
  'anyone. Null means the router chooses, exactly as it does for a sentence '
  'typed into Slack. 0324.';

-- ---------------------------------------------------------------------------
-- Carrying it through to the job
-- ---------------------------------------------------------------------------

/*
  The dispatcher, with the payload attached.

  Before this it inserted kind, project and requested_by and nothing else — so
  a duty of kind office.instruction fired a job whose handler immediately threw
  "the command carried no instruction". The capability was one column short of
  existing and looked complete.

  Everything else is unchanged, including the unique_violation branch, whose
  comment is the reason it stamps last_run_at as well.
*/
create or replace function app.dispatch_due_responsibilities()
returns table(duty_slug text, duty_kind text, outcome text, fired_job_id uuid)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  d record;
  v_job uuid;
begin
  for d in select r.*, due.idempotency_key
             from app.due_responsibilities() due
             join public.responsibilities r
               on r.responsibility_id = due.responsibility_id loop
    begin
      insert into public.jobs
        (correlation_id, project_id, idempotency_key, kind, requested_by, announce,
         pinned_config, recipient_agent)
      values
        (gen_random_uuid(), d.project_id, d.idempotency_key, d.job_kind,
         'duty:' || d.slug, true,
         coalesce(d.pinned_config, '{}'::jsonb), d.recipient_agent)
      returning job_id into v_job;

      update public.responsibilities
         set last_run_at = app.now_utc()
       where responsibility_id = d.responsibility_id;

      return query select d.slug, d.job_kind, 'fired'::text, v_job;
    exception
      when unique_violation then
        -- Stamped here too. A live job carrying this period's key exists, so
        -- the duty HAS fired this period; leaving it unstamped only buys a
        -- failed insert every tick until the period turns over.
        update public.responsibilities
           set last_run_at = app.now_utc()
         where responsibility_id = d.responsibility_id;
        return query select d.slug, d.job_kind, 'already_fired'::text, null::uuid;
    end;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reading a project's automations
-- ---------------------------------------------------------------------------

/**
 * What runs by itself on this project, in English.
 *
 * `period_minutes` is stored and "every two hours" is what a person reads, so
 * the phrasing is done here rather than in the page: two surfaces spelling a
 * schedule would eventually spell it differently, and the API is the one both
 * of them ask.
 */
create or replace function app.say_schedule(p_minutes int, p_at time, p_zone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_at is not null and p_minutes >= 10080 then 'weekly at ' || to_char(p_at, 'HH24:MI')
    when p_at is not null then 'every day at ' || to_char(p_at, 'HH24:MI')
    when p_minutes % 10080 = 0 and p_minutes >= 10080 then
      case when p_minutes = 10080 then 'once a week'
           else 'every ' || (p_minutes / 10080)::text || ' weeks' end
    when p_minutes % 1440 = 0 then
      case when p_minutes = 1440 then 'once a day'
           else 'every ' || (p_minutes / 1440)::text || ' days' end
    when p_minutes % 60 = 0 then
      case when p_minutes = 60 then 'every hour'
           else 'every ' || (p_minutes / 60)::text || ' hours' end
    else 'every ' || p_minutes::text || ' minutes'
  end
$$;

create or replace function app.project_automations(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.v order by x.at desc), '[]'::jsonb)
    from (
      select r.created_at as at, jsonb_build_object(
               'slug', r.slug,
               'what', r.description,
               -- The instruction as written, when there is one. A duty that
               -- pre-dates automations has none, and says so by being null
               -- rather than by an empty string that reads as a blank field.
               'instruction', nullif(r.pinned_config ->> 'instruction', ''),
               'who', s.name,
               'who_slug', s.slug,
               'addressed_to', r.recipient_agent,
               'when', app.say_schedule(r.period_minutes, r.at_time, r.timezone),
               'every_minutes', r.period_minutes,
               'at_time', to_char(r.at_time, 'HH24:MI'),
               'on', r.enabled,
               'last_run', r.last_run_at,
               'made_by', r.created_by,
               -- Whether Grant can edit it here. The twelve that run the
               -- office are not his to change from a project page, and a
               -- control that refuses on press is worse than one that is not
               -- drawn. See `remove_automation`.
               'mine', r.created_by <> 'migration' and r.job_kind = 'office.instruction'
             ) as v
        from public.responsibilities r
        left join public.staff s on s.staff_id = r.staff_id
       where r.project_id = p_project_id
    ) x
$$;

-- ---------------------------------------------------------------------------
-- Making one
-- ---------------------------------------------------------------------------

/**
 * Write down something that should happen by itself, from now on.
 *
 * Refuses rather than corrects, and each refusal says what to do instead: this
 * is called from a form, and a form that silently rounds "every 3 minutes" up
 * to ten teaches nothing.
 *
 * The slug is derived and made unique here rather than asked for. Grant is
 * writing a sentence, not naming a database row, and `responsibilities.slug`
 * is UNIQUE across the whole office — so a second project asking for
 * "weekly-summary" would collide with the first, which is a stranger's error
 * message for something he did nothing wrong to cause.
 */
create or replace function app.create_automation(
  p_slug text,
  p_instruction text,
  p_every_minutes int default 1440,
  p_at_time text default null,
  p_who text default null,
  p_by text default 'grant')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_project uuid;
  v_name    text;
  v_staff   uuid;
  v_what    text := btrim(coalesce(p_instruction, ''));
  v_at      time := case when btrim(coalesce(p_at_time, '')) = '' then null
                         else btrim(p_at_time)::time end;
  v_stem    text;
  v_slug    text;
  v_n       int := 1;
  v_id      uuid;
begin
  select project_id, name into v_project, v_name
    from public.projects where slug = p_slug and status <> 'archived';
  if v_project is null then
    return jsonb_build_object('ok', false, 'error', format('no active project called %s', p_slug));
  end if;

  /*
    Twenty characters, matching `responsibilities_description_substantive`.
    Checked here so the message is a sentence rather than a constraint name —
    the column still enforces it, which is what makes this a better error and
    not the only guard.
  */
  if length(v_what) < 20 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Say what should happen in a sentence — this is the instruction the team will be given.');
  end if;

  if p_who is not null and btrim(p_who) <> '' then
    select staff_id into v_staff from public.staff where slug = btrim(p_who) and active;
    if v_staff is null then
      return jsonb_build_object('ok', false, 'error', format('nobody here is called %s', p_who));
    end if;
    -- An automation addressed to somebody who is not on this project would
    -- never produce anything, and the reason would be two tables away. 0323's
    -- rule, enforced at the point the decision is made.
    if not (btrim(p_who) = any (app.staff_on_project(v_project))) then
      return jsonb_build_object(
        'ok', false,
        'error', format('%s is not on this project — put them on it first, in Team.', p_who));
    end if;
  end if;

  if p_every_minutes < 10 or p_every_minutes > 20160 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Anything from every ten minutes to once a fortnight.');
  end if;
  -- `responsibilities_one_schedule`. A time of day only means something on a
  -- period of a day or more; "every hour at 09:00" is two schedules.
  if v_at is not null and p_every_minutes < 1440 then
    return jsonb_build_object(
      'ok', false,
      'error', 'A time of day needs a daily or slower schedule.');
  end if;

  v_stem := regexp_replace(
              regexp_replace(lower(btrim(coalesce(v_name, 'project'))), '[^a-z0-9]+', '-', 'g'),
              '(^-+|-+$)', '', 'g');
  v_stem := left(coalesce(nullif(v_stem, ''), 'project'), 40) || '-auto';
  v_slug := v_stem;
  while exists (select 1 from public.responsibilities where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_stem || '-' || v_n::text;
  end loop;

  insert into public.responsibilities
    (slug, staff_id, project_id, description, job_kind, period_minutes, at_time,
     enabled, pinned_config, recipient_agent, created_by)
  values
    (v_slug, v_staff, v_project, v_what, 'office.instruction', p_every_minutes, v_at,
     true, jsonb_build_object('instruction', v_what), nullif(btrim(coalesce(p_who, '')), ''), p_by)
  returning responsibility_id into v_id;

  return jsonb_build_object(
    'ok', true, 'automation', v_slug, 'id', v_id,
    'when', app.say_schedule(p_every_minutes, v_at, 'UTC'));
end;
$$;

/**
 * Turn one on or off.
 *
 * Disabling rather than deleting is the reversible half of every control on
 * this page, and `enabled` has existed for it since the table was written.
 */
create or replace function app.set_automation(p_automation text, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_kind text; v_by text;
begin
  select job_kind, created_by into v_kind, v_by
    from public.responsibilities where slug = p_automation;
  if v_kind is null then
    return jsonb_build_object('ok', false, 'error', format('no automation called %s', p_automation));
  end if;

  update public.responsibilities
     set enabled = p_on, updated_at = app.now_utc()
   where slug = p_automation;

  return jsonb_build_object('ok', true, 'automation', p_automation, 'on', p_on);
end;
$$;

/**
 * Remove one.
 *
 * Only one Grant made. The twelve that run the office — the backup, the
 * rotation, the morning briefing — are inserted by migrations and are not his
 * to delete from a project page: deleting the nightly backup from a settings
 * sheet is exactly the destructive action CLAUDE.md says to check first, and
 * the check that works is not offering it.
 *
 * A refusal, not a silent no-op, so the page can say why.
 */
create or replace function app.remove_automation(p_automation text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_by text; v_kind text; v_what text;
begin
  select created_by, job_kind, description into v_by, v_kind, v_what
    from public.responsibilities where slug = p_automation;
  if v_by is null then
    return jsonb_build_object('ok', false, 'error', format('no automation called %s', p_automation));
  end if;
  if v_by = 'migration' then
    return jsonb_build_object(
      'ok', false, 'refused', true,
      'error', 'That one runs the office rather than this project. Switch it off in Settings if you need it quiet.');
  end if;

  delete from public.responsibilities where slug = p_automation;
  return jsonb_build_object('ok', true, 'removed', p_automation, 'what', v_what);
end;
$$;

-- ---------------------------------------------------------------------------
-- Public wrappers
-- ---------------------------------------------------------------------------

create or replace function public.project_automations(p_project_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.project_automations(p_project_id) $$;

create or replace function public.create_automation(
  p_slug text, p_instruction text, p_every_minutes int default 1440,
  p_at_time text default null, p_who text default null, p_by text default 'grant')
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.create_automation(p_slug, p_instruction, p_every_minutes, p_at_time, p_who, p_by) $$;

create or replace function public.set_automation(p_automation text, p_on boolean)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.set_automation(p_automation, p_on) $$;

create or replace function public.remove_automation(p_automation text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.remove_automation(p_automation) $$;

grant execute on function app.say_schedule(int, time, text) to ai_team_app;
grant execute on function app.project_automations(uuid) to ai_team_app;
grant execute on function public.project_automations(uuid) to ai_team_app;
grant execute on function app.create_automation(text, text, int, text, text, text) to ai_team_app;
grant execute on function public.create_automation(text, text, int, text, text, text) to ai_team_app;
grant execute on function app.set_automation(text, boolean) to ai_team_app;
grant execute on function public.set_automation(text, boolean) to ai_team_app;
grant execute on function app.remove_automation(text) to ai_team_app;
grant execute on function public.remove_automation(text) to ai_team_app;

commit;
