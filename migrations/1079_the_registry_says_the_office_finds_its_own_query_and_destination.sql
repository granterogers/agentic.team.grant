begin;

-- The office does not ask Grant for a Gmail search term, a Notion workspace or an owner it can find itself (COS-121,
-- COS-122; Canary incident 15 October 2026, 15:45: "I need a precise Gmail search term (or label)", "I need to know
-- which Notion workspace", "I need the preferred assignee").
--
-- The capability registry is what every prompt says about a tool (`src/agents/capability.ts`: each enabled tool's
-- description appears in the brief). Those three descriptions said what the tool does and nothing about who supplies
-- its inputs, so the model asked for them. `task.create` already states the rule ("never ask for more than a title");
-- this brings the Gmail and Notion rows to the same standard.
--
-- What changed, and only this: the descriptions of gmail.search, gmail.read and notion.write. No permission, level,
-- enablement or delivery changes. A tool's authority is unchanged; only what the model is told about its inputs.

update public.tool_permissions
   set description = 'Search Gmail. You write the query yourself from the objective and the people and organisations in it, and refine it until it finds the thread. Never ask Grant for a search term or label.'
 where tool = 'gmail.search';

update public.tool_permissions
   set description = 'Read Gmail messages you found. You choose which messages to read from your own search. Never ask Grant which emails to read.'
 where tool = 'gmail.read';

update public.tool_permissions
   set description = 'Create and update Notion pages: a page in a database, blocks appended to a page, properties changed. No deletion; the worst a mistake can be is a page to archive. Where a page goes: the Notion database the project is attached to. Never ask Grant which workspace. If none is attached, say so and carry on with the rest.'
 where tool = 'notion.write';

commit;
