-- The first real source of signals, and the thing that acts on them (#264).
--
-- 0438 is the model. A model with nothing writing into it is a table, and a
-- table nothing reads is #72's defect with two extra steps -- so this is the
-- first source and the first consumer, and both are deliberately the smallest
-- honest ones.
--
-- ## Why a document arriving is the right first source
--
-- It needs no new infrastructure, no webhook, no polling and no credential:
-- the office already writes `public.documents` from six connectors, and "a
-- document arrived on this project" is a thing Grant would genuinely want work
-- to start from. Every richer source -- an email, a GitHub issue, a Drive
-- change -- is the same shape with an adapter in front, which is the point of
-- the model.
--
-- ## Recorded in a trigger, ACTED ON by the worker
--
-- Two steps rather than one, and the reason is blast radius. A trigger that
-- also created jobs would put job creation inside the transaction that writes
-- a document, so a misconfigured trigger could fail an import. Recording is
-- cheap and cannot fail usefully; deciding happens a moment later on the tick,
-- where a failure costs the decision and not the document.

create or replace function app.a_document_arriving_is_a_signal()
returns trigger language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  /*
    Fixtures are not news.

    A suite importing forty documents must not start forty jobs, and the
    project's own flag is the thing that knows. CLAUDE.md records five separate
    occasions when harness traffic was about to be reported to Grant as the
    office doing something; this is the sixth place it would have happened.
  */
  if exists (select 1 from public.projects p
              where p.project_id = new.project_id and p.is_fixture) then
    return new;
  end if;

  perform app.record_signal(
    'office', 'document.added', new.document_id::text, new.project_id,
    left(coalesce(new.title, '(untitled)'), 300),
    jsonb_build_object(
      'document_id', new.document_id,
      'connector', coalesce(new.connector, ''),
      'origin', coalesce(new.origin, ''),
      'doc_type', coalesce(new.doc_type, ''),
      'mime_type', coalesce(new.mime_type, '')),
    new.produced_by_job,
    coalesce(new.created_at, app.now_utc()));
  return new;
end;
$function$;

drop trigger if exists documents_arriving_is_a_signal on public.documents;
create trigger documents_arriving_is_a_signal
  after insert on public.documents
  for each row execute function app.a_document_arriving_is_a_signal();

/*
  Act on everything nobody has decided about yet.

  Bounded by AGE as well as by count: a signal older than an hour that nothing
  has looked at is a signal from before a restart, and acting on it is the
  replay-after-downtime failure 0438 lists. It is left undecided rather than
  fired, and the row stays as a record that it happened.

  Called from the worker tick, so a signal recorded inside somebody else's
  transaction is acted on a moment later and never inside it.
*/
create or replace function app.fire_pending_signals(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v_signal uuid; v_out jsonb := '[]'::jsonb;
begin
  for v_signal in
    select s.signal_id from public.signals s
     where s.received_at > app.now_utc() - interval '1 hour'
       and not exists (select 1 from public.trigger_firings f where f.signal_id = s.signal_id)
       and exists (select 1 from public.event_triggers t
                    where t.source = s.source and t.event_type = s.event_type)
     order by s.received_at
     limit greatest(1, least(100, coalesce(p_limit, 20)))
  loop
    v_out := v_out || app.fire_triggers_for(v_signal);
  end loop;
  return jsonb_build_object('ok', true, 'looked_at', jsonb_array_length(v_out),
                            'decisions', v_out);
end;
$function$;

comment on function app.fire_pending_signals(integer) is
  'Decide what to do about signals nobody has decided about yet (#264). Only '
  'those with a trigger that could match and only those from the last hour -- '
  'a signal from before a restart is not news.';
