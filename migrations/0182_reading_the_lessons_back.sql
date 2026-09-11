-- Reading the lessons back, which is the half that is actually hard.
--
-- Issue #48. Writing a memory is a table; USING one is a retrieval problem, and
-- getting it wrong in either direction is worse than having no memory at all:
--
--   * Retrieve too much and every prompt carries forty sentences of accumulated
--     hedging, the useful one is buried, and the token bill on a ~£0/month
--     budget is no longer nominal.
--   * Retrieve too little and behaviour changes for reasons nobody can find.
--
-- So retrieval is scoped, ranked, capped, and — the part that makes it
-- debuggable — RECORDED. A job knows which lessons it saw and which it did not,
-- so a wrong answer can be traced to a lesson that was or was not present.
-- Without that, a memory turns every bug into a mystery.
--
-- ## Ranking
--
-- Specificity first, then weight of evidence. A lesson about THIS project
-- outranks a lesson about everything, because the general one is usually
-- already reflected in how the office is built and the specific one is the
-- thing nobody knew. Within a tier: observations, then confidence, then
-- recency. Observations lead confidence deliberately — a model's own confidence
-- in a thing it just noticed is not evidence, and nine sightings are.

begin;

-- ---------------------------------------------------------------------------
-- Learn something
--
-- `p_supersedes` covers both corrections and repeat observations. Passing it
-- carries the previous row's observation count forward and adds one, so
-- confirming a lesson strengthens it instead of duplicating it.
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
  prior     public.lessons%rowtype;
  seen      integer := 1;
  made      public.lessons%rowtype;
begin
  if p_supersedes is not null then
    select * into prior from public.lessons where lesson_id = p_supersedes;
    if not found then
      return jsonb_build_object('error', 'nothing to supersede: ' || p_supersedes::text);
    end if;
    -- Superseding a row that is already superseded would lose the newer belief.
    -- The unique index refuses it; saying so is friendlier than a constraint name.
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

  return jsonb_build_object(
    'lesson_id', made.lesson_id,
    'observations', made.observations,
    'replaced', p_supersedes
  );
end;
$$;

comment on function app.learn(public.lesson_scope, text, text, uuid, text, text, uuid, numeric, uuid) is
  'Record a lesson, or strengthen an existing one by superseding it. Never '
  'updates: the previous belief stays readable (#48).';

-- ---------------------------------------------------------------------------
-- Withdraw one
--
-- Grant must be able to retract a lesson from the dashboard (#54). A lesson he
-- cannot retract is a rule he never agreed to, so this is not an internal
-- maintenance function — it is the governance half of the feature.
-- ---------------------------------------------------------------------------
create or replace function app.unlearn(
  p_lesson_id uuid,
  p_by        text,
  p_reason    text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.lessons%rowtype;
  note   text;
begin
  select * into target from public.lessons where lesson_id = p_lesson_id;
  if not found then
    return jsonb_build_object('error', 'no such lesson');
  end if;
  if exists (select 1 from public.lessons where supersedes = p_lesson_id) then
    return jsonb_build_object('error', 'that lesson is already superseded');
  end if;

  -- The retraction row carries the reason in `body`, and `body` has a minimum
  -- length, so "withdrawn" with no reason is not a thing that can be recorded.
  note := 'Withdrawn: ' || btrim(coalesce(p_reason, ''));
  if length(note) < 20 then
    return jsonb_build_object('error', 'say why it is being withdrawn');
  end if;

  insert into public.lessons
    (row_kind, scope, project_id, staff_slug, job_kind, body,
     learned_by, confidence, supersedes)
  values
    ('retraction', target.scope, target.project_id, target.staff_slug,
     target.job_kind, left(note, 280), p_by, 1.00, p_lesson_id);

  return jsonb_build_object('retracted', p_lesson_id);
end;
$$;

comment on function app.unlearn(uuid, text, text) is
  'Withdraw a lesson by writing a retraction that supersedes it. Nothing is '
  'deleted; a reason is required.';

-- ---------------------------------------------------------------------------
-- What this job should know
--
-- Scoped, ranked, capped. The cap is an argument rather than a constant because
-- a chat turn and an overnight research job can afford very different amounts,
-- and hardcoding the cheaper one makes the expensive one worse for no reason.
-- ---------------------------------------------------------------------------
create or replace function app.lessons_for(
  p_project_id uuid default null,
  p_staff_slug text default null,
  p_job_kind   text default null,
  p_limit      integer default 8
)
returns table (
  lesson_id    uuid,
  scope        public.lesson_scope,
  body         text,
  observations integer,
  confidence   numeric,
  learned_by   text,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.lesson_id, l.scope, l.body, l.observations, l.confidence,
         l.learned_by, l.created_at
    from public.lessons_live l
   where (l.scope = 'global')
      or (l.scope = 'project' and l.project_id = p_project_id)
      or (l.scope = 'staff'   and l.staff_slug = p_staff_slug)
      or (l.scope = 'kind'    and l.job_kind   = p_job_kind)
   order by
     -- Specificity first. The general lesson is usually already reflected in
     -- how the office is built; the specific one is what nobody knew.
     case l.scope when 'staff' then 0 when 'kind' then 1 when 'project' then 2 else 3 end,
     l.observations desc,
     l.confidence desc,
     l.created_at desc
   limit greatest(coalesce(p_limit, 8), 0)
$$;

comment on function app.lessons_for(uuid, text, text, integer) is
  'The lessons a job should be told, scoped and ranked by specificity then '
  'weight of evidence. Capped by the caller, because a chat turn and an '
  'overnight research job can afford different amounts.';

-- ---------------------------------------------------------------------------
-- Public wrappers
--
-- PostgREST only exposes `public`. Every app.* RPC a client calls needs one,
-- and the wrapper is the half that silently drops a new parameter — so these
-- are written out in full rather than defaulted.
-- ---------------------------------------------------------------------------
create or replace function public.learn(
  p_scope public.lesson_scope, p_body text, p_learned_by text,
  p_project_id uuid default null, p_staff_slug text default null,
  p_job_kind text default null, p_from_job uuid default null,
  p_confidence numeric default 0.50, p_supersedes uuid default null
)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.learn(p_scope, p_body, p_learned_by, p_project_id, p_staff_slug,
                       p_job_kind, p_from_job, p_confidence, p_supersedes) $$;

create or replace function public.unlearn(p_lesson_id uuid, p_by text, p_reason text)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.unlearn(p_lesson_id, p_by, p_reason) $$;

create or replace function public.lessons_for(
  p_project_id uuid default null, p_staff_slug text default null,
  p_job_kind text default null, p_limit integer default 8
)
returns table (
  lesson_id uuid, scope public.lesson_scope, body text, observations integer,
  confidence numeric, learned_by text, created_at timestamptz
)
language sql stable security definer set search_path = ''
as $$ select * from app.lessons_for(p_project_id, p_staff_slug, p_job_kind, p_limit) $$;

commit;
