-- 0068 — MCP can write (ADR-0014 amended)
--
-- Grant: *"it's not really great if the MCP has read-only access. It needs to
-- be able to write as well. For example, I use ChatGPT and I say, okay, we've
-- assigned such and such a task, we've talked about this, now upload that to
-- the project."*
--
-- Fair, and it was the wrong default. Read-only was chosen by analogy with
-- Team HQ, where it is right because a dashboard is for looking at. An MCP
-- client is a working surface: a conversation that cannot leave anything behind
-- is a conversation you have to transcribe by hand afterwards, which is the
-- job this system exists to remove.
--
-- ## What "write" means here, and what it does not
--
-- Three verbs, and no more:
--
--   add_document   put text into a project's corpus
--   enqueue        ask the team to do something (a notebook artifact, a push)
--   nothing else
--
-- A client cannot delete, cannot edit an existing document, cannot change a
-- project's configuration, and cannot touch staff, jobs it did not create, or
-- anything in `app`. Adding is recoverable — a wrong document is deleted by a
-- human in one statement. Editing and deleting are not, and a general-purpose
-- model's judgement about what is irreversible is worse than its reach.
--
-- ## Why an enqueue rather than an action
--
-- The MCP endpoint is a Deno Edge Function and cannot spawn Python, which is
-- where the NotebookLM adapter lives. It could not run a generation even if we
-- wanted it to. That constraint turns out to be the right shape anyway: an
-- audio overview takes minutes, and a tool call that blocks for minutes times
-- out in every client. So the client asks, the worker does, and `check_job`
-- reports. Two calls, honestly.
--
-- ## Provenance is not optional
--
-- Every document a client adds records WHICH client added it. A corpus that
-- cannot distinguish "Grant wrote this", "the team concluded this" and
-- "ChatGPT pasted this in" is a corpus whose citations mean nothing — and §10
-- is built on citations meaning something.

begin;

-- `upload` already exists as a connector for documents that came from nowhere
-- but here. An MCP client is a different provenance and gets its own.
insert into public.knowledge_connectors (connector, name, automated, enabled, notes)
values (
  'mcp', 'MCP client', true, true,
  'Added by an MCP client (Claude, ChatGPT). A distinct connector from ''upload'' '
  'because "a model pasted this in" and "Grant uploaded this" are different '
  'provenances, and §10 is built on citations meaning something.'
)
on conflict (connector) do nothing;

alter table public.documents
  add column added_by text;

comment on column public.documents.added_by is
  'Which MCP client added this, when one did. Null for everything else. The '
  'connector says HOW it arrived; this says WHO asked.';

-- --------------------------------------------------------------------------
-- add_document
-- --------------------------------------------------------------------------

create or replace function app.mcp_add_document(
  p_client_id text,
  p_project   text,
  p_title     text,
  p_content   text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_project uuid;
  v_id uuid;
  v_fingerprint text;
  v_existing uuid;
begin
  select project_id into v_project
    from public.projects where slug = p_project and status = 'active';
  if v_project is null then
    return jsonb_build_object('error', format('no active project with slug %L', p_project));
  end if;
  if coalesce(trim(p_content), '') = '' then
    return jsonb_build_object('error', 'content is empty; refusing to store an empty document');
  end if;
  if coalesce(trim(p_title), '') = '' then
    return jsonb_build_object('error', 'title is required');
  end if;

  v_fingerprint := encode(digest(p_content, 'sha256'), 'hex');

  -- The same content twice is one document. A model that is asked to "add the
  -- summary" twice in one conversation would otherwise add it twice, and
  -- Grant's stated requirement is no duplicates.
  select document_id into v_existing
    from public.documents
   where project_id = v_project and content_fingerprint = v_fingerprint;
  if v_existing is not null then
    return jsonb_build_object(
      'document_id', v_existing, 'title', p_title, 'duplicate', true,
      'note', 'identical content already in this project; nothing was added'
    );
  end if;

  insert into public.documents
    (project_id, connector, external_parent_ref, external_ref, title, doc_type,
     content, content_fingerprint, content_chars, fetched_at, added_by)
  values (v_project, 'mcp', null, null, p_title, 'note',
          p_content, v_fingerprint, length(p_content), app.now_utc(), p_client_id)
  returning document_id into v_id;

  return jsonb_build_object(
    'document_id', v_id, 'title', p_title, 'chars', length(p_content), 'duplicate', false
  );
end;
$$;

-- --------------------------------------------------------------------------
-- enqueue
-- --------------------------------------------------------------------------

create or replace function app.mcp_enqueue(
  p_client_id text,
  p_project   text,
  p_kind      text,
  p_payload   jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_project uuid;
  v_job uuid;
begin
  -- The list is fixed for the same reason the tool list is: a client naming a
  -- job kind is a client choosing what the worker does.
  if p_kind not in ('notebook.generate', 'notebook.push_document', 'notebook.ask') then
    return jsonb_build_object('error', format('%L is not a kind a client may enqueue', p_kind));
  end if;

  select project_id into v_project
    from public.projects where slug = p_project and status = 'active';
  if v_project is null then
    return jsonb_build_object('error', format('no active project with slug %L', p_project));
  end if;

  insert into public.jobs
    (correlation_id, project_id, idempotency_key, kind, requested_by, priority, pinned_config)
  values (gen_random_uuid(), v_project,
          format('mcp-%s-%s', p_client_id, gen_random_uuid()),
          p_kind, format('mcp:%s', p_client_id), 200, p_payload)
  returning job_id into v_job;

  return jsonb_build_object(
    'job_id', v_job, 'kind', p_kind, 'state', 'queued',
    'note', 'the worker picks this up; call check_job with the id'
  );
end;
$$;

create or replace function app.mcp_job_status(p_job_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select jsonb_build_object(
              'job_id', j.job_id, 'kind', j.kind, 'state', j.state,
              'reason', j.state_reason, 'created_at', j.created_at,
              'finished_at', j.finished_at,
              'output', (select left(o.body, 4000) from public.outputs o
                          where o.job_id = j.job_id order by o.created_at desc limit 1)
            )
       from public.jobs j where j.job_id = p_job_id),
    jsonb_build_object('error', 'no such job'))
$$;

comment on function app.mcp_enqueue is
  'A client asks; the worker does. The Edge Function cannot spawn the Python '
  'the notebook adapter needs, and an audio overview takes minutes - a tool '
  'call that blocks for minutes times out in every client, so the constraint '
  'and the right design agree.';

-- Public wrappers: PostgREST serves only `public` (0042, 0046, 0066 — three
-- times now).
create or replace function public.mcp_add_document(p_client_id text, p_project text, p_title text, p_content text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.mcp_add_document(p_client_id, p_project, p_title, p_content) $$;

create or replace function public.mcp_enqueue(p_client_id text, p_project text, p_kind text, p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.mcp_enqueue(p_client_id, p_project, p_kind, p_payload) $$;

create or replace function public.mcp_job_status(p_job_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.mcp_job_status(p_job_id) $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'app.mcp_add_document(text, text, text, text)', 'public.mcp_add_document(text, text, text, text)',
    'app.mcp_enqueue(text, text, text, jsonb)', 'public.mcp_enqueue(text, text, text, jsonb)',
    'app.mcp_job_status(uuid)', 'public.mcp_job_status(uuid)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to ai_team_app, service_role', fn);
  end loop;
end $$;

commit;
