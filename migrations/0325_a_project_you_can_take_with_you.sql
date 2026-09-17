begin;

/**
 * A project you can take with you, and one you can put away.
 *
 * Issue #36, under #25 — the last two of Project Settings' six sections, and
 * the two the Issue says explicitly not to defer:
 *
 *   > Archive and export are the vendor-lock-in answer and should not be
 *   > deferred to a later milestone on the grounds that nobody has asked to
 *   > leave yet.
 *
 * §13 of the frontend prompt names the shape:
 *
 *     project-package/
 *         project.json
 *         documents/
 *         covers/
 *         images/
 *         attachments/
 *
 * ## What this half does, and what the page does
 *
 * This produces the CONTENT of `project.json` — everything the office knows
 * about one dashboard project, as one JSON document, with nothing in it that
 * only makes sense inside this database. The page turns that into a folder of
 * files and hands it over.
 *
 * The split is deliberate. Postgres is the only thing that can read all
 * fourteen tables consistently, and it is the wrong place to build a zip. And
 * it means the export is reachable from the API, from a script, and from a
 * future import adapter without any of them going through a browser.
 *
 * ## Neutral means neutral
 *
 * No `project_id`, no `document_id`, no `staff_id`. A uuid is an identity in
 * THIS database and nowhere else; a package full of them re-imports only into
 * the system it came from, which is vendor lock-in wearing a JSON hat.
 * Everything is named: the project by slug and name, a person by name and
 * role, a collection by its name, a document by a stable relative PATH inside
 * the package.
 *
 * ## Archive is not delete
 *
 * `app.project_delete` exists and refuses a project holding documents or jobs,
 * which is nearly all of them. Archiving is the reversible thing Grant
 * actually wants — the project leaves his switcher and everything it holds
 * stays — and it is reversible from here too. ADR-0014's order is not involved
 * because nothing is removed.
 */

-- ---------------------------------------------------------------------------
-- Export
-- ---------------------------------------------------------------------------

/**
 * A stable, readable path for a document inside the package.
 *
 * Derived from the title so a person unzipping it can find things, suffixed
 * with a short hash of the id so two documents called "Notes" do not become
 * one file. Not the uuid alone: a folder of uuids is technically complete and
 * practically useless, which is the failure mode §13 is written against.
 */
create or replace function app.export_path(p_title text, p_id uuid, p_ext text default 'md')
returns text
language sql
immutable
set search_path = ''
as $$
  select 'documents/'
      || coalesce(nullif(left(regexp_replace(
             regexp_replace(lower(btrim(coalesce(p_title, ''))), '[^a-z0-9]+', '-', 'g'),
             '(^-+|-+$)', '', 'g'), 60), ''), 'untitled')
      || '-' || left(replace(p_id::text, '-', ''), 8)
      || '.' || p_ext
$$;

/**
 * Everything the office holds about one dashboard project, as one document.
 *
 * Read-only and complete. If something a person would expect to find is
 * missing from this, the export is not an export — so it carries the brief,
 * the documents with their text, the tasks, the contacts, the collections, the
 * sources both kinds, the team and their local briefs, the automations, and
 * the outputs the office produced. Not the job queue: that is machinery, not
 * the project.
 */
create or replace function app.project_export(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'format', 'ai-team-hq/project-package',
    'format_version', 1,
    'exported_at', app.now_utc(),
    'project', (
      select jsonb_build_object(
               'slug', p.slug, 'name', p.name, 'status', p.status,
               'created_at', p.created_at,
               'brief', (select b.body from public.project_briefs b
                          where b.project_id = p.project_id
                          order by b.generated_at desc limit 1),
               'also_known_as', (select coalesce(jsonb_agg(a.alias order by a.alias), '[]'::jsonb)
                                   from public.project_aliases a
                                  where a.project_id = p.project_id))
        from public.projects p where p.project_id = p_project_id),

    'documents', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'path', app.export_path(d.title, d.document_id),
               'title', d.title,
               'kind', d.doc_type,
               'text', d.content,
               'came_from', d.connector,
               'external_ref', d.external_ref,
               'tags', d.tags,
               -- Named, not identified. `produced_by` is a person's name and
               -- 0284 made it nullable so that a blank one reads as unknown
               -- rather than as the empty string a coalesce could not catch.
               'made_by', nullif(d.produced_by, ''),
               'origin', d.origin,
               'in_collections', (select coalesce(jsonb_agg(c.name order by c.name), '[]'::jsonb)
                                    from public.document_collections dc
                                    join public.collections c using (collection_id)
                                   where dc.document_id = d.document_id),
               'created_at', d.created_at) order by d.created_at), '[]'::jsonb)
        from public.documents d
       where d.project_id = p_project_id and d.state = 'approved'),

    'collections', (
      select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'position', c.position)
                                order by c.position, c.name), '[]'::jsonb)
        from public.collections c where c.project_id = p_project_id),

    'tasks', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'title', t.title, 'state', t.state, 'due', t.due_on,
               'detail', nullif(t.detail, ''),
               -- `assigned_to_human` is a BOOLEAN saying whether this is
               -- Grant's rather than the office's; the person, when it is one
               -- of the team, is `assignee_staff`. Named here, never the uuid.
               'for_grant', t.assigned_to_human,
               'assigned_to', ts.name,
               'blocked_on', nullif(t.blocked_on, ''),
               'milestone', t.is_milestone) order by t.created_at), '[]'::jsonb)
        -- Harness tasks excluded, the same rule the whole product reads by:
        -- an export that carries fixtures is an export of the test suite.
        from public.tasks t
       left join public.staff ts on ts.staff_id = t.assignee_staff
       where t.project_id = p_project_id and not t.is_fixture),

    'contacts', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', ct.name, 'role', nullif(ct.role, ''),
               'org', nullif(ct.org, ''), 'email', nullif(ct.email, ''),
               'phone', nullif(ct.phone, ''), 'website', nullif(ct.website, ''),
               'notes', nullif(ct.note, ''),
               'labels', (select coalesce(jsonb_agg(l.name order by l.name), '[]'::jsonb)
                            from public.contact_label_links ll
                            join public.contact_labels l using (label_id)
                           where ll.contact_id = ct.contact_id))
               order by ct.name), '[]'::jsonb)
        from public.contacts ct where ct.project_id = p_project_id and not ct.is_fixture),

    'sources', app.studio_sources(p_project_id),

    'team', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', s.name, 'role', s.title,
               'on_this_project', (s.slug = 'chief-of-staff' or coalesce(ps.active, true)),
               'brief_here', nullif(coalesce(ps.instruction, ''), ''))
               order by s.name), '[]'::jsonb)
        from public.staff s
        left join public.project_staff ps
          on ps.staff_id = s.staff_id and ps.project_id = p_project_id
       where s.active),

    'automations', app.project_automations(p_project_id),

    'answers', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'by', coalesce(st.name, 'The team'),
               'text', o.body,
               'how_sure', o.confidence,
               'on_what', o.evidence,
               'at', o.created_at) order by o.created_at), '[]'::jsonb)
        from public.outputs o
        join public.jobs j on j.job_id = o.job_id
        left join public.staff st on st.staff_id = o.staff_id
       where j.project_id = p_project_id and not j.is_fixture)
  ))
$$;

comment on function app.project_export is
  '#36, §13. One dashboard project as a neutral JSON document — the contents '
  'of project.json in the package the specification names. No uuids: a package '
  'full of them re-imports only into the database it came from, which is '
  'vendor lock-in wearing a JSON hat. 0325.';

-- ---------------------------------------------------------------------------
-- Archive
-- ---------------------------------------------------------------------------

/**
 * Put a project away, reversibly.
 *
 * Nothing is deleted and nothing is detached: the documents, the sources, the
 * history all stay exactly where they are, and `status` is the one thing that
 * changes. That is what makes the confirmation Grant asked for honest — *"you
 * should always check before making any destructive action with me"* — because
 * the answer to "what happens if I did not mean it" is "press unarchive".
 *
 * Its automations are switched off in the same statement. An archived project
 * whose duties keep firing is a project that is not archived, and the twelve
 * office-wide duties are untouched because they belong to no project.
 */
create or replace function app.archive_project(p_slug text, p_by text default 'grant')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_project uuid; v_name text; v_stopped int;
begin
  select project_id, name into v_project, v_name
    from public.projects where slug = p_slug;
  if v_project is null then
    return jsonb_build_object('ok', false, 'error', format('no project called %s', p_slug));
  end if;

  update public.projects set status = 'archived' where project_id = v_project;

  update public.responsibilities
     set enabled = false, updated_at = app.now_utc()
   where project_id = v_project and enabled;
  get diagnostics v_stopped = row_count;

  return jsonb_build_object(
    'ok', true, 'archived', p_slug, 'name', v_name, 'automations_stopped', v_stopped,
    'reversible', true);
end;
$$;

/**
 * Take it back out again.
 *
 * The automations are NOT switched back on. Archiving stopped them and
 * unarchiving cannot know which of them Grant still wants: turning them all
 * back on would fire a fortnight of missed schedules at him, and this system
 * has done that once already with a narration backlog. They are listed in the
 * answer so the page can offer them.
 */
create or replace function app.unarchive_project(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_project uuid; v_name text; v_off jsonb;
begin
  select project_id, name into v_project, v_name
    from public.projects where slug = p_slug and status = 'archived';
  if v_project is null then
    return jsonb_build_object('ok', false, 'error', format('no archived project called %s', p_slug));
  end if;

  update public.projects set status = 'active' where project_id = v_project;

  select coalesce(jsonb_agg(r.slug order by r.slug), '[]'::jsonb) into v_off
    from public.responsibilities r where r.project_id = v_project and not r.enabled;

  return jsonb_build_object(
    'ok', true, 'project', p_slug, 'name', v_name, 'still_off', v_off);
end;
$$;

-- ---------------------------------------------------------------------------
-- Public wrappers
-- ---------------------------------------------------------------------------

create or replace function public.project_export(p_project_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.project_export(p_project_id) $$;

create or replace function public.archive_project(p_slug text, p_by text default 'grant')
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.archive_project(p_slug, p_by) $$;

create or replace function public.unarchive_project(p_slug text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.unarchive_project(p_slug) $$;

grant execute on function app.export_path(text, uuid, text) to ai_team_app;
grant execute on function app.project_export(uuid) to ai_team_app;
grant execute on function public.project_export(uuid) to ai_team_app;
grant execute on function app.archive_project(text, text) to ai_team_app;
grant execute on function public.archive_project(text, text) to ai_team_app;
grant execute on function app.unarchive_project(text) to ai_team_app;
grant execute on function public.unarchive_project(text) to ai_team_app;

commit;
