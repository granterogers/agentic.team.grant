-- 0078 — The notebook has a meter, and we are not allowed to read it
--
-- Google changed NotebookLM's limits on 2 September 2026: no longer a count of
-- chats per day but **compute**, weighted by prompt complexity, model, feature
-- and conversation length, refreshing every five hours against a weekly cap.
--
-- Grant: *"be good for the agents and stuff to know not to just generate things
-- constantly. And if it's possible for you to actually query what the usage is
-- left every time I make a request, that'd be good. And especially if the
-- quota's used up, you'd obviously have to schedule one."*
--
-- ## The honest part first: we cannot query it
--
-- The counter lives behind Settings → Usage in Google's own interface. The
-- adapter library exposes `AccountLimits` — notebook and source caps, and a
-- tier — and nothing at all about compute. There is no RPC for it. Anything on
-- our page claiming to show Google's number would be a number we made up.
--
-- So this is a meter of OUR OWN consumption, and every surface that shows it
-- says so. §11 already requires exactly this for the free inference tier —
-- *"budgets are counted locally"* — and the reasoning transfers intact: a
-- ceiling you cannot read is a ceiling you must not guess at, so you count what
-- you spend and you stop early.
--
-- ## Weights are estimates and are labelled as estimates
--
-- Google says the cost varies by feature and complexity, and does not say by
-- how much. The weights below are ordered by how expensive each operation
-- obviously is — a video overview costs more than a question — and their
-- absolute values are meaningless. What makes them useful is the next part.
--
-- ## The ceiling is LEARNED, which is the point
--
-- When Google refuses, the refusal is recorded together with what we had spent
-- in that window. That number is evidence: it is an upper bound on the real
-- ceiling, measured rather than assumed. If it is lower than our configured
-- ceiling, the ceiling comes down to it automatically and stays down.
--
-- A ceiling that only ever came from a constant would be wrong forever in
-- whichever direction it started. This one is wrong once.
--
-- ## And when there is nothing left, the work is not refused
--
-- It is scheduled. 0074 gave jobs `not_before`; a generation that would exceed
-- the window is queued for when the window turns over, and the person who asked
-- is told when that is. Google's own answer to this is a "Generate later"
-- button, so the shape is not even novel — only ours is automatic.

begin;

-- --------------------------------------------------------------------------
-- What each operation is estimated to cost
-- --------------------------------------------------------------------------

create table public.notebook_operation_cost (
  operation   text        primary key,
  units       integer     not null,
  note        text        not null default '',
  updated_at  timestamptz not null default app.now_utc(),

  constraint notebook_operation_cost_positive check (units > 0)
);

comment on table public.notebook_operation_cost is
  'Estimated compute cost per operation, in units of our own invention. Google '
  'publishes no figures, so the ORDER is the meaningful part and the absolute '
  'values are not. Tunable, because they are guesses.';

insert into public.notebook_operation_cost (operation, units, note) values
  ('ask',           1,  'a question against the notebook''s sources'),
  ('add_text',      1,  'a source, processed once on the way in'),
  ('add_url',       2,  'Google fetches and processes the page'),
  ('create_note',   1,  'written, not generated'),
  ('mindmap',       3,  'structural, and the cheapest thing Studio makes'),
  ('quiz',          4,  ''),
  ('flashcards',    4,  ''),
  ('study_guide',   5,  ''),
  ('report',        5,  ''),
  ('infographic',   6,  'an image, generated'),
  ('slides',        8,  'a deck, generated slide by slide'),
  ('audio',        10,  'minutes of synthesised conversation'),
  ('video',        15,  'the most expensive thing the product makes');

-- --------------------------------------------------------------------------
-- What we have actually spent
-- --------------------------------------------------------------------------

create table public.notebook_spend (
  spend_id     uuid        primary key default gen_random_uuid(),
  operation    text        not null references public.notebook_operation_cost (operation),
  units        integer     not null,
  notebook_ref text,
  project_id   uuid        references public.projects (project_id),
  job_id       uuid        references public.jobs (job_id),
  -- False when Google refused: the attempt cost us nothing but tells us where
  -- the real ceiling is, which is the more valuable of the two.
  succeeded    boolean     not null default true,
  occurred_at  timestamptz not null default app.now_utc(),

  constraint notebook_spend_units_positive check (units > 0)
);

create index notebook_spend_recent on public.notebook_spend (occurred_at desc);

comment on table public.notebook_spend is
  'Every notebook operation we performed and what we estimate it cost. Our own '
  'ledger, never Google''s - there is no API for Google''s.';

create table public.notebook_refusals (
  refusal_id     uuid        primary key default gen_random_uuid(),
  operation      text        not null,
  detail         text        not null,
  -- What our ledger said we had spent in the five hours before the refusal.
  -- The evidence: an upper bound on the real ceiling, measured.
  window_spend   integer     not null,
  -- When Google said it would refresh, when it said. Null when it did not.
  resets_at      timestamptz,
  occurred_at    timestamptz not null default app.now_utc()
);

comment on table public.notebook_refusals is
  'Google saying no, and what we had spent when it did. This is the only real '
  'measurement of the ceiling available to us, so it is kept rather than logged.';

-- --------------------------------------------------------------------------
-- The ceilings, configurable and self-correcting
-- --------------------------------------------------------------------------

insert into public.system_config (key, value, description) values
  ('notebook.window_hours', to_jsonb(5),
   'Google refreshes the allowance every five hours. Their number, not ours.'),
  ('notebook.window_units', to_jsonb(40),
   'How many of our estimated units to spend in one five-hour window. A guess '
   'until a refusal measures it, and then it is whatever the refusal proved.'),
  ('notebook.week_units', to_jsonb(300),
   'The weekly ceiling, same currency, same caveat.'),
  ('notebook.ceiling_is_measured', to_jsonb(false),
   'True once a refusal has taught us the real number. False means the ceiling '
   'above is still a guess and should be read as one.')
on conflict (key) do nothing;

-- --------------------------------------------------------------------------
-- May we spend this now?
-- --------------------------------------------------------------------------

create or replace function app.notebook_allowance(p_operation text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_hours    integer := coalesce((select value::text::integer from public.system_config where key = 'notebook.window_hours'), 5);
  v_window   integer := coalesce((select value::text::integer from public.system_config where key = 'notebook.window_units'), 40);
  v_week     integer := coalesce((select value::text::integer from public.system_config where key = 'notebook.week_units'), 300);
  v_measured boolean := coalesce((select value::text::boolean from public.system_config where key = 'notebook.ceiling_is_measured'), false);
  v_spent_w  integer;
  v_spent_7  integer;
  v_cost     integer;
  v_blocked  timestamptz;
  v_resets   timestamptz;
begin
  select coalesce(sum(units), 0) into v_spent_w
    from public.notebook_spend
   where succeeded and occurred_at > now() - make_interval(hours => v_hours);

  select coalesce(sum(units), 0) into v_spent_7
    from public.notebook_spend
   where succeeded and occurred_at > now() - interval '7 days';

  select units into v_cost
    from public.notebook_operation_cost where operation = p_operation;

  -- A refusal Google dated is authoritative until that moment, whatever our
  -- own arithmetic says. Their no beats our estimate.
  select resets_at into v_blocked
    from public.notebook_refusals
   where resets_at is not null and resets_at > now()
   order by resets_at desc limit 1;

  -- When the window turns over, on our own reckoning: the oldest spend inside
  -- the window ages out first, so that is the soonest anything frees up.
  select occurred_at + make_interval(hours => v_hours) into v_resets
    from public.notebook_spend
   where succeeded and occurred_at > now() - make_interval(hours => v_hours)
   order by occurred_at asc limit 1;

  return jsonb_build_object(
    'window_hours', v_hours,
    'window_spent', v_spent_w,
    'window_ceiling', v_window,
    'window_left', greatest(v_window - v_spent_w, 0),
    'week_spent', v_spent_7,
    'week_ceiling', v_week,
    'week_left', greatest(v_week - v_spent_7, 0),
    'ceiling_is_measured', v_measured,
    'operation', p_operation,
    'operation_cost', v_cost,
    'blocked_until', v_blocked,
    'window_resets_at', v_resets,
    'allowed', (
      v_blocked is null
      and (v_cost is null or v_spent_w + v_cost <= v_window)
      and (v_cost is null or v_spent_7 + v_cost <= v_week)
    ),
    -- Everything above is OUR arithmetic. Said here so no caller can present
    -- it as Google's without going out of its way.
    'source', 'our own ledger — Google exposes no usage API'
  );
end;
$$;

create or replace function app.notebook_record_spend(
  p_operation text,
  p_notebook  text default null,
  p_project   uuid default null,
  p_job       uuid default null,
  p_succeeded boolean default true
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_units integer;
begin
  select units into v_units from public.notebook_operation_cost where operation = p_operation;
  if v_units is null then
    -- An operation with no price is still an operation. Charged at the median
    -- rather than free: a free unknown is how a meter stops meaning anything.
    v_units := 5;
  end if;

  insert into public.notebook_spend (operation, units, notebook_ref, project_id, job_id, succeeded)
  values (p_operation, v_units, p_notebook, p_project, p_job, p_succeeded);

  return v_units;
end;
$$;

/**
 * Google said no. Learn from it.
 */
create or replace function app.notebook_record_refusal(
  p_operation text,
  p_detail    text,
  p_resets_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_hours integer := coalesce((select value::text::integer from public.system_config where key = 'notebook.window_hours'), 5);
  v_spent integer;
  v_ceiling integer := coalesce((select value::text::integer from public.system_config where key = 'notebook.window_units'), 40);
  v_lowered boolean := false;
begin
  select coalesce(sum(units), 0) into v_spent
    from public.notebook_spend
   where succeeded and occurred_at > now() - make_interval(hours => v_hours);

  insert into public.notebook_refusals (operation, detail, window_spend, resets_at)
  values (p_operation, left(p_detail, 500), v_spent, p_resets_at);

  -- The measurement. We were refused having spent this much, so the real
  -- ceiling is at most this much — and a configured ceiling above it is a
  -- ceiling that will let us be refused again tomorrow.
  --
  -- Only ever downward, and only from evidence. Raising it would require a
  -- successful operation ABOVE the ceiling, which cannot happen because the
  -- ceiling prevents it: the loop is one-way by construction, and a human
  -- raises it in the front end when they think we are being too careful.
  if v_spent > 0 and v_spent < v_ceiling then
    update public.system_config set value = to_jsonb(v_spent) where key = 'notebook.window_units';
    update public.system_config set value = to_jsonb(true) where key = 'notebook.ceiling_is_measured';
    v_lowered := true;
  end if;

  return jsonb_build_object(
    'window_spend', v_spent, 'ceiling_lowered_to', case when v_lowered then v_spent end,
    'resets_at', p_resets_at
  );
end;
$$;

create or replace function public.notebook_allowance(p_operation text default null)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.notebook_allowance(p_operation) $$;

commit;
