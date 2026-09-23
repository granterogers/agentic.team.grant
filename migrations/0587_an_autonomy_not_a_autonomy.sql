-- "changed a autonomy" (#356).
--
-- app.action_in_words turns an action_type into the phrase the studio's Recent
-- activity panel reads out, and composes the article as a bare
--
--   'a ' || replace(split_part(p_action, '.', 1), '_', ' ')
--
-- so any noun beginning with a vowel gets the wrong one. Today exactly one does,
-- and it is not a rare one: autonomy.changed has 441 events, and #15 made the
-- autonomy dial something Grant actually sets -- so the panel tells him he
-- "changed a autonomy" every time he does.
--
-- It was invisible until 0586 because the only such rows on the panel belonged
-- to verify:pursues, and filtering the suites out is what left his own behind
-- to be read properly.
--
-- Fixed by the SOUND rather than by listing the nouns: a list would be wrong the
-- first time the office grows an action_type nobody wrote down, which is the
-- enumeration-versus-property correction this repository keeps making. Crude on
-- purpose -- English has "an hour" and "a university" and this vocabulary has
-- neither, and a phonetic dictionary for one word would be the worse trade.

do $$
declare
  v_def  text;
  v_next text;
  v_old  constant text :=
    'else ''a '' || replace(split_part(p_action, ''.'', 1), ''_'', '' '')';
  v_new  constant text :=
    'else case when split_part(p_action, ''.'', 1) ~* ''^[aeiou]'' '
    || 'then ''an '' else ''a '' end '
    || '|| replace(split_part(p_action, ''.'', 1), ''_'', '' '')';
begin
  select pg_get_functiondef('app.action_in_words'::regproc) into v_def;

  if position(v_old in v_def) = 0 then
    raise exception 'the article clause is not where this migration expects it';
  end if;

  v_next := replace(v_def, v_old, v_new);
  if v_next = v_def then
    raise exception 'the replacement changed nothing';
  end if;

  execute v_next;
end $$;

-- Drive it. Both articles, and the prefixes that take no article at all.
do $$
declare
  v_vowel text;
  v_cons  text;
  v_none  text;
begin
  select app.action_in_words('autonomy.changed') ->> 'what' into v_vowel;
  select app.action_in_words('tool.granted') ->> 'what' into v_cons;
  select app.action_in_words('office.synced') ->> 'what' into v_none;

  if v_vowel <> 'an autonomy' then
    raise exception 'a vowel noun reads "%"', v_vowel;
  end if;
  if v_cons <> 'a tool' then
    raise exception 'a consonant noun reads "%"', v_cons;
  end if;
  -- THE CONTROL. office, ledger and system take no article, and an article
  -- rule that gave them one would be a new defect wearing this fix's clothes.
  if v_none <> 'office' then
    raise exception 'a no-article prefix reads "%"', v_none;
  end if;
end $$;
