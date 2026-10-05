-- An incident's office is written once, and its writer names it where the checks can see it (#413).
--
-- Two structural checks failed against 0877, both correctly:
--   * check:office-edges: every office-carrying table has the a1_office_write_once trigger, so a row cannot be moved
--     to another office after the fact. incidents had none.
--   * check:carrier-writers: reads every function body for an insert into a carrier that does not name office_id in
--     the column list. app.incident_seen did name it, but through a table alias (insert into public.incidents as i),
--     which the reader does not follow. The alias was only there to qualify the conflict update; the table's own name
--     does the same.
-- The behaviour is unchanged and was driven again after this migration (the same 200-failure, reminder, recovery and
-- recurrence run as before).

begin;

create trigger a1_office_write_once
  before update of office_id on public.incidents
  for each row execute function app.office_id_is_write_once();

create or replace function app.incident_seen(
  p_office uuid,
  p_service text,
  p_problem text,
  p_evidence jsonb default '{}'::jsonb,
  p_remind_hours integer default 24
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v_id uuid;
  v_inserted boolean;
  v_told timestamptz;
  v_occurrences integer;
  v_hours integer := greatest(coalesce(p_remind_hours, 24), 1);
  v_notify boolean := false;
  v_reason text := 'quiet';
  v_evidence jsonb;
begin
  perform app.require_office(p_office);

  if coalesce(btrim(p_service), '') = '' or coalesce(btrim(p_problem), '') = '' then
    raise exception 'an incident needs a service and a problem' using errcode = '22023';
  end if;

  -- A note, not a log: a long one is replaced by a marker rather than refused, so reporting a problem can never fail
  -- because of how much was said about it.
  v_evidence := case
                  when p_evidence is null then '{}'::jsonb
                  when octet_length(p_evidence::text) > 2000 then jsonb_build_object('truncated', true)
                  else p_evidence
                end;

  -- ON CONFLICT on the partial unique index takes the row lock, so a second worker reporting the same problem waits
  -- here and then sees what the first one decided. Exactly one caller is ever the one that inserted.
  insert into public.incidents (office_id, service, problem, evidence)
  values (p_office, lower(btrim(p_service)), lower(btrim(p_problem)), v_evidence)
  on conflict (office_id, service, problem) where state = 'open'
  do update set last_seen_at = app.now_utc(),
                occurrences = public.incidents.occurrences + 1,
                evidence = excluded.evidence
  returning incident_id, (xmax = 0), told_at, occurrences
       into v_id, v_inserted, v_told, v_occurrences;

  if v_inserted or v_told is null then
    v_notify := true;
    v_reason := 'first';
  elsif v_told < app.now_utc() - make_interval(hours => v_hours) then
    v_notify := true;
    v_reason := 'reminder';
  end if;

  if v_notify then
    update public.incidents
       set told_at = app.now_utc(), told_count = told_count + 1
     where incident_id = v_id;
  end if;

  return jsonb_build_object(
    'incident_id', v_id,
    'notify', v_notify,
    'reason', v_reason,
    'occurrences', v_occurrences
  );
end
$f$;

revoke all on function app.incident_seen(uuid, text, text, jsonb, integer) from public, anon, authenticated, service_role;

commit;
