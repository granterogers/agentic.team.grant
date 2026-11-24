-- 1121 — a question about blocked tasks is not answered with the list of approvals (found on the Sample Office, 24 November 2026, 0.115.0)
--
-- app.voice_answer's "waiting on you" branch matched the word blocked or waiting on its own. "Which tasks are blocked, and what is
-- each one waiting for?" was answered "4 things are waiting on you. Create the Slack channel #unnamed…": a list of pending
-- approvals, which is not what was asked. The branch keeps its short questions ("what is waiting on me", "what do you need
-- from me") and leaves a question about tasks to the team, which reads the tasks.
--
-- The live definition is read, one line is replaced, and the result is run back. A definition that does not hold the line
-- exactly once is refused.

do $m$
declare
  v text;
  old_line text := $o$  if g ~ '\m(waiting|blocked|blocking|need from me|needs me|decide|decisions)\M' then$o$;
  new_line text := $n$  if g ~ '\m(waiting|blocked|blocking|need from me|needs me|decide|decisions)\M' and said !~* '\mtasks?\M' then$n$;
  hits int;
begin
  v := pg_get_functiondef('app.voice_answer(uuid,uuid)'::regprocedure);
  -- The new text contains the old line, so the new text is looked for first.
  if position(new_line in v) > 0 then
    return; -- already applied
  end if;
  hits := (length(v) - length(replace(v, old_line, ''))) / length(old_line);
  if hits <> 1 then
    raise exception 'app.voice_answer: the waiting line was found % times, expected once', hits;
  end if;
  v := replace(v, old_line, new_line);
  execute v;
end
$m$;
