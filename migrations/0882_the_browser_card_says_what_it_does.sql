-- The Settings card for the browser said "Not built yet - tracked as issue 16... off because nothing can do it".
-- The browser tier exists: the office can open a page, read it and take a screenshot, with a stored session for a site
-- it has been given. It cannot click, type, submit or sign in on its own (src/browser/adapter.ts says so). A card
-- claiming nothing can do it told Grant the opposite of the product, and a documented excuse stops the next person
-- looking. The switch stays unsettable and off, because there is still no way to let an agent DRIVE a browser.
--
-- Spliced from the live definition, anchored exactly once, so nothing else in the function changes.
do $m$
declare
  v_def text;
  v_old constant text := $o$'note', 'Not built yet — tracked as issue 16. Shown because it is coming, '
                'and off because nothing can do it.'),$o$;
  v_new constant text := $n$'note', 'The office can open a page, read it and take a screenshot, using a '
                'signed-in session you have given it for that site. It cannot click, type, submit or sign '
                'in by itself, so there is nothing here to switch on.'),$n$;
  v_n int;
begin
  v_def := pg_get_functiondef('app.hq_studio_settings(uuid)'::regprocedure);
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then
    raise exception 'anchor occurs % times, expected exactly 1', v_n;
  end if;
  execute replace(v_def, v_old, v_new);
end
$m$;
