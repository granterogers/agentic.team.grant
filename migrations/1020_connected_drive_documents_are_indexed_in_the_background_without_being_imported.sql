-- 1020. A connected Google Drive document is read and indexed in the BACKGROUND, without being imported (HQ-DOC-026),
-- and a deployment can start with its timed duties held (the staging posture). UNAPPLIED to production.
-- Depends on 0896, 0900, 0960, 0990, 1000 and 1010.
--
-- Grant, 5 October 2026: agents may read and index connected Drive documents on their own. BACKGROUND INDEX IS NOT IMPORT.
--   background index  reads the source read-only and keeps only DERIVED material: extracted text in documents.content
--                     (the existing chunk index picks it up), the source's own version markers (document_previews), and
--                     when it was last checked. No binary, no Storage object, nothing written to Drive.
--   import            an explicit, separate press that makes a durable Team HQ copy (0900/0960/0991/1010). Text a background
--                     read derived is, exactly as with a preview (0990), NOT "held" material: importing such a document
--                     still fetches the source and the copy gets the file.
--
-- What decides whether a document may be read this hour is ONE predicate, app.document_index_candidates:
--   * the document is an external Drive document of this office, in a project, not archived, not missing;
--   * app.document_source_state is 'ok' (1010): the attachment is enabled AND Google is connected for this office. A
--     disconnected or revoked source stops future reads at the source of the list, and re-connecting brings them back;
--   * it is not in a failure back-off, and it was not checked inside the last six hours (unchanged documents are not
--     re-read: the handler compares Drive's modified time / checksum with the cache and fetches only on a change);
--   * oldest check first, at most 25 per call (the handler takes eight an hour by default). Nothing here is a crawler.
-- The outcome (app.document_index_outcome) is what makes it honest and bounded: a failure is recorded with its reason and
-- the document is not tried again until a back-off has passed (15 min doubling to a day), a success clears it.
--
-- THE STAGING POSTURE. A deployment whose worker must not start touching real Drive, Calendar, Slack or Telegram the
-- moment it is deployed can hold its duties: system_config 'duties.paused' = true makes app.due_responsibilities return
-- nothing, except the slugs listed in 'duties.allow' (a jsonb array). Absent, nothing changes (production behaviour is
-- exactly what it was). Enabling is therefore explicit and one duty at a time. Jobs a person asks for are not duties and
-- are not held.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. The state of background indexing, per document. Not the cache (document_previews is that): this is the schedule.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.document_index_state (
  office_id        uuid        not null references public.offices (office_id),
  document_id      uuid        not null,
  last_checked_at  timestamptz,
  last_indexed_at  timestamptz,
  failures         integer     not null default 0 check (failures >= 0),
  last_error       text        check (last_error is null or length(last_error) <= 400),
  next_attempt_at  timestamptz,
  primary key (office_id, document_id),
  constraint document_index_state_document_same_office
    foreign key (document_id, office_id) references public.documents (document_id, office_id) on delete cascade
);

comment on table public.document_index_state is
  'When the background indexer last looked at an external Drive document, when it last derived text from it, and the back-off after a failure. A schedule, not a copy: it holds no content.';

create trigger a1_office_write_once before update of office_id on public.document_index_state
  for each row execute function app.office_id_is_write_once();

alter table public.document_index_state enable row level security;
revoke all on table public.document_index_state from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Who may be read this hour.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.document_index_candidates(p_office uuid, p_limit integer default 8)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $f$
begin
  perform app.require_office(p_office);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'document_id', x.document_id, 'project_id', x.project_id, 'slug', x.slug,
             'title', x.title, 'external_ref', x.external_ref) order by x.last_checked nulls first, x.document_id)
      from (
        select d.document_id, d.project_id, p.slug, d.title, d.external_ref,
               s.last_checked_at as last_checked
          from public.documents d
          join public.projects p on p.project_id = d.project_id and p.office_id = d.office_id
          left join public.document_index_state s on s.office_id = d.office_id and s.document_id = d.document_id
         where d.office_id = p_office
           and d.origin = 'source' and d.connector = 'drive'
           and d.state <> 'archived' and d.missing_since is null
           and coalesce(btrim(d.external_ref), '') <> ''
           and p.status = 'active'
           and app.document_source_state(p_office, d.document_id) = 'ok'
           and (s.next_attempt_at is null or s.next_attempt_at <= app.now_utc())
           and (s.last_checked_at is null or s.last_checked_at <= app.now_utc() - interval '6 hours')
         order by s.last_checked_at nulls first, d.document_id
         limit least(greatest(coalesce(p_limit, 8), 1), 25)
      ) x), '[]'::jsonb);
end
$f$;

comment on function app.document_index_candidates(uuid, integer) is
  'The external Drive documents that may be read in the background now: source connected (attachment enabled AND Google connected, 1010), not in back-off, not checked in the last six hours. Oldest check first, at most 25.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. What happened, and the back-off.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.document_index_outcome(
  p_office uuid, p_document uuid, p_ok boolean, p_indexed boolean default false, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $f$
declare
  v_fail integer;
begin
  perform app.require_office(p_office);
  if not exists (select 1 from public.documents d where d.document_id = p_document and d.office_id = p_office) then
    return jsonb_build_object('ok', false, 'error', 'there is no document with that id');
  end if;
  insert into public.document_index_state as s (office_id, document_id, last_checked_at, last_indexed_at, failures, last_error, next_attempt_at)
  values (p_office, p_document, app.now_utc(),
          case when p_ok and p_indexed then app.now_utc() else null end,
          case when p_ok then 0 else 1 end,
          case when p_ok then null else left(coalesce(nullif(btrim(p_error), ''), 'the read failed'), 400) end,
          case when p_ok then null else app.now_utc() + interval '15 minutes' end)
  on conflict (office_id, document_id) do update
     set last_checked_at = app.now_utc(),
         last_indexed_at = case when p_ok and p_indexed then app.now_utc() else s.last_indexed_at end,
         failures = case when p_ok then 0 else s.failures + 1 end,
         last_error = case when p_ok then null else left(coalesce(nullif(btrim(p_error), ''), 'the read failed'), 400) end,
         next_attempt_at = case when p_ok then null
                                else app.now_utc() + least(interval '15 minutes' * power(2, least(s.failures, 7)), interval '1 day') end
  returning failures into v_fail;
  return jsonb_build_object('ok', true, 'failures', v_fail);
end
$f$;

revoke all on function app.document_index_candidates(uuid, integer) from public, anon, authenticated;
revoke all on function app.document_index_outcome(uuid, uuid, boolean, boolean, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. The duty. One hour, owned by the chief of staff like drive-watch (0195), and quiet: the handler never announces.
-- ---------------------------------------------------------------------------------------------------------------------
-- One per office that already keeps the Drive watch (it is the office's Drive duty), the way 0897 added the calendar sync.
--
-- SHIPPED SWITCHED OFF, on purpose. A database that is migrated before its worker is deployed would otherwise fire an hourly
-- drive.index job that no handler is registered for, and a duty that fails every hour is the office crying wolf. It is
-- switched on, once the worker that has the handler is running, by the duty's own switch (Settings > the duty list, or
-- update public.responsibilities set enabled = true where slug = 'drive-index'). Grant has decided agents may read and
-- index connected Drive documents on their own; turning the duty on is how that decision starts to apply, and it is the
-- same switch as every other duty ("a duty you switched on is a standing authorization", 0424).
insert into public.responsibilities (slug, staff_id, description, job_kind, period_minutes, office_id, enabled)
select 'drive-index', s.staff_id,
       'Read the connected Drive documents the office has not read lately, read-only, and keep their searchable text. '
       'Never imports, never writes to Drive.',
       'drive.index', 60, r.office_id, false
  from public.responsibilities r
  join public.staff s on s.slug = 'chief-of-staff'
 where r.slug = 'drive-watch'
on conflict (office_id, slug) do nothing;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. The held-duties posture. Spliced from the LIVE app.due_responsibilities.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.duty_allowed(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $f$
  select not coalesce((select c.value = 'true'::jsonb from public.system_config c where c.key = 'duties.paused'), false)
      or coalesce((select c.value @> to_jsonb(p_slug) from public.system_config c
                    where c.key = 'duties.allow' and jsonb_typeof(c.value) = 'array'), false)
$f$;

comment on function app.duty_allowed(text) is
  'True unless system_config duties.paused is true; while paused, only the slugs listed in duties.allow (a jsonb array) may fire. Absent keys change nothing.';

do $s$
declare
  v_def text := pg_get_functiondef('app.due_responsibilities()'::regprocedure);
  v_old text := '  where r.enabled' || chr(10);
  v_new text := '  where r.enabled' || chr(10) || '    and app.duty_allowed(r.slug)' || chr(10);
begin
  if position(v_old in v_def) = 0 then raise exception '1020 splice anchor missing: due_responsibilities'; end if;
  v_def := replace(v_def, v_old, v_new);
  if position('duty_allowed' in v_def) = 0 then raise exception '1020 due_responsibilities splice did not land'; end if;
  execute v_def;
end
$s$;

revoke all on function app.duty_allowed(text) from public, anon, authenticated;
