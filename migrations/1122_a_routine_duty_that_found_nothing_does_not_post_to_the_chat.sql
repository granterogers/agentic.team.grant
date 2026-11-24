-- 1122 — a routine duty that found nothing does not post to the project chat (Cowork test of 24 November 2026, 0.116.1)
--
-- The project chat showed "Nothing to remind you about.", "No Drive folders are attached to a live project." and "Mail refreshed: 17
-- messages." every five to fifteen minutes. The duties were right to find nothing; the thread was wrong to show it. The reminder,
-- Drive and mail duties now mark a quiet run as not announced (in code), and this function leaves those quiet outputs out of the
-- conversation. A reminder that is due, a Drive file that was read, and mail that was pruned or forgotten are still shown.
--
-- The live definition is read, one line is replaced, and the result is run back. A definition that does not hold the line exactly
-- once is refused.

do $m$
declare
  v text;
  old_line text := $o$       and not app.harness_job(j.job_id)$o$;
  new_line text := $n$       and not app.harness_job(j.job_id)
       and not (j.kind in ('tasks.remind', 'drive.watch', 'google.read_mail') and coalesce(j.announce, true) = false)$n$;
  hits int;
begin
  v := pg_get_functiondef('app.conversation_history(uuid,uuid,integer,timestamp with time zone)'::regprocedure);
  -- The new text contains the old line, so the new text is looked for first.
  if position(new_line in v) > 0 then
    return; -- already applied
  end if;
  hits := (length(v) - length(replace(v, old_line, ''))) / length(old_line);
  if hits <> 1 then
    raise exception 'app.conversation_history: the harness line was found % times, expected once', hits;
  end if;
  v := replace(v, old_line, new_line);
  execute v;
end
$m$;
