-- 0073 — the front end can configure projects
--
-- Grant: *"rather than me necessarily sending you a Notion link, I want to be
-- able to do it via the front end. […] The idea with this entire project is
-- that it's customizable and theoretically I could give the repo to somebody
-- else and they could run it for their own projects. So the projects and stuff
-- shouldn't be baked in."*
--
-- Which is the right test for every decision here, and one this has been
-- failing: `npm run project` is a command a person types in a terminal they do
-- not have. Everything it does becomes an HQ endpoint.
--
-- ## Why writes, on a dashboard that has been read-only on purpose
--
-- Team HQ is read-only because a dashboard where you can do something
-- irreversible by accident is worse than one where you can do nothing. That
-- reasoning holds for *acting* — cancelling a job, approving an output — and
-- not for *configuring*. Attaching a Notion database is a row; detaching it is
-- another row; neither loses anything, and the corpus a connector fed survives
-- the connector being removed (ADR-0013). So configuration is writable and
-- action stays read-only, which is a line worth keeping sharp.
--
-- Deleting a project is deliberately NOT here. It cascades to documents, and
-- the whole design says a route may be closed but a corpus is kept. Archiving
-- is the operation, and it is reversible.

begin;

create or replace function app.hq_create_project(
  p_name       text,
  p_connector  text,
  p_ref        text,
  p_display    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_slug text;
  v_prefix text;
  v_id uuid;
  v_n integer := 0;
begin
  if coalesce(trim(p_name), '') = '' then
    return jsonb_build_object('error', 'a project needs a name');
  end if;
  if coalesce(trim(p_ref), '') = '' then
    -- 0067's rule, restated where a person meets it. A project attached to
    -- nothing has nothing to read and nowhere to write; the database refuses
    -- it anyway, and saying so before the transaction is kinder than after.
    return jsonb_build_object(
      'error', 'a project needs at least one source: a notebook or a Notion database'
    );
  end if;
  if p_connector not in ('notebooklm', 'notion', 'upload') then
    return jsonb_build_object('error', format('%L is not a connector', p_connector));
  end if;

  v_slug := left(trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g')), 60);
  if v_slug = '' then v_slug := 'project'; end if;
  v_prefix := left(v_slug, 48);

  -- A name someone else already used is a suffix, not an error. The front end
  -- should not make Grant think of a different name for his own project.
  while exists (select 1 from public.projects where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := left(v_prefix, 56) || '-' || v_n::text;
    if v_n > 50 then
      return jsonb_build_object('error', 'could not find a free slug for that name');
    end if;
  end loop;

  insert into public.projects (slug, name, channel_prefix, status)
  values (v_slug, trim(p_name), v_prefix, 'active')
  returning project_id into v_id;

  insert into public.project_attachments
    (project_id, connector, external_ref, display_name, role)
  values (v_id, p_connector, trim(p_ref), coalesce(nullif(trim(coalesce(p_display, '')), ''), trim(p_name)), 'source');

  return jsonb_build_object('project_id', v_id, 'slug', v_slug, 'name', trim(p_name));
end;
$$;

create or replace function app.hq_rename_project(p_slug text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_prefix text;
  v_id uuid;
begin
  if coalesce(trim(p_name), '') = '' then
    return jsonb_build_object('error', 'a project needs a name');
  end if;
  select project_id into v_id from public.projects where slug = p_slug;
  if v_id is null then
    return jsonb_build_object('error', format('no project %L', p_slug));
  end if;

  v_prefix := left(trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g')), 48);
  update public.projects
     set name = trim(p_name), channel_prefix = nullif(v_prefix, '')
   where project_id = v_id;

  -- The Slack channels follow, but not from here: renaming a channel is a
  -- Slack API call and this is SQL. The page reports that the rename is
  -- pending and the worker carries it out, rather than the page claiming a
  -- rename it cannot perform.
  insert into public.jobs
    (correlation_id, project_id, idempotency_key, kind, requested_by, priority, pinned_config)
  values (gen_random_uuid(), v_id, format('rename-%s-%s', v_id, gen_random_uuid()),
          'office.rename_channels', 'hq', 300,
          jsonb_build_object('prefix', v_prefix));

  return jsonb_build_object(
    'slug', p_slug, 'name', trim(p_name), 'channel_prefix', v_prefix,
    'note', 'channels will be renamed by the worker on its next pass'
  );
end;
$$;

create or replace function app.hq_attach(
  p_slug text, p_connector text, p_ref text, p_role text default 'source',
  p_kind text default null, p_display text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id uuid;
begin
  select project_id into v_id from public.projects where slug = p_slug;
  if v_id is null then return jsonb_build_object('error', format('no project %L', p_slug)); end if;
  if p_connector not in ('notebooklm', 'notion', 'upload', 'mcp') then
    return jsonb_build_object('error', format('%L is not a connector', p_connector));
  end if;
  if p_role = 'home' and p_kind is null then
    return jsonb_build_object('error', 'a home must say what it is the home for');
  end if;

  insert into public.project_attachments
    (project_id, connector, external_ref, display_name, role, artifact_kind)
  values (v_id, p_connector, trim(p_ref),
          coalesce(nullif(trim(coalesce(p_display, '')), ''), trim(p_ref)), p_role,
          case when p_role = 'home' then p_kind else null end)
  on conflict do nothing;

  return jsonb_build_object('slug', p_slug, 'connector', p_connector, 'role', p_role);
end;
$$;

create or replace function app.hq_detach(p_attachment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_project uuid;
begin
  select project_id into v_project
    from public.project_attachments where attachment_id = p_attachment_id;
  if v_project is null then return jsonb_build_object('error', 'no such attachment'); end if;

  -- Disabled, not deleted, and the documents it fed are untouched. ADR-0013:
  -- closing a route loses the route, never the corpus.
  update public.project_attachments
     set enabled = false, disabled_reason = 'detached from Team HQ'
   where attachment_id = p_attachment_id;

  return jsonb_build_object('detached', p_attachment_id);
end;
$$;

create or replace function app.hq_projects()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) from (
    select jsonb_build_object(
             'project_id', p.project_id,
             'slug', p.slug,
             'name', p.name,
             'channel_prefix', p.channel_prefix,
             'status', p.status,
             'documents', (select count(*) from public.documents d where d.project_id = p.project_id),
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
$$;

-- The public wrappers, written out rather than generated.
--
-- A loop building `create function` with `format` was shorter and was wrong:
-- it had to reconstruct each parameter list from the signature string, got
-- `ordinality` out of nowhere, and would have been unreadable even if it had
-- worked. PostgREST serves only `public` (0042, 0046, 0066, 0068, 0072 — five
-- times), so these exist; five plain functions are the honest cost of that.

create or replace function public.hq_create_project(
  p_name text, p_connector text, p_ref text, p_display text default null
) returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_create_project(p_name, p_connector, p_ref, p_display) $$;

create or replace function public.hq_rename_project(p_slug text, p_name text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_rename_project(p_slug, p_name) $$;

create or replace function public.hq_attach(
  p_slug text, p_connector text, p_ref text, p_role text default 'source',
  p_kind text default null, p_display text default null
) returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_attach(p_slug, p_connector, p_ref, p_role, p_kind, p_display) $$;

create or replace function public.hq_detach(p_attachment_id uuid)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_detach(p_attachment_id) $$;

create or replace function public.hq_projects()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.hq_projects() $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'app.hq_create_project(text, text, text, text)',
    'public.hq_create_project(text, text, text, text)',
    'app.hq_rename_project(text, text)', 'public.hq_rename_project(text, text)',
    'app.hq_attach(text, text, text, text, text, text)',
    'public.hq_attach(text, text, text, text, text, text)',
    'app.hq_detach(uuid)', 'public.hq_detach(uuid)',
    'app.hq_projects()', 'public.hq_projects()'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to ai_team_app, service_role', fn);
  end loop;
end $$;

commit;
