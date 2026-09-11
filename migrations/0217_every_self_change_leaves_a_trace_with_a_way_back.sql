-- Every self-change leaves a trace, and the trace names a way back.
--
-- Issue #53. §6's rule, in its own words:
--
--     "set at write time by the code performing the action, never inferred
--      later. If the author cannot say how to undo it, it is reversible = false."
--
-- Four things the office now does to itself without being asked — learning a
-- lesson (0182), writing down a skill (0213), raising a suggestion (0211) and
-- asking for reach (0215) — and only the last of them was in the ledger, because
-- it was the only one written after this rule was noticed to apply to them.
--
-- ## Why this matters more than an audit trail usually does
--
-- The other three all change how later work is done. A lesson and a skill go
-- into a prompt; a suggestion goes in front of Grant. So "why did it answer
-- that way in September" is answerable only if the things that shaped the
-- answer are dated and attributed. Without this, a memory turns every bug into
-- a mystery — which is the sentence ADR-0015 already used about retrieval, and
-- it applies twice as hard to the writes.
--
-- ## Each reversal method is real, and was checked
--
-- `app.unlearn`, `app.retire_skill` and dismissing a suggestion all exist and
-- all work. Naming a method that does not exist would produce exactly the
-- failure §6 is written against: an undo that cannot undo. None of these is a
-- compensating-event undo in #10's sense, and this does not claim they are.
--
-- ## And suggestions get the credential trigger
--
-- `check:secrets` scans FILES. A table is precisely where a secret would hide
-- from it, which is why lessons (0181), skills (0212) and tool requests (0215)
-- each refuse one at insert. `suggestions` was the one left out — its body is
-- generated from counted facts today, so the hole is theoretical, but the whole
-- point of refusing at the write boundary is that it stays closed when the
-- generator changes.

begin;

create trigger suggestions_carry_no_credential
  before insert or update on public.suggestions
  for each row execute function app.reject_credential_text();

-- ---------------------------------------------------------------------------
-- Learning something, in the ledger
-- ---------------------------------------------------------------------------
create or replace function app.learn(
  p_scope        public.lesson_scope,
  p_body         text,
  p_learned_by   text,
  p_project_id   uuid default null,
  p_staff_slug   text default null,
  p_job_kind     text default null,
  p_from_job     uuid default null,
  p_confidence   numeric default 0.50,
  p_supersedes   uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  prior public.lessons%rowtype;
  seen  integer := 1;
  made  public.lessons%rowtype;
begin
  if p_supersedes is not null then
    select * into prior from public.lessons where lesson_id = p_supersedes;
    if not found then
      return jsonb_build_object('error', 'nothing to supersede: ' || p_supersedes::text);
    end if;
    -- Superseding a row that is already superseded would lose the newer belief.
    if exists (select 1 from public.lessons where supersedes = p_supersedes) then
      return jsonb_build_object('error', 'that lesson has already been revised');
    end if;
    seen := prior.observations + 1;
  end if;

  insert into public.lessons
    (row_kind, scope, project_id, staff_slug, job_kind, body,
     learned_by, from_job, confidence, observations, supersedes)
  values
    ('lesson', p_scope, p_project_id, p_staff_slug, p_job_kind, p_body,
     p_learned_by, p_from_job, least(greatest(p_confidence, 0), 1), seen, p_supersedes)
  returning * into made;

  /*
    Into the ledger (#53).

    `actor_kind` is decided by who says they learned it: Grant teaching the
    office in a Telegram message is a user acting, and an agent drawing its own
    conclusion is the autonomous case this issue is actually about. Conflating
    them would make "what has it decided by itself" unanswerable, which is the
    one question the ledger exists to answer here.
  */
  perform public.append_event(
    coalesce((select correlation_id from public.jobs where job_id = p_from_job),
             extensions.gen_random_uuid()),
    case when p_learned_by = 'grant' then 'user' else 'agent' end,
    p_learned_by, 'learning', 'office.learned',
    true, p_project_id, null,
    jsonb_build_object('lesson_id', made.lesson_id, 'scope', p_scope,
                       'observations', made.observations),
    left(p_body, 1000), '[]'::jsonb, null, null,
    'app.unlearn(lesson_id, by, reason)',
    p_from_job);

  return jsonb_build_object(
    'lesson_id', made.lesson_id,
    'observations', made.observations,
    'replaced', p_supersedes
  );
end;
$$;

comment on function app.learn(public.lesson_scope, text, text, uuid, text, text, uuid, numeric, uuid) is
  'Record a lesson, or strengthen an existing one by superseding it. Never '
  'updates: the previous belief stays readable (#48). Appends to the ledger '
  'with a real reversal method (#53).';

-- ---------------------------------------------------------------------------
-- Writing a skill down, in the ledger
-- ---------------------------------------------------------------------------
create or replace function app.teach_skill(
  p_name        text,
  p_when_to_use text,
  p_procedure   text,
  p_authored_by text,
  p_scope       public.lesson_scope default 'global',
  p_project_id  uuid default null,
  p_staff_slug  text default null,
  p_job_kind    text default null,
  p_tools       text[] default '{}',
  p_from_job    uuid default null,
  p_supersedes  uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  prior   public.skills%rowtype;
  made    public.skills%rowtype;
  next_v  integer := 1;
  unknown text;
begin
  if p_supersedes is not null then
    select * into prior from public.skills where skill_id = p_supersedes;
    if not found then
      return jsonb_build_object('error', 'nothing to supersede: ' || p_supersedes::text);
    end if;
    if exists (select 1 from public.skills where supersedes = p_supersedes) then
      return jsonb_build_object('error', 'that skill has already been revised');
    end if;
    next_v := prior.version + 1;
  end if;

  -- Named before anything is written, so the error is about the tool rather
  -- than about a foreign key on a table the author has never heard of.
  select t into unknown
    from unnest(coalesce(p_tools, '{}'::text[])) as t
   where not exists (select 1 from public.tool_permissions tp where tp.tool = t)
   limit 1;
  if unknown is not null then
    return jsonb_build_object(
      'error', 'no such tool: ' || unknown ||
               '. A skill may only name tools that already exist; ask for a new '
               'one rather than inventing it (ADR-0017).');
  end if;

  insert into public.skills
    (row_kind, scope, project_id, staff_slug, job_kind, name, when_to_use,
     procedure, authored_by, from_job, version, supersedes)
  values
    ('skill', p_scope, p_project_id, p_staff_slug, p_job_kind, p_name,
     p_when_to_use, p_procedure, p_authored_by, p_from_job, next_v, p_supersedes)
  returning * into made;

  insert into public.skill_tools (skill_id, tool)
  select made.skill_id, t from unnest(coalesce(p_tools, '{}'::text[])) as t
  on conflict do nothing;

  perform public.append_event(
    coalesce((select correlation_id from public.jobs where job_id = p_from_job),
             extensions.gen_random_uuid()),
    case when p_authored_by = 'grant' then 'user' else 'agent' end,
    p_authored_by, 'learning', 'office.skill_written',
    true, p_project_id, null,
    jsonb_build_object('skill_id', made.skill_id, 'name', p_name,
                       'scope', p_scope, 'version', made.version,
                       'tools', coalesce(p_tools, '{}'::text[])),
    -- The procedure is up to 4,000 characters and the ledger caps a rationale
    -- at 1,000, which is §6 refusing to become a place text is dumped. What it
    -- needs is enough to identify the change; the row itself holds the rest.
    left(format('%s — %s', p_name, p_when_to_use), 1000),
    '[]'::jsonb, null, null,
    'app.retire_skill(skill_id, by, reason)',
    p_from_job);

  return jsonb_build_object(
    'skill_id', made.skill_id,
    'version', made.version,
    'replaced', p_supersedes,
    'tools', coalesce(p_tools, '{}'::text[])
  );
end;
$$;

comment on function app.teach_skill(text, text, text, text, public.lesson_scope, uuid, text, text, text[], uuid, uuid) is
  'Write down a reusable procedure (#50). Refuses one containing an address or '
  'a credential, and refuses to name a tool that does not exist. Appends to '
  'the ledger with a real reversal method (#53).';

-- ---------------------------------------------------------------------------
-- Raising a suggestion, in the ledger
-- ---------------------------------------------------------------------------
create or replace function app.raise_suggestions(p_limit integer default 6)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n integer;
  raised uuid[];
begin
  with put as (
    insert into public.suggestions
      (project_id, kind, subject_ref, body, because, weight, offer_kind, offer_args)
    select s.project_id, s.kind, s.subject_ref, s.body, s.because,
           s.weight, s.offer_kind, s.offer_args
      from app.notice(p_limit) s
    on conflict (kind, coalesce(project_id::text, ''), subject_ref)
      where state = 'open'
      do nothing
    returning suggestion_id
  )
  select count(*)::integer, coalesce(array_agg(suggestion_id), '{}')
    into n, raised
    from put;

  /*
    One event for the pass, not one per suggestion.

    A noticing pass that found four things is one act of noticing, and four
    ledger rows would make the daily volume of "the office thought about itself"
    four times what it is. The ids are in the row, so the detail is not lost.
  */
  if n > 0 then
    perform public.append_event(
      extensions.gen_random_uuid(), 'agent', 'chief-of-staff', 'noticing',
      'office.noticed', true, null, null,
      jsonb_build_object('raised', n, 'suggestion_ids', raised),
      format('Raised %s observation%s nobody asked for.', n,
             case when n = 1 then '' else 's' end),
      '[]'::jsonb, null, null,
      'update public.suggestions set state = ''dismissed'' — or the dashboard',
      null);
  end if;

  return n;
end;
$$;

comment on function app.raise_suggestions(integer) is
  'Write what was noticed into public.suggestions so it can be dismissed. '
  'notice() has no memory; this table is the memory (#52). One ledger event '
  'per pass, because a pass is one act of noticing (#53).';

-- ---------------------------------------------------------------------------
-- What the office has decided about itself
--
-- The question this whole issue exists to keep answerable, in one place so
-- nobody has to know the six action types by heart.
-- ---------------------------------------------------------------------------
create or replace function app.self_changes(p_days integer default 14)
returns table (
  occurred_at timestamptz,
  actor_kind  text,
  actor       text,
  what        text,
  detail      text,
  reversible  boolean,
  undo_with   text
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.occurred_at, e.actor_kind, e.actor, e.action_type,
         e.rationale_summary, e.reversible, e.reversal_method
    from public.events e
   where e.action_type in ('office.learned', 'office.skill_written',
                           'office.noticed', 'tool.requested', 'tool.granted',
                           'tool.declined', 'tool.revoked', 'tool.wanted')
     and e.occurred_at > app.now_utc()
                         - (greatest(coalesce(p_days, 14), 1) || ' days')::interval
   order by e.occurred_at desc
$$;

comment on function app.self_changes(integer) is
  'Everything the office has changed about itself, with who did it and how to '
  'undo it (#53). The one question an office that extends itself must be able '
  'to answer about its own past.';

create or replace function public.self_changes(p_days integer default 14)
returns table (
  occurred_at timestamptz, actor_kind text, actor text, what text,
  detail text, reversible boolean, undo_with text
) language sql stable security definer set search_path = ''
as $$ select * from app.self_changes(p_days) $$;

commit;
