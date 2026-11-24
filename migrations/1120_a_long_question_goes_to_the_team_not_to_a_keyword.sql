-- 1120 — a long question goes to the team, not to a keyword (stress test of 24 November 2026, 0.113.0)
--
-- app.voice_answer answers some questions from the database: the calendar, what is waiting on Grant, the team's last output,
-- spending. Each branch matches a word, so a long question that merely contains the word was answered by the branch. Efficacy
-- baseline T10, "What did the team decide last time about the budget? If you are not sure, say so.", came back "4 things are
-- waiting on you" in three seconds, because it contains "decide".
--
-- A question of more than twelve words is not one of the short state questions these branches were written for, so it is not
-- answered here: it returns null and the team reads it, as it reads any other request. Short questions are untouched.
--
-- The live definition is read, one line is replaced, and the result is run back. A definition that does not hold the line
-- exactly once is refused.

do $m$
declare
  v text;
  old_line text := $o$  if app.spoken_is_a_request(said) then$o$;
  new_line text := $n$  if array_length(regexp_split_to_array(btrim(said), '\s+'), 1) > 12 then
    return null;
  end if;

  if app.spoken_is_a_request(said) then$n$;
  hits int;
begin
  v := pg_get_functiondef('app.voice_answer(uuid,uuid)'::regprocedure);
  -- The new text contains the old line, so the new text is looked for first.
  if position(new_line in v) > 0 then
    return; -- already applied
  end if;
  hits := (length(v) - length(replace(v, old_line, ''))) / length(old_line);
  if hits <> 1 then
    raise exception 'app.voice_answer: the request guard was found % times, expected once', hits;
  end if;
  v := replace(v, old_line, new_line);
  execute v;
end
$m$;
