begin;

-- ---------------------------------------------------------------------------
-- 0391 - a decision has to use a word the table allows (#147)
--
-- 0390 added `app.decide_suggestion` and it has never run. It writes
-- `state = 'accepted'` on a press and `state = 'declined'` on a decline, and
-- `suggestions_state_check` permits exactly four words:
--
--     open, acted, dismissed, stale
--
-- So the first time Grant pressed Accept on a drafted standing rule, the
-- office would have raised 23514 and stored nothing - and because `app.learn`
-- is called BEFORE the update in the same statement, the lesson would have
-- been rolled back with it. A feature whose entire point is one press, and the
-- press could not work.
--
-- Third instance of this shape in the repository and the second in a fortnight:
-- `documents_state_check` refused 'superseded' in 0384, and the answer then was
-- the same as the answer now. Do NOT widen the constraint. Two words for one
-- state is what 0311 was spent undoing, and the vocabulary already has the
-- right ones:
--
--   * ACCEPTED is `acted` - accepting a suggestion PERFORMS its offer, which
--     for a standing rule means `app.learn` actually ran. "Acted" is the more
--     honest of the two words, because it says something happened rather than
--     that somebody agreed.
--   * DECLINED is `dismissed` - and `dismissals` is already the counter beside
--     it, which the page renders loudly above zero and `raise_suggestions`
--     reads. A separate 'declined' would have left that counter describing
--     only some of the declines.
--
-- Nothing else changes: the dedupe in `propose_standing_rule` matches on
-- `subject_ref` regardless of state, so a dismissed offer still does not come
-- back.
--
-- The page also gains ONE field. `hq_governance` returned every suggestion
-- without saying which of them carries an offer, and a suggestion with no
-- `offer_kind` is a note rather than a decision - drawing Accept and Decline on
-- one would put two buttons in front of Grant that perform nothing. The column
-- has existed since `suggestions` did; it was simply never exposed.
-- ---------------------------------------------------------------------------

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
     set state = 'acted', settled_at = app.now_utc()
   where suggestion_id = p_suggestion_id;

  return jsonb_build_object('accepted', true, 'state', 'acted', 'lesson_id', v_kept,
                            'did', coalesce(s.offer_kind, 'nothing but noting it'));
end;
$$;

comment on function app.decide_suggestion(uuid, boolean, text) is
  'One press (#147, 0391). Accepting PERFORMS the offer - for a drafted '
  'standing rule that is app.learn, the only path by which a correction '
  'becomes a rule. The states are the four the table allows: acted on a press, '
  'dismissed on a decline.';

/*
  Which suggestions are a decision rather than a note.

  Patched from the live definition rather than transcribed: `hq_governance` is
  several thousand characters and 0389 already changed one predicate in it.
*/
do $$
declare v_def text;
begin
  select pg_get_functiondef(oid) into v_def
    from pg_proc where oid = 'app.hq_governance(integer)'::regprocedure;
  if position('''dismissed'', s.dismissals,' in v_def) = 0 then
    raise exception 'the noticed block is not shaped as expected - read it first';
  end if;
  if position('''offer'', s.offer_kind' in v_def) > 0 then
    raise exception 'it already says which suggestions carry an offer';
  end if;
  v_def := replace(v_def,
    '''dismissed'', s.dismissals,',
    '''dismissed'', s.dismissals,' || E'\n' || '               ''offer'', s.offer_kind,');
  execute v_def;
end
$$;

commit;
