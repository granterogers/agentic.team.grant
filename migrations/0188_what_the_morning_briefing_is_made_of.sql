-- What the morning briefing is made of.
--
-- Issue #56. Grant: *"what's on the cards, what's to be done, recommendations,
-- that kind of thing. I appreciate it'll have much current data to go on."*
--
-- That last sentence is a licence for a THIN briefing, not for an invented one.
-- A model asked to write a morning briefing with little to go on will write a
-- good one anyway — that is what it is for — and the result reads exactly like
-- a briefing about a busy office. Grant would trust it, and it would be
-- fiction.
--
-- So the facts are counted here, in SQL, and every number has a provenance.
-- `capacity.ts` already learned this the expensive way (§11, and its own
-- header: *"the model is never shown the numbers to summarise. It is handed the
-- finished sentences as facts"*). The briefing follows the same rule.
--
-- ## Why one function returning jsonb rather than several views
--
-- The briefing is written once a day and stored with its inputs. Having the
-- facts arrive as one object means `briefings.inputs` is exactly what the body
-- was written from — so three weeks later, "why did it say that" is answerable
-- by reading one column rather than by re-running six queries against a
-- database that has moved on.

begin;

create or replace function app.morning_briefing_facts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  z as (select app.grant_timezone() as tz),
  -- The local day this briefing is FOR, which is not necessarily today in UTC.
  d as (select (app.now_utc() at time zone (select tz from z))::date as today),

  /*
    What needs him. First, because it is the only category he can unblock —
    the `needs_me` view's own comment says so, and it is not capped there
    deliberately: "a view that silently returned 7 of 40 would hide the thing
    worth knowing."
  */
  waiting as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'what', n.requested_action,
             'why', n.why_needed,
             'project', p.name,
             'overdue', n.overdue,
             'deadline', n.real_deadline,
             'if_delayed', n.consequences_of_delay,
             'work_continues', n.work_can_continue
           ) order by n.overdue desc, n.real_deadline nulls last, n.created_at), '[]'::jsonb) as v
      from public.needs_me n
      left join public.projects p on p.project_id = n.project_id
  ),

  -- What the office did while he slept. Fixtures excluded — 264 harness
  -- failures were once reported to him as the office falling over.
  overnight as (
    select jsonb_build_object(
             'finished', count(*) filter (where j.state = 'complete'),
             'failed',   count(*) filter (where j.state = 'failed'),
             'still_going', count(*) filter (where j.state in ('queued', 'running'))
           ) as v
      from public.jobs j
     where not j.is_fixture
       and j.updated_at >= app.now_utc() - interval '18 hours'
  ),

  -- What is stuck, and for how long. A blocked job with no stated reason is
  -- the failure Active Jobs was built to fix, so the reason comes with it.
  stuck as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', j.kind,
             'project', p.name,
             'since_hours', round(extract(epoch from (app.now_utc() - j.updated_at)) / 3600),
             'why', coalesce(nullif(btrim(j.state_reason), ''), 'no reason recorded')
           ) order by j.updated_at), '[]'::jsonb) as v
      from public.jobs j
      left join public.projects p on p.project_id = j.project_id
     where not j.is_fixture
       and j.state in ('waiting_external', 'waiting_user', 'retrying', 'paused')
       and j.updated_at < app.now_utc() - interval '2 hours'
  ),

  -- His day. The calendar is already refreshed hourly by its own duty.
  diary as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'what', c.summary,
             'at', c.starts_at
           ) order by c.starts_at), '[]'::jsonb) as v
      from public.calendar_events c, z, d
     where (c.starts_at at time zone z.tz)::date = d.today
  ),

  -- Projects with a deadline and nothing moving toward it. The cheapest useful
  -- recommendation there is, and it is pure SQL.
  adrift as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'project', p.name,
             'open_tasks', t.open_count,
             'last_touched_days', round(extract(epoch from (app.now_utc() - p.updated_at)) / 86400)
           ) order by p.updated_at), '[]'::jsonb) as v
      from public.projects p
      join lateral (
        select count(*) filter (where tk.state in ('todo', 'in_progress')) as open_count
          from public.tasks tk where tk.project_id = p.project_id
      ) t on true
     where p.status = 'active'
       and not p.is_fixture
       and p.updated_at < app.now_utc() - interval '7 days'
  ),

  /*
    What the office keeps being unable to do (#47).

    Through the public wrapper, deliberately: it is the path that cannot be
    asked for fixtures, so a verification run can never turn into a line in
    Grant's briefing asking him to buy something.
  */
  cannots as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'who', i.staff_slug,
             'needs', i.needed,
             'kind', i.kind,
             'times', i.times,
             'for_instance', i.for_instance
           ) order by i.times desc), '[]'::jsonb) as v
      from public.impediments_tally(14, 2) i
  )

  select jsonb_build_object(
    'for_date', (select today from d),
    'timezone', (select tz from z),
    'generated_at', app.now_utc(),
    'waiting_on_you', (select v from waiting),
    'overnight', (select v from overnight),
    'stuck', (select v from stuck),
    'diary', (select v from diary),
    'adrift', (select v from adrift),
    'office_cannot', (select v from cannots)
  )
$$;

comment on function app.morning_briefing_facts() is
  'Everything the morning briefing is allowed to say, counted rather than '
  'inferred (#56). Stored alongside the body in briefings.inputs, so "why did '
  'it say that" is answerable three weeks later by reading one column.';

-- ---------------------------------------------------------------------------
-- Writing one, at most once a day
--
-- The unique key on (kind, scope_ref, for_date) is already there and was
-- clearly put there for this: "so a duty re-attempted after a crash collides
-- instead of sending a second one". This uses it rather than checking first,
-- because a check-then-insert has a race and a unique index does not.
-- ---------------------------------------------------------------------------
create or replace function app.write_briefing(
  p_kind      text,
  p_for_date  date,
  p_body      text,
  p_inputs    jsonb,
  p_scope_ref text default 'grant'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  made public.briefings%rowtype;
begin
  insert into public.briefings (kind, for_date, scope_ref, body, inputs)
  values (p_kind, p_for_date, p_scope_ref, p_body, coalesce(p_inputs, '{}'::jsonb))
  on conflict (kind, scope_ref, for_date) do nothing
  returning * into made;

  if made.briefing_id is null then
    return jsonb_build_object(
      'already_written', true,
      'for_date', p_for_date,
      'briefing_id', (select b.briefing_id from public.briefings b
                       where b.kind = p_kind and b.scope_ref = p_scope_ref
                         and b.for_date = p_for_date)
    );
  end if;

  return jsonb_build_object('briefing_id', made.briefing_id, 'already_written', false);
end;
$$;

comment on function app.write_briefing(text, date, text, jsonb, text) is
  'Store a briefing, at most one per kind per scope per day. Relies on the '
  'unique index rather than checking first: a check-then-insert has a race and '
  'an index does not.';

create or replace function public.morning_briefing_facts()
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.morning_briefing_facts() $$;

create or replace function public.write_briefing(
  p_kind text, p_for_date date, p_body text, p_inputs jsonb,
  p_scope_ref text default 'grant'
)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.write_briefing(p_kind, p_for_date, p_body, p_inputs, p_scope_ref) $$;

commit;
