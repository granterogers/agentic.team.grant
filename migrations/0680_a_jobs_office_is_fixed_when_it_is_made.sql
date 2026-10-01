-- 0680 - a job's office is fixed when it is made, and nothing a job makes can leave it (multi-user P3, wave 3).
--
-- Every function that creates a job now says whose it is: a child is its parent's (and a project, a caller or a signal
-- it names must be that office's too), a duty is its responsibility's, a trigger fires only on its own office's signals,
-- an approved job belongs to the office that approved it. Before this the compatibility bridge guessed: from the project
-- the caller NAMED - so a child hung on a foreign project id would have run in the foreign office with the parent's
-- authority - or, with two real offices, failed.
--
-- Three defects found on the way, all of them cross-office the day a second office exists:
--   * `event_triggers` were matched on source and event type alone, so a signal in one office fired every office's trigger;
--   * a duty's idempotency key is `duty:<slug>:<period>` and the live-key index was global, so two offices with the same
--     duty slug would have collided and the second office's duty would have read as "already fired" for ever;
--   * duties took their clock from `app.grant_timezone()`, one system setting, whoever's duty it was.

-- helpers the creators below use

-- The reserved "Unnamed" project is per office. Found, or made the first time an office's message names no project: the
-- authorisation Grant gave in ADR-0024 is for THIS reserved placeholder (attached to `upload`, as his own is), nothing else.
create function app.unnamed_project(p_office uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $f$
declare
  v uuid;
begin
  perform app.require_office(p_office);
  select project_id into v from public.projects where office_id = p_office and slug = 'unnamed';
  if v is not null then return v; end if;
  insert into public.projects (office_id, slug, name, status, reserved_reason)
  values (p_office, 'unnamed', 'Unnamed', 'active',
          'Where a message that names no project lands (ADR-0024, #194). Deleting it would orphan every unattributed conversation.')
  returning project_id into v;
  insert into public.project_attachments (project_id, connector, external_ref, display_name, role, enabled)
  values (v, 'upload', 'unnamed-project', 'Direct messages and uploads', 'source', true);
  return v;
end
$f$;
revoke all on function app.unnamed_project(uuid) from public, anon, authenticated, service_role;

-- Which project a conversation is already about, read inside ONE office.
create function app.current_project(p_office uuid, p_scope_kind public.project_scope_kind, p_scope_ref text)
returns uuid
language sql
stable
security definer
set search_path to ''
as $f$
  select case when latest.is_fixture then null else latest.project_id end
    from (
      select s.project_id, coalesce(p.is_fixture, false) as is_fixture
        from public.project_switches s
        left join public.projects p on p.project_id = s.project_id and p.office_id = p_office
       where s.office_id = p_office
         and s.scope_kind = p_scope_kind
         and s.scope_ref = p_scope_ref
       order by s.switched_at desc, s.seq desc
       limit 1
    ) latest
$f$;
revoke all on function app.current_project(uuid, public.project_scope_kind, text) from public, anon, authenticated, service_role;

-- A key is unique within an office, not across them.
drop index public.jobs_one_live_per_idempotency_key;
create unique index jobs_one_live_per_idempotency_key on public.jobs (office_id, idempotency_key)
  where state <> all (array['complete'::job_state, 'cancelled'::job_state, 'failed'::job_state]);


create or replace function app.due_responsibilities()
 RETURNS TABLE(responsibility_id uuid, slug text, staff_id uuid, project_id uuid, job_kind text, idempotency_key text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    r.responsibility_id, r.slug, r.staff_id, r.project_id, r.job_kind,
    case
      when r.at_time is null
        -- The window index, unchanged: two attempts inside the same period
        -- produce the same key and collide on 0005's unique index.
        then 'duty:' || r.slug || ':' ||
             (floor(extract(epoch from app.now_utc()) / (r.period_minutes * 60)))::bigint::text
        -- The local date. Two passes on the same day produce the same key,
        -- which is what stops him being briefed twice.
        else 'duty:' || r.slug || ':' ||
             to_char((app.now_utc() at time zone coalesce(r.timezone, o.timezone))::date, 'YYYY-MM-DD')
    end
  from public.responsibilities r
  join public.staff s on s.staff_id = r.staff_id and s.active
  join public.offices o on o.office_id = r.office_id and o.state = 'active'
  where r.enabled
    and case
      when r.at_time is null then
        r.last_run_at is null
        or r.last_run_at <= app.now_utc() - make_interval(mins => r.period_minutes)
      else
        -- Past this morning's anchor, and not already done since it. Comparing
        -- against the anchor rather than against "24h ago" is the whole point:
        -- a run that happened at 07:02 does not push tomorrow's to 07:02 + 24h.
        app.now_utc() >= (
          ((app.now_utc() at time zone coalesce(r.timezone, o.timezone))::date + r.at_time)
            at time zone coalesce(r.timezone, o.timezone)
        )
        and (
          r.last_run_at is null
          or r.last_run_at < (
            ((app.now_utc() at time zone coalesce(r.timezone, o.timezone))::date + r.at_time)
              at time zone coalesce(r.timezone, o.timezone)
          )
        )
    end;
$function$;

create or replace function app.dispatch_due_responsibilities()
 RETURNS TABLE(duty_slug text, duty_kind text, outcome text, fired_job_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
        (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, announce,
         pinned_config, recipient_agent)
      values
        (d.office_id, gen_random_uuid(), d.project_id, d.idempotency_key, d.job_kind,
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
$function$;

create or replace function app.enqueue_child(p_parent uuid, p_kind text, p_payload jsonb DEFAULT '{}'::jsonb, p_delay interval DEFAULT '00:00:00'::interval, p_announce boolean DEFAULT true, p_project uuid DEFAULT NULL::uuid, p_caller uuid DEFAULT NULL::uuid, p_caller_worker text DEFAULT NULL::text, p_caller_gen bigint DEFAULT NULL::bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_parent public.jobs;
  v_id uuid;
  v_hash text;
  v_slot text;
  v_n integer;
  v_key text;
  v_caller public.jobs;
  v_scope text := '';
  v_slot_attempt integer;
begin
  select * into v_parent from public.jobs where job_id = p_parent for share;
  if not found then
    raise exception 'no job % to hang a child on', p_parent using errcode = '23503';
  end if;
  -- The child belongs to its parent's office, and so does everything it is hung on (P3): a project another office
  -- owns is not a project this parent may give work to, and is refused as a project that does not exist.
  if p_project is not null and not exists (
    select 1 from public.projects pr where pr.project_id = p_project and pr.office_id = v_parent.office_id) then
    raise exception 'no project % to give a child', p_project using errcode = '23503';
  end if;
  -- A job called off is given no more work: whoever had not yet noticed cannot undo the stop.
  if v_parent.state = 'cancelled' then
    raise exception 'job % is % and cannot be given children', p_parent, v_parent.state using errcode = '55000';
  end if;
  -- The caller is asked, when it says who it is: a worker that no longer holds its job takes no slot anywhere.
  if (p_caller is not null or p_caller_worker is not null or p_caller_gen is not null)
     and (p_caller is null or p_caller_worker is null or p_caller_gen is null) then
    raise exception 'an incomplete caller: name the job, the worker and the claim, or none' using errcode = '22023';
  end if;
  if p_caller is not null then
    select * into v_caller from public.jobs where job_id = p_caller for share;
    if not found or v_caller.office_id is distinct from v_parent.office_id
       or not app.job_held(p_caller, p_caller_worker, v_caller.attempt, p_caller_gen) then
      raise exception 'stale caller: % no longer holds job %', p_caller_worker, p_caller using errcode = '40001';
    end if;
    if p_caller <> p_parent then v_scope := p_caller::text; end if;
  end if;
  v_slot_attempt := coalesce(p_caller_gen, v_parent.attempt)::integer;

  perform pg_advisory_xact_lock(hashtext('enqueue_child:' || p_parent::text));
  -- Identity of the request: kind, payload MINUS ids that are minted afresh by every attempt (a handoff carries the
  -- uuid of the output it hands on, and a retry writes a new output), and the project it is for.
  v_hash := md5((coalesce(p_payload, '{}'::jsonb) - 'from_output')::text || '|' || coalesce(coalesce(p_project, v_parent.project_id)::text, '') || '|' || v_scope);
  v_slot := left(p_kind, 40) || ':' || v_hash;
  insert into public.job_child_slots as s (job_id, attempt, slot_key, used)
  values (p_parent, v_slot_attempt, v_slot, 1)
  on conflict (job_id, attempt, slot_key) do update set used = s.used + 1
  returning s.used - 1 into v_n;
  v_key := format('child-%s-%s-%s', left(p_kind, 40), left(v_hash, 16), v_n);

  -- One parent, one kind, one request, one slot: this is the child the parent already made, if it did and it did
  -- not fail. A failed or cancelled child is not reused - the retry is entitled to try again - and neither is a
  -- child whose LATER sibling of the same request failed: a deferral that completed having only scheduled the work
  -- has not done it (notebook.generate defers itself as a sibling).
  select c.job_id into v_id from public.jobs c
   where c.parent_job_id = p_parent and c.kind = p_kind
     and c.idempotency_key like v_key || '-%' and c.state not in ('failed', 'cancelled')
     and not exists (
       select 1 from public.jobs s2
        where s2.parent_job_id = p_parent and s2.kind = p_kind
          and s2.idempotency_key like 'child-' || left(p_kind, 40) || '-' || left(v_hash, 16) || '-%'
          and s2.state in ('failed', 'cancelled') and s2.created_at > c.created_at)
   order by c.created_at limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.jobs
    (office_id, parent_job_id, correlation_id, project_id, idempotency_key, kind,
     requested_by, priority, pinned_config, not_before, announce)
  values (
    v_parent.office_id, p_parent, v_parent.correlation_id,
    coalesce(p_project, v_parent.project_id),
    v_key || '-' || left(gen_random_uuid()::text, 8),
    p_kind, v_parent.requested_by, v_parent.priority,
    coalesce(p_payload, '{}'::jsonb),
    case when p_delay <= interval '0' then null else now() + p_delay end,
    p_announce
  )
  returning job_id into v_id;

  return v_id;
end;
$function$;

create or replace function app.enqueue_child_once(p_parent uuid, p_kind text, p_request text, p_payload jsonb DEFAULT '{}'::jsonb, p_announce boolean DEFAULT true, p_project uuid DEFAULT NULL::uuid, p_caller uuid DEFAULT NULL::uuid, p_caller_worker text DEFAULT NULL::text, p_caller_gen bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_parent public.jobs;
  v_key text;
  v_id uuid;
  v_live uuid;
  v_payload jsonb;
  v_caller public.jobs;
begin
  select * into v_parent from public.jobs where job_id = p_parent for share;
  if not found then
    raise exception 'no job % to hang a child on', p_parent using errcode = '23503';
  end if;
  if p_project is not null and not exists (
    select 1 from public.projects pr where pr.project_id = p_project and pr.office_id = v_parent.office_id) then
    raise exception 'no project % to give a child', p_project using errcode = '23503';
  end if;
  if v_parent.state = 'cancelled' then
    raise exception 'job % is % and cannot be given children', p_parent, v_parent.state using errcode = '55000';
  end if;
  if (p_caller is not null or p_caller_worker is not null or p_caller_gen is not null)
     and (p_caller is null or p_caller_worker is null or p_caller_gen is null) then
    raise exception 'an incomplete caller: name the job, the worker and the claim, or none' using errcode = '22023';
  end if;
  if p_caller is not null then
    select * into v_caller from public.jobs where job_id = p_caller for share;
    if not found or v_caller.office_id is distinct from v_parent.office_id
       or not app.job_held(p_caller, p_caller_worker, v_caller.attempt, p_caller_gen) then
      raise exception 'stale caller: % no longer holds job %', p_caller_worker, p_caller using errcode = '40001';
    end if;
  end if;

  v_key := app.obligation_key(p_parent, p_kind, p_request);
  v_payload := coalesce(p_payload, '{}'::jsonb);
  if coalesce(btrim(p_request), '') <> ''
     and not (v_payload ? 'request' or v_payload ? 'brief' or v_payload ? 'instruction') then
    v_payload := v_payload || jsonb_build_object('request', p_request);
  end if;

  /*
    0595: THE SAME PARENT'S FINISHED CHILD IS THIS ATTEMPT'S CHILD.

    The live-key index stops a second LIVE child and deliberately allows one
    after the first finishes (#316: asking again later is a new request). A
    parent RETRY is not asking again - it is the same job doing its work a
    second time - and it re-enqueued a child that attempt one had already
    completed: behavioural remediation, 24 September 2026, one margin
    question answered twice by the operations director. Scoped to this
    parent and to a COMPLETE child; a failed or cancelled one is re-run, and
    a different parent asking the same thing is untouched.
  */
  select job_id into v_live from public.jobs
   where parent_job_id = p_parent
     and office_id = v_parent.office_id
     and idempotency_key = v_key
     and state = 'complete'
   order by created_at desc
   limit 1;
  if v_live is not null then
    return jsonb_build_object('job_id', v_live, 'created', false, 'reused', true);
  end if;

  begin
    insert into public.jobs
      (office_id, parent_job_id, correlation_id, project_id, idempotency_key, kind,
       requested_by, priority, pinned_config, announce)
    values (
      v_parent.office_id, p_parent, v_parent.correlation_id,
      coalesce(p_project, v_parent.project_id),
      v_key, p_kind, v_parent.requested_by, v_parent.priority,
      v_payload, p_announce)
    returning job_id into v_id;
    return jsonb_build_object('job_id', v_id, 'created', true);
  exception when unique_violation then
    select job_id into v_live from public.jobs
     where idempotency_key = v_key
       and state not in ('complete', 'cancelled', 'failed')
     limit 1;
    return jsonb_build_object('job_id', v_live, 'created', false);
  end;
end;
$function$;

create or replace function app.answer_generation_approval(p_blocker uuid, p_approved boolean, p_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  b public.blockers;
  v_config jsonb;
  v_next text;
  v_new uuid;
  v_refusal text;
begin
  -- 0608: called directly by the button path as well as by hq_answer_blocker,
  -- so it refuses an unidentified approver for itself.
  v_refusal := app.principal_refusal(p_by);
  if v_refusal is not null then
    return jsonb_build_object('error', v_refusal);
  end if;

  -- 0611: locked, like hq_answer_blocker (0596). This is the door the button path
  -- calls directly, and it now writes the durable answer, so two presses at the
  -- same moment must not both read 'open' and leave an answer that contradicts
  -- the job that ran.
  select * into b from public.blockers where blocker_id = p_blocker for update;
  if not found then
    return jsonb_build_object('error', 'no such request');
  end if;
  v_refusal := app.authority_refusal(btrim(coalesce(p_by, '')), b.job_id, b.project_id);
  if v_refusal is not null then
    return jsonb_build_object('error', v_refusal);
  end if;
  if b.state <> 'open' then
    return jsonb_build_object('already', true, 'state', b.state, 'resolution', b.resolution);
  end if;

  -- Called off (review of the final audit): the answer is recorded and nothing is started.
  if p_approved and exists (select 1 from public.jobs j where j.job_id = b.job_id and j.state = 'cancelled') then
    update public.blockers
       set state = 'resolved', resolved_at = app.now_utc(),
           resolution = format('approved by %s, but the work it asked about was called off, so nothing was started', p_by),
           answered_option = b.approval_options[1], answered_by = p_by
     where blocker_id = p_blocker;
    return jsonb_build_object('approved', true, 'called_off', true, 'started', 0);
  end if;

  update public.blockers
     set state = 'resolved',
         resolved_at = app.now_utc(),
         resolution = case when p_approved
                        then format('approved by %s', p_by)
                        else format('declined by %s', p_by) end,
         -- 0611: the option chosen is a column whichever door answered, so an
         -- answer from a button is as visible to the boundary as one typed.
         answered_option = case when p_approved then b.approval_options[1]
                                else coalesce(b.decline_option, b.approval_options[2]) end,
         answered_by = p_by
   where blocker_id = p_blocker;

  if not p_approved then
    return jsonb_build_object('approved', false);
  end if;

  select pinned_config into v_config from public.jobs where job_id = b.job_id;
  -- `notebook.generate` when the job did not say, which is every approval
  -- created before this migration. An in-flight request must not become
  -- unanswerable because the schema moved under it.
  v_next := coalesce(v_config ->> 'approval_next', 'notebook.generate');

  insert into public.jobs
    (office_id, parent_job_id, correlation_id, project_id, idempotency_key, kind,
     requested_by, priority, pinned_config)
  select b.office_id, b.job_id, j.correlation_id, j.project_id,
         format('approved-%s', p_blocker),
         v_next,
         j.requested_by,
         -- Ahead of the queue: he has just pressed a button and is watching.
         50,
         (coalesce(v_config, '{}'::jsonb) - 'approval_next')
           || jsonb_build_object('approved_by', p_by, 'approval', p_blocker)
    from public.jobs j where j.job_id = b.job_id and j.office_id = b.office_id
  returning job_id into v_new;

  return jsonb_build_object('approved', true, 'job_id', v_new, 'kind', v_next);
end;
$function$;

create or replace function app.fire_triggers_for(p_signal uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
     where office_id = e.office_id
       and source = e.source and event_type = e.event_type
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
        (office_id, kind, idempotency_key, correlation_id, requested_by, project_id, state,
         recipient_agent, announce, pinned_config)
      values (t.office_id, t.job_kind,
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

create or replace function app.notice_new_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_enabled boolean;
  v_cap integer;
  v_min integer;
  v_had integer;
  v_recent integer;
begin
  select coalesce((select value::text::boolean from public.system_config
                    where key = 'knowledge.read_new_sources'), true)
    into v_enabled;
  if not v_enabled then return new; end if;

  if new.project_id is null then return new; end if;

  select coalesce((select value::text::integer from public.system_config
                    where key = 'knowledge.new_source_min_chars'), 600)
    into v_min;
  if coalesce(new.content_chars, 0) < v_min then return new; end if;

  if exists (
    select 1 from public.projects p
     where p.project_id = new.project_id
       and (p.slug like 'fixture-%' or p.slug like 'verify-%' or p.status <> 'active')
  ) then
    return new;
  end if;

  select count(*)::integer into v_had
    from public.documents d
   where d.project_id = new.project_id and d.document_id <> new.document_id;
  if v_had = 0 then return new; end if;

  select coalesce((select value::text::integer from public.system_config
                    where key = 'knowledge.new_source_jobs_per_hour'), 6)
    into v_cap;
  -- Real work only. A job on an archived or fixture project does not count
  -- against a ceiling that exists to protect Grant from a stampede.
  select count(*)::integer into v_recent
    from public.jobs j
    join public.projects p on p.project_id = j.project_id
   where j.office_id = new.office_id
     and j.kind = 'knowledge.read_source'
     and j.created_at > app.now_utc() - interval '1 hour'
     and p.status = 'active'
     and p.slug not like 'fixture-%'
     and p.slug not like 'verify-%'
     and p.slug not like 'newsroom-%';
  if v_recent >= v_cap then
    return new;
  end if;

  insert into public.jobs
    (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority,
     announce, pinned_config)
  values (new.office_id, gen_random_uuid(), new.project_id,
          format('read:%s', new.document_id),
          'knowledge.read_source',
          format('%s:%s', new.connector, coalesce(new.external_ref, 'source')),
          200,
          true,
          jsonb_build_object(
            'document_id', new.document_id,
            'title', new.title,
            'connector', new.connector));

  return new;
exception
  when unique_violation then
    return new;
  when others then
    raise warning 'notice_new_document failed for %: %', new.document_id, sqlerrm;
    return new;
end;
$function$;

create or replace function app.provision_missing_channels()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with want as (
    select p.project_id, p.office_id, p.name
      from public.projects p
     where p.status = 'active'
       and not p.is_fixture
       -- Fifteen minutes. A suite's subject is gone long before this; a
       -- project Grant made is still here.
       and p.created_at < app.now_utc() - interval '15 minutes'
       -- ADR-0014: an active project reads from and writes to somewhere real.
       -- One with nothing attached is half-made and does not need a room yet.
       and exists (
         select 1 from public.project_attachments a
          where a.project_id = p.project_id and a.enabled)
       and not exists (
         select 1 from public.slack_channel_map m
          where m.project_id = p.project_id and m.active)
       /*
         Once a day, whatever the reason (0477).

         Without this the sweep re-asks on every tick, and a project whose
         desired name is taken by somebody else's channel can never succeed —
         740 jobs in twelve hours, each one an API call and each one announcing
         a failure.
       */
       and not exists (
         select 1 from public.jobs j
          where j.project_id = p.project_id
            and j.kind = 'office.provision_channels'
            and j.created_at > app.now_utc() - interval '24 hours')
       /*
         And not at all while Grant is being asked about it. A blocker is the
         office saying "somebody has to choose"; asking again tomorrow while
         the question is still open is asking twice.
       */
       and not exists (
         select 1 from public.blockers b
          where b.project_id = p.project_id
            and b.state = 'open'
            and b.requested_action like '%Slack channel%')
  ),
  queued as (
    insert into public.jobs
      (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority)
    select w.office_id, gen_random_uuid(), w.project_id, format('provision-%s', w.project_id),
           'office.provision_channels', 'hq', 300
      from want w
    on conflict (office_id, idempotency_key) where state in ('queued','running','retrying') do nothing
    returning project_id
  )
  select jsonb_build_object(
    'wanted', (select count(*)::int from want),
    'queued', (select count(*)::int from queued),
    'projects', coalesce((select jsonb_agg(w.name order by w.name) from want w), '[]'::jsonb)
  )
$function$;

create or replace function app.enqueue_inbound(p_command_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  c record;
  v_project uuid;
  v_scope public.project_scope_kind;
  v_talk text;
  v_job uuid;
begin
  select * into c from public.inbound_commands where command_id = p_command_id;
  if not found then
    return jsonb_build_object('error', 'no such command');
  end if;
  -- The command carries the office its door resolved. Everything below is looked up inside it.
  perform app.require_office(c.office_id);
  /*
    0607. A STRANGER IS NOT A CONVERSATION.

    `public.subject_identities` is the authoritative list of which
    channel-native actor is which person, and `app.subject_for` returns null
    for anybody not on it - 0056 says so in its own comment: "mapping an
    unknown actor to the only person on file would let them inherit his
    preferences and his authority". The trigger on inbound_commands honours
    that and writes a null subject. Nothing downstream ever asked: a null
    subject fell through `coalesce(c.subject, c.actor)` and became a job like
    any other, so a stranger who found the bot's public username reached the
    whole office, could teach it standing rules attributed to a name that is
    not Grant's, and (through record_telegram_chat) could become the chat his
    pager writes to.

    Refused here, at the one function every door calls, so that an edge
    function which has not been redeployed is still safe. Telegram, and since
    0615 Slack (a Slack actor is a workspace user id and the list is short and exact).

    NOT refused: a synthetic command. A harness that enters through a real
    signed door declares its conversation first (0605) and is contained by
    the origin machinery; refusing it here would turn every containment proof
    into a proof of nothing. `synthetic` is stamped by a BEFORE INSERT trigger
    from the connection, never by the caller, and cannot be changed.
  */
  if c.origin_channel in ('telegram', 'slack')
     and c.subject is null
     and not coalesce(c.synthetic, false) then
    return jsonb_build_object(
      'refused', true,
      'error', 'unknown sender: this actor is not a person the office knows');
  end if;
  if c.job_id is not null then
    -- Already turned into work. Idempotent because a webhook is at-least-once
    -- and the same instruction arriving twice must not be done twice.
    return jsonb_build_object('job_id', c.job_id, 'already', true);
  end if;
  -- 0075: a recording is an instruction whose words have not been read yet.
  if coalesce(trim(c.instruction), '') = '' and c.voice_file_id is null then
    return jsonb_build_object('error', 'nothing to do: the command carries no instruction');
  end if;

  /*
    The asset's project when the command names one (#27, 0313).

    The fallback below — most recently updated — is right for a message that
    arrives out of nowhere and wrong for a button pressed on a document that
    plainly belongs somewhere. Validated against `projects` rather than
    trusted: the context is written by a caller, and a project id that does not
    resolve should fall back rather than file the job nowhere.
  */
  select p.project_id into v_project
    from public.projects p
   where p.office_id = c.office_id
     and p.project_id = nullif(c.context->>'project_id', '')::uuid;

  /*
    0337. The project the CALLER named, when it named one.

    0335 gave inbound_commands a project_id and 0336 made this function write
    its answer back to it - but nothing ever READ it, so a surface that knows
    perfectly well which project it is sending from had that knowledge thrown
    away in favour of "most recently updated". A column no writer honours is
    the web.search trap in a new place: it claims something that is not true.

    Below the context project, which is more specific still (#27: a button
    pressed on a document names that document's project). Above the fallback,
    which is a guess.

    Compared against unnamed_project() rather than null, because the column is
    NOT NULL and defaults to Unnamed - so "unset" reads as Unnamed here, and an
    adapter that could not resolve a project still reaches the heuristic rather
    than sending everything to the reserved project. That default is what keeps
    a message from being lost; it is not a routing instruction.
  */
  if v_project is null and c.project_id is distinct from app.unnamed_project(c.office_id) then
    v_project := c.project_id;
  end if;

  /*
    0338. The channel the message came from, when Slack is where it came from.

    #187 gives every dashboard project its own named channel and 0014 has
    mapped channel to project since the beginning - deliberately in Postgres
    rather than in a channel topic, because "a topic is editable by anyone in
    the channel and is lost with the channel". Nothing had ever asked that
    table which project a message belonged to.

    So a question typed in #legacy-coaching-course was filed against whichever
    project happened to have been touched most recently, and its answer went
    into that project's conversation. The mapping existed, the reader existed,
    and no line of code joined them.

    origin_ref is `channel:ts` for a Slack message - the message branch of
    toCanonicalCommand builds it that way and its comment says why the ts is
    the message's own rather than the thread parent's. split_part is safe on a
    ref of any other shape: it returns the whole string, which matches no
    channel_id and falls through.

    Only ACTIVE mappings. An archived channel's project is not where new work
    should go, and slack_channel_map keeps the row so the history still
    resolves.
  */
  if v_project is null and c.origin_channel = 'slack' then
    select m.project_id into v_project
      from public.slack_channel_map m
     where m.channel_id = split_part(c.origin_ref, ':', 1)
       and m.active
       and m.project_id is not null
       and exists (select 1 from public.projects mp
                    where mp.project_id = m.project_id and mp.office_id = c.office_id);
  end if;

  /*
    0547. WHICH CONVERSATION IS THIS, and what was it already about.

    Everything above resolves a project from THIS message. Nothing had ever
    asked what the conversation was already working on, so the second turn of
    every exchange started again from nothing: a third of Grant's real
    messages and half his voice notes carry no project, and all of them fell
    to the Unnamed fallback below.

    `project_switches` has existed since the beginning and all 169 of its rows
    are harness traffic, because `switchTo` and `resolveProject` in
    `src/projects/context.ts` have no importer and nothing in the resolution
    cascade consulted `app.current_project`. The table, the writer and the
    reader all existed and no line of code joined them - the same shape as the
    dial with no reader, in the mechanism that decides where Grant's work
    goes.

    The conversation is the FIRST segment of origin_ref, which is what the
    Slack branch above already assumes: `1386648496:325` is a chat and a
    message, `C0BVD21Q9S5:1790016258.057200` is a channel and a timestamp.
  */
  v_scope := case c.origin_channel
               when 'telegram' then 'telegram_chat'
               when 'slack'    then 'slack_channel'
               when 'voice'    then 'voice'
               when 'teamhq'   then 'dashboard'
             end::public.project_scope_kind;
  v_talk := nullif(split_part(coalesce(c.origin_ref, ''), ':', 1), '');

  /*
    RECORDED ONLY FROM AN EXPLICIT RESOLUTION, never from a guess.

    Everything that set v_project above is a resolution: an asset's own
    project, a project the surface named, a Slack channel's mapping. The two
    branches BELOW are guesses - the Unnamed fallback and the
    most-recently-updated heuristic - and writing either into the
    conversation's memory would lock the whole exchange onto something nobody
    said. That is the difference between inheriting context and inventing it.

    Unnamed is excluded for the same reason: it is the absence of a project,
    not a project, and a conversation that remembered it could never resolve
    to anything else.

    Idempotent by comparing with what the scope already says, so an exchange
    that stays on one project writes one row rather than one per turn.
  */
  if v_project is not null
     and v_scope is not null
     and v_talk is not null
     and v_project is distinct from app.unnamed_project(c.office_id)
     and v_project is distinct from app.current_project(c.office_id, v_scope, v_talk)
     /*
       0548. ACTIVE only, because `project_switches` refuses anything else and
       says why: "switching into an archived project would file new work
       somewhere nobody is looking." Perfectly right, and 0547 put that
       refusal in the path of every inbound message — a paused project made
       `enqueue_inbound` RAISE, so the message was not merely mis-filed, it
       was lost. Found by the session runner, whose fixture projects are
       paused by ADR-0014.
     */
     and exists (select 1 from public.projects p
                  where p.project_id = v_project and p.office_id = c.office_id and p.status = 'active') then
    /*
      And wrapped, because REMEMBERING is best-effort and DELIVERING is not.

      The condition above covers the rule that exists today. A constraint
      added to `project_switches` tomorrow would otherwise silently become a
      way to drop Grant's messages, and no future author of that constraint
      would think to check this path. The failure is recorded rather than
      swallowed: `app.cannot` is what this repository uses for a write that
      may fail without failing the work.
    */
    begin
      insert into public.project_switches
        (office_id, scope_kind, scope_ref, project_id, switched_by, reason)
      values (c.office_id, v_scope, v_talk, v_project,
              coalesce(c.subject, c.actor, 'the office'),
              'The message resolved to this project, so the conversation is about it.');
    exception when others then
      null;
    end;
  end if;

  /*
    AND INHERITED when this message says nothing.

    The invariant: once a conversation is operating in a known project, later
    turns without an explicit one stay there until it is explicitly switched
    or cleared. `app.current_project` already answers that, and already
    returns nothing when the latest switch points at a fixture project (0164),
    so a harness exchange cannot hand a real one its context.

    Below the explicit routes and above both guesses, which is the whole
    ordering argument: anything this message actually says wins, and the
    conversation beats a fallback.
  */
  if v_project is null and v_scope is not null and v_talk is not null then
    v_project := app.current_project(c.office_id, v_scope, v_talk);
  end if;

  /*
    0341. Nothing above could say which project this is.

    Grant, 13 September, asked what should happen to a message in a general
    Telegram chat that names no project: "you can just go in unnamed project as
    a title or category or whatever" (ADR-0024).

    Until now the answer was the line below: the most recently updated active
    project. That is a guess, and its quality is entirely a matter of whether
    he happens to have been working on the thing he is now talking about. When
    it is wrong it is silently wrong - his message and the answer to it are
    filed against a project he never mentioned, and both appear in that
    project's conversation.

    A setting rather than a constant, per §4 and because the cost of each
    choice is real and only he can weigh them. `true` files an unresolvable
    message under Unnamed, which is honest and loses the guess. `false` is the
    old behaviour, which is useful exactly when the guess is right.

    Whichever it is, everything above still wins: an asset's project, a project
    the surface named, and a Slack channel's project are all resolutions rather
    than guesses, so this only decides what happens when there is nothing to go
    on at all.
  */
  if v_project is null
     and coalesce(
           (select value::text::boolean from public.system_config
             where key = 'routing.unnamed_when_unresolved'), true) then
    v_project := app.unnamed_project(c.office_id);
  end if;

  if v_project is null then
    select project_id into v_project
      from public.projects where office_id = c.office_id and status = 'active'
     order by updated_at desc
     limit 1;
  end if;

  if v_project is null then
    return jsonb_build_object('error', 'no active project to attach this to');
  end if;

  insert into public.jobs
    (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority, pinned_config)
  values (c.office_id, gen_random_uuid(), v_project,
          format('inbound-%s', p_command_id),
          'office.instruction',
          format('%s:%s', c.origin_channel, coalesce(c.subject, c.actor)),
          -- 10, not 150. See the header: lower is sooner, and at 150 every
          -- routine duty in the building was claimed ahead of a message Grant
          -- was waiting on.
          10,
          jsonb_build_object(
            'instruction', c.instruction,
            'addressed_to', c.addressed_to,
            'addressed_also', to_jsonb(coalesce(c.addressed_also, '{}'::text[])),
            'origin_channel', c.origin_channel,
            'origin_ref', c.origin_ref,
            'command_id', p_command_id,
            'voice_file_id', c.voice_file_id,
            'voice_seconds', c.voice_seconds,
            -- The asset and the action, as facts (#27).
            'context', c.context
          ))
  on conflict (office_id, idempotency_key)
    where state <> all (array['complete'::public.job_state,
                              'cancelled'::public.job_state,
                              'failed'::public.job_state])
    do nothing
  returning job_id into v_job;

  -- THE LOSER OF THE RACE WANTS THE WINNER'S JOB (0528).
  -- `do nothing` returns no row, so v_job is null exactly when
  -- another call inserted first. Reading it back is the whole
  -- point: both callers must be told the same job id, which is
  -- what idempotent means to the adapter that asked.
  if v_job is null then
    select job_id into v_job from public.jobs
     where office_id = c.office_id
       and idempotency_key = format('inbound-%s', p_command_id)
       and state <> all (array['complete'::public.job_state,
                               'cancelled'::public.job_state,
                               'failed'::public.job_state]);
    if v_job is null then
      raise exception 'could not record what you said: the job for' 
        ' command % was neither inserted nor found', p_command_id;
    end if;
  end if;

  /*
    0336. The command's project is set to whatever the job resolved to.

    Added because #192 gave inbound_commands a project of its own and this
    function chooses the job's project independently - so the two could
    disagree and split one exchange across two conversations: Grant's message
    under the column's default, the office's answer under the job's project.

    Measured before changing anything: 193 of 194 enqueued commands reach the
    "most recently updated active project" fallback above, and exactly one has
    ever named a project in its context. So the heuristic is not an edge case,
    it is the path - which is why this reconciles the command TO the job rather
    than the other way round. Where work is ROUTED is a different decision from
    where a conversation GROUPS, and ADR-0024 was the latter.
  */
  update public.inbound_commands
     set job_id = v_job, processed_at = app.now_utc(), project_id = v_project
   where command_id = p_command_id and office_id = c.office_id;

  return jsonb_build_object('job_id', v_job, 'already', false, 'spoken', c.voice_file_id is not null);
end;
$function$;
