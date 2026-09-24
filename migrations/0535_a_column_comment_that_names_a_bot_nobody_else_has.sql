-- 0535 — a column comment that names a bot nobody else has, and the wrong person
--
-- `inbound_commands.addressed_to` is documented with an example:
--
--     "opening @atg_research_bot addresses Ines"
--
-- Two things are wrong with one clause, and the fresh-install baseline build
-- found the first while a query found the second.
--
-- 1. `@atg_research_bot` is one of GRANT'S Telegram bots. It is the only place
--    in the schema where a bot username survives into documentation, and it is
--    meaningless to anybody else: a second person installing this office
--    creates their own bots with their own names, and the example describes a
--    thing they cannot open.
--
-- 2. The research director is EMMA. There is nobody called Ines on the roster
--    and, as far as `public.staff` can say, there never has been. A comment is
--    the one part of a schema nothing checks, so a name in one can be wrong for
--    as long as nobody reads it aloud.
--
-- The replacement keeps what the comment is actually FOR — that addressing is
-- read from the surface rather than classified — and takes the example from the
-- roster's own vocabulary instead of from one installation's bots.
--
-- Nothing else changes. A comment is not behaviour, and a migration that
-- quietly altered behaviour while claiming to fix documentation would be worse
-- than the comment.

begin;

comment on column public.inbound_commands.addressed_to is
  'The staff member this was sent TO, when the surface carries that — opening '
  'the research director''s own bot addresses the research director. Null on '
  'surfaces that do not, like a Slack channel message. The router treats it as '
  'the roster rather than classifying one: choosing whose bot to open is a '
  'clearer signal than any classifier, and ignoring it would make the choice '
  'decorative.';

-- Drive it: the comment is what it now says, and names neither a bot nor a
-- person who does not exist. A comment cannot be asserted by behaviour, so the
-- assertion reads the catalogue.
do $drive$
declare v text;
begin
  select col_description('public.inbound_commands'::regclass, a.attnum) into v
    from pg_attribute a
   where a.attrelid = 'public.inbound_commands'::regclass
     and a.attname = 'addressed_to';

  if v is null then
    raise exception '0535: the comment did not survive';
  end if;
  if v ~ 'atg_[a-z]+_bot' then
    raise exception '0535: the comment still names a particular installation''s bot';
  end if;
  if v ~ '\mInes\M' then
    raise exception '0535: the comment still names somebody who is not on the roster';
  end if;
  -- CONTROL: and it still says the thing it exists to say, so this was a
  -- correction rather than a deletion.
  if v !~ 'roster' then
    raise exception '0535: the comment lost what it was for';
  end if;
end
$drive$;

commit;
