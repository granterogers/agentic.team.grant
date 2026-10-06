begin;

-- ---------------------------------------------------------------------------
-- 0920 - an Activity row says which interface the person acted through
--
-- Grant's requirement: Activity must be able to show "Grant via ChatGPT", "Grant via Telegram", "Claude via Team
-- HQ", and filter by user, agent, integration, sync, documents, tasks and calendar. Until now a row carried WHO
-- (`actor`, `actor_kind`) and nothing about WHICH DOOR the request came through.
--
-- ## What is derived and what is stored
--
-- CLAUDE.md: do not store a fact you can already read. The channel IS already readable for most work:
--
--   - an event written by a job names the job (`events.related_job_id`), and the job knows its door: an inbound turn
--     records `origin_channel` (telegram, slack, voice, teamhq), and an MCP job is `requested_by = 'mcp:<client>'`
--     with `origin_kind = 'mcp'`.
--   - a task or a document an external assistant adds is stamped with the client that added it
--     (`tasks.added_by = 'mcp:<client>'`, `documents.added_by = <client>` with connector 'mcp').
--   - a question put through ask_team carries `inbound_commands.context.via` (0922).
--
-- Only one thing is genuinely unreadable afterwards: an event a PERSON's action writes with no job in between (a
-- tool granted from a settings page, a setting changed by an assistant). `events` refuses UPDATE, so it cannot be
-- filled in later: it must be recorded at insert. That is `events.origin_channel`, nullable, written from the
-- transaction's ambient `app.via` by `app.append_event` - so no caller's signature changes (CLAUDE.md: a changed
-- argument list creates a second overload and the wrapper silently drops the parameter), and a caller that does not
-- know its door records NULL.
--
-- ## NULL means unknown, and is shown as unknown
--
-- `via` is NULL whenever nothing says. Team HQ presses that write no event and no channel-bearing row are NOT
-- labelled "Team HQ": that would be a guess, and a guess here is a lie about whether an assistant acted.
--
-- ## Why inbound_commands / deliveries / notification_preferences are NOT widened
--
-- `origin_channel` on those tables answers a different question - which surface can the office REPLY into - and
-- every one of them is read by an adapter that must be able to send there. ChatGPT and Claude are not delivery
-- surfaces: the answer to a question asked through MCP is read back with check_job, not pushed. Adding the words to
-- those CHECKs would create a channel that no adapter, no `DeliveryChannel`, no preference and no `adapter_key_ok`
-- branch can serve - a word with nothing behind it (0311's two words for one thing, and 0298's claim with no
-- performer). The provenance vocabulary is its own, on `events`, and `app.via_label` is its one reader.
--
-- ## Harness traffic
--
-- Both readers now also refuse an event whose JOB is harness traffic (`app.harness_job`, the canonical predicate),
-- beside the actor-name and fixture-project filters they already had. This only ever hides harness rows.
-- ---------------------------------------------------------------------------

-- 1. What an external assistant IS, said once, by the client row.
alter table public.mcp_clients add column if not exists kind text;

create or replace function app.mcp_client_kind_default()
returns trigger
language plpgsql
set search_path = ''
as $f$
begin
  if new.kind is null then
    new.kind := case
      when new.display_name ilike '%chatgpt%' or new.display_name ilike '%openai%' then 'chatgpt'
      when new.display_name ilike '%claude%' or new.display_name ilike '%anthropic%' then 'claude'
      else 'other'
    end;
  end if;
  return new;
end
$f$;

drop trigger if exists mcp_clients_kind_default on public.mcp_clients;
create trigger mcp_clients_kind_default
  before insert or update of display_name, kind on public.mcp_clients
  for each row execute function app.mcp_client_kind_default();

update public.mcp_clients set kind = kind where kind is null;

alter table public.mcp_clients drop constraint if exists mcp_clients_kind_known;
alter table public.mcp_clients
  add constraint mcp_clients_kind_known check (kind in ('chatgpt', 'claude', 'other'));
alter table public.mcp_clients alter column kind set not null;

-- 2. The one column that cannot be derived.
alter table public.events add column if not exists origin_channel text;
alter table public.events drop constraint if exists events_origin_channel_known;
alter table public.events
  add constraint events_origin_channel_known
  check (origin_channel is null
         or origin_channel in ('teamhq', 'chatgpt', 'claude', 'mcp', 'telegram', 'slack', 'voice'));

-- 3. The vocabulary, once.
create or replace function app.via_label(p_channel text)
returns text
language sql
immutable
set search_path = ''
as $f$
  select case p_channel
    when 'teamhq'   then 'Team HQ'
    when 'chatgpt'  then 'ChatGPT'
    when 'claude'   then 'Claude'
    when 'mcp'      then 'External assistant'
    when 'telegram' then 'Telegram'
    when 'slack'    then 'Slack'
    when 'voice'    then 'Voice'
  end
$f$;

-- The transaction's declared door. Only a word in the vocabulary counts; anything else is NULL, never an error:
-- a ledger write must not fail because somebody set a setting badly.
create or replace function app.ambient_via()
returns text
language sql
stable
set search_path = ''
as $f$
  select case when v in ('teamhq', 'chatgpt', 'claude', 'mcp', 'telegram', 'slack', 'voice') then v end
    from (select nullif(btrim(current_setting('app.via', true)), '') as v) s
$f$;

create or replace function app.client_via(p_client_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $f$
  select case k.kind when 'chatgpt' then 'chatgpt' when 'claude' then 'claude' else 'mcp' end
    from public.mcp_clients k where k.client_id = p_client_id
$f$;

-- The door a job came through, or NULL when nothing recorded one.
create or replace function app.job_via(p_job_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $f$
  select case
    when j.requested_by like 'mcp:%' then app.client_via(substring(j.requested_by from 5))
    else coalesce(
      (select case when c.context ->> 'via' in ('chatgpt', 'claude', 'mcp') then c.context ->> 'via' end
         from public.inbound_commands c where c.command_id = j.origin_command_id),
      j.origin_channel)
  end
  from public.jobs j where j.job_id = p_job_id
$f$;

create or replace function app.job_via_label(p_job_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $f$ select app.via_label(app.job_via(p_job_id)) $f$;

-- What stamped a task or a document: an external client names itself in added_by / completed_by, and a job names its
-- own door. Neither says anything for a person's own press, which stays NULL.
create or replace function app.actor_via_label(p_actor text, p_job uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $f$
  select app.via_label(coalesce(
    case when p_actor like 'mcp:%' then app.client_via(substring(p_actor from 5))
         else app.client_via(p_actor) end,
    app.job_via(p_job)))
$f$;

create or replace function app.event_channel(p_origin text, p_job uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $f$ select coalesce(p_origin, app.job_via(p_job)) $f$;

-- The label for an event row. A SYNC has no person at a door; it is labelled by the integration that ran it, and only
-- for a system actor, so a person's own act is never relabelled as one.
create or replace function app.event_via_label(p_origin text, p_job uuid, p_action text, p_actor_kind text)
returns text
language sql
stable
security definer
set search_path = ''
as $f$
  select coalesce(
    app.via_label(app.event_channel(p_origin, p_job)),
    case when p_actor_kind = 'system' and p_action ~ '^(google|drive|gmail|calendar)[.]' then 'Google sync'
         when p_actor_kind = 'system' and p_action ~ '^notion[.]' then 'Notion sync'
    end)
$f$;

-- The category an Activity filter groups by, from the action alone.
create or replace function app.activity_category(p_action text)
returns text
language sql
immutable
set search_path = ''
as $f$
  select case
    when p_action ~ '^(task|tasks|chore)[.]' then 'task'
    when p_action ~ '^(document|doc|artifact|source|report)[.]' or p_action = 'notebook.source_added' then 'document'
    when p_action ~ '^(calendar|event)[.]' then 'calendar'
    when p_action ~ '^(drive|google|gmail|notion|sync|mail)[.]' then 'sync'
    when p_action ~ '^(finding|research|browser)[.]' or p_action = 'notebook.ask' then 'research'
    else 'other'
  end
$f$;

-- 4. append_event records the ambient door. Spliced from the live definition.
CREATE OR REPLACE FUNCTION app.append_event(p_office uuid, p_correlation_id uuid, p_actor_kind text, p_actor text, p_trigger text, p_action_type text, p_reversible boolean, p_project_id uuid DEFAULT NULL::uuid, p_before_state jsonb DEFAULT NULL::jsonb, p_after_state jsonb DEFAULT NULL::jsonb, p_rationale_summary text DEFAULT NULL::text, p_source_refs jsonb DEFAULT '[]'::jsonb, p_provider_used text DEFAULT NULL::text, p_tool_used text DEFAULT NULL::text, p_reversal_method text DEFAULT NULL::text, p_related_job_id uuid DEFAULT NULL::uuid, p_related_task_id uuid DEFAULT NULL::uuid, p_compensates_event_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_id uuid;
begin
  perform app.require_office(p_office);
  insert into public.events (
    office_id, correlation_id, actor_kind, actor, trigger, action_type, reversible,
    project_id, before_state, after_state, rationale_summary, source_refs,
    provider_used, tool_used, reversal_method, related_job_id, related_task_id,
    compensates_event_id, origin_channel
  ) values (
    p_office, p_correlation_id, p_actor_kind, p_actor, p_trigger, p_action_type, p_reversible,
    p_project_id, p_before_state, p_after_state, p_rationale_summary, p_source_refs,
    p_provider_used, p_tool_used, p_reversal_method, p_related_job_id, p_related_task_id,
    p_compensates_event_id, app.ambient_via()
  )
  returning event_id into v_id;
  return v_id;
end
$function$;

-- 5. The two Activity readers.
CREATE OR REPLACE FUNCTION app.hq_studio_lately(p_office uuid, p_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
  with
  -- A window to summarise from, deliberately wider than the page: collapsing
  -- forty rows into eight and then showing eight is a shorter page, not a
  -- better one.
  recent as (
    select e.event_id, e.actor, e.actor_kind, e.action_type, e.rationale_summary,
           e.project_id, e.occurred_at, e.reversible, e.reversal_method,
           p.name as project_name,
           app.event_via_label(e.origin_channel, e.related_job_id, e.action_type, e.actor_kind) as via,
           app.activity_category(e.action_type) as category
      from public.events e
      left join public.projects p on p.project_id = e.project_id and p.office_id = p_office
     where e.office_id = p_office
       and (p.project_id is null or not p.is_fixture)
       and not app.harness_label(e.actor)
       and (e.related_job_id is null or not app.harness_job(e.related_job_id))
     order by e.occurred_at desc
     limit greatest(coalesce(p_limit, 40), 1) * 10
  ),
  ranked as (
    select r.*,
           row_number() over (partition by r.actor, r.action_type, r.project_id, r.via
                              order by r.occurred_at desc) as n
      from recent r
  ),
  kept as (
    select jsonb_build_object(
             'id', k.event_id,
             'who', case when k.actor is not distinct from app.office_actor(p_office) then 'you' else k.actor end,
             'kind', k.actor_kind,
             'verb', app.action_in_words(k.action_type) ->> 'verb',
             'what', app.action_in_words(k.action_type) ->> 'what',
             'why', k.rationale_summary,
             'project', k.project_name,
             'when', to_char(k.occurred_at, 'FMDD Mon HH24:MI'),
             'at', k.occurred_at,
             'reversible', k.reversible,
             'undo_with', k.reversal_method,
             'via', k.via,
             'category', k.category
           ) as v, k.occurred_at as at
      from ranked k
     where k.n <= 2
  ),
  -- The rest of each group, as one row that says how many and when the last of
  -- them was. Placed at the newest of the ones it stands for, so it sits
  -- directly under the two that are shown rather than at the bottom of the day.
  folded as (
    select jsonb_build_object(
             'id', null,
             'who', case when f.actor is not distinct from app.office_actor(p_office) then 'you' else f.actor end,
             'kind', min(f.actor_kind),
             'verb', app.action_in_words(f.action_type) ->> 'verb',
             'what', app.action_in_words(f.action_type) ->> 'what',
             'why', null,
             'project', min(f.project_name),
             'when', to_char(max(f.occurred_at), 'FMDD Mon HH24:MI'),
             'at', max(f.occurred_at),
             'times', count(*)::int,
             'reversible', false,
             'undo_with', null,
             'via', f.via,
             'category', min(f.category)
           ) as v, max(f.occurred_at) as at
      from ranked f
     where f.n > 2
     group by f.actor, f.action_type, f.project_id, f.via
  ),
  office as (
    select coalesce(jsonb_agg(x.v order by x.at desc), '[]'::jsonb) as v
      from (
        select v, at from kept
        union all
        select v, at from folded
        order by at desc
        limit greatest(coalesce(p_limit, 40), 1)
      ) x
  ),
  -- the build log is the deployment's own: only its operator reads it
  building as (select case when app.office_sees_the_deployment(p_office) then app.hq_build() else '{}'::jsonb end as v),
  today as (
    select jsonb_build_object(
      'events', (select count(*)::int
                   from public.events e
                   left join public.projects p on p.project_id = e.project_id and p.office_id = p_office
                  where e.office_id = p_office
                    and e.occurred_at > app.now_utc() - interval '24 hours'
                    and not app.harness_label(e.actor)
                    and (e.related_job_id is null or not app.harness_job(e.related_job_id))
                    and (p.project_id is null or not p.is_fixture)),
      'jobs_done', (select count(*)::int from public.jobs j
                     where j.office_id = p_office and not app.harness_job(j.job_id) and j.state = 'complete'
                       and j.updated_at > app.now_utc() - interval '24 hours'),
      'jobs_failed', (select count(*)::int from public.jobs j
                       where j.office_id = p_office and not app.harness_job(j.job_id) and j.state = 'failed'
                         and j.updated_at > app.now_utc() - interval '24 hours')
    ) as v
  )
  select jsonb_build_object(
    'office', (select v from office),
    'building', (select v from building),
    'today', (select v from today),
    'generated_at', app.now_utc()
  )
  );
end
$function$;

CREATE OR REPLACE FUNCTION app.studio_activity(p_project_id uuid, p_limit integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with window_start as (select app.now_utc() - interval '45 days' as t),
  staff_slugs as (select slug from public.staff),
  proj as (
    select p.project_id, p.office_id, p.created_at, p.is_fixture
      from public.projects p where p.project_id = p_project_id and not p.is_fixture
  ),
  ledger as (
    select case when e.actor in (select slug from staff_slugs) then e.actor
                    when e.actor is not distinct from app.office_actor(proj.office_id) then 'you'
                    else e.actor end as who,
           app.action_in_words(e.action_type) ->> 'verb' as verb,
           app.action_in_words(e.action_type) ->> 'what' as what,
           e.occurred_at as at,
           e.rationale_summary as detail,
           app.event_via_label(e.origin_channel, e.related_job_id, e.action_type, e.actor_kind) as via,
           app.activity_category(e.action_type) as category
      from public.events e, proj
     where e.project_id = proj.project_id and e.office_id = proj.office_id
       and not app.harness_label(e.actor)
       and (e.related_job_id is null or not app.harness_job(e.related_job_id))
       -- The office's own plumbing is not what happened on the project: a committed finding is the answer line below
       -- said once, and the ledger, gate and backup rows are about the machinery.
       and e.action_type !~ '^(ledger|gate[0-9]|backup)\.'
       and e.action_type not in ('finding.committed', 'job.committed')
     order by e.occurred_at desc
     limit 40
  ),
  made as (
    select case when t.added_by in (select slug from staff_slugs) then t.added_by else 'you' end as who,
           date_trunc('day', t.created_at) as day,
           count(*) as n, max(t.created_at) as at,
           (array_agg(t.title order by t.created_at desc))[1] as one,
           app.actor_via_label(t.added_by, t.job_id) as via
      from public.tasks t, proj, window_start w
     where t.project_id = proj.project_id and t.office_id = proj.office_id
       and t.state <> 'cancelled' and t.created_at >= w.t
       and not app.harness_task(t.is_fixture, t.job_id)
     group by 1, 2, app.actor_via_label(t.added_by, t.job_id)
  ),
  finished as (
    select case when t.completed_by in (select slug from staff_slugs) then t.completed_by else 'you' end as who,
           date_trunc('day', t.done_at) as day,
           count(*) as n, max(t.done_at) as at,
           (array_agg(t.title order by t.done_at desc))[1] as one,
           app.actor_via_label(t.completed_by, null) as via
      from public.tasks t, proj, window_start w
     where t.project_id = proj.project_id and t.office_id = proj.office_id
       and t.state = 'done' and t.done_at is not null and t.done_at >= w.t
       and not app.harness_task(t.is_fixture, t.job_id)
     group by 1, 2, app.actor_via_label(t.completed_by, null)
  ),
  filed as (
    select case when coalesce(d.produced_by, d.added_by) in (select slug from staff_slugs)
                then coalesce(d.produced_by, d.added_by) else 'you' end as who,
           d.origin, date_trunc('day', d.created_at) as day,
           count(*) as n, max(d.created_at) as at,
           (array_agg(d.title order by d.created_at desc))[1] as one,
           app.actor_via_label(d.added_by, d.produced_by_job) as via
      from public.documents d, proj, window_start w
     where d.project_id = proj.project_id and d.office_id = proj.office_id
       and (d.origin in ('yours', 'made') or d.connector = 'mcp') and d.state <> 'archived' and d.created_at >= w.t
     group by 1, 2, 3, app.actor_via_label(d.added_by, d.produced_by_job)
  ),
  met as (
    select date_trunc('day', c.created_at) as day, count(*) as n, max(c.created_at) as at,
           (array_agg(c.name order by c.created_at desc))[1] as one
      from public.contacts c, proj, window_start w
     where c.project_id = proj.project_id and c.archived_at is null
       and c.created_at >= w.t and not c.is_fixture
       and exists (select 1 from public.projects pp where pp.project_id = c.project_id and pp.office_id = proj.office_id)
     group by 1
  ),
  answered as (
    select s.slug as who, date_trunc('day', o.created_at) as day, count(*) as n, max(o.created_at) as at,
           app.job_via_label(j.job_id) as via,
           case when j.kind ~ '^(browser|research|notebook[.]ask)' then 'research' else 'other' end as category
      from public.outputs o
      join public.jobs j on j.job_id = o.job_id
      join public.staff s on s.staff_id = o.staff_id, proj, window_start w
     where j.project_id = proj.project_id and j.office_id = proj.office_id
       and o.created_at >= w.t and not app.harness_job(j.job_id)
     group by 1, 2, 5, 6
  ),
  lines as (
    select who, verb, what, at, detail, via, category from ledger
    union all
    select who, 'added',
           case when n = 1 then format('the task "%s"', one) else format('%s tasks', n) end, at, null, via, 'task' from made
    union all
    select who, 'completed',
           case when n = 1 then format('the task "%s"', one) else format('%s tasks', n) end, at, null, via, 'task' from finished
    union all
    select who, case when origin = 'made' then 'made' else 'added' end,
           case when n = 1 then format('the document "%s"', left(one, 70)) else format('%s documents', n) end, at, null, via, 'document' from filed
    union all
    select 'you', 'added',
           case when n = 1 then format('the contact %s', one) else format('%s contacts', n) end, at, null, null::text, 'other' from met
    union all
    select who, 'answered', case when n = 1 then 'a request' else format('%s requests', n) end, at, null, via, category from answered
    union all
    select 'you', 'created', 'this project', proj.created_at, null, null::text, 'other' from proj, window_start w where proj.created_at >= w.t
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'who', l.who,
           'verb', l.verb,
           'what', l.what,
           'when', to_char(l.at, 'FMDD Mon HH24:MI'),
           'at', l.at,
           'detail', l.detail,
           'via', l.via,
           'category', l.category
         ) order by l.at desc), '[]'::jsonb)
    from (select * from lines order by at desc limit greatest(coalesce(p_limit, 12), 1)) l
$function$;

commit;
