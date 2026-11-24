-- 1118 — a question about one project is not answered with the list of projects (stress test of 24 November 2026, 0.111.0)
--
-- app.voice_answer answered any message that said "project" and a word like "what" or "which" with the office's count of active
-- projects. It takes no project into account, so "In this project, which travel tasks are overdue?" and "What is the status of
-- the Zephyr project?" were both answered "4 active projects: …" (efficacy baseline T2 and T7), without a model being asked.
--
-- The branch is narrowed, and nothing else is changed. The office-wide list still answers "which projects are active", "how
-- many projects do we have", "list the projects". A question that names one project ("this project", "my project", "the
-- Zephyr project"), or asks about tasks, budgets or status, is no longer answered from the list here; it goes to the team, which
-- is given the project and says so when the project is not one the office has (src/handlers/instruction.ts, 0.111.0).
--
-- The live definition is read, the one line is replaced, and the result is run back. A definition that does not hold the line
-- exactly once is refused, so this cannot quietly change a different function.

do $m$
declare
  v text;
  old_line text := $o$if g ~ '\m(projects?)\M' and g ~ '\m(what|which|how many|list|got|have)\M' then$o$;
  new_line text := $n$if g ~ '\m(projects?)\M' and g ~ '\m(what|which|how many|list|got|have)\M' and said !~* '\m(this|that|my|our)\s+(\S+\s+)?projects?\M' and said !~ '\mthe\s+[A-Z]\S*(\s+\S+)?\s+projects?\M' and said !~* '\m(tasks?|overdue|travel|budget|status|on track|late|due|blocked|spent|cost)\M' then$n$;
  hits int;
begin
  v := pg_get_functiondef('app.voice_answer(uuid,uuid)'::regprocedure);
  hits := (length(v) - length(replace(v, old_line, ''))) / length(old_line);
  if hits = 0 and position(new_line in v) > 0 then
    return; -- already applied
  end if;
  if hits <> 1 then
    raise exception 'app.voice_answer: the project line was found % times, expected once', hits;
  end if;
  v := replace(v, old_line, new_line);
  execute v;
end
$m$;
