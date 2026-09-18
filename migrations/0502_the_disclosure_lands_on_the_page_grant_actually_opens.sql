/*
  0501 put the mail-body disclosure on the wrong payload (#172, ADR-0038).

  It spliced `mail_bodies` into `app.hq_connections`, which is a real gateway
  section and is NOT the one the studio reads: the Connections pane is filled
  by `hq_studio_settings`, and `read('connections')` appears nowhere in
  `web/studio`. So the disclosure was correct, reachable by API, and invisible
  to the only person it is for — CLAUDE.md's own "a gateway section no page
  reads", committed by somebody who had read that entry.

  Found by grepping the page for the call rather than for the noun, which is
  the rule that entry gives. 0501 is left as it is: it is not wrong, an applied
  migration is immutable, and an extra key on an API section costs nothing.

  Spliced from the live definition. `pg_get_functiondef` emits no trailing
  semicolon — fourth time in this repository.
*/

do $splice$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'hq_studio_settings';
  if v_def is null then
    raise exception 'app.hq_studio_settings is gone, so this splice would be silent';
  end if;

  if position('''connections'', (select v from connections),' in v_def) = 0 then
    raise exception 'the connections key has moved, so this splice would land wrongly';
  end if;

  v_def := replace(
    v_def,
    '''connections'', (select v from connections),',
    '''connections'', (select v from connections),' || chr(10) ||
    '    -- What of Grant''s correspondence the office is holding the WORDS of' || chr(10) ||
    '    -- (#172, ADR-0038). Beside the credential that makes it possible,' || chr(10) ||
    '    -- because the Connections pane is where he would go to stop it. An' || chr(10) ||
    '    -- authorisation with nothing showing what it produced is a setting' || chr(10) ||
    '    -- with no reader, which is #15''s defect on the most personal corpus' || chr(10) ||
    '    -- the office holds.' || chr(10) ||
    '    ''mail_bodies'', app.mail_bodies_held(),'
  );

  if position('mail_bodies' in v_def) = 0 then
    raise exception 'the splice did not land, so this migration would be silent';
  end if;

  execute v_def || ';';
end
$splice$;
