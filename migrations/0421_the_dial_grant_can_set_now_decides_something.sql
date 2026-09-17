-- The approval policy: the dial Grant can set now decides something (#15).
--
-- #15's title is the complaint -- *"the system interrupts on everything or
-- nothing"* -- and the reason is narrower and worse than a missing feature.
-- Every part of the answer already existed and none of it was joined up:
--
--   * `tool_permissions.level` has been 0/1/2/3 across 22 tools for months.
--     That IS the action class #15 asks for, already data Grant edits.
--   * `public.autonomy_level` is `observe | suggest | act_with_review | act`
--     and `app.autonomy_for(project)` resolves project-over-global with a
--     conservative default. Correct, tested, and **read by nothing in
--     `src/`** -- both rows in `autonomy_settings` were written by
--     `verify:autonomy`. `check:callers` had it in its baseline.
--   * `public.blockers` carries `requested_action`, `why_needed`,
--     `consequences_of_delay`, `approval_options` and `work_can_continue`,
--     with 397 resolved rows. The surfacing half works.
--
-- So `handlers/drive.ts` calls `raiseBlocker` unconditionally: it asks whatever
-- Grant has said he wants, and one of the options it offers him is literally
-- *"Just tell me when things land here, do not ask again"* -- an option nothing
-- could honour, because there was nowhere to write the answer.
--
-- ## What this adds, and what it deliberately does not
--
-- A MATRIX, as data, of (autonomy level x action level) -> verdict. Sixteen
-- rows Grant can edit, not a list in TypeScript he cannot -- 0366's rule.
--
-- And a hard floor he cannot edit away: **a level-3 action may never resolve
-- to `proceed`.** That is #15's "destructive or externally-visible actions
-- cannot bypass it", made structural. A CHECK constraint, not a comment,
-- because this file records four occasions where a comment claimed a property
-- with nothing behind it.
--
-- `observe` is the row that makes `refuse` mean something: a project the office
-- watches and does not write to. Without it `observe` and `suggest` would be
-- the same row, which is a matrix with a dead cell in it.
--
-- ## Standing authorizations
--
-- "Do not ask again", as a row. It turns `ask` into `proceed` for one tool, in
-- one project or everywhere. It can NEVER turn `refuse` into anything, and it
-- can never cover a level-3 tool -- a trigger refuses that, because a CHECK
-- cannot read another table. Only Grant writes one: the two wrappers hardcode
-- the actor exactly as `hq_approve_tool` does, so an agent cannot widen its own
-- permissions by asking nicely.

create type public.policy_verdict as enum ('proceed', 'ask', 'refuse');

create table public.autonomy_policy (
  autonomy      public.autonomy_level not null,
  action_level  smallint not null,
  verdict       public.policy_verdict not null,
  note          text not null,
  set_by        text not null default 'the default matrix',
  set_at        timestamptz not null default app.now_utc(),
  primary key (autonomy, action_level),
  constraint autonomy_policy_level_known check (action_level between 0 and 3),
  -- The floor. Editing the matrix may make the office quieter or noisier; it
  -- may not make a level-3 action automatic.
  constraint autonomy_policy_level_three_always_asks
    check (action_level < 3 or verdict <> 'proceed')
);

comment on table public.autonomy_policy is
  'What the office may do at each autonomy level, per action class (#15). The '
  'action class is tool_permissions.level. Edit a cell to change behaviour; the '
  'CHECK is what stops a level-3 action ever becoming automatic.';

insert into public.autonomy_policy (autonomy, action_level, verdict, note) values
  ('observe',         0, 'proceed', 'Reading is what observing is.'),
  ('observe',         1, 'refuse',  'Observing means it does not write, even internally.'),
  ('observe',         2, 'refuse',  'Nothing leaves the building.'),
  ('observe',         3, 'refuse',  'Nothing leaves the building.'),
  ('suggest',         0, 'proceed', 'Reading is never the thing worth asking about.'),
  ('suggest',         1, 'ask',     'It proposes; you decide, even for a draft.'),
  ('suggest',         2, 'ask',     'It proposes; you decide.'),
  ('suggest',         3, 'ask',     'It proposes; you decide.'),
  ('act_with_review', 0, 'proceed', 'Reading is never the thing worth asking about.'),
  ('act_with_review', 1, 'proceed', 'Internal work happens and you see it afterwards.'),
  ('act_with_review', 2, 'ask',     'Anything that leaves the building still waits.'),
  ('act_with_review', 3, 'ask',     'Consequential work always waits.'),
  ('act',             0, 'proceed', 'Reading is never the thing worth asking about.'),
  ('act',             1, 'proceed', 'It acts.'),
  ('act',             2, 'proceed', 'It acts, including outward.'),
  ('act',             3, 'ask',     'Consequential work always waits, at every level.');

create table public.standing_authorizations (
  authorization_id uuid primary key default extensions.gen_random_uuid(),
  -- Null means everywhere. A project-scoped row is the common case and the
  -- narrower one, which is the direction a default should lean.
  project_id       uuid references public.projects(project_id) on delete cascade,
  tool             text not null references public.tool_permissions(tool),
  reason           text not null,
  granted_by       text not null,
  granted_at       timestamptz not null default app.now_utc(),
  expires_at       timestamptz,
  revoked_at       timestamptz,
  revoked_reason   text,
  constraint standing_reason_said check (btrim(reason) <> ''),
  constraint standing_revoked_says_why
    check ((revoked_at is null) = (revoked_reason is null))
);

-- One LIVE authorization per (project, tool). Nulls are distinct in a unique
-- index, so the global scope needs its own partial index -- the trap 0322 cost
-- four migrations to learn.
create unique index standing_live_per_project
  on public.standing_authorizations (project_id, tool)
  where revoked_at is null and project_id is not null;
create unique index standing_live_globally
  on public.standing_authorizations (tool)
  where revoked_at is null and project_id is null;

comment on table public.standing_authorizations is
  'Do not ask again, as a row (#15). Turns ask into proceed for one tool. Never '
  'turns refuse into anything, and never covers a level-3 tool.';

create or replace function app.standing_never_covers_level_three()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v_level smallint;
begin
  select level into v_level from public.tool_permissions where tool = new.tool;
  if v_level is null then
    raise exception 'no such tool: %', new.tool;
  end if;
  if v_level >= 3 then
    raise exception
      'a standing authorization may not cover %, which is a level-3 action — those always ask',
      new.tool;
  end if;
  return new;
end;
$function$;

create trigger standing_never_covers_level_three
  before insert or update on public.standing_authorizations
  for each row execute function app.standing_never_covers_level_three();

/*
  The resolution, in one place.

  Returns the verdict AND everything the caller needs to explain it, because a
  refusal Grant cannot read the reason for is a refusal he will switch off.
*/
create or replace function app.may_act(p_project uuid, p_tool text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_tool      record;
  v_autonomy  public.autonomy_level;
  v_verdict   public.policy_verdict;
  v_note      text;
  v_standing  record;
begin
  select tool, level, enabled, disabled_reason into v_tool
    from public.tool_permissions where tool = p_tool;
  if not found then
    return jsonb_build_object('verdict', 'refuse', 'tool', p_tool,
      'because', format('There is no such capability as %s.', p_tool));
  end if;

  -- A disabled tool is refused before the dial is consulted. The registry is
  -- the authority on what exists; autonomy is only about what may be done
  -- without asking, and it may never re-enable something switched off.
  if not v_tool.enabled then
    return jsonb_build_object('verdict', 'refuse', 'tool', p_tool,
      'action_level', v_tool.level,
      'because', coalesce(nullif(btrim(v_tool.disabled_reason), ''),
                          format('%s is switched off for everyone.', p_tool)));
  end if;

  v_autonomy := app.autonomy_for(p_project);

  select verdict, note into v_verdict, v_note
    from public.autonomy_policy
   where autonomy = v_autonomy and action_level = v_tool.level;
  if v_verdict is null then
    -- A gap in the matrix is a fault, and a missing configuration must not
    -- read as permission (the same argument `autonomy_for` makes).
    return jsonb_build_object('verdict', 'ask', 'tool', p_tool,
      'action_level', v_tool.level, 'autonomy', v_autonomy::text,
      'because', 'The policy has nothing to say about this, so it asks.');
  end if;

  /*
    A standing authorization upgrades ask to proceed and nothing else.

    Not refuse: `observe` means observe, and a level-3 tool cannot hold one at
    all (the trigger above). The project's own row wins over the global one,
    the same precedence `autonomy_for` uses.
  */
  if v_verdict = 'ask' then
    select authorization_id, project_id, reason, granted_at, expires_at
      into v_standing
      from public.standing_authorizations
     where tool = p_tool
       and revoked_at is null
       and (expires_at is null or expires_at > app.now_utc())
       and (project_id is null or project_id = p_project)
     order by (project_id is not null) desc
     limit 1;
    if found then
      return jsonb_build_object(
        'verdict', 'proceed', 'tool', p_tool, 'action_level', v_tool.level,
        'autonomy', v_autonomy::text,
        'standing', jsonb_build_object(
          'id', v_standing.authorization_id,
          'scope', case when v_standing.project_id is null then 'everywhere' else 'this project' end,
          'reason', v_standing.reason,
          'since', v_standing.granted_at,
          'until', v_standing.expires_at),
        'because', format('You said not to ask again about %s: %s', p_tool, v_standing.reason));
    end if;
  end if;

  return jsonb_build_object('verdict', v_verdict::text, 'tool', p_tool,
    'action_level', v_tool.level, 'autonomy', v_autonomy::text,
    'standing', null, 'because', v_note);
end;
$function$;

create or replace function public.may_act(p_project uuid, p_tool text)
returns jsonb language sql security definer set search_path to ''
as $function$ select app.may_act(p_project, p_tool) $function$;

/*
  Granting and revoking, with the actor hardcoded.

  `hq_approve_tool`'s shape: this endpoint sits behind one bearer token and
  there is exactly one person holding it, so taking a `p_by` would be inviting
  a caller to name somebody else. An agent cannot widen its own permissions
  because there is no argument through which to try.
*/
create or replace function app.grant_standing(
  p_tool text, p_project uuid, p_reason text, p_by text, p_until timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v_id uuid;
begin
  if coalesce(btrim(p_reason), '') = '' then
    return jsonb_build_object('ok', false,
      'error', 'a standing authorization needs a reason — it is what makes it reviewable later');
  end if;

  -- Replace rather than collide. Saying it again with a better reason is the
  -- common case, and the unique index would otherwise refuse it.
  update public.standing_authorizations
     set revoked_at = app.now_utc(), revoked_reason = 'replaced by a newer standing authorization'
   where tool = p_tool and revoked_at is null
     and project_id is not distinct from p_project;

  insert into public.standing_authorizations (project_id, tool, reason, granted_by, expires_at)
  values (p_project, p_tool, btrim(p_reason), p_by, p_until)
  returning authorization_id into v_id;

  return jsonb_build_object('ok', true, 'authorization', v_id, 'tool', p_tool,
    'scope', case when p_project is null then 'everywhere' else 'this project' end);
end;
$function$;

create or replace function app.revoke_standing(p_authorization uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v_n integer;
begin
  update public.standing_authorizations
     set revoked_at = app.now_utc(),
         revoked_reason = coalesce(nullif(btrim(p_reason), ''), 'you took it back')
   where authorization_id = p_authorization and revoked_at is null;
  get diagnostics v_n = row_count;
  -- 0350's lesson: a delete keyed on something nobody checked reports success
  -- having matched nothing. Say which happened.
  if v_n = 0 then
    return jsonb_build_object('ok', false,
      'error', 'there is no live standing authorization with that id');
  end if;
  return jsonb_build_object('ok', true, 'revoked', p_authorization);
end;
$function$;

create or replace function public.hq_grant_standing(
  p_tool text, p_reason text, p_project uuid default null, p_until timestamptz default null)
returns jsonb language sql security definer set search_path to ''
as $function$ select app.grant_standing(p_tool, p_project, p_reason, 'grant', p_until) $function$;

create or replace function public.hq_revoke_standing(p_authorization uuid, p_reason text default null)
returns jsonb language sql security definer set search_path to ''
as $function$ select app.revoke_standing(p_authorization, p_reason) $function$;

/*
  What is standing, for the page.

  Live rows only by default; the settled ones matter for the same reason a
  settled tool request does (#49), so thirty days of them come back too.
*/
create or replace function app.standing_now(p_project uuid default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(jsonb_agg(q.v order by q.ord, q.at desc), '[]'::jsonb)
    from (
      select case when s.revoked_at is null then 0 else 1 end as ord,
             s.granted_at as at,
             jsonb_build_object(
               'id', s.authorization_id,
               'tool', s.tool,
               'level', t.level,
               'what', t.description,
               'scope', case when s.project_id is null then 'everywhere' else coalesce(p.name, 'a project') end,
               'project', s.project_id,
               'reason', s.reason,
               'by', s.granted_by,
               'since', s.granted_at,
               'until', s.expires_at,
               'revoked', s.revoked_at,
               'revoked_reason', s.revoked_reason,
               'live', s.revoked_at is null
                       and (s.expires_at is null or s.expires_at > app.now_utc())) as v
        from public.standing_authorizations s
        join public.tool_permissions t on t.tool = s.tool
        left join public.projects p on p.project_id = s.project_id
       where (p_project is null or s.project_id is not distinct from p_project
              or s.project_id is null)
         and (s.revoked_at is null or s.revoked_at > app.now_utc() - interval '30 days')
       order by 1, 2 desc
       limit 60
    ) q;
$function$;

create or replace function public.hq_standing(p_project uuid default null)
returns jsonb language sql security definer set search_path to ''
as $function$ select app.standing_now(p_project) $function$;

/*
  And the capability the Drive watcher performs once it is allowed to.

  Registered HERE rather than in a later migration, because 0298's defect is a
  registry row claiming something nothing does: the handler gains the ingest
  path in the same commit as this row. `delivered_by` names it so
  `check:callers` and the constraint can both see the claim is answered.
*/
insert into public.tool_permissions (tool, level, description, enabled, verbs, delivered_by)
values (
  'drive.ingest', 1,
  'Add a file that has appeared in a watched Drive folder to the project as a '
  'source document. Takes nothing: the folder is the project''s own attachment '
  'and the file is whatever arrived. Internal — the document is a draft until '
  'it is approved, and nothing is sent anywhere.',
  true,
  array['add an arrived Drive file to the project', 'take a new file in as a source'],
  'job kind drive.watch — src/handlers/drive.ts, when the policy says proceed')
on conflict (tool) do update
  set level = excluded.level, description = excluded.description,
      enabled = excluded.enabled, verbs = excluded.verbs,
      delivered_by = excluded.delivered_by;
