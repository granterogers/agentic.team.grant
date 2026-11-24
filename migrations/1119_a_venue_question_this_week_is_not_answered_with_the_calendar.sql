-- 1119 — "this week" alone does not send a question to the calendar (stress test of 24 November 2026, 0.112.0)
--
-- app.voice_answer's calendar branch matched "this week" on its own, so "What should I do about the venue booking this week?"
-- was answered "The calendar is connected but nothing has been read from it yet." (efficacy baseline T5), without the team.
-- The branch keeps every phrase that means the calendar or the diary and drops the bare "this week". "What have I got on this
-- week" still reaches the calendar through "got on", and the week is still read from the question as before.
--
-- The live definition is read, the one line is replaced, and the result is run back. A definition that does not hold the line
-- exactly once is refused.

do $m$
declare
  v text;
  old_line text := $o$if g ~ '\m(calendar|diary|schedule|meetings?|agenda|got on|free|busy today|this week)\M' then$o$;
  new_line text := $n$if g ~ '\m(calendar|diary|schedule|meetings?|agenda|got on|free|busy today)\M' then$n$;
  hits int;
begin
  v := pg_get_functiondef('app.voice_answer(uuid,uuid)'::regprocedure);
  hits := (length(v) - length(replace(v, old_line, ''))) / length(old_line);
  if hits = 0 and position(new_line in v) > 0 then
    return; -- already applied
  end if;
  if hits <> 1 then
    raise exception 'app.voice_answer: the calendar line was found % times, expected once', hits;
  end if;
  v := replace(v, old_line, new_line);
  execute v;
end
$m$;
