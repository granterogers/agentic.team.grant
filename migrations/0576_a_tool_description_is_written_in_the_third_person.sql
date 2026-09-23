/*
  "Permanently destroys the archive" read as a WRITE, not as destructive.

  `app.guess_reach` classifies a discovered MCP tool from its name and its
  description, and `app.offer_mcp_tool` turns that verdict into an authority
  level - its own comment says *"the level follows the REACH, and `unknown` is
  treated as a write"*, with `destructive` becoming level 3. That matters:
  `autonomy_policy` carries `check (action_level < 3 or verdict <> 'proceed')`,
  so a level-3 action can never resolve to proceed, and a trigger refuses a
  standing authorization on one. A write can have both.

  The four vocabularies are matched with `\m(delete|destroy|...)\M`, which
  demands the exact word. A tool DESCRIPTION is written in the third person -
  it is how Slack, Notion and every API reference in the world writes one:

      Delete every record it touches      -> destructive   (imperative)
      Deletes every record it touches     -> UNKNOWN
      Permanently destroys the archive    -> UNKNOWN
      Wipes all local state               -> UNKNOWN
      Charges the customer card           -> UNKNOWN
      Sends a message to the channel      -> UNKNOWN
      Creates a page                      -> UNKNOWN

  So the commonest form of the commonest sentence in a tool description was
  invisible to the half of the classifier that reads it. The function itself
  is right - it takes `greatest(by_name, by_description)`, so a reassuring
  description can never soften a destructive name, and that property is
  asserted below. Only the vocabulary was too narrow.

  `public.mcp_discovered_tools` holds ZERO rows, so nothing has been
  misclassified yet. This is the defect waiting for its first MCP provider,
  which is the shape no query over history can find.

  ## Why widening is safe here, and which direction it errs in

  Adding the third person can only ever ESCALATE a verdict: a description that
  matched nothing now matches something, and `greatest` takes the more
  dangerous reading. A false escalation costs a human decision on a
  third-party tool nobody has vetted, which is the correct default; a false
  RELAXATION would hand a standing authorization to something that deletes.

  The `looks` group takes `(?:es|s)?` because "searches" and "fetches" need
  the `es`. "queries" still will not match, and that is deliberate: failing to
  recognise a READ leaves the tool `unknown`, which `offer_mcp_tool` treats as
  a write - more conservative, not less.
*/

do $patch$
declare
  v_src text := pg_get_functiondef('app.guess_reach'::regproc);
  v_new text;
begin
  v_new := replace(v_src,
    '''\m(delete|destroy|remove|purge|drop|wipe|revoke|cancel|uninstall|terminate)\M'' as gone',
    '''\m(delete|destroy|remove|purge|drop|wipe|revoke|cancel|uninstall|terminate)s?\M'' as gone');
  v_new := replace(v_new,
    '''\m(pay|charge|order|purchase|buy|invoice|transfer|wire|refund|subscribe)\M'' as money',
    '''\m(pay|charge|order|purchase|buy|invoice|transfer|wire|refund|subscribe)s?\M'' as money');
  v_new := replace(v_new,
    '''\m(send|post|create|update|write|add|set|put|patch|upload|publish|invite)\M'' as writes',
    '''\m(send|post|create|update|write|add|set|put|patch|upload|publish|invite)s?\M'' as writes');
  v_new := replace(v_new,
    '''\m(get|list|read|search|find|fetch|query|show|describe|lookup|count)\M'' as looks',
    '''\m(get|list|read|search|find|fetch|query|show|describe|lookup|count)(?:es|s)?\M'' as looks');

  if v_new = v_src then
    raise exception 'the splice matched nothing — guess_reach''s vocabularies have been reworded';
  end if;
  execute v_new || ';';
end
$patch$;

do $drive$
declare
  r record;
begin
  /* The third person now reads as what it says. */
  for r in
    select * from (values
      ('Deletes every record it touches', 'destructive'),
      ('Permanently destroys the archive', 'destructive'),
      ('Wipes all local state',            'destructive'),
      ('Removes the contact from the list','destructive'),
      ('Charges the customer card',        'destructive'),
      ('Sends a message to the channel',   'write'),
      ('Creates a page',                   'write')
    ) as t(descr, want)
  loop
    if (app.guess_reach('notes.sync', r.descr) ->> 'reach') <> r.want then
      raise exception '% read as % and should be %',
        r.descr, app.guess_reach('notes.sync', r.descr) ->> 'reach', r.want;
    end if;
  end loop;

  /* The imperative still does, so nothing was traded away. */
  if (app.guess_reach('notes.sync', 'Delete every record') ->> 'reach') <> 'destructive' then
    raise exception 'the imperative form stopped working';
  end if;

  /*
    THE SECURITY PROPERTY, which is the one that must never move: a
    reassuring description cannot soften a destructive NAME.
  */
  if (app.guess_reach('delete_all_contacts', 'Perfectly safe, read only, nothing is removed')
        ->> 'reach') <> 'destructive' then
    raise exception 'A DESCRIPTION SOFTENED A DESTRUCTIVE NAME';
  end if;

  /* And a plainly read-only tool is still not called destructive. */
  if (app.guess_reach('contact.read', 'Reads a contact') ->> 'reach') = 'destructive' then
    raise exception 'a read tool was escalated to destructive';
  end if;
end
$drive$;
