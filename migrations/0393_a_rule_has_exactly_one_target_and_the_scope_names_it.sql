begin;

-- ---------------------------------------------------------------------------
-- 0393 - a rule has exactly one target, and the scope names which (#147)
--
-- `verify:rules` drove the press at every scope the offer will accept and all
-- three failed the same way:
--
--     23514 new row for relation "lessons" violates check constraint
--           "lessons_scope_matches_target"
--
-- The constraint is exact and correct: a global lesson has no project, no
-- person and no kind; a project lesson has a project and nothing else; a staff
-- lesson has a person and nothing else. `propose_standing_rule` was storing
-- whatever it was handed - a scope of 'global' beside a staff slug and a
-- project id - and the press then passed all three to `app.learn`.
--
-- The main arc passed throughout, because the handler offers global rules with
-- no targets at all. So the whole class was invisible to the one path anything
-- currently exercises, and would have appeared the first time a rule was
-- offered for one person.
--
-- 0392 said an offer must promise only what the press can perform. This is the
-- same rule applied to the offer's ARGUMENTS rather than to its scope: store
-- the one target the scope names and drop the rest, so `offer_args` cannot
-- hold a contradiction and the press has nothing to choose between. The
-- alternative - having the press pick the right field out of three - leaves
-- the wrong two on the record, and this repository has paid for a stored fact
-- that disagrees with itself four times now (0303, 0304, 0311, 0355).
--
-- `suggestions.project_id` is left alone: that is what the Governance page
-- groups by, and it is a fact about where the correction happened rather than
-- about what the rule governs.
-- ---------------------------------------------------------------------------

create or replace function app.propose_standing_rule(
  p_body       text,
  p_scope      text default 'global',
  p_staff      text default null,
  p_project_id uuid default null,
  p_from_job   uuid default null,
  p_because    jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_body    text := btrim(coalesce(p_body, ''));
  v_staff   text := nullif(btrim(coalesce(p_staff, '')), '');
  v_ref     text;
  v_id      uuid;
  v_target  jsonb;
begin
  if length(v_body) < 12 then
    return jsonb_build_object('error', 'a standing rule needs to say something');
  end if;
  /*
    The scopes the PRESS can perform, which is a shorter list than the enum.

    'kind' is a real member of `lesson_scope` and is refused here for a reason
    about this function rather than about the enum: a kind-scoped lesson needs
    a `job_kind` and an offer carries no way to say one. Offer only what the
    press can perform.
  */
  if p_scope not in ('global', 'project', 'staff') then
    return jsonb_build_object('error',
      format('%L is not a scope a standing rule can be offered at', p_scope));
  end if;

  /*
    Exactly one target, chosen by the scope, and the others dropped.

    `lessons_scope_matches_target` permits precisely one non-null per scope, so
    this is not tidying - it is the difference between an offer that can be
    accepted and one that raises 23514 on the press.
  */
  v_target := case p_scope
    when 'project' then jsonb_build_object('project_id', p_project_id, 'staff', null)
    when 'staff'   then jsonb_build_object('project_id', null, 'staff', v_staff)
    else                jsonb_build_object('project_id', null, 'staff', null)
  end;
  if p_scope = 'project' and p_project_id is null then
    return jsonb_build_object('error', 'a project rule needs a project');
  end if;
  if p_scope = 'staff' and v_staff is null then
    return jsonb_build_object('error', 'a rule for one person needs to say who');
  end if;

  /*
    The class, not the sentence.

    Two corrections about the same thing, worded differently, must not produce
    two offers - "offer at most once per correction" is only meaningful if
    similar corrections collapse. The subject is the normalised rule text, so
    punctuation and case do not make a second class.
  */
  v_ref := left(regexp_replace(lower(v_body), '[^a-z0-9]+', '-', 'g'), 120);

  -- Any row, not only an open one. A dismissed offer must not come back.
  if exists (select 1 from public.suggestions s
              where s.kind = 'standing_rule' and s.subject_ref = v_ref) then
    return jsonb_build_object('offered', false, 'why', 'already offered once');
  end if;

  insert into public.suggestions
    (project_id, kind, subject_ref, body, because, weight, offer_kind, offer_args)
  values (p_project_id, 'standing_rule', v_ref, v_body,
          coalesce(p_because, '{}'::jsonb), 3, 'learn',
          v_target || jsonb_build_object('scope', p_scope, 'from_job', p_from_job))
  returning suggestion_id into v_id;

  return jsonb_build_object('offered', true, 'suggestion_id', v_id,
                            'rule', v_body, 'scope', p_scope);
end;
$$;

comment on function app.propose_standing_rule(text, text, text, uuid, uuid, jsonb) is
  'Offer a drafted rule on the Governance page, once (#147, 0393). The body IS '
  'the rule - Grant approves text he can read, never a summary. Global, '
  'project and staff only, and the offer carries exactly the one target its '
  'scope names, because lessons_scope_matches_target permits exactly one.';

commit;
