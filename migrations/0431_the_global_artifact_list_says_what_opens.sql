-- The global artifact list says what actually opens (#260).
--
-- `app.hq_artifacts` is the whole-office list, with the project name on each
-- row — a different question from `project_artifacts` and legitimately its own
-- reader. It was written before #260 and has no `openable`, so a page drawing
-- an anchor from it would produce a dead link for every artifact type
-- NotebookLM does not expose a URL for.
--
-- That is the thing this Issue forbids by name: *"missing/unsupported
-- direct-link capability is reported accurately rather than producing
-- fabricated links."* One column, stated rather than inferred from `url`
-- being null, so a renderer never has to decide what a null means.

create or replace function app.hq_artifacts()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(jsonb_agg(a order by a.created_at desc), '[]'::jsonb)
    from (
      select ar.artifact_id, ar.kind, ar.title, ar.url,
             ar.url is not null as openable,
             -- Whether the office started it, or merely found it in the
             -- notebook and adopted it (#260). Grant's own audio overview is
             -- not the office's work and should not read as it.
             ar.requested_by_job is not null as mine,
             ar.state, ar.detail, ar.created_at, ar.ready_at, p.name as project
        from public.artifacts ar
        join public.projects p using (project_id)
       order by ar.created_at desc
       limit 40
    ) a
$function$;
