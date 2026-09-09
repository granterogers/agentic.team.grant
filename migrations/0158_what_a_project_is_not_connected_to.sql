-- What a project is NOT connected to.
--
-- Grant, §3: *"If a project exists in Supabase but has no corresponding
-- Notebook or Notion counterpart, this should be visible and repairable"* — and
-- the five things he wants to be able to do about it: connect an existing
-- Notebook, connect an existing Notion page, create a new Notebook, create a
-- new Notion project, or **deliberately leave it disconnected**.
--
-- The audit found nothing that computes any of this. `hq_projects` lists the
-- attachments a project HAS; nothing anywhere says what it is missing, and
-- "missing" is the entire question. Both live projects have exactly one
-- attachment each and neither has Notion or GitHub — invisible today.
--
-- ## Why the fifth option needs its own table
--
-- The other four end in a `project_attachments` row. The fifth cannot: that
-- table's `external_ref` is `not null`, and rightly — a row there means "this
-- project is attached to this thing", and every query in the system reads it
-- that way. A row with an invented ref meaning "attached to nothing, on
-- purpose" would make the table mean two things, and the next person to count
-- attachments would be wrong.
--
-- So the decision lives beside the attachments rather than inside them. It is
-- not a parallel system: it holds no refs, no sync state and no roles. It
-- records one fact about one connector that the attachment table has no way to
-- express — that its absence is deliberate.
--
-- ## And the fourth state, which is not a decision at all
--
-- `wanted` earns its place next to `declined` because "I do want Notion here,
-- I just have not done it" and "I have never thought about it" should not look
-- the same on the page. One is a to-do; the other is a suggestion. Without the
-- distinction the interface has to nag about everything or nothing.
--
-- ## Broken, and how a project knows
--
-- An attachment can exist and still not work, because the service behind it is
-- down or the credential has expired. `connection_health` already tracks that,
-- per service — but nothing joined the two, because a connector had no way to
-- say which service it depends on. One column fixes that, and a project can
-- then distinguish "no Notion page" from "a Notion page we currently cannot
-- reach", which need completely different things from Grant.

begin;

-- ---------------------------------------------------------------------------
-- Which service a connector actually depends on
-- ---------------------------------------------------------------------------

alter table public.knowledge_connectors
  add column if not exists health_service text;

comment on column public.knowledge_connectors.health_service is
  'The `connection_health.service` this connector depends on, so a project can '
  'tell "not connected" from "connected but the service is down". Null means '
  'nothing external can fail — an upload has no service behind it.';

update public.knowledge_connectors set health_service = 'Google'  where connector = 'notebooklm';
update public.knowledge_connectors set health_service = 'Notion'  where connector = 'notion';
update public.knowledge_connectors set health_service = 'GitHub'  where connector = 'github';
-- `upload` and `mcp` keep null on purpose: an uploaded document is already in
-- the database and cannot become unreachable because a vendor is having a bad
-- morning.

-- ---------------------------------------------------------------------------
-- The decision
-- ---------------------------------------------------------------------------

create table if not exists public.project_connector_choices (
  project_id  uuid not null references public.projects(project_id) on delete cascade,
  connector   text not null references public.knowledge_connectors(connector),
  choice      text not null check (choice in ('declined', 'wanted')),
  reason      text,
  decided_by  text not null default 'grant',
  decided_at  timestamptz not null default app.now_utc(),
  primary key (project_id, connector)
);

comment on table public.project_connector_choices is
  'What Grant has decided about a connector a project does not have: `declined` '
  '(leave it alone) or `wanted` (do it, not yet done). Absence of a row means '
  'nobody has considered it, which is a third thing and reads differently on '
  'the page (0158).';

alter table public.project_connector_choices enable row level security;
alter table public.project_connector_choices force row level security;

drop policy if exists project_connector_choices_app on public.project_connector_choices;
create policy project_connector_choices_app on public.project_connector_choices
  for all to ai_team_app using (true) with check (true);

grant select, insert, update, delete on public.project_connector_choices to ai_team_app;

-- ---------------------------------------------------------------------------
-- Every connector, and where this project stands with it
-- ---------------------------------------------------------------------------
--
-- One row per FIRST-CLASS connector, whether or not the project uses it —
-- because the row that matters most is the one for the connector it has never
-- heard of. `upload` and `mcp` are excluded: they are how a document arrives,
-- not somewhere a project lives, and listing them as "missing" would be telling
-- Grant to go and connect something that is not a place.

create or replace function app.project_connections(p_project_id uuid)
returns table (
  connector   text,
  name        text,
  state       text,
  detail      text,
  external_ref text,
  external_url text,
  role        text,
  last_synced_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    k.connector,
    k.name,
    case
      -- Connected, but the service behind it is not answering. Distinct from
      -- missing, and needing something completely different from Grant.
      when a.attachment_id is not null and h.state in ('dead', 'missing')
        then 'broken'
      when a.attachment_id is not null then 'connected'
      when c.choice = 'declined' then 'declined'
      when c.choice = 'wanted'   then 'wanted'
      else 'missing'
    end as state,
    case
      when a.attachment_id is not null and h.state in ('dead', 'missing')
        then coalesce(k.name || ' is not answering: ' || coalesce(h.detail, h.state), 'not answering')
      when a.attachment_id is not null then a.display_name
      when c.choice is not null then c.reason
      else null
    end as detail,
    a.external_ref,
    a.external_url,
    a.role,
    a.last_synced_at
  from public.knowledge_connectors k
  left join public.project_attachments a
    on a.project_id = p_project_id and a.connector = k.connector and a.enabled
  left join public.project_connector_choices c
    on c.project_id = p_project_id and c.connector = k.connector
  -- The worst state recorded for the service, so one dead credential is not
  -- hidden by a healthy row beside it. `connection_health` holds several rows
  -- per service (Google has four).
  left join lateral (
    select ch.state, ch.detail
      from public.connection_health ch
     where ch.service = k.health_service
     order by case ch.state
                when 'dead' then 0 when 'missing' then 1 when 'unknown' then 2
                when 'ok' then 3 else 4 end
     limit 1
  ) h on true
  where k.enabled
    and k.connector not in ('upload', 'mcp')
  order by
    -- What needs attention first, then alphabetical. A list ordered by name
    -- buries the one broken row in the middle.
    case
      when a.attachment_id is not null and h.state in ('dead', 'missing') then 0
      when c.choice = 'wanted' then 1
      when a.attachment_id is null and c.choice is null then 2
      when a.attachment_id is not null then 3
      else 4
    end,
    k.connector
$$;

comment on function app.project_connections(uuid) is
  'Every first-class connector and this project''s standing with it: connected, '
  'broken, wanted, declined, or missing. Ordered by what needs attention (0158).';

-- ---------------------------------------------------------------------------
-- Recording a decision
-- ---------------------------------------------------------------------------

create or replace function app.hq_connection_choose(
  p_slug      text,
  p_connector text,
  p_choice    text,
  p_reason    text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_project uuid;
begin
  select project_id into v_project from public.projects where slug = p_slug and status = 'active';
  if v_project is null then
    return jsonb_build_object('error', format('no active project called %L', p_slug));
  end if;
  if not exists (select 1 from public.knowledge_connectors where connector = p_connector and enabled) then
    return jsonb_build_object('error', format('%L is not a connector', p_connector));
  end if;

  -- `clear` removes the decision rather than storing a third value, so
  -- "changed my mind" and "never considered" end up in the same state — which
  -- they are.
  if p_choice = 'clear' then
    delete from public.project_connector_choices
     where project_id = v_project and connector = p_connector;
    return jsonb_build_object('ok', true, 'choice', null);
  end if;

  if p_choice not in ('declined', 'wanted') then
    return jsonb_build_object('error', 'choice must be declined, wanted or clear');
  end if;

  -- Refused rather than silently overwritten: a project that IS connected has
  -- no business also being marked as not wanting the connection, and the way
  -- to stop using one is to detach it.
  if exists (
    select 1 from public.project_attachments
     where project_id = v_project and connector = p_connector and enabled
  ) then
    return jsonb_build_object(
      'error', format('%s is already attached to %s — detach it first', p_connector, p_slug)
    );
  end if;

  insert into public.project_connector_choices (project_id, connector, choice, reason)
  values (v_project, p_connector, p_choice, nullif(btrim(coalesce(p_reason, '')), ''))
  on conflict (project_id, connector) do update
    set choice = excluded.choice, reason = excluded.reason, decided_at = app.now_utc();

  return jsonb_build_object('ok', true, 'choice', p_choice, 'connector', p_connector);
end;
$$;

create or replace function public.hq_connection_choose(
  p_slug text, p_connector text, p_choice text, p_reason text default null
) returns jsonb
language sql security definer set search_path to 'public', 'pg_catalog'
as $$ select app.hq_connection_choose(p_slug, p_connector, p_choice, p_reason) $$;

-- ---------------------------------------------------------------------------
-- And the page can see it
-- ---------------------------------------------------------------------------

create or replace function app.hq_projects()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) from (
    select jsonb_build_object(
             'project_id', p.project_id,
             'slug', p.slug,
             'name', p.name,
             'description', p.description,
             'purpose', p.purpose,
             'channel_prefix', p.channel_prefix,
             'status', p.status,
             'documents', (select count(*) from public.documents d where d.project_id = p.project_id),
             'aliases', (select coalesce(jsonb_agg(jsonb_build_object(
                              'alias', a.alias, 'source', a.source) order by a.confidence desc, a.alias), '[]'::jsonb)
                           from public.project_aliases a
                          where a.project_id = p.project_id and a.source <> 'name'),
             -- Every first-class connector and where this project stands with
             -- it — including the ones it does NOT have, which is the half §3
             -- is about and the half nothing could see before 0158.
             'connections', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
                               from app.project_connections(p.project_id) c),
             'channels', (select coalesce(jsonb_agg(jsonb_build_object(
                              'name', m.channel_name, 'discipline', m.discipline) order by m.channel_name), '[]'::jsonb)
                            from public.slack_channel_map m
                           where m.project_id = p.project_id and m.active),
             'attachments', (select coalesce(jsonb_agg(jsonb_build_object(
                                 'attachment_id', a.attachment_id,
                                 'connector', a.connector,
                                 'external_ref', a.external_ref,
                                 'display_name', a.display_name,
                                 'role', a.role,
                                 'artifact_kind', a.artifact_kind) order by a.role, a.connector), '[]'::jsonb)
                               from public.project_attachments a
                              where a.project_id = p.project_id and a.enabled)
           ) as x
      from public.projects p
     where p.status = 'active'
  ) s
$function$;

commit;
