-- What the team made, readable.
--
-- §19: *"Keep this concept. It is useful as project output/history... But
-- interaction must NOT be limited to `Add to project`. Clicking an output
-- should allow Grant to OPEN and VIEW the artifact directly."*
--
-- He could not. The office has written 5,000 outputs and there has never been
-- a way to read ONE: `import_output` turns it into a document and
-- `decide_output` accepts or rejects it, and both are verdicts on something
-- nobody can see. The only row-level reader is the list, which carries a title
-- and a size.
--
-- So this is the reader, and it carries the provenance with the body because
-- §9's whole argument is that an output card naming only its title loses the
-- trail at exactly the moment it becomes a document. What was asked, who
-- answered, what they read, how sure they were, and whether anybody has
-- reviewed it.
--
-- `evidence` and `confidence` come along deliberately. An output the office is
-- unsure of, or that cites nothing, reads identically to a confident sourced
-- one when all you can see is a title -- and this office's first invariant is
-- not claiming what it did not do.

create or replace function app.hq_output(p_output_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', o.output_id,
           -- WHAT IT IS CALLED, and jobs have no title to take it from.
           -- `understood_as` is what the office understood the request to be,
           -- which is the nearest true thing: an output's name is the question
           -- it answers. Guessing a column called `subject` cost one migration
           -- here, which is the trap this file's neighbours keep recording.
           'title', coalesce(nullif(btrim(j.understood_as), ''), j.kind, 'Untitled'),
           'body', o.body,
           'kind', o.shape,
           'who', coalesce(st.name, st.slug, 'The team'),
           'made', o.created_at,
           'confidence', o.confidence,
           -- `evidence` is an enum and `sources` is already jsonb. Both were
           -- guessed as text and an array on the first pass, which is two more
           -- entries for the list of columns whose type has to be READ.
           'evidence', o.evidence::text,
           'sources', coalesce(o.sources, '[]'::jsonb),
           'reviewed', o.reviewer_status,
           'reviewed_at', o.reviewed_at,
           -- What was asked for, which is the other half of reading an answer.
           'asked', j.understood_as,
           'job_kind', j.kind,
           'project', p.name,
           'project_slug', p.slug,
           -- Whether it has already become a document, so the surface can
           -- offer the one action that is still available rather than both.
           'imported', exists (
             select 1 from public.documents d where d.produced_by_job = o.job_id
           )
         )
    from public.outputs o
    join public.jobs j on j.job_id = o.job_id
    left join public.staff st on st.staff_id = o.staff_id
    left join public.projects p on p.project_id = j.project_id
   where o.output_id = p_output_id
$$;

comment on function app.hq_output(uuid) is
  'One output, with the body and the provenance -- what was asked, who '
  'answered, what they read and how sure they were (§19).';

create or replace function public.hq_output(p_output_id uuid)
returns jsonb language sql security definer set search_path = ''
as $$ select app.hq_output(p_output_id) $$;

grant execute on function public.hq_output(uuid) to anon, authenticated, service_role;
