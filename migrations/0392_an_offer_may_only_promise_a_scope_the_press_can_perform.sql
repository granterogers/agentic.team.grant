begin;

-- ---------------------------------------------------------------------------
-- 0392 - an offer may only promise a scope the press can perform (#147)
--
-- `verify:rules` was written against 0390/0391 and drove the press. It found
-- two more ways the press could not work, neither visible from reading the
-- migration and both fatal:
--
-- 1. `app.learn` RETURNS JSONB, and `decide_suggestion` assigned it to a uuid:
--
--        invalid input syntax for type uuid:
--          {"replaced": null, "lesson_id": "...", "observations": 1}
--
--    So every accept raised 22P02 - and because the cast happens before the
--    state update, the rule was rolled back with it. CLAUDE.md's rule about
--    guessing column names, one level up: read the RESULT type too.
--
-- 2. The two halves disagree about what a scope is. `propose_standing_rule`
--    validated against the list ('global', 'project', 'agent'); the press casts
--    that same string to `lesson_scope`, whose members are
--
--        global | project | staff | kind
--
--    There is no 'agent'. An agent-scoped rule could therefore be OFFERED and
--    could never be ACCEPTED - the worst shape of defect this repository knows,
--    because it surfaces months later, on a press, to Grant. 0311 was spent
--    undoing exactly this: two vocabularies for one idea.
--
--    'staff' is the stored word, so 'staff' is the word. 'agent' is not aliased
--    to it: an alias is how the second vocabulary survives.
--
--    'kind' is a real member of the enum and is still refused here, for a
--    reason that is about this function rather than about the enum - a
--    kind-scoped lesson needs a `job_kind`, an offer carries no way to say
--    one, and a scope this function cannot supply the arguments for is a scope
--    it must not promise. That is the same test as the one above, stated
--    positively: offer only what the press can perform.
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
  v_body text := btrim(coalesce(p_body, ''));
  v_ref  text;
  v_id   uuid;
begin
  if length(v_body) < 12 then
    return jsonb_build_object('error', 'a standing rule needs to say something');
  end if;
  /*
    The scopes the PRESS can perform, which is a shorter list than the enum.

    Named rather than derived from `lesson_scope` on purpose: the constraint is
    not "is this a scope" but "can an accepted offer supply what a lesson at
    this scope needs", and 'kind' fails that while being a perfectly good
    member of the enum. Each of the three below is exercised end to end by
    `verify:rules`, which drives the offer AND the press, so the day this list
    and `app.learn` disagree again a check goes red rather than Grant does.
  */
  if p_scope not in ('global', 'project', 'staff') then
    return jsonb_build_object('error',
      format('%L is not a scope a standing rule can be offered at', p_scope));
  end if;
  if p_scope = 'project' and p_project_id is null then
    return jsonb_build_object('error', 'a project rule needs a project');
  end if;
  if p_scope = 'staff' and nullif(btrim(coalesce(p_staff, '')), '') is null then
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
          jsonb_build_object('scope', p_scope, 'staff', p_staff,
                             'project_id', p_project_id, 'from_job', p_from_job))
  returning suggestion_id into v_id;

  return jsonb_build_object('offered', true, 'suggestion_id', v_id, 'rule', v_body);
end;
$$;

comment on function app.propose_standing_rule(text, text, text, uuid, uuid, jsonb) is
  'Offer a drafted rule on the Governance page, once (#147, 0392). The body IS '
  'the rule - there is no summary anywhere, because Grant must be approving '
  'text he can read. Only global, project and staff are offered, because they '
  'are the scopes app.learn can be given everything it needs for.';

create or replace function app.decide_suggestion(
  p_suggestion_id uuid,
  p_accept        boolean,
  p_by            text default 'grant'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  s      public.suggestions;
  v_did  jsonb;
begin
  select * into s from public.suggestions where suggestion_id = p_suggestion_id;
  if s.suggestion_id is null then
    return jsonb_build_object('error', 'there is no such suggestion');
  end if;
  if s.state <> 'open' then
    return jsonb_build_object('already', s.state);
  end if;

  if not p_accept then
    /*
      Dismissed is a decision, and the count is the office being told it is not
      taking a hint. `raise_suggestions` reads it; so does the page, loudly,
      above zero.
    */
    update public.suggestions
       set state = 'dismissed', settled_at = app.now_utc(),
           dismissals = coalesce(dismissals, 0) + 1
     where suggestion_id = p_suggestion_id;
    return jsonb_build_object('accepted', false, 'state', 'dismissed');
  end if;

  if s.offer_kind = 'learn' then
    -- The only path by which a correction becomes a rule, and it is reachable
    -- only from a press. `app.learn` answers in JSONB, not with an id.
    v_did := app.learn(
      (s.offer_args ->> 'scope')::lesson_scope,
      s.body,
      p_by,
      nullif(s.offer_args ->> 'project_id', '')::uuid,
      nullif(s.offer_args ->> 'staff', ''),
      null,
      nullif(s.offer_args ->> 'from_job', '')::uuid,
      0.9,
      null);
  end if;

  update public.suggestions
     set state = 'acted', settled_at = app.now_utc()
   where suggestion_id = p_suggestion_id;

  return jsonb_build_object('accepted', true, 'state', 'acted',
                            'lesson_id', v_did -> 'lesson_id',
                            'did', coalesce(s.offer_kind, 'nothing but noting it'));
end;
$$;

comment on function app.decide_suggestion(uuid, boolean, text) is
  'One press (#147, 0392). Accepting PERFORMS the offer - for a drafted '
  'standing rule that is app.learn, the only path by which a correction '
  'becomes a rule. States are the four the table allows: acted on a press, '
  'dismissed on a decline.';

commit;
