begin;

-- ---------------------------------------------------------------------------
-- 0390 - a correction can become a standing rule, in one press (#147)
--
-- Grant's FIRST PICK from #136, and his reason: *"There are dozens of
-- corrections already on record. This turns work he has already done into
-- permanent improvement, which no other item on the list does."*
--
-- The gap: *"When a reply is wrong Grant says so and the next reply is better.
-- NOTHING GENERALISES."*
--
-- ## Built on the suggestion, not on a new mechanism
--
-- `public.suggestions` already has `offer_kind` and `offer_args` - a note with
-- an action attached - and `hq_governance` already renders suggestions on the
-- page Grant reads. Nothing had ever written an offer into those two columns.
-- So a drafted rule is a suggestion whose offer is `learn`, which means it
-- arrives where he already looks, with the rule VERBATIM, and accepting it is
-- one press. #169's rule, applied to a noun this office already has.
--
-- ## The four constraints, each enforced here rather than remembered
--
--   * *"Never save a rule without the press."* `decide_suggestion` is the only
--     thing that calls `learn` for one of these, and it is only reachable from
--     a decision.
--   * *"Offer at most once per correction; a declined offer is not repeated for
--     the same class."* The unique index on (kind, project, subject_ref) that
--     `raise_suggestions` already relies on does the first; a DECLINED row with
--     the same subject_ref does the second, because the proposer checks for any
--     row rather than only an open one.
--   * *"The drafted rule must be visible verbatim before acceptance."* The
--     suggestion's `body` IS the rule text. There is no summary anywhere: what
--     is rendered is what gets stored.
--   * A rule is scoped. `offer_args` carries the scope and the staff slug, so
--     a correction addressed to Ruby does not quietly govern Daniel.
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
  if p_scope not in ('global', 'project', 'agent') then
    return jsonb_build_object('error', format('%L is not a scope a rule can have', p_scope));
  end if;

  /*
    The class, not the sentence.

    Two corrections about the same thing, worded differently, must not produce
    two offers - "offer at most once per correction" is only meaningful if
    similar corrections collapse. The subject is the normalised rule text, so
    punctuation and case do not make a second class, and the existing unique
    index does the rest.
  */
  v_ref := left(regexp_replace(lower(v_body), '[^a-z0-9]+', '-', 'g'), 120);

  -- Any row, not only an open one. A declined offer must not come back.
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
  'Offer a drafted rule on the Governance page, once (#147). The body IS the '
  'rule - there is no summary anywhere, because Grant must be approving text '
  'he can read rather than a description of it.';

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
  v_kept uuid;
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
      Declined is a decision, and the dismissal count is the office being told
      it is not taking a hint. `raise_suggestions` reads that count; so does
      the page, loudly, above zero.
    */
    update public.suggestions
       set state = 'declined', settled_at = app.now_utc(),
           dismissals = coalesce(dismissals, 0) + 1
     where suggestion_id = p_suggestion_id;
    return jsonb_build_object('accepted', false);
  end if;

  if s.offer_kind = 'learn' then
    -- The only path by which a correction becomes a rule, and it is reachable
    -- only from a press.
    v_kept := app.learn(
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
     set state = 'accepted', settled_at = app.now_utc()
   where suggestion_id = p_suggestion_id;

  return jsonb_build_object('accepted', true, 'lesson_id', v_kept,
                            'did', coalesce(s.offer_kind, 'nothing but noting it'));
end;
$$;

comment on function app.decide_suggestion(uuid, boolean, text) is
  'One press (#147). Accepting a suggestion PERFORMS its offer - for a drafted '
  'standing rule that means app.learn, which is the only path by which a '
  'correction becomes a rule. Never saved without the press, because nothing '
  'else calls it.';

create or replace function public.decide_suggestion(p_suggestion_id uuid, p_accept boolean, p_by text default 'grant')
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.decide_suggestion(p_suggestion_id, p_accept, p_by) $$;

revoke all on function public.decide_suggestion(uuid, boolean, text) from public;
grant execute on function public.decide_suggestion(uuid, boolean, text) to service_role;

commit;
