-- The index knows what it has NOT got (#257).
--
-- Grant, from real Telegram use: he asked about a document associated with the
-- project and was told it could not be found. It was in the project's linked
-- Google Notebook, and only saying so got it retrieved.
--
-- ## What was already true, measured before building
--
-- `public.documents` IS the unified index the Issue asks for -- one table, one
-- `search` vector, one `app.search_documents`, project-scoped, connector
-- recorded as provenance. 60 NotebookLM documents and 23 Notion documents are
-- in it with full text, and `retrieve()` finds them without being told where
-- they live. That half works.
--
-- **Zero Drive documents.** `app.record_drive_document` and the whole
-- `drive.read_file` handler exist and nothing has ever enqueued the latter --
-- #72's shape again, the implemented option with no caller. So a Drive file is
-- invisible to project search, and the office answers "I have nothing on that"
-- with complete sincerity.
--
-- ## The part that makes the wrong answer a LIE rather than a gap
--
-- The Issue's own line: *"Connector failure/staleness is represented honestly
-- rather than becoming a false 'document does not exist' answer."*
--
-- A search that found nothing is legitimate evidence for "there is nothing in
-- our documents" -- `provenance.ts` is built on exactly that, and it is right
-- whenever the index covers what is attached. It stops being right the moment
-- a connector is attached and unindexed, and nothing anywhere could tell the
-- difference.
--
-- `app.project_knowledge` is that difference, as data: what is attached, what
-- is indexed, how fresh, and which connectors are attached with nothing behind
-- them. The handler puts it in front of the model, so an absence is reported
-- as "nothing in what I have indexed, and Drive is not indexed" rather than as
-- "there is nothing".

create or replace function app.project_knowledge(p_project uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with attached as (
    select a.connector,
           count(*)::int as attachments,
           max(a.last_synced_at) as last_synced
      from public.project_attachments a
     where a.project_id = p_project
       and a.enabled
     group by a.connector
  ),
  indexed as (
    select d.connector,
           count(*)::int as documents,
           max(coalesce(d.fetched_at, d.updated_at)) as newest
      from public.documents d
     where d.project_id = p_project
       and coalesce(btrim(d.connector), '') <> ''
     group by d.connector
  ),
  /*
    Every connector that is attached OR has fed something in.

    Named `covered` rather than `both`, which is a reserved word — `trim(both
    ...)` — and produced a syntax error pointing at the CTE name.

    A full outer join rather than a left one: a connector whose attachment was
    removed can still have documents (§17 turns off a route, not what it
    brought in), and a reader that hid those would be understating what the
    office holds -- the opposite failure to the one this exists for, and just
    as dishonest.
  */
  covered as (
    select coalesce(a.connector, i.connector) as connector,
           coalesce(a.attachments, 0) as attachments,
           a.last_synced,
           coalesce(i.documents, 0) as documents,
           i.newest
      from attached a
      full outer join indexed i on i.connector = a.connector
  )
  select jsonb_build_object(
    'as_of', app.now_utc(),
    'documents', (select coalesce(sum(documents), 0)::int from covered),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
               'connector', b.connector,
               'attached', b.attachments > 0,
               'documents', b.documents,
               'newest', b.newest,
               'last_synced', b.last_synced,
               -- Attached, and nothing of it is in the index. The case this
               -- function exists for.
               'blank', b.attachments > 0 and b.documents = 0)
             order by b.documents desc, b.connector)
        from covered b), '[]'::jsonb),
    /*
      The connectors a search CANNOT speak for.

      Named rather than counted, because the sentence the office has to be able
      to say is "nothing in what I have indexed, and Drive is not indexed" --
      and a count cannot name Drive.
    */
    'blank', coalesce((
      select jsonb_agg(b.connector order by b.connector)
        from covered b where b.attachments > 0 and b.documents = 0), '[]'::jsonb),
    -- True only when every attached connector has fed something in. A search
    -- that finds nothing may be reported as an absence ONLY when this is true.
    'complete', not exists (
      select 1 from covered b where b.attachments > 0 and b.documents = 0)
  );
$function$;

comment on function app.project_knowledge(uuid) is
  'What the project index covers, and what it does not (#257). `blank` names '
  'every connector attached with nothing indexed; `complete` is false whenever '
  'one exists, and a search finding nothing may only be reported as an absence '
  'when it is true.';

create or replace function public.project_knowledge(p_project uuid)
returns jsonb language sql security definer set search_path to ''
as $function$ select app.project_knowledge(p_project) $function$;
