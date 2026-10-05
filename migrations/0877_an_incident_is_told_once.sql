-- An unresolved problem is told once, then reminded sensibly, then closed when it is fixed (#413).
--
-- Grant's Google token was revoked on 15 September. Every duty that needed Google said so, every hour, for days: 194
-- messages with one distinct body. app.say_once (0584, 0589, 0782) already limits a duty to one telling per twenty hours,
-- but it asks "has THIS KIND said THIS THING lately" and nothing more, so:
--   * google.read_mail and google.read_calendar (and any later Google duty) each tell him separately about one cause;
--   * it has no notion of the problem being FIXED, so nothing says "Google works again" and a recurrence an hour later
--     is indistinguishable from the old one;
--   * it only covers kinds a responsibility schedules, so a person's own request that fails for the same cause is not
--     counted at all.
--
-- The unit here is the problem, not the job: an office, a service and what is wrong with it. One OPEN incident may exist
-- for each (enforced by a partial unique index, so two workers racing to report the same problem cannot both be first).
--
--   app.incident_seen(office, service, problem, evidence, remind_hours)
--       opens the incident or counts another occurrence, and says whether the person should be told:
--         first      this is the first time (or a later occurrence of an incident nobody has been told about)
--         reminder   he was told, the problem is still open and the reminder interval has elapsed
--         quiet      he was told recently; nothing is said
--   app.incident_resolve(office, service, problem)
--       closes the open incident and says whether he had been told, which is the only case worth a "that works again".
--       A later failure opens a NEW incident and is told as a first.
--
-- Only the decision to speak lives here. What is said, and the button that goes with it, is composed in code.
--
-- Evidence is a short note for whoever investigates (the last error class, the duty that saw it). It is replaced on every
-- occurrence, so the table does not grow with the flood: 200 failures are one row with occurrences = 200.

begin;

create table if not exists public.incidents (
  incident_id    uuid primary key default gen_random_uuid(),
  office_id      uuid not null references public.offices (office_id),
  service        text not null check (service = lower(btrim(service)) and service <> ''),
  problem        text not null check (problem = lower(btrim(problem)) and problem <> ''),
  state          text not null default 'open' check (state in ('open', 'resolved')),
  opened_at      timestamptz not null default app.now_utc(),
  last_seen_at   timestamptz not null default app.now_utc(),
  occurrences    integer not null default 1 check (occurrences >= 1),
  told_at        timestamptz,
  told_count     integer not null default 0 check (told_count >= 0),
  resolved_at    timestamptz,
  evidence       jsonb not null default '{}'::jsonb,
  constraint incidents_resolved_has_a_time check ((state = 'resolved') = (resolved_at is not null)),
  constraint incidents_told_has_a_time check ((told_count > 0) = (told_at is not null))
);

create unique index if not exists incidents_one_open
  on public.incidents (office_id, service, problem)
  where state = 'open';

create index if not exists incidents_office_recent_idx
  on public.incidents (office_id, last_seen_at desc);

comment on table public.incidents is
  'One unresolved problem with a service, for one office (#413). occurrences counts how often it was seen and told_count '
  'how often the person was told, so a large occurrences beside told_count = 1 is the flood this exists to prevent. '
  'Rows are closed, never deleted: a recurrence after a fix is a new row.';

alter table public.incidents enable row level security;
revoke all on table public.incidents from public, anon, authenticated, service_role;

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
  insert into public.incidents as i (office_id, service, problem, evidence)
  values (p_office, lower(btrim(p_service)), lower(btrim(p_problem)), v_evidence)
  on conflict (office_id, service, problem) where state = 'open'
  do update set last_seen_at = app.now_utc(),
                occurrences = i.occurrences + 1,
                evidence = excluded.evidence
  returning i.incident_id, (xmax = 0), i.told_at, i.occurrences
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

create or replace function app.incident_resolve(p_office uuid, p_service text, p_problem text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v_id uuid;
  v_told timestamptz;
begin
  perform app.require_office(p_office);

  update public.incidents
     set state = 'resolved', resolved_at = app.now_utc()
   where office_id = p_office
     and service = lower(btrim(p_service))
     and problem = lower(btrim(p_problem))
     and state = 'open'
  returning incident_id, told_at into v_id, v_told;

  return jsonb_build_object(
    'resolved', v_id is not null,
    'was_told', v_told is not null,
    'incident_id', v_id
  );
end
$f$;

revoke all on function app.incident_resolve(uuid, text, text) from public, anon, authenticated, service_role;

commit;
