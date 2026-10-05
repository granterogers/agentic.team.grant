-- 0980: optimistic concurrency for the project-calendar sync. UNAPPLIED to production.
--
-- The duty now sends If-Match with the etag it stored (public.project_events.external_etag, which 0897 already records
-- from every successful push), so a change made in Google since the last sync is a 412 rather than being overwritten.
-- On a 412 the handler reads the event back and decides by the rule 0897's pull already uses (the LATER writer wins, and
-- an override either way is written down). Two outcomes need a database write that 0897 has no function for:
--
--   * GOOGLE WINS  the remote content is applied to the native row (and a tombstone is lifted if a delete lost), the row is
--                  marked synced with the new etag, and the override is recorded. app.project_event_take_remote
--   * LOCAL WINS   the local edit was re-sent once with the fresh etag; after the ordinary sync_done, the override is
--                  recorded on the row and in Activity. app.project_event_conflict_note
--
-- The marker the calendar reads is the existing `sync_error` sentence (public.hq_project_calendar already returns it for
-- every native event) beginning "conflict:" - no payload change, no new column. The row stays 'synced' because the sides
-- now agree; the sentence says how they came to.
--
-- Both are new names (no overload). Rollback: the handler only calls them on a 412, so the previous worker is unaffected;
-- drop the two functions.

create function app.project_event_take_remote(
  p_office uuid, p_event uuid, p_seen_updated_at timestamptz,
  p_title text, p_notes text, p_location text, p_starts timestamptz, p_ends timestamptz, p_all_day boolean,
  p_etag text, p_remote_updated timestamptz, p_restore boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
declare r public.project_events%rowtype;
begin
  perform app.require_office(p_office);
  select * into r from public.project_events where event_id = p_event and office_id = p_office for update;
  if not found then return jsonb_build_object('ok', true, 'gone', true); end if;
  -- A person edited the row after the work was read: that edit is newer than anything seen here and stays pending.
  if r.updated_at <> p_seen_updated_at then
    return jsonb_build_object('ok', true, 'raced', true);
  end if;
  if r.deleted_at is not null and not coalesce(p_restore, false) then
    return jsonb_build_object('error', 'the event is deleted here and the caller did not ask to restore it');
  end if;
  update public.project_events
     set title = coalesce(nullif(btrim(p_title), ''), r.title),
         notes = p_notes, location = p_location,
         starts_at = p_starts, ends_at = p_ends, all_day = coalesce(p_all_day, r.all_day),
         deleted_at = null, authority = 'person',
         external_etag = coalesce(p_etag, r.external_etag),
         external_updated_at = coalesce(p_remote_updated, r.external_updated_at),
         last_synced_at = app.now_utc(), sync_state = 'synced',
         sync_error = left('conflict: ' || coalesce(nullif(btrim(p_note), ''), 'Google had a newer change, so it was kept'), 1000)
   where event_id = p_event and office_id = p_office;
  perform app.append_event(p_office, extensions.gen_random_uuid(), 'system', 'google_sync', 'google_sync', 'event.updated', false,
    r.project_id, jsonb_build_object('title', r.title, 'starts_at', r.starts_at, 'ends_at', r.ends_at),
    jsonb_build_object('event_id', r.event_id, 'channel', 'google_sync', 'winner', 'google',
                       'mode', case when coalesce(p_restore, false) then 'restored after a lost delete' else 'edit lost to a newer Google change' end),
    format('%s: a newer change in Google was kept', left(coalesce(nullif(btrim(p_title), ''), r.title), 200)),
    '[]'::jsonb, null, null, null);
  return jsonb_build_object('ok', true, 'winner', 'google', 'restored', coalesce(p_restore, false));
end
$f$;
revoke all on function app.project_event_take_remote(uuid, uuid, timestamptz, text, text, text, timestamptz, timestamptz, boolean, text, timestamptz, boolean, text)
  from public, anon, authenticated, service_role;

create function app.project_event_conflict_note(p_office uuid, p_event uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
declare r public.project_events%rowtype;
begin
  perform app.require_office(p_office);
  select * into r from public.project_events where event_id = p_event and office_id = p_office for update;
  if not found then return jsonb_build_object('ok', true, 'gone', true); end if;
  -- Only a row that is in step again carries the note; one left pending by a mid-sync edit has not been resolved yet.
  if r.sync_state <> 'synced' then return jsonb_build_object('ok', true, 'noted', false); end if;
  update public.project_events
     set sync_error = left('conflict: ' || coalesce(nullif(btrim(p_note), ''), 'a newer change in Google was overridden by this later edit'), 1000)
   where event_id = p_event and office_id = p_office;
  perform app.append_event(p_office, extensions.gen_random_uuid(), 'system', 'google_sync', 'google_sync', 'event.updated', false,
    r.project_id, null,
    jsonb_build_object('event_id', r.event_id, 'channel', 'google_sync', 'winner', 'team_hq', 'mode', 'edit re-sent after a 412'),
    format('%s: the later Team HQ edit wins over a Google change', left(r.title, 200)), '[]'::jsonb, null, null, null);
  return jsonb_build_object('ok', true, 'noted', true, 'winner', 'team_hq');
end
$f$;
revoke all on function app.project_event_conflict_note(uuid, uuid, text) from public, anon, authenticated, service_role;
