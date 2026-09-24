-- An example in a comment is still his chat id, and it ships in the schema.
--
-- 0547 explains how a conversation is derived from `origin_ref`, and it does
-- what a good comment does: it gives an example. The example is real.
--
--     The conversation is the FIRST segment of origin_ref, which is what the
--     Slack branch above already assumes: 1386648496:325 is a chat and a
--     message, C0BVD21Q9S5:1790016258.057200 is a channel and a timestamp.
--
-- 1386648496 is Grant's Telegram chat. C0BVD21Q9S5 is a real Slack channel of
-- his. Both sit inside the BODY of app.enqueue_inbound, so they are part of
-- the schema -- and the fresh-install baseline captures the schema, so a
-- stranger installing this office would arrive holding them.
--
-- The baseline build is what found it, and it refused rather than shipping:
-- "a baseline carrying somebody else's identifiers is worse than no baseline,
-- because it would be installed without being read." Neither branch is wrong
-- alone. The comment is good and the scanner is right, and only integration
-- puts them in the same room.
--
-- Nothing about the function changes. The definition is spliced from the LIVE
-- one rather than transcribed, because this is a 9,000-character function and
-- the alternative is retyping it to alter twenty-two characters -- which
-- CLAUDE.md records as the way to lose four behaviours in one go.
--
-- The replacements are obviously invented: a Telegram chat id is numeric, so
-- the stand-in is numeric, and it is a repeated digit no account has. That is
-- the point of an example.

do $$
declare
  v_src text;
  v_next text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'enqueue_inbound';
  if v_src is null then
    raise exception '0595: app.enqueue_inbound is missing';
  end if;

  if position('1386648496' in v_src) = 0 and position('C0BVD21Q9S5' in v_src) = 0 then
    raise notice '0595: the example was already anonymous - nothing to do';
    return;
  end if;

  v_next := replace(v_src, '1386648496:325', '4242424242:325');
  v_next := replace(v_next, 'C0BVD21Q9S5:1790016258.057200', 'C000EXAMPLE0:1790016258.057200');

  if v_next = v_src then
    raise exception '0595: the example has been reworded - splice matched nothing';
  end if;

  -- pg_get_functiondef emits no trailing semicolon. Twice recorded, twice paid.
  execute v_next || ';';
end $$;

-- Drive it. Reading a migration proves it parses.
do $$
declare
  v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'enqueue_inbound';

  if position('1386648496' in v_src) > 0 then
    raise exception '0595: his chat id is still in the function body';
  end if;
  if position('C0BVD21Q9S5' in v_src) > 0 then
    raise exception '0595: his Slack channel is still in the function body';
  end if;

  -- AND THE CONTROL: the explanation must still be there. A splice that
  -- removed the paragraph would pass the two checks above and cost the reader
  -- the one thing the comment was for.
  if position('The conversation is the FIRST segment of origin_ref' in v_src) = 0 then
    raise exception '0595: the explanation went with the example';
  end if;
  if position('4242424242:325' in v_src) = 0 then
    raise exception '0595: the example was removed rather than replaced';
  end if;
end $$;
