-- Asking about someone is not asking for work.
--
-- §22 scenario A contains a literal sentence Grant is expected to say:
--
--   "Grant opens Team HQ on iPhone, presses Talk to Team, asks *'what was
--    Research going on about?'* → Chief of Staff explains from real state"
--
-- The first live run of `verify:scenario-a` put that exact sentence to the
-- live endpoint and got "Right — I have put that to the team." The office
-- delegated a question about work it had already finished, back to itself.
--
-- ## Why
--
-- 0105 added `spoken_is_a_request`, which settles "is this work?" before any
-- state matcher runs. Its phrase list contains the bare word `research`,
-- because "research the trade-offs" is a request. And "what was **Research**
-- going on about" contains the word research — as the name of the person being
-- asked about.
--
-- So naming the Research Director was indistinguishable from asking for
-- research, and the same held for "what has Research been up to". Two of the
-- three natural phrasings of §22's own sentence.
--
-- ## The fix, and how narrow it deliberately is
--
-- 0105's reasoning stands and is not being softened: an utterance that asks
-- for something to be done is work whatever nouns it contains, and ties go to
-- delegating, because work mistaken for a question is never done at all.
--
-- The exemption is therefore three conditions at once, not one:
--
--   1. the sentence OPENS with an interrogative — so "have a look at what
--      Emma found" is still a request, as 0105 intends
--   2. it names a member of staff that `spoken_about_whom` resolves
--   3. it uses one of the verbs that mean "what did they do" — the same list
--      the state matcher itself keys on
--
-- All three, and it is a question about a person. Any fewer and 0105 wins.
--
-- ## Why here and not in `voice_answer`
--
-- Because `voice_answer` is 180 lines of branches and I have already broken
-- one large function by re-authoring it (0128). `spoken_is_a_request` is
-- fourteen lines, its existing body is copied below verbatim from 0105, and
-- the new condition wraps it rather than editing it.

begin;

create or replace function app.spoken_is_a_request(p_said text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    -- A wh-question about a named colleague's work. See the header: three
    -- conditions, all of them, or this does not apply.
    when app.spoken_gist(p_said) ~ '^(what|who|how|when|where|why)\M'
     and app.spoken_about_whom(p_said) is not null
     and app.spoken_gist(p_said) ~
         '\m(said|say|find|found|going on|about|doing|been up to|conclude|concluded|reported|report)\M'
    then false
    else app.spoken_gist(p_said) ~
      ('\m('
       -- Asking for work outright.
       || 'have a look|take a look|look into|look at|dig into|find out|work out|'
       || 'figure out|work up|put together|draft|write|draw up|make me|build|'
       || 'research|investigate|check whether|see whether|see if|'
       -- Asking a person or the team.
       || 'ask |get \w+ to|bring \w+ in|tell \w+ to|have \w+ look|'
       -- Delegating judgement, which §22 names explicitly: "do what you think
       -- is best and let me know".
       || 'do what you think|your call|use your judgement|use your judgment|'
       || 'go ahead and|carry on and|sort out|deal with|handle'
       || ')\M')
  end
$$;

comment on function app.spoken_is_a_request is
  'Whether an utterance asks for work rather than for a fact. Checked before '
  'the state matchers, and deliberately eager: work mistaken for a question is '
  'never done at all, while a question sent to the team comes back answered. '
  'The one exemption is a wh-question naming a colleague and asking what they '
  'did — §22 A names that sentence, and the phrase list was catching it on the '
  'word "research" in the Research Director''s title (0139).';

-- ---------------------------------------------------------------------------
-- Prove it on the sentences the spec actually contains
-- ---------------------------------------------------------------------------
--
-- Both directions. A fix that only checks the newly-passing case is a fix that
-- can quietly turn every request into a question.

do $$
begin
  if app.spoken_is_a_request('what was Research going on about?') then
    raise exception 'the sentence §22 A names is still classified as work';
  end if;
  if app.spoken_is_a_request('what has Research been up to?') then
    raise exception 'asking what Research has been up to is still classified as work';
  end if;
  if app.spoken_is_a_request('what did Emma find?') then
    raise exception 'asking what Emma found is still classified as work';
  end if;

  -- And 0105's own examples, which must not have moved.
  if not app.spoken_is_a_request(
    'have a look at whether we should be worried about the notebook allowance') then
    raise exception '0105 regressed: "have a look at" is no longer a request';
  end if;
  if not app.spoken_is_a_request('research the trade-offs in storing a project canonically') then
    raise exception '0105 regressed: "research X" is no longer a request';
  end if;
  if not app.spoken_is_a_request('do what you think is best and let me know') then
    raise exception '0105 regressed: delegated judgement is no longer a request';
  end if;
  -- The near miss the exemption is shaped to avoid: names a person, asks for
  -- work, does not open with an interrogative.
  if not app.spoken_is_a_request('have a look at what Emma found') then
    raise exception 'the exemption is too wide: it caught a request that names a person';
  end if;
end
$$;

commit;
