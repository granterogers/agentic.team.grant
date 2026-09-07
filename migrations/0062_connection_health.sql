-- 0062 — every connection, and whether it was working when we last looked
--
-- Grant asked for the front end to show each connected service with a light.
-- The obvious build is a green dot per row and a probe on page load, and it is
-- wrong twice over.
--
-- **A page cannot probe.** The dashboard is an Edge Function with one bearer
-- token; probing eleven vendors would mean it holding eleven credentials, and
-- a read-only dashboard becoming the widest-privileged thing in the system is
-- the opposite of what §25 wants. `npm run inventory` already probes every
-- credential against its real provider, from a place that legitimately has
-- them. It just threw the answers away when it finished printing.
--
-- **A light with no timestamp is a lie waiting to happen.** Green means
-- "working"; what it can honestly mean is "working when we last looked". A
-- stored status with no age is this project's recurring defect wearing a UI:
-- the indicator stops depending on the thing it indicates the moment the
-- prober stops running, and it stays green while doing so. So every row
-- carries `checked_at`, the reader decides what counts as stale, and the page
-- shows amber rather than green for a check old enough to be meaningless.
--
-- Nothing here is a secret. A service name, a state and a piece of advice —
-- deliberately no key material, no vault reference, no endpoint. §25 forbids
-- token and debug detail on this surface and the schema is the enforcement.

begin;

create table public.connection_health (
  service       text        not null,
  credential    text        not null,
  -- The same vocabulary `npm run inventory` prints, so one is not a
  -- translation of the other.
  state         text        not null,
  -- One short human sentence: "valid", "http 401", "5 credits left".
  detail        text        not null,
  -- Whose account it hangs off. The column that did not exist when one Google
  -- suspension took out four vendors at once.
  owner         text        not null,
  -- What to do about it, empty when there is nothing to do.
  action        text        not null default '',
  checked_at    timestamptz not null default app.now_utc(),

  primary key (service, credential),

  constraint connection_health_state_known
    check (state in ('ok', 'dead', 'missing', 'unknown', 'parked')),
  -- §25: this table is read by a browser. A credential in any of its columns
  -- would be a credential in a web response, and the constraint is cheaper
  -- than remembering.
  constraint connection_health_carries_no_credential
    check (
      (service || credential || detail || owner || action)
        !~ '(xox[a-z]-|sbp_|ntn_|sk-[A-Za-z0-9]|AIza|eyJ[A-Za-z0-9_-]{10})'
    )
);

comment on table public.connection_health is
  'What each connected service was doing when the prober last looked. Written '
  'by `npm run inventory`, read by Team HQ. Carries checked_at because a light '
  'with no age stays green after the prober stops running.';

create or replace function app.record_connection_health(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_count integer;
begin
  insert into public.connection_health (service, credential, state, detail, owner, action, checked_at)
  select r->>'service', r->>'credential', r->>'state',
         left(coalesce(r->>'detail', ''), 200), coalesce(r->>'owner', ''),
         left(coalesce(r->>'action', ''), 200), app.now_utc()
    from jsonb_array_elements(p_rows) as r
  on conflict (service, credential) do update
    set state = excluded.state,
        detail = excluded.detail,
        owner = excluded.owner,
        action = excluded.action,
        checked_at = excluded.checked_at;

  get diagnostics v_count = row_count;

  -- A service that stops being probed stops being shown, rather than lingering
  -- green for ever. Removed only when this run wrote a full set, so one
  -- partial run cannot empty the page.
  if v_count >= 5 then
    delete from public.connection_health
     where checked_at < app.now_utc() - interval '1 minute';
  end if;

  return v_count;
end;
$$;

comment on function app.record_connection_health is
  'Upsert a whole probe run. Prunes rows this run did not write - a service '
  'that stopped being probed must stop being shown, not linger green - but '
  'only when the run was large enough to be a full set.';

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
                   -- Computed here rather than in the browser so every reader
                   -- agrees what stale means.
                   'age_minutes', round(extract(epoch from (app.now_utc() - c.checked_at)) / 60)
                 )
                 order by
                   case c.state
                     when 'dead' then 0 when 'missing' then 1 when 'unknown' then 2
                     when 'parked' then 3 else 4
                   end,
                   c.service
               )
          from public.connection_health c
      )
    ),
    '{}'::jsonb
  )
$$;

comment on function app.hq_connections() is
  'Team HQ''s connections view. Problems first, then everything working - a '
  'list sorted alphabetically buries the one row that matters.';

create or replace function public.hq_connections()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.hq_connections() $$;

revoke all on function app.record_connection_health(jsonb) from public;
revoke all on function app.hq_connections() from public;
revoke all on function public.hq_connections() from public;
grant execute on function app.record_connection_health(jsonb) to ai_team_app;
grant execute on function app.hq_connections() to ai_team_app, service_role;
grant execute on function public.hq_connections() to ai_team_app, service_role;

grant select, insert, update, delete on public.connection_health to ai_team_app;
alter table public.connection_health enable row level security;
alter table public.connection_health force  row level security;
create policy connection_health_app_all on public.connection_health
  for all to ai_team_app using (true) with check (true);

commit;
