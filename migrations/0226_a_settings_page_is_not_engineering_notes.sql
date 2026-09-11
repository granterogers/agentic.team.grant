-- A settings page is not engineering notes.
--
-- Issue #68. The Connections pane rendered `knowledge_connectors.notes`, which
-- is where the engineering reasoning lives:
--
--     "A document handed to the system with no external system behind it.
--      external_ref is null, which is why the uniqueness index is partial."
--
--     "github.write is registered at risk 3 and disabled (§13).
--      github.dispatch_token authenticates as granterogers; scoped to this
--      repository only…"
--
-- Both true, both worth keeping, and neither is a sentence for the person
-- deciding whether Drive is working. They also made the cards wildly uneven —
-- one four hundred characters long beside one of forty.
--
-- The notes stay exactly where they are. What the page gets is a short line
-- saying what the connector is FOR, which is the question a settings card
-- answers. Written here rather than truncating the notes, because truncating
-- prose produces a sentence that stops mid-clause and looks like a bug.

begin;

create or replace function app.connector_purpose(p_connector text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case lower(coalesce(p_connector, ''))
    when 'notebooklm' then 'Reads the source corpus, and makes the audio overviews.'
    when 'notion'     then 'Where project pages, docs and tasks are mirrored.'
    when 'drive'      then 'A folder per project, watched for anything that lands in it.'
    when 'github'     then 'Reads this repository — issues, code and releases.'
    when 'upload'     then 'Anything handed straight to the office, with no service behind it.'
    when 'mcp'        then 'Lets Claude and ChatGPT read the office directly.'
    when 'gmail'      then 'Reads mail. Sending needs your say-so.'
    when 'calendar'   then 'Your day, refreshed hourly.'
    when 'slack'      then 'The office floor — a channel per project.'
    else ''
  end
$$;

comment on function app.connector_purpose(text) is
  'One line saying what a connector is FOR, for the settings card (#68). '
  'knowledge_connectors.notes is engineering reasoning and stays that way; '
  'truncating it produced sentences that stopped mid-clause.';

commit;
