begin;

/**
 * An export carries no identity of ours.
 *
 * Issue #36, §13. 0325 said this in its header and did not do it: the finished
 * package held 117 uuids, and counting them in the real output was the only
 * way to find that out — reading the function back said what it intended.
 *
 * Three kinds, and only one of them is wrong:
 *
 *   - **70 inside document TEXT.** Grant's own material, which happens to
 *     mention uuids. Stripping those would corrupt the documents, which is a
 *     far worse failure than the one being fixed.
 *   - **38 in `external_ref`.** A Notion page id, a NotebookLM source id. That
 *     is the OTHER system's identity, and it is exactly what an import adapter
 *     needs in order to re-link a package to where it came from rather than
 *     duplicating everything. Keeping it is the point.
 *   - **9 in `sources`.** `attachment_id` and `reference_id` — ours, and
 *     meaningless outside this database. These are the leak.
 *
 * The whole function is restated rather than patched, because a `create or
 * replace` that changed only one expression would leave 0325 reading as the
 * definition when it is not.
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

    -- Our own row ids dropped, and only ours. See the header: the uuids that
    -- survive elsewhere in this package are either inside Grant's own document
    -- text or are the external system's reference, and both belong here.
    -- `studio_sources` keeps emitting the id because the Sources section needs
    -- it to remove a row; a reader's shape should not be bent by an unrelated
    -- writer's needs, so the export drops it rather than the function.
    'sources', coalesce(
      (select jsonb_agg(s - 'id')
         from jsonb_array_elements(app.studio_sources(p_project_id)) s),
      '[]'::jsonb),

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
  '#36, §13. One dashboard project as a neutral JSON document. Our own row ids '
  'are removed; the uuids that remain are inside Grant material or are the '
  'external system''s own reference, and both belong in the package. 0326.';

grant execute on function app.project_export(uuid) to ai_team_app;

commit;
