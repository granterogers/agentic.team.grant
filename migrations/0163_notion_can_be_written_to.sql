-- Notion can be written to, and a teamspace has to be made by hand.
--
-- Two answers, and they belong together because the second is what the first
-- runs into.
--
-- ## The verb that was missing
--
-- Grant asked the Chief of Staff to populate a Notion teamspace and she said:
-- *"I can't actually create the pages or upload files."* That was **true**.
-- The connector is enabled, the token works, `verify:notion` passes twelve live
-- checks — and all twelve are reads. `syncNotion` pulls pages in; nothing ever
-- pushed one out, and `tool_permissions` had no `notion.write` row at all.
--
-- Worth recording because the previous fix was about her claiming things that
-- were false. This one she got right, and the honest response is to build the
-- verb rather than to argue with her.
--
-- ## Level 2, not 1 and not 3
--
-- §13 puts "creating external resources" in the middle tier: *"medium risk,
-- with confirmation."* Writing a page into his workspace is visible, reversible
-- by archiving it, and not destructive — the same class as `notebook.write`,
-- which sits at 2 for the same reasons. Level 3 would need explicit approval
-- per page and make the team useless for the job he actually asked for; level 1
-- would let it write silently.
--
-- Deletion is NOT granted. There is no delete in `src/notion/write.ts` and none
-- here, so the strongest thing a mistake can be is a page he archives.
--
-- ## Teamspaces are his to create, and now he gets asked
--
-- Grant: *"moving forward, then, I will need to manually create teamspaces (for
-- which I should be prompted) for new projects that I define?"*
--
-- Yes, and the reason is Notion's, not ours: the public API exposes no
-- teamspace at all — no endpoint, no field, no parent type — on both API
-- versions tested (0161). Nothing can create one, and nothing can even see that
-- one exists.
--
-- So the prompt. 0158 already built the state for it: a project with no Notion
-- attachment reads as `missing`, and a `wanted` choice means "he means to and
-- has not". A new project now starts at `wanted` for Notion rather than
-- `missing` — the difference between a to-do and a suggestion — and the setup
-- surface can ask for exactly the one thing he has to do by hand.

begin;

-- ---------------------------------------------------------------------------
-- The verb
-- ---------------------------------------------------------------------------

insert into public.tool_permissions (tool, level, description, enabled, disabled_reason)
values (
  'notion.write', 2,
  'Create and update Notion pages: a page in a database, blocks appended to a '
  'page, properties changed. No deletion — src/notion/write.ts contains no '
  'delete, so the worst a mistake can be is a page to archive.',
  true, null
)
on conflict (tool) do update
  set level = excluded.level, description = excluded.description,
      enabled = excluded.enabled, disabled_reason = excluded.disabled_reason;

insert into public.staff_tools (staff_slug, tool, granted_by, note)
select s.slug, 'notion.write', 'migration 0163',
       'Writing project documentation and tasks into Notion is ordinary work '
       'for this team, and the same tier as writing to the notebook.'
  from public.staff s
 where s.active
on conflict (staff_slug, tool) do nothing;

-- ---------------------------------------------------------------------------
-- A new project wants a Notion teamspace, and says so
-- ---------------------------------------------------------------------------
--
-- `wanted` rather than left as `missing`, because the two read differently and
-- the difference is the whole point of 0158: missing is a suggestion nobody has
-- considered, wanted is a job with his name on it.

create or replace function app.hq_create_project(
  p_name      text,
  p_connector text,
  p_ref       text,
  p_display   text default null,
  p_force     boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_slug   text;
  v_prefix text;
  v_id     uuid;
  v_n      integer := 0;
  v_near   jsonb;
begin
  if coalesce(trim(p_name), '') = '' then
    return jsonb_build_object('error', 'a project needs a name');
  end if;
  if coalesce(trim(p_ref), '') = '' then
    return jsonb_build_object(
      'error', 'a project needs at least one source: a notebook or a Notion database'
    );
  end if;
  if p_connector not in ('notebooklm', 'notion', 'upload', 'github') then
    return jsonb_build_object('error', format('%L is not a connector', p_connector));
  end if;

  if not p_force then
    select jsonb_agg(jsonb_build_object(
             'project_id', r.project_id, 'slug', r.slug, 'name', r.name,
             'confidence', r.confidence, 'how', r.how) order by r.confidence desc)
      into v_near
      from app.resolve_project_by_name(p_name) r
     where r.confidence >= 0.55;

    if v_near is not null then
      return jsonb_build_object(
        'needs_confirmation', true,
        'candidates', v_near,
        'question', format(
          'There is already something by that name. Did you mean one of these, '
          'or is %L genuinely new?', trim(p_name))
      );
    end if;
  end if;

  v_slug := left(trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g')), 60);
  if v_slug = '' then v_slug := 'project'; end if;
  v_prefix := left(v_slug, 48);

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
    (project_id, connector, external_ref, display_name, role, ref_kind)
  values (v_id, p_connector, trim(p_ref),
          coalesce(nullif(trim(coalesce(p_display, '')), ''), trim(p_name)), 'source',
          case p_connector when 'notebooklm' then 'notebook'
                           when 'github' then 'repository'
                           when 'notion' then 'database' end);

  perform app.add_project_alias(v_id, trim(p_name), 'name', 1.0);

  -- The one thing about a new project that a machine cannot do for him.
  if p_connector <> 'notion' then
    insert into public.project_connector_choices (project_id, connector, choice, reason, decided_by)
    values (v_id, 'notion', 'wanted',
            'A new project needs a Notion Teamspace, and Notion''s API cannot '
            'create one — no endpoint, no field, no parent type (0161). Make the '
            'teamspace, add a database inside it, share it with the Agentic '
            'integration, and attach that database here.',
            'system')
    on conflict (project_id, connector) do nothing;
  end if;

  return jsonb_build_object(
    'project_id', v_id, 'slug', v_slug, 'name', trim(p_name),
    'needs_you', case when p_connector <> 'notion'
                 then 'a Notion Teamspace, which only you can create' end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- And the same for the projects that already exist
-- ---------------------------------------------------------------------------

insert into public.project_connector_choices (project_id, connector, choice, reason, decided_by)
select p.project_id, 'notion', 'wanted',
       'Needs a Notion Teamspace. Notion''s API cannot create one, so this is '
       'yours to make: teamspace, a database inside it, shared with the Agentic '
       'integration, then attach the database here.',
       'system'
  from public.projects p
 where p.status = 'active'
   and not exists (
     select 1 from public.project_attachments a
      where a.project_id = p.project_id and a.connector = 'notion' and a.enabled
   )
on conflict (project_id, connector) do nothing;

commit;
