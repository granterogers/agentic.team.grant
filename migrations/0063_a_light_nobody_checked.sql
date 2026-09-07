-- 0063 — a light nobody checked must not be green
--
-- The connections view rendered, and the second row down said **Backblaze B2 ·
-- Working**, with a green light, on the strength of a `state` of `ok` that no
-- program has ever verified. Backblaze is not machine-checkable from here — the
-- B2 credential is used by a GitHub Action, not by this process — so that row's
-- status comes from Grant saying so on 2026-09-06.
--
-- Which may well be true, and is still the wrong light. Green on this page
-- means "a probe reached this service and it answered". A row that means "a
-- human told us, once" is a different claim with a different shelf life, and
-- painting them the same colour is this project's recurring defect rendered in
-- LEDs: an indicator that stops depending on the thing it indicates.
--
-- So `attested` joins the vocabulary: confirmed by a person, not by a probe.
-- The page gives it its own neutral lamp and the words "Confirmed by hand",
-- and the count of working services no longer includes things nobody checked.
--
-- Four rows are affected — Backblaze, GitHub, the Telegram roster and the TTS
-- placeholder — and the honest reading of the page changes from "13 working"
-- to "11 working, 3 taken on trust".

begin;

alter table public.connection_health
  drop constraint connection_health_state_known;

alter table public.connection_health
  add constraint connection_health_state_known
  check (state in ('ok', 'dead', 'missing', 'unknown', 'parked', 'attested'));

comment on column public.connection_health.state is
  'ok = a probe reached it and it answered. attested = a person said so, and '
  'no program has checked. The distinction exists because painting them the '
  'same colour makes the indicator stop depending on the thing it indicates.';

-- The ordering puts problems first and now places `attested` between the
-- things that work and the things deliberately parked: it is not a problem,
-- but it is less certain than a green row and should not sit above one.
create or replace function app.hq_connections()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    jsonb_build_object(
      'checked_at', (select max(checked_at) from public.connection_health),
      'rows', (
        select jsonb_agg(
                 jsonb_build_object(
                   'service', c.service,
                   'credential', c.credential,
                   'state', c.state,
                   'detail', c.detail,
                   'owner', c.owner,
                   'action', c.action,
                   'checked_at', c.checked_at,
                   'age_minutes', round(extract(epoch from (app.now_utc() - c.checked_at)) / 60)
                 )
                 order by
                   case c.state
                     when 'dead' then 0 when 'missing' then 1 when 'unknown' then 2
                     when 'ok' then 3 when 'attested' then 4 else 5
                   end,
                   c.service
               )
          from public.connection_health c
      )
    ),
    '{}'::jsonb
  )
$$;

commit;
