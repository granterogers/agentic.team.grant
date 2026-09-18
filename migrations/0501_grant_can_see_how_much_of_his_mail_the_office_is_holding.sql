/*
  The disclosure that has to ship with the permission (#172, ADR-0038).

  0500 gave the office message bodies because Grant authorised it. An
  authorisation with no way to see what it produced is a setting with no
  reader — #15's defect, on the most personal corpus the office holds. He
  should be able to look at the page where he can disconnect Google and see,
  in one line, how many of his messages the office is currently holding the
  words of.

  `app.mail_bodies_held` already counts it and 0500 gave it a PostgREST wrapper
  nothing needed. That wrapper is dropped here rather than left: a public
  wrapper exists so a browser can call a function directly, the browser calls
  `hq_connections`, and an unreachable wrapper is 0298's registry row with a
  friendlier face. `check:callers` named it within a minute of it existing,
  which is the check doing its job.

  Spliced from the live definition rather than rewritten. CLAUDE.md records
  what rewriting `app.pause_job` from memory cost.
*/

drop function if exists public.mail_bodies_held();

do $splice$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'hq_connections';
  if v_def is null then
    raise exception 'app.hq_connections is gone, so this splice would be silent';
  end if;

  /*
    One key added beside `rows`, at the same level, so the page's existing
    reader is untouched. The whole object is replaced rather than patched
    because `jsonb_build_object` is one expression: the anchor is the closing
    brace of that object, and it is asserted rather than assumed.
  */
  if position('''rows'', (' in v_def) = 0 then
    raise exception 'hq_connections no longer builds a rows key, so this splice would land wrongly';
  end if;

  v_def := replace(
    v_def,
    '''checked_at'', (select max(checked_at) from public.connection_health),',
    '''checked_at'', (select max(checked_at) from public.connection_health),' || chr(10) ||
    '      -- What of Grant''s correspondence the office is holding the words' || chr(10) ||
    '      -- of, right now (#172, ADR-0038). Beside the credential that makes' || chr(10) ||
    '      -- it possible, because that is where he would go to stop it.' || chr(10) ||
    '      ''mail_bodies'', app.mail_bodies_held(),'
  );

  if position('mail_bodies' in v_def) = 0 then
    raise exception 'the splice did not land — hq_connections would be unchanged and this migration silent';
  end if;

  -- pg_get_functiondef emits no trailing semicolon. Third time in this
  -- repository; CLAUDE.md records the two before it.
  execute v_def || ';';
end
$splice$;
