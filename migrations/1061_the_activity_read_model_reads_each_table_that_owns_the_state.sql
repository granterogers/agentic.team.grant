-- 1061: the unified activity ledger, part 2 of 2 - the read model, the Team HQ adapter, the health reading and the indexes.
--
-- app.activity_read answers "what has the team been doing" from the tables that already own each fact (1060 explains why nothing
-- is copied), plus public.activity_events for what has no other home. Every row it returns has the ONE event contract in
-- docs/activity-ledger/EVENT-CONTRACT.md, a deterministic id (so a client can link, dedupe and name a cause), and a
-- provenance that says whether the row is native (public.activity_events), external (an external worker's report), or
-- projected (read from the authoritative table at the moment you ask; nothing was reconstructed or invented to fill a gap).
--
-- What it guarantees
--   * Office isolation: every branch is bound to the office the CALLER names (the gateway takes it from the verified session);
--     a project, job, correlation or cursor id from another office matches nothing.
--   * Harness traffic is excluded by the canonical predicates (app.harness_job, synthetic, is_fixture), as in every reader Grant looks at.
--   * Stable order: (occurred_at, id) descending, a keyset cursor, never an offset; at most 200 rows a page.
--   * Visibility: user (default), diagnostic (the person debugging their own office), operator (the deployment's operator only).
--   * Cost is never invented: cost_status is provider_reported, authoritative / calculated / estimated as the usage row says, or unavailable.
--
-- Additive only. The indexes are the ones the per-office, newest-first reads need; none changes an existing query's result.

-- ------------------------------------------------------------------------------------------------ small pure helpers

create or replace function app.activity_pid(p_source text, p_pk text, p_type text)
returns uuid
language sql
immutable
set search_path = 'pg_catalog'
as $$ select md5(p_source || ':' || p_pk || ':' || p_type)::uuid $$;

comment on function app.activity_pid(text, text, text) is
  'The deterministic id of a projected event: the same source row and type always give the same id, so it can be linked, deduplicated and named as a cause.';

create or replace function app.activity_name(p_slug text)
returns text
language sql
immutable
set search_path = 'pg_catalog'
as $$ select case when p_slug is null or p_slug = '' then null else initcap(replace(p_slug, '-', ' ')) end $$;

create or replace function app.activity_sev_rank(p_sev text)
returns integer
language sql
immutable
set search_path = 'pg_catalog'
as $$ select case p_sev when 'debug' then 0 when 'info' then 1 when 'notice' then 2 when 'warning' then 3 when 'error' then 4 when 'critical' then 5 else null end $$;

create or replace function app.activity_vis_rank(p_vis text)
returns integer
language sql
immutable
set search_path = 'pg_catalog'
as $$ select case p_vis when 'user' then 0 when 'diagnostic' then 1 when 'operator' then 2 else null end $$;

create or replace function app.activity_type_category(p_type text)
returns text
language sql
stable
set search_path = 'pg_catalog', 'public'
as $$
  select coalesce((select t.category from public.activity_event_types t where t.event_type = p_type),
                  app.activity_category(p_type))
$$;

create or replace function app.activity_type_visrank(p_type text)
returns integer
language sql
stable
set search_path = 'pg_catalog', 'public'
as $$
  select coalesce((select app.activity_vis_rank(t.default_visibility) from public.activity_event_types t where t.event_type = p_type), 0)
$$;

create or replace function app.activity_type_severity(p_type text)
returns text
language sql
stable
set search_path = 'pg_catalog', 'public'
as $$
  select coalesce((select t.default_severity from public.activity_event_types t where t.event_type = p_type), 'info')
$$;

create or replace function app.activity_channel_label(p_channel text)
returns text
language sql
immutable
set search_path = 'pg_catalog'
as $$ select case p_channel when 'teamhq' then 'Team HQ' when 'telegram' then 'Telegram' when 'slack' then 'Slack'
                            when 'voice' then 'a voice call' when 'mcp' then 'MCP' when 'claude' then 'Claude' when 'chatgpt' then 'ChatGPT'
                            else coalesce(p_channel, 'a channel') end $$;

-- ------------------------------------------------------------------------------------------------ the read model

create or replace function app.activity_read(
  p_office     uuid,
  p_project    uuid        default null,
  p_agent      text        default null,
  p_job        uuid        default null,
  p_correlation uuid       default null,
  p_since      timestamptz default null,
  p_until      timestamptz default null,
  p_category   text        default null,
  p_min_severity text      default null,
  p_status     text        default null,
  p_source     text        default null,
  p_visibility text        default 'user',
  p_type       text        default null,
  p_before_at  timestamptz default null,
  p_before_id  uuid        default null,
  p_limit      integer     default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
-- JIT is switched off for this function: the query it builds is wide (fifteen sources) so its estimated cost crosses jit_above_cost
-- and the compile step then took about 650 ms of a 70 ms query (measured on the replica, 24 000 transitions). A page of fifty rows
-- gains nothing from compiled expressions. Harmless where the host already has JIT off.
set jit = off
as $$
declare
  v_limit   integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_maxvis  integer;
  v_sevrank integer := app.activity_sev_rank(p_min_severity);
  v_f       text;
  v_branches text[] := '{}';
  v_sql     text;
  v_cols    constant text := 'id, at, type, status, sev, actor_kind, actor, agent, project_id, job_id, root_job, parent_job_id, correlation_id, causation_id, iface, tool, model, summary, meta, evidence, prov, src, vis_override, rawkey, hjob';
  v_pool    integer;
  v_z       text[];
  v_ts      text[];
  v_idx     text[];
  v_result  jsonb;
begin
  perform app.require_office(p_office);

  if p_visibility not in ('user', 'diagnostic', 'operator') then
    raise exception 'unknown visibility %', p_visibility using errcode = '22023';
  end if;
  if p_min_severity is not null and v_sevrank is null then
    raise exception 'unknown severity %', p_min_severity using errcode = '22023';
  end if;
  -- operator visibility is the deployment's own: anybody else asking for it is given diagnostic, never an error that names the difference.
  v_maxvis := least(app.activity_vis_rank(p_visibility), case when app.office_sees_the_deployment(p_office) then 2 else 1 end);

  if not app.activity_ledger_on() then
    return jsonb_build_object('enabled', false, 'events', '[]'::jsonb, 'next', null, 'generated_at', app.now_utc());
  end if;

  -- The filters every branch applies to its OWN computed columns, so a page is the newest N rows that match, not the matches among the newest N.
  v_f := $f$
        ($2::uuid is null or q.project_id = $2)
    and ($3::text is null or q.agent = $3)
    and ($4::uuid is null or q.job_id = $4 or q.root_job = $4)
    and ($5::uuid is null or q.correlation_id = $5)
    and ($6::text is null or app.activity_type_category(q.type) = $6)
    and ($7::int is null or app.activity_sev_rank(q.sev) >= $7)
    and ($8::text is null or q.status = $8)
    and ($9::text is null or q.iface = $9)
    and ($16::text is null or q.type = $16)
    and ((q.vis_override is null and app.activity_type_visrank(q.type) <= $10) or q.vis_override <= $10)
    and ($13::timestamptz is null or (q.at, q.id) < ($13::timestamptz, $14::uuid))
  $f$;

  -- every branch below selects the same 22 columns plus vis_override (null for projected rows, whose visibility is the taxonomy's).

  -- 1. requests: one per inbound message or voice note (never a button press, never a suite's)
  v_branches := v_branches || $b$
    select app.activity_pid('inbound_commands', c.command_id::text, 'request.received') as id, c.received_at as at,
           'request.received'::text as type, 'recorded'::text as status, 'info'::text as sev,
           'user'::text as actor_kind, 'you'::text as actor, c.addressed_to as agent, c.project_id, c.job_id,
           coalesce(j.root_job_id, j.job_id) as root_job, j.parent_job_id, j.correlation_id, null::uuid as causation_id,
           c.origin_channel as iface, null::text as tool, null::text as model,
           (case when c.voice_file_id is not null then 'Voice note received on ' else 'Message received on ' end
              || app.activity_channel_label(c.origin_channel))::text as summary,
           jsonb_strip_nulls(jsonb_build_object('voice', c.voice_file_id is not null, 'voice_seconds', c.voice_seconds,
             'transcribed', c.transcript is not null, 'addressed_to', c.addressed_to)) as meta,
           jsonb_build_object('kind', 'inbound_command', 'id', c.command_id) as evidence,
           'projected'::text as prov, 'inbound_commands'::text as src, null::int as vis_override,
           c.command_id as rawkey, j.job_id as hjob
      from {z} c
      left join public.jobs j on j.job_id = c.job_id and j.office_id = c.office_id
     where c.office_id = $1 and c.callback_action is null and not c.synthetic
       and c.received_at >= coalesce($11, '-infinity') and c.received_at <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
       and (j.job_id is null or not (j.synthetic or j.is_fixture))
  $b$::text;

  -- 2. routing: who was asked to handle it, from the routing decision
  v_branches := v_branches || $b$
    select app.activity_pid('routing_decisions', r.decision_id::text, 'request.routed'), r.decided_at,
           'request.routed', 'recorded', 'info', 'system', 'office', j.recipient_agent, j.project_id, j.job_id,
           coalesce(j.root_job_id, j.job_id), j.parent_job_id, j.correlation_id,
           case when j.origin_command_id is not null then app.activity_pid('inbound_commands', j.origin_command_id::text, 'request.received') end,
           j.origin_channel, null, null,
           case when coalesce(array_length(r.roster, 1), 0) = 0 then 'Kept with the chief of staff'
                else 'Routed to ' || (select string_agg(app.activity_name(x), ', ') from unnest(r.roster) x) end,
           jsonb_strip_nulls(jsonb_build_object('intent_class', r.intent_class, 'confident', r.confident,
             'delegation_depth', r.delegation_depth, 'roster', to_jsonb(r.roster))),
           jsonb_build_object('kind', 'routing_decision', 'id', r.decision_id), 'projected', 'routing_decisions', null::int,
           r.decision_id, j.job_id
      from {z} r
      join public.jobs j on j.job_id = r.job_id and j.office_id = $1
     where $10 >= 1
       and r.decided_at >= coalesce($11, '-infinity') and r.decided_at <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
       and not (j.synthetic or j.is_fixture)
  $b$::text;

  -- 3. the job lifecycle: every transition is written by trigger in the same transaction as the state change
  v_branches := v_branches || $b$
    select app.activity_pid('job_state_transitions', t.transition_id::text, 'transition'), t.occurred_at, ty.ty,
           case ty.ty when 'job.created' then 'requested' when 'job.delegated' then 'requested' when 'job.started' then 'attempted'
                      when 'job.completed' then 'completed' when 'job.failed' then 'failed' when 'job.cancelled' then 'cancelled'
                      when 'retry.scheduled' then 'scheduled' else 'recorded' end,
           app.activity_type_severity(ty.ty),
           case when ty.ty = 'job.delegated' then 'agent' when ty.ty = 'job.created' then 'system' else 'agent' end,
           case when ty.ty = 'job.delegated' then coalesce(pj.recipient_agent, 'office')
                when ty.ty = 'job.created' then 'office' else coalesce(j.recipient_agent, 'office') end,
           j.recipient_agent, j.project_id, j.job_id, coalesce(j.root_job_id, j.job_id), j.parent_job_id, j.correlation_id,
           case when ty.ty = 'job.delegated' then
                  (select app.activity_pid('job_state_transitions', pt.transition_id::text, 'transition')
                     from public.job_state_transitions pt where pt.job_id = j.parent_job_id and pt.from_state is null limit 1)
                when ty.ty = 'job.created' and j.origin_command_id is not null then
                  app.activity_pid('inbound_commands', j.origin_command_id::text, 'request.received') end,
           j.origin_channel, null, null,
           case ty.ty when 'job.created' then 'Queued ' || j.kind
                      when 'job.delegated' then 'Handed ' || j.kind || ' to ' || coalesce(app.activity_name(j.recipient_agent), 'a specialist')
                      when 'job.started' then 'Started ' || j.kind
                      when 'job.completed' then 'Finished ' || j.kind
                      when 'job.failed' then 'Failed: ' || j.kind
                      when 'job.cancelled' then 'Called off ' || j.kind
                      when 'retry.scheduled' then 'Will try again: ' || j.kind
                      when 'job.paused' then 'Parked ' || j.kind
                      when 'job.waiting' then 'Waiting: ' || j.kind
                      else 'Moved ' || j.kind || ' to ' || t.to_state::text end,
           jsonb_strip_nulls(jsonb_build_object('kind', j.kind, 'attempt', t.attempt, 'from_state', t.from_state::text,
             'to_state', t.to_state::text, 'reason', left(app.activity_redact(t.reason), 200))),
           jsonb_build_object('kind', 'job', 'id', j.job_id), 'projected', 'job_state_transitions', null::int,
           t.transition_id, j.job_id
      from {z} t
      join public.jobs j on j.job_id = t.job_id and j.office_id = $1
      left join public.jobs pj on pj.job_id = j.parent_job_id
      cross join lateral (select case
              when t.from_state is null then (case when j.parent_job_id is null then 'job.created' else 'job.delegated' end)
              when t.to_state = 'running' then 'job.started' when t.to_state = 'complete' then 'job.completed'
              when t.to_state = 'failed' then 'job.failed' when t.to_state = 'cancelled' then 'job.cancelled'
              when t.to_state = 'retrying' then 'retry.scheduled' when t.to_state = 'paused' then 'job.paused'
              when t.to_state in ('waiting_external', 'waiting_user') then 'job.waiting' else 'job.state_changed' end as ty) ty
     where t.occurred_at >= coalesce($11, '-infinity') and t.occurred_at <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
       and ($10 >= 1 or t.to_state in ('complete', 'failed', 'cancelled') or (t.from_state is null and j.parent_job_id is not null))
       and not (j.synthetic or j.is_fixture)
  $b$::text;

  -- 4a. an approval question was asked
  v_branches := v_branches || $b$
    select app.activity_pid('blockers', b.blocker_id::text, 'approval.requested'), b.created_at, 'approval.requested', 'requested', 'notice',
           'agent', coalesce(b.originating_agent, 'office'), b.originating_agent, b.project_id, b.job_id,
           coalesce(j.root_job_id, j.job_id), j.parent_job_id, j.correlation_id, null::uuid, j.origin_channel, null, null,
           'Asked you: ' || left(app.activity_redact(b.requested_action), 160),
           jsonb_strip_nulls(jsonb_build_object('options', coalesce(array_length(b.approval_options, 1), 0),
             'work_can_continue', b.work_can_continue, 'deadline', b.real_deadline)),
           jsonb_build_object('kind', 'blocker', 'id', b.blocker_id), 'projected', 'blockers', null::int,
           b.blocker_id, j.job_id
      from {z} b
      left join public.jobs j on j.job_id = b.job_id and j.office_id = b.office_id
     where b.office_id = $1
       and b.created_at >= coalesce($11, '-infinity') and b.created_at <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
       and (j.job_id is null or not (j.synthetic or j.is_fixture))
  $b$::text;

  -- 4b. ... and how it ended. A question closed with no option chosen is "withdrawn", never "granted": no yes was recorded.
  v_branches := v_branches || $b$
    select app.activity_pid('blockers', b.blocker_id::text, 'approval.decided'), d.at, d.ty,
           case d.ty when 'approval.granted' then 'authorised' when 'approval.denied' then 'declined' when 'approval.expired' then 'expired' else 'cancelled' end,
           app.activity_type_severity(d.ty),
           case when d.ty in ('approval.granted', 'approval.denied') then 'user' else 'system' end,
           case when d.ty in ('approval.granted', 'approval.denied') then 'you' else 'office' end,
           b.originating_agent, b.project_id, b.job_id, coalesce(j.root_job_id, j.job_id), j.parent_job_id, j.correlation_id,
           app.activity_pid('blockers', b.blocker_id::text, 'approval.requested'), j.origin_channel, null, null,
           case d.ty when 'approval.granted' then 'You said yes: ' when 'approval.denied' then 'You said no: '
                     when 'approval.expired' then 'No answer, lapsed: ' else 'Withdrawn: ' end || left(app.activity_redact(b.requested_action), 160),
           jsonb_strip_nulls(jsonb_build_object('standing', b.standing_option is not null and b.answered_option = b.standing_option)),
           jsonb_build_object('kind', 'blocker', 'id', b.blocker_id), 'projected', 'blockers', null::int,
           b.blocker_id, j.job_id
      from {z} b
      left join public.jobs j on j.job_id = b.job_id and j.office_id = b.office_id
      cross join lateral (select coalesce(b.resolved_at, b.updated_at) as at,
              case when b.state = 'expired' then 'approval.expired'
                   when b.state = 'withdrawn' then 'approval.withdrawn'
                   when b.answered_option is null then 'approval.withdrawn'
                   when b.decline_option is not null and b.answered_option = b.decline_option then 'approval.denied'
                   else 'approval.granted' end as ty) d
     where b.office_id = $1 and b.state <> 'open'
       and d.at >= coalesce($11, '-infinity') and d.at <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
       and (j.job_id is null or not (j.synthetic or j.is_fixture))
  $b$::text;

  -- 5. impediments (append-only): a permission nobody granted is "action.blocked" and shown; the rest is diagnostic
  v_branches := v_branches || $b$
    select app.activity_pid('job_impediments', i.impediment_id::text, 'impediment'), i.created_at, d.ty, 'blocked', app.activity_type_severity(d.ty),
           'agent', coalesce(i.staff_slug, 'office'), i.staff_slug, coalesce(i.project_id, j.project_id), j.job_id,
           coalesce(j.root_job_id, j.job_id), j.parent_job_id, j.correlation_id, null::uuid, j.origin_channel, null, null,
           'Could not proceed: ' || left(app.activity_redact(i.needed), 160),
           jsonb_strip_nulls(jsonb_build_object('impediment', i.kind::text, 'noticed_by', i.noticed_by)),
           jsonb_build_object('kind', 'impediment', 'id', i.impediment_id), 'projected', 'job_impediments', null::int,
           i.impediment_id, j.job_id
      from {z} i
      join public.jobs j on j.job_id = i.job_id and j.office_id = $1
      cross join lateral (select case when i.kind = 'needs_permission' then 'action.blocked' else 'job.impeded' end as ty) d
     where not i.is_fixture
       and i.created_at >= coalesce($11, '-infinity') and i.created_at <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
       and ($10 >= 1 or d.ty = 'action.blocked')
       and not (j.synthetic or j.is_fixture)
  $b$::text;

  -- 6a. an output was produced (its text is never copied)
  v_branches := v_branches || $b$
    select app.activity_pid('outputs', o.output_id::text, 'output.created'), o.created_at, 'output.created', 'completed', 'info',
           'agent', coalesce(s.slug, 'office'), s.slug, j.project_id, j.job_id, coalesce(j.root_job_id, j.job_id), j.parent_job_id,
           j.correlation_id, null::uuid, j.origin_channel, null, o.model,
           'Output produced' || coalesce(' by ' || app.activity_name(s.slug), ''),
           jsonb_strip_nulls(jsonb_build_object('confidence', o.confidence::text, 'evidence', o.evidence::text, 'shape', o.shape,
             'deterministic', o.deterministic, 'reviewer_status', o.reviewer_status::text,
             'sources', case when jsonb_typeof(o.sources) = 'array' then jsonb_array_length(o.sources) end)),
           jsonb_build_object('kind', 'output', 'id', o.output_id), 'projected', 'outputs', null::int,
           o.output_id, j.job_id
      from {z} o
      join public.jobs j on j.job_id = o.job_id and j.office_id = $1
      left join public.staff s on s.staff_id = o.staff_id
     where o.created_at >= coalesce($11, '-infinity') and o.created_at <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
       and not (j.synthetic or j.is_fixture)
  $b$::text;

  -- 6b. ... and reviewed
  v_branches := v_branches || $b$
    select app.activity_pid('outputs', o.output_id::text, 'output.reviewed'), o.reviewed_at, 'output.reviewed',
           case when o.reviewer_status = 'rejected' then 'declined' else 'completed' end, 'info',
           'agent', coalesce(rs.slug, 'office'), rs.slug, j.project_id, j.job_id, coalesce(j.root_job_id, j.job_id), j.parent_job_id,
           j.correlation_id, app.activity_pid('outputs', o.output_id::text, 'output.created'), j.origin_channel, null, null,
           'Output ' || replace(o.reviewer_status::text, '_', ' '),
           jsonb_build_object('reviewer_status', o.reviewer_status::text),
           jsonb_build_object('kind', 'output', 'id', o.output_id), 'projected', 'outputs', null::int,
           o.output_id, j.job_id
      from {z} o
      join public.jobs j on j.job_id = o.job_id and j.office_id = $1
      left join public.staff rs on rs.staff_id = o.reviewed_by
     where o.reviewed_at is not null and o.reviewer_status <> 'pending'
       and o.reviewed_at >= coalesce($11, '-infinity') and o.reviewed_at <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
       and not (j.synthetic or j.is_fixture)
  $b$::text;

  -- 7. deliveries: attempted is not delivered, delivered is not confirmed. A destination id is never shown.
  -- four sources of one table (attempted, succeeded, failed, suppressed), each ordered by its own time column so each can use an index
  for i in 1 .. 4 loop
  v_branches := v_branches || replace(replace(replace($b$
    select app.activity_pid('deliveries', d.delivery_id::text, x.ty), x.at, x.ty,
           case x.ty when 'delivery.attempted' then 'attempted' when 'delivery.failed' then 'failed'
                     when 'delivery.suppressed' then 'cancelled'
                     else case when d.message_ref is not null then 'confirmed' else 'completed' end end,
           app.activity_type_severity(x.ty), 'system', 'office', s.slug, j.project_id, d.job_id, coalesce(j.root_job_id, j.job_id),
           j.parent_job_id, coalesce(d.correlation_id, j.correlation_id),
           case when x.ty in ('delivery.succeeded', 'delivery.failed') and d.send_started_at is not null
                then app.activity_pid('deliveries', d.delivery_id::text, 'delivery.attempted') end,
           d.channel, null, null,
           case x.ty when 'delivery.attempted' then 'Sending to ' || app.activity_channel_label(d.channel)
                     when 'delivery.succeeded' then 'Sent to ' || app.activity_channel_label(d.channel)
                     when 'delivery.failed' then 'Could not send to ' || app.activity_channel_label(d.channel)
                     else 'Not sent to ' || app.activity_channel_label(d.channel) end,
           jsonb_strip_nulls(jsonb_build_object('purpose', d.purpose, 'attempt', d.attempt,
             'provider_confirmed', d.message_ref is not null,
             'error_code', left(app.activity_redact(d.error_code), 80),
             'suppressed_reason', left(app.activity_redact(d.suppressed_reason), 80))),
           jsonb_build_object('kind', 'delivery', 'id', d.delivery_id), 'projected', 'deliveries', null::int,
           d.delivery_id, j.job_id
      from {z} d
      left join public.jobs j on j.job_id = d.job_id and j.office_id = d.office_id
      left join public.staff s on s.staff_id = d.staff_id
      cross join lateral (select '{ty}'::text as ty, d.{atcol} as at) x
     where d.office_id = $1 and {cond}
       and x.at >= coalesce($11, '-infinity') and x.at <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
       and ($10 >= 1 or x.ty in ('delivery.succeeded', 'delivery.failed'))
       and (j.job_id is null or not (j.synthetic or j.is_fixture))
  $b$,
    '{ty}', (array['delivery.attempted', 'delivery.succeeded', 'delivery.failed', 'delivery.suppressed'])[i]),
    '{atcol}', (array['send_started_at', 'sent_at', 'updated_at', 'updated_at'])[i]),
    '{cond}', (array['d.send_started_at is not null', 'd.state = ''sent'' and d.sent_at is not null', 'd.state = ''failed''', 'd.state = ''suppressed'''])[i]);
  end loop;

  -- 8. model calls and their cost (diagnostic only; cost status is never defaulted to a number)
  v_branches := v_branches || $b$
    select app.activity_pid('inference_usage', u.usage_id::text, 'inference.completed'), u.occurred_at, 'inference.completed',
           case when u.outcome = 'ok' then 'completed' else 'failed' end,
           case when u.outcome = 'ok' then 'info' else 'warning' end,
           'system', 'office', j.recipient_agent, j.project_id, u.job_id, coalesce(j.root_job_id, j.job_id), j.parent_job_id,
           coalesce(u.correlation_id, j.correlation_id), null::uuid, j.origin_channel, null, u.model_id,
           'Model call: ' || u.model_id || case when u.outcome = 'ok' then '' else ' (' || replace(u.outcome, '_', ' ') || ')' end,
           jsonb_strip_nulls(jsonb_build_object('provider', u.provider, 'outcome', u.outcome, 'prompt_tokens', u.prompt_tokens,
             'completion_tokens', u.completion_tokens, 'latency_ms', u.latency_ms,
             'cost_usd', coalesce(u.provider_reported_cost, u.cost_usd),
             'cost_status', case when u.provider_reported_cost is not null then 'provider_reported' else u.provenance::text end)),
           jsonb_build_object('kind', 'inference_usage', 'id', u.usage_id), 'projected', 'inference_usage', null::int,
           u.usage_id, j.job_id
      from {z} u
      left join public.jobs j on j.job_id = u.job_id and j.office_id = u.office_id
     where $10 >= 1 and u.office_id = $1
       and u.occurred_at >= coalesce($11, '-infinity') and u.occurred_at <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
       and (j.job_id is null or not (j.synthetic or j.is_fixture))
  $b$::text;

  -- 9. the action ledger (public.events): what the office DID, in its own vocabulary, with the reversal if there is one
  v_branches := v_branches || $b$
    select e.event_id, e.occurred_at, e.action_type, 'completed', 'info', e.actor_kind,
           case when e.actor_kind = 'user' and e.actor is not distinct from app.office_actor($1) then 'you' else e.actor end,
           case when e.actor_kind = 'agent' then e.actor end, e.project_id, e.related_job_id, coalesce(j.root_job_id, j.job_id),
           j.parent_job_id, e.correlation_id, e.compensates_event_id, e.origin_channel, e.tool_used, e.provider_used,
           coalesce(nullif(left(app.activity_redact(e.rationale_summary), 300), ''),
                    (app.action_in_words(e.action_type) ->> 'verb') || ' ' || (app.action_in_words(e.action_type) ->> 'what')),
           jsonb_strip_nulls(jsonb_build_object('reversible', e.reversible, 'undo_with', e.reversal_method, 'trigger', left(e.trigger, 80))),
           jsonb_build_object('kind', 'event', 'id', e.event_id), 'projected', 'events', null::int,
           e.event_id, j.job_id
      from {z} e
      left join public.jobs j on j.job_id = e.related_job_id and j.office_id = e.office_id
     where e.office_id = $1
       and e.occurred_at >= coalesce($11, '-infinity') and e.occurred_at <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
       and not app.harness_label(e.actor)
       and (j.job_id is null or not (j.synthetic or j.is_fixture))
  $b$::text;

  -- 10. native ledger rows
  v_branches := v_branches || $b$
    select a.activity_id, a.occurred_at, a.event_type, a.status, a.severity, a.actor_kind, a.actor, a.agent_slug, a.project_id, a.job_id,
           coalesce(j.root_job_id, a.job_id), a.parent_job_id, a.correlation_id, a.causation_id, a.source_interface, a.tool, a.model,
           a.summary,
           a.metadata || coalesce((select jsonb_build_object('superseded_by', s.activity_id) from public.activity_events s
                                    where s.supersedes_activity_id = a.activity_id), '{}'::jsonb),
           coalesce(a.evidence_ref, jsonb_build_object('kind', 'activity_event', 'id', a.activity_id)), a.provenance, 'activity_events',
           app.activity_vis_rank(a.visibility), a.activity_id, j.job_id
      from {z} a
      left join public.jobs j on j.job_id = a.job_id and j.office_id = a.office_id
     where a.office_id = $1
       and a.occurred_at >= coalesce($11, '-infinity') and a.occurred_at <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
       and (j.job_id is null or not (j.synthetic or j.is_fixture))
  $b$::text;

  -- Stage 0 of each branch above, in the SAME ORDER: the source's newest rows by its own time column, with only the certain exclusions.
  -- v_ts names the column whose oldest value says how far back the source has been read.
  v_z := array[
    -- 1 requests
    $z$select c0.* from public.inbound_commands c0
        where c0.office_id = $1 and c0.callback_action is null and not c0.synthetic
          and c0.received_at >= coalesce($11, '-infinity') and c0.received_at <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
          and (c0.job_id is null or exists (select 1 from public.jobs j0 where j0.job_id = c0.job_id and not (j0.synthetic or j0.is_fixture)))
        order by {ts} desc, {id} desc limit $18$z$,
    -- 2 routing
    $z$select r0.* from public.routing_decisions r0
        where $10 >= 1
          and r0.decided_at >= coalesce($11, '-infinity') and r0.decided_at <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
          and exists (select 1 from public.jobs j0 where j0.job_id = r0.job_id and j0.office_id = $1 and not (j0.synthetic or j0.is_fixture))
        order by {ts} desc, {id} desc limit $18$z$,
    -- 3 job lifecycle
    $z$select t0.* from public.job_state_transitions t0
        where t0.occurred_at >= coalesce($11, '-infinity') and t0.occurred_at <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
          and exists (select 1 from public.jobs j0 where j0.job_id = t0.job_id and j0.office_id = $1 and not (j0.synthetic or j0.is_fixture)
                        and ($10 >= 1 or t0.to_state in ('complete', 'failed', 'cancelled') or (t0.from_state is null and j0.parent_job_id is not null)))
        order by {ts} desc, {id} desc limit $18$z$,
    -- 4 approvals asked
    $z$select b0.* from public.blockers b0
        where b0.office_id = $1
          and b0.created_at >= coalesce($11, '-infinity') and b0.created_at <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
          and (b0.job_id is null or exists (select 1 from public.jobs j0 where j0.job_id = b0.job_id and not (j0.synthetic or j0.is_fixture)))
        order by {ts} desc, {id} desc limit $18$z$,
    -- 5 approvals settled
    $z$select b0.* from public.blockers b0
        where b0.office_id = $1 and b0.state <> 'open'
          and coalesce(b0.resolved_at, b0.updated_at) >= coalesce($11, '-infinity')
          and coalesce(b0.resolved_at, b0.updated_at) <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
          and (b0.job_id is null or exists (select 1 from public.jobs j0 where j0.job_id = b0.job_id and not (j0.synthetic or j0.is_fixture)))
        order by {ts} desc, {id} desc limit $18$z$,
    -- 6 impediments
    $z$select i0.* from public.job_impediments i0
        where not i0.is_fixture
          and i0.created_at >= coalesce($11, '-infinity') and i0.created_at <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
          and ($10 >= 1 or i0.kind = 'needs_permission')
          and exists (select 1 from public.jobs j0 where j0.job_id = i0.job_id and j0.office_id = $1 and not (j0.synthetic or j0.is_fixture))
        order by {ts} desc, {id} desc limit $18$z$,
    -- 7 outputs produced
    $z$select o0.* from public.outputs o0
        where o0.created_at >= coalesce($11, '-infinity') and o0.created_at <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
          and exists (select 1 from public.jobs j0 where j0.job_id = o0.job_id and j0.office_id = $1 and not (j0.synthetic or j0.is_fixture))
        order by {ts} desc, {id} desc limit $18$z$,
    -- 8 outputs reviewed
    $z$select o0.* from public.outputs o0
        where o0.reviewed_at is not null and o0.reviewer_status <> 'pending'
          and o0.reviewed_at >= coalesce($11, '-infinity') and o0.reviewed_at <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
          and exists (select 1 from public.jobs j0 where j0.job_id = o0.job_id and j0.office_id = $1 and not (j0.synthetic or j0.is_fixture))
        order by {ts} desc, {id} desc limit $18$z$
  ];
  v_ts := array['received_at', 'decided_at', 'occurred_at', 'created_at', 'coalesce(resolved_at, updated_at)', 'created_at', 'created_at', 'reviewed_at'];
  -- the id each source gives its events, as an expression over its own columns: stage 0 orders by it, so a source's order is
  -- exactly the order the page uses and a tie in time is settled the same way everywhere
  v_idx := array[
    'app.activity_pid(''inbound_commands'', command_id::text, ''request.received'')',
    'app.activity_pid(''routing_decisions'', decision_id::text, ''request.routed'')',
    'app.activity_pid(''job_state_transitions'', transition_id::text, ''transition'')',
    'app.activity_pid(''blockers'', blocker_id::text, ''approval.requested'')',
    'app.activity_pid(''blockers'', blocker_id::text, ''approval.decided'')',
    'app.activity_pid(''job_impediments'', impediment_id::text, ''impediment'')',
    'app.activity_pid(''outputs'', output_id::text, ''output.created'')',
    'app.activity_pid(''outputs'', output_id::text, ''output.reviewed'')'];
  -- 9 to 12 deliveries: attempted, succeeded, failed, suppressed
  for i in 1 .. 4 loop
    v_z := v_z || replace(replace(replace($z$select d0.* from public.deliveries d0
        where d0.office_id = $1 and {cond}
          and d0.{atcol} >= coalesce($11, '-infinity') and d0.{atcol} <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
          and ($10 >= 1 or {vis})
          and (d0.job_id is null or exists (select 1 from public.jobs j0 where j0.job_id = d0.job_id and not (j0.synthetic or j0.is_fixture)))
        order by {ts} desc, {id} desc limit $18$z$,
      '{atcol}', (array['send_started_at', 'sent_at', 'updated_at', 'updated_at'])[i]),
      '{cond}', (array['d0.send_started_at is not null', 'd0.state = ''sent'' and d0.sent_at is not null', 'd0.state = ''failed''', 'd0.state = ''suppressed'''])[i]),
      '{vis}', (array['false', 'true', 'true', 'false'])[i]);
    v_ts := v_ts || (array['send_started_at', 'sent_at', 'updated_at', 'updated_at'])[i];
    v_idx := v_idx || ('app.activity_pid(''deliveries'', delivery_id::text, '''
                       || (array['delivery.attempted', 'delivery.succeeded', 'delivery.failed', 'delivery.suppressed'])[i] || ''')');
  end loop;
  v_z := v_z || array[
    -- 13 model calls
    $z$select u0.* from public.inference_usage u0
        where $10 >= 1 and u0.office_id = $1
          and u0.occurred_at >= coalesce($11, '-infinity') and u0.occurred_at <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
          and (u0.job_id is null or exists (select 1 from public.jobs j0 where j0.job_id = u0.job_id and not (j0.synthetic or j0.is_fixture)))
        order by {ts} desc, {id} desc limit $18$z$,
    -- 14 the action ledger
    $z$select e0.* from public.events e0
        where e0.office_id = $1 and not app.harness_label(e0.actor)
          and e0.occurred_at >= coalesce($11, '-infinity') and e0.occurred_at <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
          and (e0.related_job_id is null or exists (select 1 from public.jobs j0 where j0.job_id = e0.related_job_id and not (j0.synthetic or j0.is_fixture)))
        order by {ts} desc, {id} desc limit $18$z$,
    -- 15 native rows
    $z$select a0.* from public.activity_events a0
        where a0.office_id = $1
          and a0.occurred_at >= coalesce($11, '-infinity') and a0.occurred_at <= least(coalesce($12, 'infinity'), coalesce($13, 'infinity'))
          and (a0.job_id is null or exists (select 1 from public.jobs j0 where j0.job_id = a0.job_id and not (j0.synthetic or j0.is_fixture)))
        order by {ts} desc, {id} desc limit $18$z$
  ];
  v_ts := v_ts || array['occurred_at', 'occurred_at', 'occurred_at'];
  v_idx := v_idx || array[
    'app.activity_pid(''inference_usage'', usage_id::text, ''inference.completed'')',
    'event_id',
    'activity_id'];

  -- Assemble: each branch reads its own stage 0 and applies the caller's filters to its computed columns.
  -- The limit is the page PLUS ONE: whether there is a next page is decided by seeing one row beyond it, and a source that holds
  -- every remaining row would otherwise be cut at exactly the page size and look exhausted (found by the gateway proof).
  --
  -- TWO STAGES PER SOURCE, because the harness test (app.harness_job) is the one expensive predicate and must run on rows that can
  -- appear, not on every row the office ever wrote:
  --   s<i>  the source's newest $18 rows that pass every cheap filter, in index order (the order key is the source's own column,
  --         never the computed id, or the planner has to compute every row to sort them)
  --   r<i>  of those, the ones that are not a suite's work
  -- A page is only trusted when no source could still hold a row that belongs in it: a source that returned a full $18 rows must
  -- reach strictly further back than the page's last row. Otherwise the pool is widened (x8, to 16384) and the page is rebuilt;
  -- if the cap is reached the answer says partial: true rather than pretending to be complete.
  --
  -- Three stages, because the plan showed where the time goes (docs/activity-ledger/ARCHITECTURE.md, "Performance"):
  --   z<i>  the source's newest $18 rows by its own time column and primary key (an index range scan: no computed column is
  --         evaluated for a row that will not be shown) with only the cheap, certain exclusions (office, suites' flags)
  --   s<i>  the contract columns for those rows, then every filter the caller asked for
  --   the canonical harness test (app.harness_job, about 0.2 ms a call) runs ONCE per distinct job among only the newest $19
  --   candidates of all sources together, never per source and never on a row that cannot reach the page
  -- A page is trusted only when nothing unread could belong in it: a source whose z returned a full $18 rows must reach strictly
  -- further back than the page's last row, and a page short of survivors needs every candidate read. Otherwise the answer is
  -- rebuilt with a pool eight times wider, up to 16384, and past that it says partial: true instead of pretending to be complete.
  v_sql := 'with ';
  for i in 1 .. array_length(v_branches, 1) loop
    v_sql := v_sql || case when i > 1 then ', ' else '' end
      || 'z' || i || ' as materialized (' || replace(replace(v_z[i], '{ts}', v_ts[i]), '{id}', v_idx[i]) || '), '
      || 's' || i || ' as (select * from (select * from (' || replace(v_branches[i], '{z}', 'z' || i) || ') b(' || v_cols || ')) q'
      || ' where ' || v_f || ')';
  end loop;
  v_sql := v_sql || ', allrows as (';
  for i in 1 .. array_length(v_branches, 1) loop
    v_sql := v_sql || case when i > 1 then ' union all ' else '' end || 'select * from s' || i;
  end loop;
  v_sql := v_sql || '), stats as (';
  for i in 1 .. array_length(v_branches, 1) loop
    -- the OLDEST row each source read, as the full ordering key (time, then id): everything the source did not read is strictly below it
    v_sql := v_sql || case when i > 1 then ' union all ' else '' end
      || 'select count(*)::int as cnt, (array_agg(' || v_ts[i] || ' order by ' || v_ts[i] || ', ' || v_idx[i] || '))[1] as minat, '
      || '(array_agg(' || v_idx[i] || ' order by ' || v_ts[i] || ', ' || v_idx[i] || '))[1] as minid from z' || i;
  end loop;
  v_sql := v_sql || '), cand as materialized (select * from allrows order by at desc, id desc limit $19), '
    || 'hj as materialized (select x.hjob, app.harness_job(x.hjob) as h from (select distinct hjob from cand where hjob is not null) x), '
    || 'ok as (select c.* from cand c left join hj on hj.hjob = c.hjob where hj.hjob is null or not hj.h), '
    || 'page as (select * from ok order by at desc, id desc limit $15 + 1), '
    || 'lastat as (select at, id from page order by at desc, id desc offset $15 limit 1) '
    || 'select jsonb_build_object(''enabled'', true, ''visibility'', $17::text, '
    ||   '''_valid'', not exists (select 1 from stats where cnt >= $18 '
    ||     'and not exists (select 1 from lastat l where (stats.minat, stats.minid) <= (l.at, l.id))) '
    ||     'and ((select count(*) from lastat) > 0 or (select count(*) from allrows) <= $19), '
    ||   '''events'', coalesce((select jsonb_agg(x.e order by x.at desc, x.id desc) from ('
    ||     'select g.at, g.id, jsonb_build_object(''id'', g.id, ''type'', g.type, ''schema_version'', 1, ''at'', g.at,'
    ||       '''category'', app.activity_type_category(g.type), ''severity'', g.sev, ''status'', g.status,'
    ||       '''visibility'', coalesce((select t.default_visibility from public.activity_event_types t where t.event_type = g.type), ''user''),'
    ||       '''actor_kind'', g.actor_kind, ''actor'', g.actor, ''agent'', g.agent, ''project_id'', g.project_id, ''project'', p.name,'
    ||       '''job_id'', g.job_id, ''parent_job_id'', g.parent_job_id, ''correlation_id'', g.correlation_id, ''causation_id'', g.causation_id,'
    ||       '''source_interface'', g.iface, ''tool'', g.tool, ''model'', g.model, ''summary'', g.summary, ''metadata'', g.meta,'
    ||       '''evidence'', g.evidence, ''provenance'', g.prov, ''source'', g.src) as e '
    ||     'from (select * from page order by at desc, id desc limit $15) g '
    ||     'left join public.projects p on p.project_id = g.project_id and p.office_id = $1) x), ''[]''::jsonb), '
    ||   '''next'', (select case when count(*) > $15 then (select jsonb_build_object(''at'', l.at, ''id'', l.id) '
    ||     'from (select at, id from page order by at desc, id desc limit $15) l order by l.at asc, l.id asc limit 1) end from page), '
    ||   '''generated_at'', app.now_utc())';

  v_pool := (v_limit + 1) * 2;
  loop
    execute v_sql into v_result
      using p_office, p_project, p_agent, p_job, p_correlation, p_category, v_sevrank, p_status, p_source, v_maxvis,
            p_since, p_until, p_before_at, p_before_id, v_limit, p_type, p_visibility, v_pool, v_pool;
    exit when (v_result ->> '_valid')::boolean or v_pool >= 16384;
    v_pool := least(v_pool * 8, 16384);
  end loop;
  return (v_result - '_valid') || jsonb_build_object('partial', not (v_result ->> '_valid')::boolean);
end
$$;

comment on function app.activity_read(uuid, uuid, text, uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, timestamptz, uuid, integer) is
  'The unified activity read model: one office, newest first, keyset-paged, filtered on the computed columns of every source before each source''s own limit. '
  'Contract: docs/activity-ledger/EVENT-CONTRACT.md. Answers {enabled:false} while the ledger switch is off.';

-- ------------------------------------------------------------------------------------------------ the indexes the reads need

-- One per-office, newest-first access path for each source that did not have one. Additive; none changes a result.
create index if not exists inbound_commands_office_received_idx on public.inbound_commands (office_id, received_at desc);
create index if not exists deliveries_office_updated_idx on public.deliveries (office_id, updated_at desc);
create index if not exists deliveries_office_sent_idx on public.deliveries (office_id, sent_at desc) where sent_at is not null;
create index if not exists deliveries_office_send_started_idx on public.deliveries (office_id, send_started_at desc) where send_started_at is not null;
create index if not exists blockers_office_created_idx on public.blockers (office_id, created_at desc);
create index if not exists inference_usage_office_time_idx on public.inference_usage (office_id, occurred_at desc);
create index if not exists events_office_time_idx on public.events (office_id, occurred_at desc);
create index if not exists job_transitions_time_idx on public.job_state_transitions (occurred_at desc);
create index if not exists outputs_created_idx on public.outputs (created_at desc);
create index if not exists outputs_reviewed_idx on public.outputs (reviewed_at desc) where reviewed_at is not null;
create index if not exists job_impediments_time_idx on public.job_impediments (created_at desc);

-- ------------------------------------------------------------------------------------------------ one chain, from request to delivery

-- Everything that belongs to one piece of work: its correlation, or the job and every job under it. Oldest first, because a chain is
-- read as a story. Bounded at 500 rows; a longer chain says so rather than silently stopping.
create or replace function app.activity_chain(p_office uuid, p_job uuid default null, p_correlation uuid default null, p_visibility text default 'diagnostic')
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $$
declare v_corr uuid := p_correlation; v_pages jsonb := '[]'::jsonb; v_page jsonb; v_at timestamptz; v_id uuid; v_n integer := 0; v_more boolean := false;
begin
  perform app.require_office(p_office);
  if p_job is null and p_correlation is null then
    raise exception 'a chain needs a job or a correlation' using errcode = '22023';
  end if;
  if not app.activity_ledger_on() then
    return jsonb_build_object('enabled', false, 'events', '[]'::jsonb);
  end if;
  if v_corr is null then
    select j.correlation_id into v_corr from public.jobs j where j.job_id = p_job and j.office_id = p_office;
    if v_corr is null then
      return jsonb_build_object('enabled', true, 'events', '[]'::jsonb, 'complete', true);
    end if;
  end if;
  loop
    v_page := app.activity_read(p_office, p_correlation => v_corr, p_visibility => p_visibility,
                                p_before_at => v_at, p_before_id => v_id, p_limit => 200);
    v_pages := v_pages || coalesce(v_page -> 'events', '[]'::jsonb);
    v_n := v_n + jsonb_array_length(coalesce(v_page -> 'events', '[]'::jsonb));
    exit when v_page -> 'next' is null or jsonb_typeof(v_page -> 'next') = 'null';
    if v_n >= 500 then v_more := true; exit; end if;
    v_at := (v_page -> 'next' ->> 'at')::timestamptz;
    v_id := (v_page -> 'next' ->> 'id')::uuid;
  end loop;
  return jsonb_build_object('enabled', true, 'correlation_id', v_corr, 'complete', not v_more,
    'events', (select coalesce(jsonb_agg(e order by e ->> 'at', e ->> 'id'), '[]'::jsonb) from jsonb_array_elements(v_pages) e));
end
$$;

comment on function app.activity_chain(uuid, uuid, uuid, text) is
  'The whole causal chain of one piece of work, oldest first, from the request that began it to the delivery that ended it. Bounded at 500 events; complete=false says so.';

-- ------------------------------------------------------------------------------------------------ the Team HQ adapter

-- The shape the Activity module already reads from app.hq_studio_lately (office[]: id, who, kind, verb, what, why, project, when, at,
-- via, category, times) so the page can consume the ledger without a visual change. Nothing here is folded or summarised: the page's
-- own grouping still applies. Severity, status, the evidence link and the provenance are extra keys the existing renderer ignores.
create or replace function app.activity_for_the_page(p_office uuid, p_limit integer default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $$
declare v_page jsonb;
begin
  perform app.require_office(p_office);
  v_page := app.activity_read(p_office, p_visibility => 'user', p_limit => least(greatest(coalesce(p_limit, 40), 1), 200));
  if (v_page ->> 'enabled')::boolean is not true then
    return jsonb_build_object('enabled', false, 'office', '[]'::jsonb, 'generated_at', app.now_utc());
  end if;
  return jsonb_build_object(
    'enabled', true,
    'office', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e ->> 'id',
               'who', case when e ->> 'actor' = 'you' then 'you' else coalesce(app.activity_name(e ->> 'agent'), e ->> 'actor') end,
               'kind', e ->> 'actor_kind',
               'verb', split_part(e ->> 'summary', ' ', 1),
               'what', substr(e ->> 'summary', length(split_part(e ->> 'summary', ' ', 1)) + 2),
               'why', null,
               'project', e ->> 'project',
               'when', to_char((e ->> 'at')::timestamptz, 'FMDD Mon HH24:MI'),
               'at', e ->> 'at',
               'reversible', coalesce((e -> 'metadata' ->> 'reversible')::boolean, false),
               'undo_with', e -> 'metadata' ->> 'undo_with',
               'via', e ->> 'source_interface',
               'category', e ->> 'category',
               'severity', e ->> 'severity',
               'status', e ->> 'status',
               'evidence', e -> 'evidence',
               'provenance', e ->> 'provenance') order by (e ->> 'at') desc)
        from jsonb_array_elements(v_page -> 'events') e), '[]'::jsonb),
    'next', v_page -> 'next',
    'generated_at', app.now_utc());
end
$$;

comment on function app.activity_for_the_page(uuid, integer) is
  'The unified ledger in the shape the existing Team HQ Activity module reads (hq_studio_lately.office[]). A minimal adapter: no layout change is needed to consume it.';

-- ------------------------------------------------------------------------------------------------ the health reading

-- Operational metrics for the ledger itself. Never records an activity (no recursion): it only reads.
create or replace function app.activity_ledger_health(p_office uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $$
begin
  perform app.require_office(p_office);
  return jsonb_build_object(
    'enabled', app.activity_ledger_on(),
    'native_events_24h', (select count(*) from public.activity_events a where a.office_id = p_office and a.occurred_at > app.now_utc() - interval '24 hours'),
    'native_events_total', (select count(*) from public.activity_events a where a.office_id = p_office),
    'last_native_event_at', (select max(a.occurred_at) from public.activity_events a where a.office_id = p_office),
    'write_failures_1h', (select count(*) from public.activity_write_failures f where f.office_id = p_office and f.occurred_at > app.now_utc() - interval '1 hour'),
    'write_failures_24h', (select count(*) from public.activity_write_failures f where f.office_id = p_office and f.occurred_at > app.now_utc() - interval '24 hours'),
    'last_write_failure', (select jsonb_build_object('at', f.occurred_at, 'event_type', f.event_type, 'sqlstate', f.sqlstate)
                             from public.activity_write_failures f where f.office_id = p_office order by f.occurred_at desc limit 1),
    'retry_backlog', (select count(*) from public.jobs j where j.office_id = p_office and j.state = 'retrying' and not app.harness_job(j.job_id)),
    'generated_at', app.now_utc());
end
$$;

comment on function app.activity_ledger_health(uuid) is
  'The ledger''s own health: switch, native volume, write failures (a counter, not events), and the retry backlog. Read-only.';

-- ------------------------------------------------------------------------------------------------ public wrappers (PostgREST only exposes public)

create or replace function public.activity_read(
  p_office uuid, p_project uuid default null, p_agent text default null, p_job uuid default null, p_correlation uuid default null,
  p_since timestamptz default null, p_until timestamptz default null, p_category text default null, p_min_severity text default null,
  p_status text default null, p_source text default null, p_visibility text default 'user', p_type text default null,
  p_before_at timestamptz default null, p_before_id uuid default null, p_limit integer default 50)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.activity_read(p_office, p_project, p_agent, p_job, p_correlation, p_since, p_until, p_category, p_min_severity,
                               p_status, p_source, p_visibility, p_type, p_before_at, p_before_id, p_limit) $$;

create or replace function public.activity_chain(p_office uuid, p_job uuid default null, p_correlation uuid default null, p_visibility text default 'diagnostic')
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.activity_chain(p_office, p_job, p_correlation, p_visibility) $$;

create or replace function public.activity_for_the_page(p_office uuid, p_limit integer default 40)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.activity_for_the_page(p_office, p_limit) $$;

create or replace function public.activity_ledger_health(p_office uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.activity_ledger_health(p_office) $$;

revoke all on function app.activity_read(uuid, uuid, text, uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function app.activity_chain(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function app.activity_for_the_page(uuid, integer) from public, anon, authenticated;
revoke all on function app.activity_ledger_health(uuid) from public, anon, authenticated;
revoke all on function public.activity_read(uuid, uuid, text, uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.activity_chain(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.activity_for_the_page(uuid, integer) from public, anon, authenticated;
revoke all on function public.activity_ledger_health(uuid) from public, anon, authenticated;
grant execute on function public.activity_read(uuid, uuid, text, uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, timestamptz, uuid, integer) to service_role;
grant execute on function public.activity_chain(uuid, uuid, uuid, text) to service_role;
grant execute on function public.activity_for_the_page(uuid, integer) to service_role;
grant execute on function public.activity_ledger_health(uuid) to service_role;
