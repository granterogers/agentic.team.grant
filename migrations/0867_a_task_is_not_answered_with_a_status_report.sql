-- 0867 - voice_answer answers QUESTIONS about the office's own state, not instructions that happen to contain a word.
--
-- app.voice_answer is the canonical layer's cheap path: a short question about what the office holds (the calendar, what
-- is waiting, which projects, what it has cost) is answered from the database at once, with no model and no job. Each
-- branch is keyed on a noun list, so a sentence that merely CONTAINS one of the words takes the branch:
--
--   "Ask the finance specialist to summarise the assumptions in the budget documents in this project."
--
-- was answered, in four seconds and with no job, by Daniel reporting "35 model calls in the last day, costing 0.0054
-- dollars" - because of the word budget. The request was never done and nothing said so. The same shape sits in the other
-- branches ("schedule", "decide", "report", "projects"), and a finance or wellness project's own vocabulary is exactly
-- those words. Found by using Team Chat as the Sample Person.
--
-- The fix is at the class, not the instance: this path is for QUESTIONS. An instruction (it opens with a verb that asks
-- for work to be done) and anything longer than a spoken question is not answered here and goes to the team, which is
-- where a request for work belongs. Nothing is added to any branch; the guard sits above all of them.
--
-- Spliced from the LIVE definition (CLAUDE.md: a function you are only patching is spliced, not rewritten), and the splice
-- is asserted: if the anchor is not found exactly once the migration raises instead of changing nothing.

do $m$
declare
  d text;
  anchor constant text := E'  g := app.spoken_gist(said);\n';
  guard constant text := E'  g := app.spoken_gist(said);\n'
    || E'  -- A request for work is not a question about the office. Words like budget or schedule in it must not take a\n'
    || E'  -- canned branch; it goes to the team (0867).\n'
    || E'  if said ~* ''^\\s*(please\\s+)?(ask|have|get|draft|write|create|make|summari[sz]e|compare|research|prepare|build|add|update|plan|review|analy[sz]e|put together|work out|set up|book|remind|find out|look into|go through)\\M''\n'
    || E'     or array_length(regexp_split_to_array(btrim(said), ''\\s+''), 1) > 30 then\n'
    || E'    return null;\n'
    || E'  end if;\n';
  hits int;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'voice_answer' and pg_get_function_identity_arguments(p.oid) = 'p_office uuid, p_command_id uuid';
  if d is null then
    raise exception '0867: app.voice_answer(uuid, uuid) was not found';
  end if;
  hits := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
  if hits <> 1 then
    raise exception '0867: expected the anchor once in app.voice_answer, found it % times', hits;
  end if;
  if position('(0867)' in d) > 0 then
    return; -- already spliced
  end if;
  d := replace(d, anchor, guard);
  execute d;
end
$m$;
