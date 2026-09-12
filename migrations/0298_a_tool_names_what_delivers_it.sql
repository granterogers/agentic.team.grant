-- 0298 — a tool names what delivers it, and web.search delivers nothing
--
-- Issues #50 and #51, and #64 one layer down.
--
-- ## What was found
--
-- `tool_permissions` lists `web.search`, level 0, **enabled**. Nothing in the
-- repository implements it. Not under that name, not under another — the only
-- tools any handler names are `notebook.read`, `notebook.write`, `notion.write`
-- and `calendar.write`, and no code path performs a web search at all.
--
-- `capabilityBrief` builds an agent's sheet from this table. So every agent has
-- been told, in its prompt, that it can search the web. Asked to research
-- something, the honest answer is *"I can look through what we hold"* and the
-- answer it would give is *"I'll search for that"*.
--
-- This is exactly #64 — *"Claire told Grant she cannot send Telegram buttons.
-- She can"* — with the sign reversed, and the reversed sign is worse. Being
-- told no about something possible costs a feature request. Being told yes
-- about something impossible costs the work, silently, and Grant finds out when
-- nothing arrives.
--
-- ## Why a column rather than a one-line fix
--
-- Turning `web.search` off closes today's instance and nothing else. The row
-- was wrong because **nothing in the schema required it to be true** — a tool
-- is registered by writing a row, and a row can claim anything.
--
-- `delivered_by` is what makes the claim checkable: every enabled tool has to
-- name the thing that performs it, and `npm run verify:tools` fails when one
-- does not. #51 asks for exactly this — *"the sheet distinguishes what is
-- reachable programmatically from what is not"* — and this is that distinction
-- as data rather than as a promise.
--
-- ## The office is not losing a capability here
--
-- It is losing a claim. Nobody could search the web before this migration
-- either. What changes is that agents stop being told they can, which makes
-- the gap sayable — and a sayable gap becomes a proposal (#49) rather than a
-- silence.

begin;

alter table public.tool_permissions
  add column if not exists delivered_by text not null default '';

comment on column public.tool_permissions.delivered_by is
  '#50/#51. What actually performs this tool — a job kind, a module, or the '
  'office itself for something the delivery layer does. An ENABLED tool with '
  'nothing here is a claim the office cannot honour, and `verify:tools` fails '
  'on it. Registering a tool is writing a row, and a row can claim anything; '
  'this is what makes the claim checkable.';

update public.tool_permissions set delivered_by = v.by
  from (values
    ('calendar.read',     'job kind google.read_calendar'),
    ('calendar.write',    'job kind google.write_calendar_tasks'),
    ('db.read',           'the office — every handler reads its own database directly'),
    ('draft.create',      'public.outputs — every handler''s result is a draft until reviewed'),
    ('github.read',       'src/github/api.ts'),
    ('gmail.read',        'job kind google.read_mail'),
    ('gmail.search',      'job kind google.read_mail'),
    ('gmail.draft',       'src/google/gmail.ts — draft only; gmail.send is disabled by policy'),
    ('note.create',       'job kind notebook.push_document'),
    ('notebook.read',     'job kinds notebook.ask and notebook.collect'),
    ('notebook.write',    'job kinds notebook.add_source and notebook.generate'),
    ('notion.write',      'job kinds office.notion_import and office.notion_sync'),
    ('preference.update', 'hq-api, the preference actions'),
    ('slack.post',        'src/slack/api.ts, through the channel adapter'),
    ('task.create',       'app.hq_task_add')
  ) as v(tool, by)
 where public.tool_permissions.tool = v.tool;

/*
  And the one that delivers nothing.

  Disabled rather than deleted: the row is the record that the office WANTS
  this reach, `disabled_reason` is what an agent reads instead of a false yes,
  and #49 can turn a repeated need for it into a proposal. Deleting it would
  make the gap unsayable again, which is how it stayed invisible.
*/
update public.tool_permissions
   set enabled = false,
       delivered_by = '',
       disabled_reason =
         'Nothing implements this. The row claimed reach the office does not '
         'have, and every agent''s capability sheet repeated the claim — so an '
         'agent asked to research something would say it would search the web '
         'and then not. It stays listed, disabled, because the office genuinely '
         'wants it: a listed gap can become a proposal (#49), a deleted one '
         'cannot. Re-enable it in the same change that implements it.'
 where tool = 'web.search';

/*
  The rule, as a constraint, so the next tool cannot be registered as a claim.

  NOT VALID would be the cautious choice and is the wrong one here: the whole
  point is that the existing rows are now honest, and validating proves it
  rather than assuming it.
*/
alter table public.tool_permissions
  drop constraint if exists tool_enabled_means_delivered;
alter table public.tool_permissions
  add constraint tool_enabled_means_delivered
  check (not enabled or btrim(delivered_by) <> '');

commit;
