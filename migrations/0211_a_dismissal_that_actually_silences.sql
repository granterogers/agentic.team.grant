-- A dismissal that actually silences, and a briefing that reads the noticing.
--
-- Issue #52, second half. 0210 built `app.notice()` and `public.suggestions`
-- and left them not speaking to each other, which is two bugs wearing one coat:
--
-- **1. Nothing reads a dismissal back.** 0210's own header promises *"a
-- dismissal is durable"* and *"dismissing this project has gone quiet once
-- should raise the bar for saying it again"*. It does not. `app.notice()` joins
-- to nothing and would have said the same thing every single morning after
-- Grant told it not to — the exact behaviour the (kind, project, subject)
-- identity was invented to prevent. `verify:notice` passed twenty-one checks
-- without catching it, because it tested the table and the function separately
-- and the bug is only in the gap between them.
--
-- **2. Nothing calls it.** A noticing pass nobody reads is dead code with tests.
-- The morning briefing is where recommendations were always going to live —
-- `briefing.ts` says so in a comment: *"#52's noticing pass is what makes this
-- section genuinely good, and until then it is thin rather than padded."*
--
-- ## The bar rises by waiting longer, not by scoring lower
--
-- The tempting design is to subtract from the weight on each dismissal. It is
-- wrong: a deadline nobody owns does not become less urgent because he waved it
-- away last month, it becomes MORE so, and a decaying score eventually buries
-- it under a stale source. What a dismissal actually means is *"not now"*, so
-- what it buys is silence for a while, and a second dismissal buys longer.
-- A fortnight per dismissal: once → silent a fortnight, twice → a month.
--
-- Acting on one is different and shorter. If he acted and the condition still
-- holds a week later, saying so again is the correct behaviour, not nagging.
--
-- ## `adrift` and `office_cannot` come out of the briefing facts
--
-- `app.notice()` is a strict superset of both — `project_quiet` supersedes
-- `adrift`, `capability_missing` supersedes `office_cannot` — so leaving them
-- in means Grant reads the same recommendation twice in one message, in two
-- different phrasings, which reads worse than either alone.
--
-- It also fixes a real miscount on the way out: `adrift` counted open tasks as
-- `state in ('todo', 'in_progress')` and there is no `in_progress` state. The
-- vocabulary is todo | doing | blocked | done | cancelled, so every project
-- whose work was under way counted as having zero open tasks. `notice()`'s
-- quiet branch has the right three.

begin;

-- ---------------------------------------------------------------------------
-- Noticing, minus what he has already answered
-- ---------------------------------------------------------------------------
create or replace function app.notice(p_limit integer default 12)
returns table (
  kind        text,
  project_id  uuid,
  subject_ref text,
  body        text,
  because     jsonb,
  weight      integer,
  offer_kind  text,
  offer_args  jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with live as (
    select p.project_id, p.name, p.updated_at
      from public.projects p
     where p.status = 'active' and not p.is_fixture
  ),

  /*
    Everything settled recently enough to still count as answered.

    Keyed on the identity, never on the wording — that is the whole point of
    the shape 0210 chose. `state = 'open'` is in here too: an observation
    already sitting unanswered on the dashboard should not be raised a second
    time as though it were new.
  */
  answered as (
    select s.kind, coalesce(s.project_id::text, '') as pid, s.subject_ref
      from public.suggestions s
     where s.state = 'open'
        or (s.state = 'dismissed'
            and s.settled_at > app.now_utc()
                               - (greatest(s.dismissals, 1) * interval '14 days'))
        or (s.state = 'acted'
            and s.settled_at > app.now_utc() - interval '7 days')
  ),

  quiet as (
    select 'project_quiet'::text as kind, l.project_id, ''::text as subject_ref,
           format('%s has not moved in %s days, with %s open %s.',
                  l.name,
                  round(extract(epoch from (app.now_utc() - l.updated_at)) / 86400),
                  t.open_count,
                  case when t.open_count = 1 then 'task' else 'tasks' end) as body,
           jsonb_build_object('days',
             round(extract(epoch from (app.now_utc() - l.updated_at)) / 86400),
             'open_tasks', t.open_count) as because,
           55 as weight,
           null::text as offer_kind, null::jsonb as offer_args
      from live l
      join lateral (
        select count(*) filter (where tk.state in ('todo', 'doing', 'blocked')) as open_count
          from public.tasks tk
         where tk.project_id = l.project_id and not tk.is_fixture
      ) t on true
     where l.updated_at < app.now_utc() - interval '14 days'
       and t.open_count > 0
  ),

  looming as (
    select 'deadline_unowned'::text, tk.project_id, tk.task_id::text,
           format('“%s” is due %s and nobody is on it.',
                  left(tk.title, 90), to_char(tk.due_on, 'FMDay DD Mon')),
           jsonb_build_object('due_on', tk.due_on),
           80,
           null::text, null::jsonb
      from public.tasks tk
      join live l on l.project_id = tk.project_id
     where not tk.is_fixture
       and tk.state in ('todo', 'doing')
       and tk.due_on is not null
       and tk.due_on <= (app.now_utc() at time zone app.grant_timezone())::date + 7
       and tk.assignee_staff is null
       and not tk.assigned_to_human
  ),

  idle_source as (
    select 'source_unused'::text, a.project_id, a.attachment_id::text,
           format('%s has been attached to %s since %s and has produced nothing.',
                  coalesce(nullif(a.display_name, ''), a.connector),
                  l.name, to_char(a.created_at, 'FMDD Mon')),
           jsonb_build_object('connector', a.connector,
                              'attached_days',
                              round(extract(epoch from (app.now_utc() - a.created_at)) / 86400)),
           45,
           null::text, null::jsonb
      from public.project_attachments a
      join live l on l.project_id = a.project_id
     where a.enabled
       and a.created_at < app.now_utc() - interval '7 days'
       and not exists (
         select 1 from public.documents d
          where d.project_id = a.project_id
            and coalesce(d.connector, '') = a.connector
       )
  ),

  blocked_capability as (
    select 'capability_missing'::text, null::uuid, i.needed,
           format('We have been unable to %s %s times in the last fortnight.',
                  replace(i.needed, '-', ' '), i.times),
           jsonb_build_object('times', i.times, 'who', i.staff_slug),
           70,
           null::text, null::jsonb
      from public.impediments_tally(14, 3) i
  )

  select k.kind, k.project_id, k.subject_ref, k.body, k.because,
         k.weight, k.offer_kind, k.offer_args
    from (
      select * from looming
      union all select * from blocked_capability
      union all select * from quiet
      union all select * from idle_source
    ) as k (kind, project_id, subject_ref, body, because, weight, offer_kind, offer_args)
   where not exists (
     select 1 from answered a
      where a.kind = k.kind
        and a.pid = coalesce(k.project_id::text, '')
        and a.subject_ref = k.subject_ref
   )
   order by k.weight desc
   limit greatest(coalesce(p_limit, 12), 1)
$$;

comment on function app.notice(integer) is
  'What is worth saying without being asked, minus what he has already '
  'answered. Every row is a COUNT of something real. A dismissal buys a '
  'fortnight of silence per dismissal; acting on one buys a week (#52).';

-- ---------------------------------------------------------------------------
-- Writing down what was noticed, so a dismissal has something to attach to
-- ---------------------------------------------------------------------------
/*
  Persisting is not optional bookkeeping — it is the only way a dismissal can
  work. `app.notice()` recomputes from the world every time and has no memory;
  `suggestions` is the memory, and a suggestion Grant was shown but that was
  never written down cannot be dismissed, because there is no row to dismiss.

  So the briefing raises them first and reads them back, rather than reading
  `notice()` directly. `on conflict do nothing` against the partial unique
  index means a second pass on the same morning is free.
*/
create or replace function app.raise_suggestions(p_limit integer default 6)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with raised as (
    insert into public.suggestions
      (project_id, kind, subject_ref, body, because, weight, offer_kind, offer_args)
    select n.project_id, n.kind, n.subject_ref, n.body, n.because,
           n.weight, n.offer_kind, n.offer_args
      from app.notice(p_limit) n
    on conflict (kind, coalesce(project_id::text, ''), subject_ref)
      where state = 'open'
      do nothing
    returning 1
  )
  select count(*)::integer from raised
$$;

comment on function app.raise_suggestions(integer) is
  'Write what was noticed into public.suggestions so it can be dismissed. '
  'notice() has no memory; this table is the memory (#52).';

drop function if exists public.raise_suggestions(integer);
create function public.raise_suggestions(p_limit integer default 6)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$ select app.raise_suggestions(p_limit) $$;

-- ---------------------------------------------------------------------------
-- The briefing reads it
-- ---------------------------------------------------------------------------
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

  /*
    Recommendations, from the one place that computes them.

    Replaces `adrift` and `office_cannot`, both of which app.notice() already
    covers and covers better — see this migration's header for the state name
    that does not exist and the double-phrasing this removes.
  */
  noticed as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', n.kind,
             'body', n.body,
             'because', n.because,
             'weight', n.weight
           ) order by n.weight desc), '[]'::jsonb) as v
      from app.notice(6) n
  )

  select jsonb_build_object(
    'for_date', (select today from d),
    'timezone', (select tz from z),
    'generated_at', app.now_utc(),
    'waiting_on_you', (select v from waiting),
    'overnight', (select v from overnight),
    'stuck', (select v from stuck),
    'diary', (select v from diary),
    'noticed', (select v from noticed)
  )
$$;

comment on function app.morning_briefing_facts() is
  'Everything the morning briefing is allowed to say, counted rather than '
  'inferred (#56). Recommendations come from app.notice() (#52), so a '
  'dismissal on the dashboard silences tomorrow''s briefing too.';

commit;
