-- A duty that happens at a TIME, not every N minutes.
--
-- Issue #56. Grant:
--
--     "Certainly, I should expect every morning a morning briefing from my
--      chief of staff, you know, what's on the cards, what's to be done,
--      recommendations, that kind of thing."
--
-- `responsibilities.period_minutes` is an interval, and an interval cannot
-- express "morning". A daily duty is 1440, which means "1440 minutes after the
-- last run" — so it drifts by however long the run took plus however late the
-- pass that noticed it was. The evidence is already in the table:
--
--     daily-capacity-report   period 1440   last run 15:36
--
-- 15:36 is not a time anyone chose. It is where a 1440-minute duty ends up
-- after a few weeks of drift. A morning briefing that arrives at 15:36, then
-- 15:41, then 15:53 is not a morning briefing, and adding a duty on top of this
-- mechanism would have produced exactly that.
--
-- ## The change
--
-- `at_time` and `timezone`, both nullable. Null keeps the interval behaviour
-- exactly as it is, so nothing that works today changes. Set, it means:
--
--     once per local day, on or after this local wall-clock time
--
-- The timezone matters and cannot be UTC. Grant's is already known —
-- `system_config['grant.timezone']` is Europe/Athens — so it defaults to that
-- rather than being restated per duty. Europe/Athens observes summer time, so
-- "07:00" must mean seven in the morning where he is in both March and
-- November; storing an offset instead of a zone name would be right for half
-- the year.
--
-- ## Idempotency, which the interval version got right and must keep
--
-- The existing key is the window index — `duty:slug:<epoch/period>` — so two
-- passes inside one period produce the same key and collide on 0005's unique
-- index. For a wall-clock duty the equivalent is the LOCAL DATE:
--
--     duty:briefing-morning:2026-09-11
--
-- Two passes on the same local day produce the same key. That is the property
-- that stops Grant being briefed twice, and it is enforced by an index rather
-- than by the caller remembering.

begin;

alter table public.responsibilities
  add column if not exists at_time  time,
  add column if not exists timezone text;

comment on column public.responsibilities.at_time is
  'Local wall-clock time for a once-a-day duty. NULL means the duty is an '
  'interval, per period_minutes, which is the original behaviour.';

comment on column public.responsibilities.timezone is
  'IANA zone name for at_time. NULL falls back to system_config grant.timezone. '
  'A zone name, not an offset — Europe/Athens observes summer time, and an '
  'offset would be right for half the year.';

-- A duty is one thing or the other. Both would mean two schedules disagreeing,
-- and the code would have to pick a winner silently.
alter table public.responsibilities
  add constraint responsibilities_one_schedule
    check (at_time is null or period_minutes >= 1440);

comment on constraint responsibilities_one_schedule on public.responsibilities is
  'A wall-clock duty may not also be a sub-daily interval. period_minutes stays '
  'set on these so the sanity bound still applies and nothing reading the '
  'column finds a null it did not expect.';

-- ---------------------------------------------------------------------------
-- Where the office thinks Grant is
-- ---------------------------------------------------------------------------
create or replace function app.grant_timezone()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select value #>> '{}' from public.system_config where key = 'grant.timezone'),
    'Europe/London')
$$;

comment on function app.grant_timezone() is
  'The zone a wall-clock duty is measured in. Read from config rather than '
  'hardcoded, because he moves and the briefing should follow him.';

-- ---------------------------------------------------------------------------
-- Due duties, now in two flavours
--
-- `create or replace` does not replace a function whose argument list changed —
-- this one has none, so replace is correct here, but the return type is the
-- same and that is the part that would have bitten.
-- ---------------------------------------------------------------------------
create or replace function app.due_responsibilities()
returns table (
  responsibility_id uuid,
  slug text,
  staff_id uuid,
  project_id uuid,
  job_kind text,
  idempotency_key text
)
language sql
stable
security definer
set search_path = ''
as $$
  with z as (select app.grant_timezone() as tz)
  select
    r.responsibility_id, r.slug, r.staff_id, r.project_id, r.job_kind,
    case
      when r.at_time is null
        -- The window index, unchanged: two attempts inside the same period
        -- produce the same key and collide on 0005's unique index.
        then 'duty:' || r.slug || ':' ||
             (floor(extract(epoch from app.now_utc()) / (r.period_minutes * 60)))::bigint::text
        -- The local date. Two passes on the same day produce the same key,
        -- which is what stops him being briefed twice.
        else 'duty:' || r.slug || ':' ||
             to_char((app.now_utc() at time zone coalesce(r.timezone, z.tz))::date, 'YYYY-MM-DD')
    end
  from public.responsibilities r
  join public.staff s on s.staff_id = r.staff_id and s.active
  cross join z
  where r.enabled
    and case
      when r.at_time is null then
        r.last_run_at is null
        or r.last_run_at <= app.now_utc() - make_interval(mins => r.period_minutes)
      else
        -- Past this morning's anchor, and not already done since it. Comparing
        -- against the anchor rather than against "24h ago" is the whole point:
        -- a run that happened at 07:02 does not push tomorrow's to 07:02 + 24h.
        app.now_utc() >= (
          ((app.now_utc() at time zone coalesce(r.timezone, z.tz))::date + r.at_time)
            at time zone coalesce(r.timezone, z.tz)
        )
        and (
          r.last_run_at is null
          or r.last_run_at < (
            ((app.now_utc() at time zone coalesce(r.timezone, z.tz))::date + r.at_time)
              at time zone coalesce(r.timezone, z.tz)
          )
        )
    end;
$$;

comment on function app.due_responsibilities is
  'Due duties with the idempotency key each must use. Two flavours: an interval '
  'duty keyed on its window index, and a wall-clock duty keyed on the local '
  'date. The key is derived here, once, because "every caller derives it the '
  'same way" is not something you get by documenting it.';

-- ---------------------------------------------------------------------------
-- Fix the drift that proved the point
--
-- `daily-capacity-report` is the duty whose 15:36 last-run demonstrated the
-- problem. It is a report about the day, so it belongs at the end of one.
-- ---------------------------------------------------------------------------
update public.responsibilities
   set at_time = '18:00', timezone = null, updated_at = app.now_utc()
 where slug = 'daily-capacity-report';

commit;
