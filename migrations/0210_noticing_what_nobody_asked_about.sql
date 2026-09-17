-- Noticing what nobody asked about.
--
-- Issue #52. Grant: *"not just necessarily wait for me to tell them, but to be
-- actively trying to be more useful to me, to make suggestions, not just
-- necessarily respond to specific questions."*
--
-- Every job in the queue exists because someone asked for it. `responsibilities`
-- gives the office recurring duties, which is scheduling and not initiative. No
-- agent has ever looked at a dashboard project and said *"four of the six
-- modules cite nothing — that is worth fixing."*
--
-- That observation is available. Nothing looks.
--
-- ## Almost all of this is SQL, deliberately
--
-- The temptation is to hand a model the project and ask what it notices. That
-- costs a call per project per pass against a ~£0 budget, and it produces
-- fluent observations that are not checkable. Everything below is a COUNT of
-- something real: a source nothing cites, a deadline nothing moves toward, a
-- document nobody has opened. A model is needed only to turn a fact into a
-- sentence, and it is not needed for that yet.
--
-- ## Ranked and rationed, because the failure mode is noise
--
-- A page of plausible observations costs Grant attention every day and teaches
-- him to skim — and a skimmed suggestion is worse than none, because the
-- morning one mattered he will skim that too. So each kind carries a weight,
-- the caller takes a few, and a dismissal is durable.
--
-- ## Dismissal makes the office HARDER to convince
--
-- Not merely silent. Dismissing "this project has gone quiet" once should
-- raise the bar for saying it again, or the same observation returns every
-- week with a different date on it. `dismissed_at` plus a count does that.

begin;

create table if not exists public.suggestions (
  suggestion_id uuid primary key default extensions.gen_random_uuid(),
  project_id    uuid references public.projects(project_id),

  /*
    The KIND is what dismissal attaches to, not the wording.

    Dismissing "Wellness has gone quiet" must silence "Wellness has gone quiet"
    next week, and the sentence will have a different number of days in it. So
    the identity of a suggestion is (kind, project, subject) and the prose is
    just how it was said this time.
  */
  kind          text not null check (length(btrim(kind)) > 0),
  subject_ref   text not null default '',

  body          text not null check (length(btrim(body)) between 10 and 400),
  /** The count behind it. A suggestion with no fact is an opinion. */
  because       jsonb not null default '{}'::jsonb,
  weight        integer not null default 50 check (weight between 0 and 100),

  /** A job the office would run if he says yes. Null when there is nothing to offer. */
  offer_kind    text,
  offer_args    jsonb,

  state         text not null default 'open'
                  check (state in ('open', 'acted', 'dismissed', 'stale')),
  raised_at     timestamptz not null default app.now_utc(),
  settled_at    timestamptz,
  /** How many times this exact thing has been dismissed. Raises the bar. */
  dismissals    integer not null default 0,

  constraint suggestions_settled_is_explained
    check ((state in ('open')) = (settled_at is null))
);

-- One open suggestion per thing. A second is the same observation shouting.
create unique index if not exists suggestions_one_open
  on public.suggestions (kind, coalesce(project_id::text, ''), subject_ref)
  where state = 'open';

create index if not exists suggestions_by_weight
  on public.suggestions (weight desc, raised_at desc) where state = 'open';

comment on table public.suggestions is
  'What the office noticed without being asked (#52). Identity is (kind, '
  'project, subject) rather than wording, so dismissing one silences the same '
  'observation next week when the sentence has a different number in it.';

-- ---------------------------------------------------------------------------
-- What is worth noticing
--
-- Each is a count of something real, and each maps to a different remedy.
-- An observation nobody could act on differently from the one above it is not
-- a second observation.
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

  -- A dashboard project with open work that nothing has touched in a fortnight.
  -- The cheapest useful observation there is.
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

  -- A task with a real deadline inside a week and nobody on it. The one kind
  -- of observation where the cost of not saying it is a missed date.
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

  /*
    A source that was attached and has produced nothing.

    Grant's own phrasing for what a source is FOR: *"what this project reads
    from."* One that has given no documents is either misconfigured or was a
    good idea nobody followed through, and both are worth a sentence.
  */
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

  -- Something the office keeps being unable to do (#47), surfaced as a
  -- suggestion rather than waiting for a proposal.
  blocked_capability as (
    select 'capability_missing'::text, null::uuid, i.needed,
           format('We have been unable to %s %s times in the last fortnight.',
                  replace(i.needed, '-', ' '), i.times),
           jsonb_build_object('times', i.times, 'who', i.staff_slug),
           70,
           null::text, null::jsonb
      from public.impediments_tally(14, 3) i
  )

  select * from (
    select * from looming
    union all select * from blocked_capability
    union all select * from quiet
    union all select * from idle_source
  /*
    The column names come from the FIRST branch of a UNION, and its columns are
    unnamed literals — so `order by weight` found no such column. Named here
    rather than aliasing inside one branch, because naming them in one place
    says what the shape is for all four.
  */
  ) as all_of_it (kind, project_id, subject_ref, body, because, weight, offer_kind, offer_args)
  order by weight desc
  limit greatest(coalesce(p_limit, 12), 1)
$$;

comment on function app.notice(integer) is
  'What is worth saying without being asked. Every row is a COUNT of something '
  'real — a deadline, a source that gave nothing, a limitation that recurred. '
  'A model is needed to phrase a fact, not to find one (#52).';

commit;
