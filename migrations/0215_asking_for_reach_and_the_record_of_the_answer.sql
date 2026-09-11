-- Asking for reach, and the record of the answer.
--
-- Issue #53, ADR-0018. ADR-0015 and ADR-0017 settled what an agent may WRITE.
-- This settles what happens when it ASKS.
--
-- The route already existed in pieces and stopped one step short: a skill names
-- a tool nobody holds (0213), the agent records an impediment (0184), three in
-- a fortnight becomes a capability_missing line in the morning briefing (0210).
-- And then nothing. Grant read a sentence about a limitation with no way to
-- answer it that was not a coding session — which is the dependence the whole
-- epic exists to remove.
--
-- ## An approval grants exactly one tool, and cannot be widened
--
-- The failure mode is not somebody approving something bad. It is somebody
-- approving something reasonable and the approval quietly covering the next
-- thing that resembles it. So there is no prefix, no pattern and no family:
-- approving `linkedin.read` does nothing whatever for `linkedin.post`, and the
-- schema cannot express otherwise.
--
-- ## Approving a tool that does not exist is a decision to build, not a grant
--
-- If the tool is in `tool_permissions` there is an implementation behind the
-- name and approval is a grant — one row, effective next job, nothing coded.
-- If it is not, approving it would grant a permission to call something that
-- does not exist. The tempting alternative is to insert the row anyway so the
-- approval "works", and it produces a permission system where a granted tool
-- may or may not do anything; the first time one silently does nothing, nobody
-- can tell whether it was policy or a missing function.
--
-- ## A decline is durable, specific, and raises the bar
--
-- Durable or the office asks again next week with a different sentence and the
-- "no" costs the same attention every time. Specific — keyed on the exact tool
-- and person — or a no to publishing quietly becomes a no to reading analytics.
-- Ninety days per decline: once a quarter of silence, twice half a year. Same
-- reasoning as 0211's dismissals, and worth repeating: a decline means "not
-- now", and a capability the office keeps needing does not become less needed
-- because it was refused.

begin;

create table if not exists public.tool_requests (
  request_id  uuid primary key default extensions.gen_random_uuid(),

  /*
    The tool as the office would name it, and deliberately NOT a foreign key.

    Every other reference to a tool in this database is an FK precisely so that
    a name cannot be invented — 0119 made that argument for `staff_tools` and it
    is right there. Here it is inverted: the whole point of a request is asking
    for something that may not exist yet, and an FK would make the interesting
    half of this table unrepresentable.

    The format check does the work an FK cannot: it keeps the namespace shaped
    like the one that exists, so a request is recognisably about a tool rather
    than a sentence somebody typed.
  */
  tool        text not null check (tool ~ '^[a-z0-9]+(\.[a-z0-9_]+)+$'),
  asked_by    text not null references public.staff(slug),

  /** What it is for, in the words of whoever wants it. */
  what_for    text not null check (length(btrim(what_for)) between 20 and 600),
  /** The count behind it. A request with no evidence is a preference. */
  because     jsonb not null default '{}'::jsonb,
  from_job    uuid references public.jobs(job_id) on delete set null,

  state       text not null default 'open'
                check (state in ('open', 'approved', 'declined', 'withdrawn')),
  raised_at   timestamptz not null default app.now_utc(),
  settled_at  timestamptz,
  decided_by  text,

  /*
    What the approval is limited to.

    ADR-0018's first decision is that an approval is a record rather than a
    moment, and a record with no limits is a blank cheque. Free-form jsonb
    because the useful limits differ by tool — an expiry for one, a rate for
    another, a named project for a third — and an enum of limit kinds invented
    now would be wrong by the third tool.
  */
  limits      jsonb,

  decline_reason text,
  /** How many times this exact ask has been refused. Raises the bar. */
  declines    integer not null default 0,

  constraint tool_requests_settled_is_explained
    check ((state = 'open') = (settled_at is null)),
  -- An approval nobody signed is not an approval.
  constraint tool_requests_decision_names_its_decider
    check (state in ('open', 'withdrawn') or length(btrim(coalesce(decided_by, ''))) > 0),
  -- A decline with no reason cannot be argued with, and cannot be revisited
  -- sensibly in three months when the circumstances have changed.
  constraint tool_requests_decline_gives_a_reason
    check (state <> 'declined' or length(btrim(coalesce(decline_reason, ''))) >= 8)
);

comment on table public.tool_requests is
  'What the office has asked to be able to reach, and what Grant said (#53). '
  'An approval names its decider and its limits and applies to ONE exact tool '
  'identifier — there is no prefix and no family (ADR-0018).';

-- One open ask per person per tool. A second is the same request shouting.
create unique index if not exists tool_requests_one_open
  on public.tool_requests (tool, asked_by) where state = 'open';

create index if not exists tool_requests_by_state
  on public.tool_requests (state, raised_at desc);

alter table public.tool_requests enable row level security;
alter table public.tool_requests force  row level security;
grant select on public.tool_requests to ai_team_app;
create policy tool_requests_app_read on public.tool_requests
  for select to ai_team_app using (true);

-- A request is written in the office's own words, so it is exactly the kind of
-- text a credential could hide in. Same trigger as lessons and skills: refused
-- at insert, which is stronger than a scan that runs afterwards over files.
create or replace function app.request_carries_no_credential()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.reject_credential_text_on(new.what_for);
  perform app.reject_credential_text_on(coalesce(new.decline_reason, ''));
  return new;
end;
$$;

create trigger tool_requests_carry_no_credential
  before insert or update on public.tool_requests
  for each row execute function app.request_carries_no_credential();

-- ---------------------------------------------------------------------------
-- Asking
-- ---------------------------------------------------------------------------
/*
  Named `request_tool` and callable by an agent, which is the whole point — and
  it writes to exactly one table. Whatever it is handed, `app.staff_may_use()`
  answers the same afterwards as before, which `verify:boundary` asserts by
  making the most emphatic request the schema permits and re-asking.
*/
create or replace function app.request_tool(
  p_tool     text,
  p_asked_by text,
  p_what_for text,
  p_because  jsonb default '{}'::jsonb,
  p_from_job uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  refused public.tool_requests%rowtype;
  made    public.tool_requests%rowtype;
begin
  -- Nothing to ask for. Answering "you already have it" beats an open request
  -- sitting in front of Grant for a decision he already made.
  if app.staff_may_use(p_asked_by, p_tool) then
    return jsonb_build_object('already_held', true, 'tool', p_tool);
  end if;

  /*
    A decline that is still in force, keyed on the exact tool and person.

    Ninety days per decline. The `order by` matters: the most recent refusal is
    the one whose clock is running, and taking any other row would let an old
    settled decline expire the silence a new one just bought.
  */
  select * into refused
    from public.tool_requests
   where tool = p_tool and asked_by = p_asked_by and state = 'declined'
   order by settled_at desc nulls last
   limit 1;

  if found and refused.settled_at
       > app.now_utc() - (greatest(refused.declines, 1) * interval '90 days') then
    return jsonb_build_object(
      'declined', true,
      'tool', p_tool,
      'reason', refused.decline_reason,
      'may_ask_again_after',
        refused.settled_at + (greatest(refused.declines, 1) * interval '90 days'));
  end if;

  insert into public.tool_requests (tool, asked_by, what_for, because, from_job)
  values (p_tool, p_asked_by, p_what_for, coalesce(p_because, '{}'::jsonb), p_from_job)
  on conflict (tool, asked_by) where state = 'open' do nothing
  returning * into made;

  if made.request_id is null then
    -- Already asked and still waiting. Not an error: the honest answer is that
    -- the ask exists, and repeating it would only make the queue longer.
    select * into made from public.tool_requests
     where tool = p_tool and asked_by = p_asked_by and state = 'open';
    return jsonb_build_object('request_id', made.request_id, 'already_asked', true);
  end if;

  perform public.append_event(
    coalesce((select correlation_id from public.jobs where job_id = p_from_job),
             extensions.gen_random_uuid()),
    'agent', p_asked_by, 'capability_gap', 'tool.requested',
    true, null, null,
    jsonb_build_object('tool', p_tool, 'request_id', made.request_id),
    left(p_what_for, 1000), '[]'::jsonb, null, null,
    -- §6: if the author cannot say how to undo it, it is not reversible.
    'app.withdraw_tool_request(request_id)',
    p_from_job);

  return jsonb_build_object('request_id', made.request_id, 'tool', p_tool);
end;
$$;

comment on function app.request_tool(text, text, text, jsonb, uuid) is
  'An agent asking to be able to reach something. Writes one row and grants '
  'nothing — app.staff_may_use() answers identically before and after '
  '(ADR-0018). Refuses while a decline is still in force.';

-- ---------------------------------------------------------------------------
-- Answering
--
-- Grant, and nobody else. The check on `p_by` is the weaker half; the stronger
-- half is that no code path an agent runs calls this at all, which
-- `verify:boundary` asserts by grepping the source. Neither is dressed up as
-- cryptographic — the worker holds the service role and could execute any
-- function in this database, and pretending otherwise would be worse than
-- saying so.
-- ---------------------------------------------------------------------------
create or replace function app.approve_tool(
  p_request_id uuid,
  p_by         text default 'grant',
  p_limits     jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  req    public.tool_requests%rowtype;
  known  public.tool_permissions%rowtype;
begin
  if p_by is distinct from 'grant' then
    return jsonb_build_object('error',
      'only Grant approves reach. An agent may ask and may never answer (ADR-0018).');
  end if;

  select * into req from public.tool_requests where request_id = p_request_id;
  if not found then
    return jsonb_build_object('error', 'no such request: ' || p_request_id::text);
  end if;
  if req.state <> 'open' then
    return jsonb_build_object('error', 'that request was already ' || req.state);
  end if;

  update public.tool_requests
     set state = 'approved', settled_at = app.now_utc(),
         decided_by = p_by, limits = p_limits
   where request_id = p_request_id;

  select * into known from public.tool_permissions where tool = req.tool;

  /*
    No implementation behind the name, so there is nothing to grant.

    Inserting the row anyway would make the approval appear to work and leave a
    permission that may or may not do anything. What Grant has actually decided
    here is that he wants it built, and saying that is more useful than a grant
    that silently does nothing.
  */
  if not found then
    perform public.append_event(
      extensions.gen_random_uuid(), 'user', p_by, 'approval', 'tool.wanted',
      true, null, null,
      jsonb_build_object('tool', req.tool, 'request_id', req.request_id),
      'Approved, but no such tool exists yet — this is a decision to build it.',
      '[]'::jsonb, null, null, 'app.withdraw_tool_request(request_id)', null);
    return jsonb_build_object(
      'approved', true, 'granted', false, 'needs_building', true, 'tool', req.tool,
      'say', format('Approved — but %s does not exist yet, so there is nothing '
                    || 'to switch on. It needs building before anyone can hold it.',
                    req.tool));
  end if;

  insert into public.staff_tools (staff_slug, tool, granted_by, note)
  values (req.asked_by, req.tool, p_by,
          format('Approved from request %s.', req.request_id))
  on conflict (staff_slug, tool) do nothing;

  perform public.append_event(
    extensions.gen_random_uuid(), 'user', p_by, 'approval', 'tool.granted',
    true, null,
    jsonb_build_object('held', false),
    jsonb_build_object('tool', req.tool, 'to', req.asked_by,
                       'request_id', req.request_id, 'limits', p_limits),
    left(req.what_for, 1000), '[]'::jsonb, null, req.tool,
    'app.revoke_tool(staff_slug, tool)', null);

  /*
    The global switch stays the ceiling (0119).

    A grant against a policy-disabled tool is recorded and does nothing, and
    saying so is the difference between a permission screen that explains itself
    and one that lies. Flipping the global switch is a separate, deliberate act.
  */
  return jsonb_build_object(
    'approved', true, 'granted', true, 'tool', req.tool, 'to', req.asked_by,
    'in_force', known.enabled,
    'say', case when known.enabled
      then format('%s can now use %s.', req.asked_by, req.tool)
      else format('Granted to %s, but %s is switched off for everyone — %s. '
                  || 'It stays off until that changes.',
                  req.asked_by, req.tool, coalesce(known.disabled_reason, 'by policy'))
    end);
end;
$$;

comment on function app.approve_tool(uuid, text, jsonb) is
  'Grant answering yes. Grants ONE exact tool and never a family; records who '
  'decided and the limits; and when the tool does not exist, records a decision '
  'to build rather than granting a fiction (ADR-0018).';

create or replace function app.decline_tool(
  p_request_id uuid,
  p_by         text default 'grant',
  p_reason     text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  req    public.tool_requests%rowtype;
  before integer;
begin
  if p_by is distinct from 'grant' then
    return jsonb_build_object('error',
      'only Grant answers a request for reach (ADR-0018).');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 8 then
    return jsonb_build_object('error',
      'a decline needs a reason — it is what makes it worth revisiting in three months');
  end if;

  select * into req from public.tool_requests where request_id = p_request_id;
  if not found then
    return jsonb_build_object('error', 'no such request: ' || p_request_id::text);
  end if;
  if req.state <> 'open' then
    return jsonb_build_object('error', 'that request was already ' || req.state);
  end if;

  -- Carried forward from every previous refusal of this exact ask, so the
  -- silence lengthens rather than resetting to ninety days each time.
  select coalesce(max(declines), 0) into before
    from public.tool_requests
   where tool = req.tool and asked_by = req.asked_by and state = 'declined';

  update public.tool_requests
     set state = 'declined', settled_at = app.now_utc(),
         decided_by = p_by, decline_reason = btrim(p_reason),
         declines = before + 1
   where request_id = p_request_id;

  perform public.append_event(
    extensions.gen_random_uuid(), 'user', p_by, 'approval', 'tool.declined',
    true, null, null,
    jsonb_build_object('tool', req.tool, 'asked_by', req.asked_by,
                       'declines', before + 1),
    left(btrim(p_reason), 1000), '[]'::jsonb, null, req.tool,
    'app.request_tool(...) again once the silence expires', null);

  return jsonb_build_object(
    'declined', true, 'tool', req.tool, 'declines', before + 1,
    'silent_until', app.now_utc() + ((before + 1) * interval '90 days'));
end;
$$;

comment on function app.decline_tool(uuid, text, text) is
  'Grant answering no, durably and specifically. Keyed on the exact tool and '
  'person, so a no to one thing never becomes a no to its neighbour, and '
  'ninety days per refusal so it does not need repeating (ADR-0018).';

-- ---------------------------------------------------------------------------
-- The ways back, so the ledger's `reversal_method` is not a claim
-- ---------------------------------------------------------------------------
create or replace function app.withdraw_tool_request(p_request_id uuid, p_by text default 'grant')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.tool_requests
     set state = 'withdrawn', settled_at = app.now_utc(), decided_by = p_by
   where request_id = p_request_id and state = 'open';
  if not found then
    return jsonb_build_object('error', 'nothing open to withdraw');
  end if;
  return jsonb_build_object('withdrawn', p_request_id);
end;
$$;

create or replace function app.revoke_tool(p_slug text, p_tool text, p_by text default 'grant')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  delete from public.staff_tools where staff_slug = p_slug and tool = p_tool;
  if not found then
    return jsonb_build_object('error', format('%s does not hold %s', p_slug, p_tool));
  end if;
  perform public.append_event(
    extensions.gen_random_uuid(), 'user', p_by, 'approval', 'tool.revoked',
    true, null, jsonb_build_object('held', true), jsonb_build_object('held', false),
    format('%s no longer holds %s.', p_slug, p_tool), '[]'::jsonb, null, p_tool,
    'app.approve_tool on a fresh request', null);
  return jsonb_build_object('revoked', p_tool, 'from', p_slug);
end;
$$;

comment on function app.revoke_tool(text, text, text) is
  'The other half of a grant. Named in the ledger as the reversal method for '
  'tool.granted, so §6''s rule that a reversal method must be real holds.';

-- ---------------------------------------------------------------------------
-- What is waiting for him
-- ---------------------------------------------------------------------------
create or replace function app.reach_wanted()
returns table (
  request_id uuid,
  tool       text,
  asked_by   text,
  what_for   text,
  because    jsonb,
  exists_yet boolean,
  raised_at  timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.request_id, r.tool, r.asked_by, r.what_for, r.because,
         exists (select 1 from public.tool_permissions t where t.tool = r.tool),
         r.raised_at
    from public.tool_requests r
   where r.state = 'open'
   order by r.raised_at
$$;

comment on function app.reach_wanted() is
  'The open asks, for the briefing and the dashboard. `exists_yet` is false '
  'when approving means deciding to build rather than switching on (ADR-0018).';

-- Public wrappers. PostgREST only exposes `public`, and the wrapper is the half
-- that silently drops a new parameter, so these are written out in full.
create or replace function public.request_tool(
  p_tool text, p_asked_by text, p_what_for text,
  p_because jsonb default '{}'::jsonb, p_from_job uuid default null
) returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.request_tool(p_tool, p_asked_by, p_what_for, p_because, p_from_job) $$;

create or replace function public.hq_approve_tool(
  p_request_id uuid, p_limits jsonb default null
) returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.approve_tool(p_request_id, 'grant', p_limits) $$;

create or replace function public.hq_decline_tool(
  p_request_id uuid, p_reason text default null
) returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.decline_tool(p_request_id, 'grant', p_reason) $$;

create or replace function public.hq_revoke_tool(p_slug text, p_tool text)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.revoke_tool(p_slug, p_tool, 'grant') $$;

create or replace function public.reach_wanted()
returns table (
  request_id uuid, tool text, asked_by text, what_for text, because jsonb,
  exists_yet boolean, raised_at timestamptz
) language sql stable security definer set search_path = ''
as $$ select * from app.reach_wanted() $$;

commit;
