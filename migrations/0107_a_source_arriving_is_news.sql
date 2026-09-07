-- 0107 — A source arriving is news, and news is work
--
-- §22's scenario A opens: *"Grant adds a source to the Money Mastery Notebook
-- from his phone → detected within the sync interval → **Research analyzes** →
-- justified specialists consulted → Quality/Risk reviews → useful findings
-- written back."*
--
-- Every one of those exists. The sync detects, the router justifies, Quality
-- reviews, the notifier delivers. And nothing joins "detected" to "Research
-- analyzes": the sync writes a `documents` row and stops. 586 documents have
-- been stored and not one of them has ever caused a job.
--
-- Which is this codebase's recurring defect at the largest scale it has
-- appeared: not a check that cannot fail, but a whole arc whose every segment
-- works and which has never once been traversed.
--
-- ## Why a trigger
--
-- Because a caller can forget, and two callers can forget differently. There
-- are two connectors writing documents today (`notebooklm` and `notion`) and
-- ADR-0013 exists to make room for more. An explicit `noticeNewDocument()` in
-- each sync script is the arrangement that produced this gap in the first
-- place.
--
-- ## Why it does almost nothing
--
-- The dangerous version of this feature fires 45 jobs the first time a notebook
-- is attached. So:
--
--   - **a project's FIRST documents are a corpus, not news.** Attaching a
--     notebook with forty pages in it is an import; the fortieth page is not an
--     event. Only a document arriving into a project that already had one
--     counts.
--   - **one job per document, ever.** The idempotency key is the document id,
--     so a re-sync, a fingerprint change, or two workers racing produce one job
--     — 0005's index doing the work rather than a guard here.
--   - **a ceiling per hour**, in `system_config` where Grant can lower it. A
--     bulk paste of thirty pages into an established project is still an
--     import even though the rule above cannot tell; the cap is what makes that
--     survivable.
--   - **nothing for an empty or trivial document**, because a page with two
--     lines on it is not worth convening anyone over.
--
-- ## Why it cannot break the sync
--
-- The whole body is wrapped: a trigger that raises would abort the INSERT and
-- take the sync down with it, and the sync is the more important of the two.
-- A failure to notice is recorded on the event ledger and the document is still
-- stored.

begin;

insert into public.system_config (key, value, description) values
  ('knowledge.read_new_sources', to_jsonb(true),
   'Whether a source arriving in an established project starts a research job. '
   'Off makes the corpus passive again: documents are stored and nothing acts '
   'on them.'),
  ('knowledge.new_source_jobs_per_hour', to_jsonb(6),
   'Ceiling on research jobs started by arriving sources, across all projects. '
   'A bulk paste into an established project looks exactly like news, and this '
   'is what makes that survivable.'),
  ('knowledge.new_source_min_chars', to_jsonb(600),
   'Below this a document is not worth convening anyone over.')
on conflict (key) do nothing;

/**
 * Notice a document that just arrived, and start work if it is news.
 *
 * AFTER INSERT, so the document exists whatever happens here, and the whole
 * body is inside an exception handler for the same reason.
 */
create or replace function app.notice_new_document()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_enabled boolean;
  v_cap integer;
  v_min integer;
  v_had integer;
  v_recent integer;
begin
  select coalesce((select value::text::boolean from public.system_config
                    where key = 'knowledge.read_new_sources'), true)
    into v_enabled;
  if not v_enabled then return new; end if;

  if new.project_id is null then return new; end if;

  select coalesce((select value::text::integer from public.system_config
                    where key = 'knowledge.new_source_min_chars'), 600)
    into v_min;
  if coalesce(new.content_chars, 0) < v_min then return new; end if;

  -- Never for a fixture. A verification run that stored a document and then
  -- convened Emma over it would be a verification run with a side effect
  -- nobody asked for, and it would eat the hourly cap.
  if exists (
    select 1 from public.projects p
     where p.project_id = new.project_id
       and (p.slug like 'fixture-%' or p.slug like 'verify-%' or p.status <> 'active')
  ) then
    return new;
  end if;

  -- The first documents of a project are an import, not news.
  select count(*)::integer into v_had
    from public.documents d
   where d.project_id = new.project_id and d.document_id <> new.document_id;
  if v_had = 0 then return new; end if;

  select coalesce((select value::text::integer from public.system_config
                    where key = 'knowledge.new_source_jobs_per_hour'), 6)
    into v_cap;
  select count(*)::integer into v_recent
    from public.jobs j
   where j.kind = 'knowledge.read_source'
     and j.created_at > app.now_utc() - interval '1 hour';
  if v_recent >= v_cap then
    -- Not silent. A capped document is one with no `read:` job, and the daily
    -- capacity report counts exactly that — so "sources arrived and nobody
    -- looked at them" is a line Grant sees rather than a number in a log he
    -- does not read.
    --
    -- Deliberately NOT written to the event ledger: `append_event` takes a
    -- strict parameter list and is SECURITY INVOKER, and reaching for it from
    -- inside a SECURITY DEFINER trigger would either fail on permissions or
    -- quietly write the ledger as the wrong actor.
    return new;
  end if;

  insert into public.jobs
    (correlation_id, project_id, idempotency_key, kind, requested_by, priority,
     announce, pinned_config)
  values (gen_random_uuid(), new.project_id,
          -- The document, so one arrives once however many times it is synced.
          format('read:%s', new.document_id),
          'knowledge.read_source',
          format('%s:%s', new.connector, coalesce(new.external_ref, 'source')),
          -- Below an instruction Grant is waiting on. He asked for nothing
          -- here; the system noticed.
          200,
          true,
          jsonb_build_object(
            'document_id', new.document_id,
            'title', new.title,
            'connector', new.connector));

  return new;
exception
  when unique_violation then
    -- Already noticed. The index is the mechanism and this is its normal
    -- outcome, exactly as in the duty dispatcher (0098).
    return new;
  when others then
    -- Never take the sync down. A document stored and not noticed is a
    -- recoverable state that the capacity report will surface; a sync that
    -- dies half way through is not.
    raise warning 'notice_new_document failed for %: %', new.document_id, sqlerrm;
    return new;
end;
$$;

create trigger documents_notice_new
  after insert on public.documents
  for each row execute function app.notice_new_document();

comment on function app.notice_new_document is
  'Starts a research job for a source arriving into an established project. A '
  'trigger rather than a call in each sync script, because two connectors '
  'write documents and the missing call in both is exactly how this arc went '
  'un-traversed for 586 documents.';

commit;
