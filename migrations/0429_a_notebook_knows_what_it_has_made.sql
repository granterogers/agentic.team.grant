-- A notebook knows what it has made, and so does the office (#260).
--
-- ## What already existed, checked before building
--
-- Nearly all of it, which is why this migration is small:
--
--   * `NotebookActions.artifacts(notebookId)` already enumerates a notebook's
--     generated outputs through the supported library -- id, title, kind,
--     status, done, failed, created_at -- and `poll()` returns a URL for a
--     completed one. No UI automation, no new dependency.
--   * `public.artifacts` already holds them per project, with
--     `artifacts_one_per_external_ref` unique on `(notebook_ref, external_ref)`
--     and, better, `artifacts_ready_has_a_link`: a row may not be `ready`
--     without a URL. #260's *"missing direct-link capability is reported
--     accurately rather than producing fabricated links"* is already a CHECK
--     constraint rather than a hope.
--
-- **What it could not do is ADOPT.** Every one of the five rows in
-- `public.artifacts` was written by a job that generated one, so an audio
-- overview Grant made himself in NotebookLM's own interface is invisible to
-- the office entirely -- and "give me all the audio overviews" is mostly a
-- question about those.
--
-- ## So: one upsert that does not care who made it
--
-- Keyed on the notebook's own id for the artifact. A row the office started
-- keeps its `requested_by_job`; a row it merely found has none, and the
-- difference stays readable rather than being flattened into "ours".

create or replace function app.record_notebook_artifact(
  p_project uuid,
  p_notebook_ref text,
  p_external_ref text,
  p_kind text,
  p_title text,
  p_url text default null,
  p_state text default 'generating',
  p_detail text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_id uuid;
  v_state text := coalesce(nullif(btrim(p_state), ''), 'generating');
  v_was text;
begin
  if coalesce(btrim(p_notebook_ref), '') = '' or coalesce(btrim(p_external_ref), '') = '' then
    return jsonb_build_object('ok', false,
      'error', 'an artifact needs the notebook it belongs to and its own id');
  end if;

  /*
    `ready` needs a link, and the constraint says so.

    Rather than let the INSERT raise, the state is DEMOTED when no URL came
    back: the artifact genuinely is finished in the notebook and the office
    genuinely cannot open it, and saying "ready, here is nothing" would be the
    fabricated link #260 forbids. `detail` carries the reason so the page and
    the answer can both say it.
  */
  if v_state = 'ready' and coalesce(btrim(p_url), '') = '' then
    v_state := 'generating';
    p_detail := coalesce(nullif(btrim(p_detail), ''),
      'Finished in the notebook, but it gave no link the office can open.');
  end if;

  select artifact_id, state into v_id, v_was
    from public.artifacts
   where notebook_ref = btrim(p_notebook_ref) and external_ref = btrim(p_external_ref);

  if v_id is null then
    insert into public.artifacts
      (project_id, notebook_ref, external_ref, kind, title, url, state, detail, ready_at)
    values (p_project, btrim(p_notebook_ref), btrim(p_external_ref),
            coalesce(nullif(btrim(p_kind), ''), 'unknown'),
            nullif(btrim(coalesce(p_title, '')), ''),
            nullif(btrim(coalesce(p_url, '')), ''),
            v_state, nullif(btrim(coalesce(p_detail, '')), ''),
            case when v_state = 'ready' then app.now_utc() else null end)
    returning artifact_id into v_id;
    return jsonb_build_object('ok', true, 'artifact', v_id, 'outcome', 'adopted');
  end if;

  /*
    An update never moves a terminal state backwards.

    A notebook listing that briefly reports an old artifact as pending must not
    un-finish something the office already has a link for -- the same argument
    `record_drive_document` makes about not re-stamping an unchanged file, with
    a worse failure mode: a `ready` row demoted loses its URL to the CHECK.
  */
  update public.artifacts
     set title = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title),
         kind = coalesce(nullif(btrim(p_kind), ''), kind),
         url = coalesce(nullif(btrim(coalesce(p_url, '')), ''), url),
         state = case
                   when state in ('ready', 'failed', 'abandoned') then state
                   else v_state
                 end,
         detail = coalesce(nullif(btrim(coalesce(p_detail, '')), ''), detail),
         ready_at = case
                      when ready_at is not null then ready_at
                      when v_state = 'ready' then app.now_utc()
                      else null
                    end,
         updated_at = app.now_utc()
   where artifact_id = v_id;

  return jsonb_build_object('ok', true, 'artifact', v_id,
    'outcome', case when v_was = 'ready' then 'unchanged' else 'updated' end);
end;
$function$;

/*
  Enumerating them, optionally by kind.

  `p_kinds` empty or null means every kind, because "what has the notebook
  generated?" is a legitimate question and answering it with nothing would be
  the found-nothing failure this repository keeps paying for.

  `openable` is stated rather than implied. An artifact with no URL is not a
  broken row -- NotebookLM does not expose a stable link for every type -- and
  the caller has to be able to say so instead of printing an empty anchor.
*/
create or replace function app.artifacts_in(
  p_project uuid, p_kinds text[] default null, p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(jsonb_agg(q.v order by q.at desc), '[]'::jsonb)
    from (
      select a.created_at as at,
             jsonb_build_object(
               'id', a.artifact_id,
               'kind', a.kind,
               'title', coalesce(nullif(btrim(coalesce(a.title, '')), ''), '(untitled)'),
               'url', a.url,
               'openable', a.url is not null,
               'state', a.state,
               'detail', a.detail,
               'mine', a.requested_by_job is not null,
               'notebook', a.notebook_ref,
               'at', a.created_at,
               'ready_at', a.ready_at) as v
        from public.artifacts a
       where a.project_id = p_project
         and (p_kinds is null or coalesce(array_length(p_kinds, 1), 0) = 0
              or a.kind = any (p_kinds))
       order by a.created_at desc
       limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) q;
$function$;

create or replace function public.artifacts_in(
  p_project uuid, p_kinds text[] default null, p_limit integer default 50)
returns jsonb language sql security definer set search_path to ''
as $function$ select app.artifacts_in(p_project, p_kinds, p_limit) $function$;

create or replace function public.record_notebook_artifact(
  p_project uuid, p_notebook_ref text, p_external_ref text, p_kind text, p_title text,
  p_url text default null, p_state text default 'generating', p_detail text default null)
returns jsonb language sql security definer set search_path to ''
as $function$ select app.record_notebook_artifact(p_project, p_notebook_ref, p_external_ref,
                                                  p_kind, p_title, p_url, p_state, p_detail) $function$;
