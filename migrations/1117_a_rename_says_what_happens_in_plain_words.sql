-- 1117 — a rename says what happens, in plain words (stress test of 23 November 2026, copy)
--
-- The rename answer said "channels will be renamed by the worker on its next pass": internal wording, in lower case, shown as a toast.
-- The sentence is changed in the live definition of app.hq_rename_project and nothing else. The function is taken as it is in the
-- database, the one sentence is replaced, and the result is run back. A definition that no longer holds the sentence is left alone.

do $m$
declare
  v text;
begin
  v := pg_get_functiondef('app.hq_rename_project(uuid,text,text)'::regprocedure);
  if position('channels will be renamed by the worker on its next pass' in v) > 0 then
    v := replace(v,
      'channels will be renamed by the worker on its next pass',
      'Slack and Telegram channels will update within a minute');
    if position('channels will be renamed by the worker on its next pass' in v) > 0 then
      raise exception 'app.hq_rename_project: the sentence did not change';
    end if;
    execute v;
  end if;
end
$m$;
