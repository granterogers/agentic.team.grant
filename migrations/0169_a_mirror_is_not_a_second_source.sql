-- A mirror is not a second source.
--
-- Grant's Legacy Coaching Course holds 33 documents where it holds 12 things.
-- Every one appears twice: once from `notebooklm`, once from `notion`, with
-- near-identical content — 37,697 characters and 37,476 for the same Zoom call.
--
-- ## Why the existing index did not stop it
--
-- `documents_one_per_external_ref` is unique on
-- `(connector, external_parent_ref, external_ref)`, which is exactly right for
-- what it was built for: the same page fetched twice from the same connector is
-- one row. It says nothing about the same DOCUMENT arriving from two
-- connectors, because until 0166 that could not happen.
--
-- Then `office.notion_import` wrote the NotebookLM sources into Notion as Docs
-- pages, and `duty:notion-sync` read those pages back as new documents. The
-- office imported its own output and counted it as new material. Nothing was
-- wrong with either job; the pair of them had no way to know they were talking
-- about the same thing.
--
-- ## Provenance, not title matching
--
-- The tempting fix is to dedupe on title. That is wrong twice over: two genuine
-- documents may share a title, and a page whose title Grant edits in Notion
-- would silently stop matching and duplicate again.
--
-- What is actually true is narrower and permanent: *this Notion page exists
-- because we put that document there.* So the row records it —
-- `mirrors_document_id` — and everything that counts documents counts originals.
-- The mirror row stays, because it is how we find the page again to update it.

begin;

alter table public.documents
  add column if not exists mirrors_document_id uuid
  references public.documents (document_id) on delete set null;

comment on column public.documents.mirrors_document_id is
  'This row is a copy of another document that WE wrote into a connector — the '
  'Notion page office.notion_import created from a NotebookLM source, say. It '
  'is not new material and must not be counted, retrieved or shown as such. '
  'Null for everything that arrived from outside (0169).';

create index if not exists documents_mirrors
  on public.documents (mirrors_document_id) where mirrors_document_id is not null;

-- Originals only, which is what every count and every retrieval means.
create index if not exists documents_original
  on public.documents (project_id) where mirrors_document_id is null;

-- ---------------------------------------------------------------------------
-- Adopt the duplicates that already exist
-- ---------------------------------------------------------------------------
--
-- Matched on normalised title within a project, which is safe HERE and only
-- here: these rows were created by one import from one source set on one day,
-- so a title collision between two genuinely different documents is not a case
-- that arises. Going forward the link is recorded at write time and never
-- inferred.

-- First by CONTENT, which is the strongest evidence there is and needs no
-- assumption about titles at all. This also catches a second case the audit
-- turned up and I had not expected: the same NotebookLM source added to the
-- same notebook twice, five seconds apart, with two source ids and one
-- identical fingerprint. Same defect from the other direction — a duplicate we
-- hold twice — and the same answer.
update public.documents m
   set mirrors_document_id = o.document_id
  from (
    select project_id, content_fingerprint,
           (array_agg(document_id order by created_at))[1] as document_id
      from public.documents
     where content_fingerprint is not null and project_id is not null
     group by 1, 2
  ) o
 where m.project_id = o.project_id
   and m.content_fingerprint = o.content_fingerprint
   and m.document_id <> o.document_id
   and m.mirrors_document_id is null;

-- Then the cross-connector case, where content differs slightly because Notion
-- round-tripped it — 37,697 characters became 37,476 — so no fingerprint can
-- match. Title within a project is safe HERE and only here: these rows were
-- created by one import from one source set on one day, so a collision between
-- two genuinely different documents is not a case that arises. Going forward
-- the link is recorded at write time and never inferred.
update public.documents m
   set mirrors_document_id = o.document_id
  from public.documents o
 where m.connector = 'notion'
   and o.connector <> 'notion'
   and m.project_id = o.project_id
   and m.mirrors_document_id is null
   and o.mirrors_document_id is null
   and app.normalise_name(m.title) = app.normalise_name(o.title)
   and m.document_id <> o.document_id;

-- ---------------------------------------------------------------------------
-- Counting, everywhere, means originals
-- ---------------------------------------------------------------------------

create or replace function app.voice_state()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select jsonb_build_object(
    'as_of', app.now_utc(),
    'projects', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', p.name,
               'purpose', left(coalesce(p.purpose, p.description, ''), 200),
               -- 0169: originals. Claire told Grant a project had 33 documents
               -- when it had 12 things, because the office had imported its own
               -- output back in.
               'documents', (select count(*) from public.documents d
                              where d.project_id = p.project_id
                                and d.mirrors_document_id is null),
               'connected_to', (select coalesce(string_agg(distinct a.connector, ', '), 'nothing')
                                  from public.project_attachments a
                                 where a.project_id = p.project_id and a.enabled),
               'last_output', (select max(o.created_at)
                                 from public.outputs o
                                 join public.jobs j on j.job_id = o.job_id
                                where j.project_id = p.project_id))
             order by p.name), '[]'::jsonb)
        from public.projects p
       where p.status = 'active' and not p.is_fixture
    ),
    'team', (
      select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'title', s.title)
             order by s.name), '[]'::jsonb)
        from public.staff s where s.active
    ),
    'today', app.office_health(24),
    'waiting_on_grant', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'what', left(n.requested_action, 160),
               'why', left(coalesce(n.why_needed, ''), 160),
               'project', pr.name,
               'work_goes_on', n.work_can_continue,
               'since', n.created_at) order by n.created_at), '[]'::jsonb)
        from public.needs_me n
        left join public.projects pr on pr.project_id = n.project_id
    ),
    'latest', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'who', coalesce(s.name, 'the office'),
               'project', pr.name,
               'headline', left(o.body, 220),
               'when', o.created_at) order by o.created_at desc), '[]'::jsonb)
        from (select ob.* from public.outputs ob
                join public.jobs jb on jb.job_id = ob.job_id
               where not jb.is_fixture
               order by ob.created_at desc limit 6) o
        left join public.staff s on s.staff_id = o.staff_id
        left join public.jobs j on j.job_id = o.job_id
        left join public.projects pr on pr.project_id = j.project_id
    )
  )
$function$;

create or replace function app.voice_lookup(p_about text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_project uuid;
  v_staff   text;
  v_said    text := coalesce(trim(p_about), '');
begin
  select s.slug into v_staff
    from public.staff s
   where s.active
     and (v_said ~* ('\m' || s.name || '\M') or v_said ~* ('\m' || s.slug || '\M'))
   order by length(s.name) desc
   limit 1;

  if v_staff is not null then
    return jsonb_build_object(
      'about', 'person',
      'who', (select jsonb_build_object('name', s.name, 'title', s.title,
                       'style', s.communication_style)
                from public.staff s where s.slug = v_staff),
      'recent', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'project', pr.name,
                 'headline', left(o.body, 400),
                 'when', o.created_at) order by o.created_at desc), '[]'::jsonb)
          from (select o2.* from public.outputs o2
                  join public.staff s2 on s2.staff_id = o2.staff_id
                 where s2.slug = v_staff
                 order by o2.created_at desc limit 5) o
          left join public.jobs j on j.job_id = o.job_id
          left join public.projects pr on pr.project_id = j.project_id
      ),
      'duties', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'what', r.description, 'every_minutes', r.period_minutes,
                 'on', r.enabled) order by r.slug), '[]'::jsonb)
          from public.responsibilities r
          join public.staff s on s.staff_id = r.staff_id
         where s.slug = v_staff
      )
    );
  end if;

  select r.project_id into v_project
    from app.resolve_project_by_name(v_said) r
   where r.confidence >= 0.55
   order by r.confidence desc
   limit 1;

  if v_project is not null then
    return jsonb_build_object(
      'about', 'project',
      'project', (
        select jsonb_build_object(
          'name', p.name, 'purpose', coalesce(p.purpose, p.description),
          'status', p.status,
          'connected_to', (select coalesce(jsonb_agg(jsonb_build_object(
                             'connector', a.connector, 'what', a.display_name,
                             'holds', a.artifact_kind) order by a.connector), '[]'::jsonb)
                             from public.project_attachments a
                            where a.project_id = p.project_id and a.enabled))
          from public.projects p where p.project_id = v_project
      ),
      'material', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'title', d.title, 'size', d.content_chars)
               order by d.content_chars desc), '[]'::jsonb)
          from (select * from public.documents
                 where project_id = v_project
                   and mirrors_document_id is null
                 order by content_chars desc limit 12) d
      ),
      'recent', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'who', coalesce(s.name, 'the office'),
                 'headline', left(o.body, 400),
                 'when', o.created_at) order by o.created_at desc), '[]'::jsonb)
          from (select o2.* from public.outputs o2
                  join public.jobs j2 on j2.job_id = o2.job_id
                 where j2.project_id = v_project
                 order by o2.created_at desc limit 5) o
          left join public.staff s on s.staff_id = o.staff_id
      ),
      'in_flight', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'kind', j.kind, 'status', j.state, 'since', j.created_at)
               order by j.created_at desc), '[]'::jsonb)
          from public.jobs j
         where j.project_id = v_project
           and j.state not in ('complete', 'failed', 'cancelled')
      )
    );
  end if;

  return jsonb_build_object('about', 'everything', 'state', app.voice_state());
end;
$function$;

-- The dashboard's project list counts the same way.
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
             'documents', (select count(*) from public.documents d
                            where d.project_id = p.project_id
                              and d.mirrors_document_id is null),
             -- Shown separately rather than hidden: a mirror is real, it is
             -- just not new material, and "12 documents, 12 mirrored to Notion"
             -- is a more useful sentence than either number alone.
             'mirrored', (select count(*) from public.documents d
                           where d.project_id = p.project_id
                             and d.mirrors_document_id is not null),
             'aliases', (select coalesce(jsonb_agg(jsonb_build_object(
                              'alias', a.alias, 'source', a.source) order by a.confidence desc, a.alias), '[]'::jsonb)
                           from public.project_aliases a
                          where a.project_id = p.project_id and a.source <> 'name'),
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

-- ---------------------------------------------------------------------------
-- Prove it, on the data that produced the complaint
-- ---------------------------------------------------------------------------

do $$
declare
  v_all      bigint;
  v_original bigint;
  v_dupes    bigint;
begin
  select count(*) into v_all from public.documents d
    join public.projects p using (project_id)
   where p.slug = 'legacy-coaching-course';
  select count(*) into v_original from public.documents d
    join public.projects p using (project_id)
   where p.slug = 'legacy-coaching-course' and d.mirrors_document_id is null;

  if v_original >= v_all then
    raise exception
      'nothing was adopted as a mirror: % documents, % originals — the course '
      'still reads as having twice the material it has', v_all, v_original;
  end if;

  -- And no project may still hold two ORIGINALS with the same name, which is
  -- the condition the fix is actually claiming.
  select count(*) into v_dupes from (
    select project_id, app.normalise_name(title)
      from public.documents
     where mirrors_document_id is null and project_id is not null
     group by 1, 2 having count(*) > 1
  ) t;
  if v_dupes > 0 then
    raise exception '% title(s) still duplicated among originals', v_dupes;
  end if;
end
$$;

commit;
