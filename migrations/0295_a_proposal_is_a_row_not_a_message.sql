-- 0295 — a proposal is a row, not a message
--
-- Issue #49. Grant, twice:
--
--   > *"They need to propose how they can improve... they should make
--   > suggestions to me and how they can improve if they can't do it
--   > themselves."*
--
--   > *"They need to constantly be aware of the role, how they can gain more
--   > agency."*
--
-- ## Why a row and not a message
--
-- The Issue is explicit and the reason is the whole design:
--
--   > *A proposal is not a message; it is a row with a remedy, an argument, and
--   > a state (`open` → `approved` / `declined` / `done`), so a decline is
--   > durable and the same proposal does not arrive again next week. Grant
--   > declining something once must mean it stays declined.*
--
-- A message cannot be declined. It can be ignored, and then sent again on
-- Thursday, which is how a helpful office becomes a nagging one — and Grant has
-- been explicit that eight agents proposing independently is eight times the
-- noise he does not want.
--
-- ## The threshold already exists and is already countable
--
-- `app.impediments_tally` (#47) groups typed `cannot:` outcomes by kind, need
-- and agent, with a count and a `having count(*) >= p_min`. That is exactly
-- #49's *"repeated, typed, and with a nameable remedy"*, and it is a SQL query
-- rather than a model call per job — which the Issue requires:
--
--   > *The cost of noticing must not be a model call per job.*
--
-- So nothing here reads prose or asks a model anything. It counts rows.
--
-- ## One row per (agent, kind, need), for ever
--
-- The unique index is the durable decline. A repeat does not insert a second
-- row; it bumps the count on the one that exists. A declined one is not
-- touched at all — not reopened, not re-counted, not re-delivered — so
-- declining costs Grant one press and buys permanent silence on that subject.
--
-- The one exception is deliberate: `times_seen` keeps rising on a DECLINED
-- proposal is exactly what nobody wants, so it does not. If the world changes
-- and it should be asked again, that is a human reopening it, which
-- `app.decide_proposal` allows explicitly.
--
-- ## And it may never act
--
--   > *Proposals must never act. A proposal that acquires the thing it proposes
--   > is #50, and it is gated by #53.*
--
-- Nothing in this migration grants, installs, connects or enqueues. It writes
-- a row and it reads rows back. `approved` means Grant said yes; making the
-- thing happen is somebody else's job and is gated elsewhere.

begin;

create table if not exists public.proposals (
  proposal_id uuid primary key default extensions.gen_random_uuid(),

  -- Who is blocked, and by what. The three together are the identity of the
  -- proposal: the same agent hitting the same typed wall for the same need is
  -- the SAME proposal, however many times it happens.
  staff_slug  text        not null references public.staff (slug) on delete cascade,
  kind        public.impediment_kind not null,
  needed      text        not null,

  -- What Grant reads. Separate columns rather than one blob because each has a
  -- different job and #49 names all three: what it is, what would fix it, and
  -- why it is worth his attention.
  title       text        not null,
  remedy      text        not null,
  argument    text        not null,
  -- What it costs him, in his own terms. ~£0/month is a hard constraint, so a
  -- proposal that would break it has to say so before he presses anything.
  cost_note   text        not null default '',

  state       text        not null default 'open',
  decided_at  timestamptz,
  decided_by  text,
  decided_note text,

  -- The evidence, carried on the row so the message writes itself and so a
  -- proposal read six weeks later still says why it was raised.
  times_seen  int         not null default 1,
  first_seen  timestamptz not null default app.now_utc(),
  last_seen   timestamptz not null default app.now_utc(),
  for_instance text       not null default '',

  -- Claire sends; nobody else. Stamped when it goes, so a batch cannot send
  -- the same proposal twice.
  delivered_at timestamptz,

  created_at  timestamptz not null default app.now_utc(),

  constraint proposals_state_known
    check (state in ('open', 'approved', 'declined', 'done')),
  constraint proposals_decided_iff_settled
    check ((state in ('approved', 'declined', 'done')) = (decided_at is not null)),
  constraint proposals_says_something
    check (btrim(title) <> '' and btrim(remedy) <> '' and btrim(argument) <> '')
);

/*
  The durable decline, as an index.

  One row per agent per typed need, for ever. A repeat bumps the count on the
  row that exists; it cannot create a second. Without this, "I declined that
  last week" is a thing Grant says and the office cannot hear.
*/
create unique index if not exists proposals_one_per_need
  on public.proposals (staff_slug, kind, needed);

create index if not exists proposals_open_undelivered
  on public.proposals (state, delivered_at) where state = 'open';

alter table public.proposals enable row level security;

comment on table public.proposals is
  '#49. An agent''s standing request for something it needs to do its job. A '
  'ROW and not a message, because a message cannot be declined — it can only be '
  'ignored and sent again on Thursday. One per (agent, kind, need) for ever: '
  'the unique index IS the durable decline.';

-- ---------------------------------------------------------------------------
-- Raising them, by counting rather than by asking a model
-- ---------------------------------------------------------------------------

/**
 * Turn repeated typed limitations into proposals.
 *
 * Reads `app.impediments_tally`, which already does the grouping and the
 * threshold. Nothing here calls a model: #49 requires that noticing costs a
 * SQL query and not an inference per job, and the typed `cannot:` outcomes
 * from #47 are what make that possible.
 *
 * Idempotent by construction. Run it hourly, run it twice in a row, run it
 * after every job — the same wall produces the same one row with a higher
 * count, and a declined one is not touched.
 */
create or replace function app.raise_proposals(p_days int default 30, p_min int default 3)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  t          record;
  v_new      int := 0;
  v_bumped   int := 0;
  v_silent   int := 0;
  v_title    text;
  v_remedy   text;
  v_arg      text;
begin
  for t in
    select * from app.impediments_tally(p_days, p_min, false)
     where staff_slug is not null
  loop
    /*
      A declined proposal is left completely alone — not reopened, not
      re-counted, not re-delivered. Declining costs Grant one press and buys
      permanent silence on that subject, which is the whole point of the row.
    */
    if exists (
      select 1 from public.proposals
       where staff_slug = t.staff_slug and kind = t.kind and needed = t.needed
         and state = 'declined'
    ) then
      v_silent := v_silent + 1;
      continue;
    end if;

    /*
      The words. Written from the tally rather than by a model, so a proposal
      costs nothing and says the same thing every time — and so the numbers in
      it are the numbers, not a paraphrase of them.
    */
    v_title := format('%s cannot %s', initcap(replace(t.staff_slug, '-', ' ')), t.needed);
    v_remedy := case t.kind
      when 'missing_tool'     then format('Give this agent a tool that can %s.', t.needed)
      when 'missing_skill'    then format('The office has no way to %s at all — it needs building.', t.needed)
      when 'missing_data'     then format('Connect or supply the material needed to %s.', t.needed)
      when 'needs_permission' then format('Grant permission to %s.', t.needed)
      when 'ambiguous'        then format('Say which reading of "%s" is meant.', t.needed)
      else format('Decide whether the office should be able to %s.', t.needed)
    end;
    v_arg := format(
      '%s time(s) in the last %s day(s), across %s project(s). Most recently: %s',
      t.times, p_days, t.projects,
      coalesce(nullif(btrim(t.for_instance), ''), 'no detail recorded'));

    insert into public.proposals
      (staff_slug, kind, needed, title, remedy, argument,
       times_seen, first_seen, last_seen, for_instance)
    values (t.staff_slug, t.kind, t.needed, v_title, v_remedy, v_arg,
            t.times, t.first_seen, t.last_seen, coalesce(t.for_instance, ''))
    on conflict (staff_slug, kind, needed) do update
      set times_seen = excluded.times_seen,
          last_seen  = excluded.last_seen,
          argument   = excluded.argument,
          for_instance = excluded.for_instance
      -- Only while it is still open and unanswered. An approved or done
      -- proposal is history and must not be rewritten under Grant.
      where public.proposals.state = 'open';

    if found then
      if exists (select 1 from public.proposals
                  where staff_slug = t.staff_slug and kind = t.kind and needed = t.needed
                    and created_at > app.now_utc() - interval '2 seconds') then
        v_new := v_new + 1;
      else
        v_bumped := v_bumped + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('raised', v_new, 'updated', v_bumped, 'left_declined', v_silent);
end;
$$;

-- ---------------------------------------------------------------------------
-- Deciding, and the decline that sticks
-- ---------------------------------------------------------------------------

create or replace function app.decide_proposal(
  p_proposal_id uuid,
  p_state       text,
  p_note        text default null,
  p_by          text default 'grant'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_was text;
begin
  select state into v_was from public.proposals where proposal_id = p_proposal_id;
  if v_was is null then
    return jsonb_build_object('error', 'there is no such proposal');
  end if;
  if p_state not in ('open', 'approved', 'declined', 'done') then
    return jsonb_build_object('error', format('%L is not a state a proposal can be in', p_state));
  end if;

  update public.proposals
     set state = p_state,
         decided_at = case when p_state = 'open' then null else app.now_utc() end,
         decided_by = case when p_state = 'open' then null else p_by end,
         decided_note = nullif(btrim(coalesce(p_note, '')), '')
   where proposal_id = p_proposal_id;

  return jsonb_build_object('ok', true, 'was', v_was, 'now', p_state);
end;
$$;

comment on function app.decide_proposal is
  '#49. Reopening a declined proposal is allowed and deliberate: if the world '
  'changes it should be askable again — but only by a person saying so, never '
  'by the office deciding on its own that the decline has expired.';

-- ---------------------------------------------------------------------------
-- What Claire sends, once
-- ---------------------------------------------------------------------------

/**
 * The batch, ranked, for the one voice Grant hears.
 *
 * `telegram.only_chief_speaks` is true and #49 says it is not a formality:
 * eight agents proposing independently is eight times the noise he explicitly
 * does not want. So this returns ONE list and the chief of staff sends it.
 *
 * Ranked by how often it has actually bitten, not by severity, because
 * severity would be a judgement this function is not entitled to make.
 */
create or replace function app.proposals_to_send(p_limit int default 5)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(p order by p.times_seen desc, p.last_seen desc), '[]'::jsonb)
    from (
      select proposal_id as id, staff_slug as who, kind::text, needed, title, remedy,
             argument, cost_note, times_seen, last_seen
        from public.proposals
       where state = 'open' and delivered_at is null
       order by times_seen desc, last_seen desc
       limit greatest(coalesce(p_limit, 5), 1)
    ) p
$$;

/** Mark a batch sent, so the next pass does not send it again. */
create or replace function app.proposals_sent(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_n int;
begin
  update public.proposals set delivered_at = app.now_utc()
   where proposal_id = any(coalesce(p_ids, array[]::uuid[]))
     and delivered_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.raise_proposals(p_days int default 30, p_min int default 3)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.raise_proposals(p_days, p_min) $$;

create or replace function public.decide_proposal(
  p_proposal_id uuid, p_state text, p_note text default null, p_by text default 'grant')
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.decide_proposal(p_proposal_id, p_state, p_note, p_by) $$;

create or replace function public.proposals_to_send(p_limit int default 5)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.proposals_to_send(p_limit) $$;

grant execute on function app.raise_proposals(int, int) to ai_team_app;
grant execute on function public.raise_proposals(int, int) to ai_team_app;
grant execute on function app.decide_proposal(uuid, text, text, text) to ai_team_app;
grant execute on function public.decide_proposal(uuid, text, text, text) to ai_team_app;
grant execute on function app.proposals_to_send(int) to ai_team_app;
grant execute on function public.proposals_to_send(int) to ai_team_app;
grant execute on function app.proposals_sent(uuid[]) to ai_team_app;
grant select, insert, update on public.proposals to ai_team_app;

commit;
