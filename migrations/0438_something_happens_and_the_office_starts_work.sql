-- One way for an event to start governed work (#264).
--
-- The office already has schedules, duties, inbound commands, Slack and
-- Telegram ingress, and Gmail and Calendar polling. What it has no word for is
-- the shape those all share:
--
--   WHEN x happens FROM s IF c THEN make job j FOR project p
--   SUBJECT TO dedupe, cooldown, rate limit, approval.
--
-- Without that, every new source is bespoke logic, and the fifth one is where
-- somebody forgets the dedupe.
--
-- ## `signals`, not `events`, and the difference is the whole reason
--
-- `public.events` already exists and holds 2,641 rows: the append-only ledger
-- of what the OFFICE DID, with an actor, an action type and a before and after
-- state. What this needs is the opposite direction -- what happened TO the
-- office, before it has done anything about it.
--
-- The first draft of this migration called its table `events`, and
-- `create table if not exists` silently did nothing: it applied against the
-- existing table and failed on the first missing column. That is the cheap
-- version of the expensive mistake, which would have been widening the ledger
-- until "who did this" had no answer.
--
-- ## Three tables, and the middle one is the point
--
--   `signals`         -- what happened, normalised, deduplicated
--   `event_triggers`  -- what the office should do about it
--   `trigger_firings` -- what it actually did, INCLUDING what it declined
--
-- The firings table records refusals as well as jobs, which is the difference
-- between a trigger somebody can debug and one that mysteriously does nothing.
-- "Cooled down", "rate limited", "would have looped" are answers; silence is
-- not.
--
-- ## Adapters translate; this decides
--
-- §5, and it is the reason `record_event` takes a normalised record and
-- nothing else. An adapter turns a webhook into a row. It does not choose an
-- agent, skip an approval or decide a consequence -- every one of those is
-- below, in SQL, where it can be read.
--
-- ## The storm rules, each for a failure that actually happens
--
--   duplicate delivery   -- unique (source, external_ref); a second POST of
--                           the same webhook is the same event
--   provider retry       -- same
--   polling twice        -- same, because the external ref is the provider's
--   a burst of a hundred -- max_per_hour, counted from the firings
--   two in a second      -- debounce: ignore an event within N seconds of the
--                           last one this trigger saw
--   a loop               -- an event CAUSED BY a job that this trigger created
--                           never fires it again. One level is enough: the
--                           second lap is where a loop becomes visible, and a
--                           deeper walk costs more than the rate limit it
--                           duplicates
--   replay after downtime -- `not_before_event_at` on the trigger, so
--                           reconnecting does not act on last week

create table if not exists public.signals (
  signal_id uuid primary key default gen_random_uuid(),
  source text not null check (btrim(source) <> ''),
  event_type text not null check (btrim(event_type) <> ''),
  /** The PROVIDER's id for the thing. What makes a duplicate a duplicate. */
  external_ref text not null check (btrim(external_ref) <> ''),
  project_id uuid references public.projects(project_id) on delete set null,
  /** One line a person can read. Never a raw body and never a credential. */
  summary text not null default '',
  /*
    Normalised fields only, and a REFERENCE rather than a copy wherever the
    thing already lives somewhere -- a document id, not the document.
  */
  detail jsonb not null default '{}'::jsonb,
  /** The job that caused it, when the office caused it. The loop guard. */
  caused_by_job uuid references public.jobs(job_id) on delete set null,
  happened_at timestamptz not null default app.now_utc(),
  received_at timestamptz not null default app.now_utc(),
  constraint signals_one_per_external_ref unique (source, external_ref)
);

create index if not exists signals_recent on public.signals (source, event_type, received_at desc);

comment on table public.signals is
  'What the office NOTICED: something that happened, normalised and '
  'deduplicated (#264). Deliberately not `public.events`, which is the ledger '
  'of what the office DID -- 2,641 rows of actor, action and before/after. '
  'Two different nouns, and one table for both would make "who did this" '
  'unanswerable.';

create table if not exists public.event_triggers (
  trigger_id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  source text not null,
  event_type text not null,
  /** Null means any project. A trigger scoped to one is the common case. */
  project_id uuid references public.projects(project_id) on delete cascade,
  /*
    Equality and containment over the normalised event, as
    `{"detail.connector": "drive", "summary~": "invoice"}`.

    Deliberately not an expression language. A trigger somebody can read at a
    glance is worth more than one that can express anything, and the day a
    condition genuinely needs code it belongs in a handler where it can be
    tested.
  */
  filters jsonb not null default '{}'::jsonb,
  job_kind text not null check (btrim(job_kind) <> ''),
  recipient_agent text references public.staff(slug),
  /** Merged into the job's pinned_config, under the event. */
  payload jsonb not null default '{}'::jsonb,
  /*
    Whether the job it creates must be approved before it acts.

    Recorded here and enforced by the handler through `app.may_act`, not by a
    second gate: #15's policy is the authority and a trigger that could bypass
    it would be the adapter deciding.
  */
  needs_approval boolean not null default false,
  debounce_seconds integer not null default 0 check (debounce_seconds >= 0),
  cooldown_seconds integer not null default 0 check (cooldown_seconds >= 0),
  max_per_hour integer not null default 12 check (max_per_hour > 0),
  /** Reconnecting after downtime must not act on last week. */
  not_before_event_at timestamptz,
  enabled boolean not null default true,
  created_by text not null default 'grant',
  created_at timestamptz not null default app.now_utc(),
  updated_at timestamptz not null default app.now_utc()
);

comment on table public.event_triggers is
  'WHEN x happens FROM s IF c THEN make job j FOR project p, subject to '
  'dedupe, debounce, cooldown and a rate limit (#264). The canonical layer '
  'that decides; adapters only translate.';

create table if not exists public.trigger_firings (
  firing_id uuid primary key default gen_random_uuid(),
  trigger_id uuid not null references public.event_triggers(trigger_id) on delete cascade,
  signal_id uuid not null references public.signals(signal_id) on delete cascade,
  /** The job it made, when it made one. */
  job_id uuid references public.jobs(job_id) on delete set null,
  decision text not null check (decision in (
    'fired', 'filtered_out', 'debounced', 'cooling_down', 'rate_limited',
    'would_have_looped', 'too_old', 'disabled', 'refused')),
  why text not null default '',
  at timestamptz not null default app.now_utc(),
  constraint trigger_firings_one_per_signal unique (trigger_id, signal_id)
);

create index if not exists trigger_firings_recent on public.trigger_firings (trigger_id, at desc);

comment on table public.trigger_firings is
  'What each trigger did about each event, INCLUDING what it declined and why '
  '(#264). A trigger that mysteriously does nothing is the failure this table '
  'exists to prevent.';

/*
  Record something that happened. Idempotent by the provider's own id.

  Returns `duplicate` rather than raising, because a provider retrying a
  webhook is normal and an adapter should not have to tell the difference.
*/
create or replace function app.record_signal(
  p_source text, p_event_type text, p_external_ref text,
  p_project uuid default null, p_summary text default '',
  p_detail jsonb default '{}'::jsonb, p_caused_by_job uuid default null,
  p_happened_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v_id uuid; v_was uuid;
begin
  select signal_id into v_was from public.signals
   where source = p_source and external_ref = p_external_ref;
  if v_was is not null then
    return jsonb_build_object('ok', true, 'signal', v_was, 'duplicate', true);
  end if;
  insert into public.signals
    (source, event_type, external_ref, project_id, summary, detail, caused_by_job, happened_at)
  values (p_source, p_event_type, p_external_ref, p_project,
          left(coalesce(p_summary, ''), 500), coalesce(p_detail, '{}'::jsonb),
          p_caused_by_job, coalesce(p_happened_at, app.now_utc()))
  returning signal_id into v_id;
  return jsonb_build_object('ok', true, 'signal', v_id, 'duplicate', false);
end;
$function$;

/*
  Does this event match this trigger's filters?

  A key with no suffix is equality; a key ending `~` is containment, case
  insensitive. `detail.x` reaches into the normalised payload. Anything else is
  a filter nobody can read, which is the point of keeping it this small.
*/
create or replace function app.signal_matches(p_signal public.signals, p_filters jsonb)
returns boolean
language plpgsql
immutable
as $function$
declare k text; v text; got text; path text;
begin
  for k, v in select key, value #>> '{}' from jsonb_each(coalesce(p_filters, '{}'::jsonb)) loop
    path := rtrim(k, '~');
    got := case
      when path = 'summary' then p_signal.summary
      when path = 'event_type' then p_signal.event_type
      when path = 'source' then p_signal.source
      when path like 'detail.%' then p_signal.detail #>> string_to_array(substr(path, 8), '.')
      else null
    end;
    if got is null then return false; end if;
    if k like '%~' then
      if position(lower(v) in lower(got)) = 0 then return false; end if;
    else
      if got <> v then return false; end if;
    end if;
  end loop;
  return true;
end;
$function$;

/*
  Decide what to do about an event, and do it.

  One row in `trigger_firings` per trigger per event, always -- including the
  declines. Returns what it decided, so an adapter or a suite can see it
  without querying.
*/
create or replace function app.fire_triggers_for(p_signal uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  e public.signals%rowtype; t public.event_triggers%rowtype;
  v_out jsonb := '[]'::jsonb; v_job uuid; v_decision text; v_why text;
  v_last timestamptz; v_recent integer;
begin
  select * into e from public.signals where signal_id = p_signal;
  if not found then
    return jsonb_build_object('error', 'no such signal');
  end if;

  for t in
    select * from public.event_triggers
     where source = e.source and event_type = e.event_type
       and (project_id is null or project_id = e.project_id)
     order by name
  loop
    v_job := null; v_decision := null; v_why := '';

    if not t.enabled then
      v_decision := 'disabled'; v_why := 'the trigger is switched off';
    elsif t.not_before_event_at is not null and e.happened_at < t.not_before_event_at then
      v_decision := 'too_old';
      v_why := format('it happened at %s and this trigger ignores anything before %s',
                      e.happened_at, t.not_before_event_at);
    elsif not app.signal_matches(e, t.filters) then
      v_decision := 'filtered_out'; v_why := 'the filters did not match';
    else
      /*
        The loop guard. An event the office caused, by a job THIS trigger
        created, must not fire it again -- which is the shape of every runaway
        automation: a trigger whose action produces another matching event.
      */
      if e.caused_by_job is not null and exists (
        select 1 from public.trigger_firings f
         where f.trigger_id = t.trigger_id and f.job_id = e.caused_by_job) then
        v_decision := 'would_have_looped';
        v_why := 'this event was caused by a job this trigger started';
      else
        select max(at) into v_last from public.trigger_firings
         where trigger_id = t.trigger_id and decision = 'fired';
        select count(*) into v_recent from public.trigger_firings
         where trigger_id = t.trigger_id and decision = 'fired'
           and at > app.now_utc() - interval '1 hour';

        if t.debounce_seconds > 0 and v_last is not null
           and v_last > app.now_utc() - make_interval(secs => t.debounce_seconds) then
          v_decision := 'debounced';
          v_why := format('another fired %s seconds ago and the window is %s',
                          round(extract(epoch from (app.now_utc() - v_last))), t.debounce_seconds);
        elsif t.cooldown_seconds > 0 and v_last is not null
              and v_last > app.now_utc() - make_interval(secs => t.cooldown_seconds) then
          v_decision := 'cooling_down';
          v_why := format('it last fired %s seconds ago and the cooldown is %s',
                          round(extract(epoch from (app.now_utc() - v_last))), t.cooldown_seconds);
        elsif v_recent >= t.max_per_hour then
          v_decision := 'rate_limited';
          v_why := format('%s already this hour and the limit is %s', v_recent, t.max_per_hour);
        end if;
      end if;
    end if;

    if v_decision is null then
      /*
        A real job, on the ordinary queue, with the ordinary everything.

        `requested_by` says a trigger asked, which makes trigger-started work
        countable and keeps it out of the readings that count what GRANT asked
        for -- the distinction `duty:` already draws for a schedule.
      */
      insert into public.jobs
        (kind, idempotency_key, correlation_id, requested_by, project_id, state,
         recipient_agent, announce, pinned_config)
      values (t.job_kind,
              format('trigger-%s-%s', left(t.name, 40), e.signal_id),
              gen_random_uuid(),
              format('trigger:%s', t.name),
              coalesce(e.project_id, t.project_id),
              'queued', t.recipient_agent, false,
              t.payload || jsonb_build_object(
                'event', jsonb_build_object(
                  'id', e.signal_id, 'source', e.source, 'type', e.event_type,
                  'summary', e.summary, 'detail', e.detail,
                  'happened_at', e.happened_at),
                'trigger', t.name,
                'needs_approval', t.needs_approval))
      returning job_id into v_job;
      v_decision := 'fired'; v_why := format('started %s', t.job_kind);
    end if;

    insert into public.trigger_firings (trigger_id, signal_id, job_id, decision, why)
    values (t.trigger_id, e.signal_id, v_job, v_decision, v_why)
    on conflict (trigger_id, signal_id) do nothing;

    v_out := v_out || jsonb_build_object('trigger', t.name, 'decision', v_decision,
                                         'why', v_why, 'job', v_job);
  end loop;

  return jsonb_build_object('ok', true, 'signal', p_signal, 'triggers', v_out);
end;
$function$;

/*
  How every trigger is doing, for the page and for a person.

  `last_declined` is there on purpose: a trigger that has fired twice and
  declined ninety times is working exactly as designed OR badly misconfigured,
  and the only way to tell is to see both numbers.
*/
create or replace function app.trigger_health()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(jsonb_agg(v order by name), '[]'::jsonb)
    from (
      select t.name,
             jsonb_build_object(
               'name', t.name, 'source', t.source, 'event_type', t.event_type,
               'enabled', t.enabled, 'job_kind', t.job_kind,
               'project', (select name from public.projects p where p.project_id = t.project_id),
               'fired', (select count(*) from public.trigger_firings f
                          where f.trigger_id = t.trigger_id and f.decision = 'fired'),
               'declined', (select count(*) from public.trigger_firings f
                             where f.trigger_id = t.trigger_id and f.decision <> 'fired'),
               'last_fired', (select max(at) from public.trigger_firings f
                               where f.trigger_id = t.trigger_id and f.decision = 'fired'),
               'last_declined', (select jsonb_build_object('at', f.at, 'why', f.why)
                                   from public.trigger_firings f
                                  where f.trigger_id = t.trigger_id and f.decision <> 'fired'
                                  order by f.at desc limit 1),
               'seen_this_hour', (select count(*) from public.trigger_firings f
                                   where f.trigger_id = t.trigger_id
                                     and f.at > app.now_utc() - interval '1 hour')) as v
        from public.event_triggers t
    ) q;
$function$;

create or replace function public.trigger_health()
returns jsonb language sql security definer set search_path to ''
as $function$ select app.trigger_health() $function$;
