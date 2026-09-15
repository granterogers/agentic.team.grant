-- Three capabilities advertised to all eight agents that no user request can reach.
--
-- Issue #231, Campaign Three, §11: "If a capability is advertised but cannot
-- actually be reached from a user request: FAIL. Either wire it properly or
-- stop advertising it until it is real."
--
-- `npm run matrix` put 24 of 120 applicable cells in the ADVERTISED-ONLY state,
-- and all 24 are these three capabilities times eight people. Each was checked
-- by tracing from a user request rather than by reading the registry:
--
--   github.read   src/github/api.ts is real and `verify:github` proves it, and
--                 its ONLY importer is that suite. No handler, no job kind, no
--                 planner step. `mcp_calls` -- the table its delivered_by
--                 names -- has never held a row.
--
--   gmail.draft   `src/google/mail.ts` exports `parseFrom` and `refreshMail`
--                 and NOTHING ELSE. The delivered_by says "draft only" and the
--                 function it describes does not exist. Worse than the first:
--                 the claim names an implementation that was never written.
--
--   note.create   `notebook.push_document` IS a registered handler, correctly
--                 built, and nothing enqueues it. The nine artefacts a planner
--                 can request are all NotebookLM generations; pushing a
--                 document is not among them, so no sentence Grant can type
--                 produces one.
--
-- This is 0298's defect in three new places. `capabilityBrief` reads this table,
-- so every agent has been told it can read GitHub, draft mail and push notes --
-- and #64's asymmetry applies: being told NO about something possible costs a
-- feature request, and being told YES about something impossible costs the
-- work, silently, and Grant finds out when nothing arrives.
--
-- DISABLED, NEVER DELETED -- 0298's rule. A listed gap can become a proposal
-- (#49); a deleted one cannot. Each keeps its delivered_by so the next person
-- knows exactly how much of it already exists.

update public.tool_permissions
   set enabled = false,
       disabled_reason =
         'no route from a user request. src/github/api.ts is real and tested by '
         'verify:github, and its only importer is that suite - there is no handler, '
         'no job kind and no planner step, so nothing Grant can type reaches it. '
         'Wire a job kind and re-enable; until then saying otherwise is #64.'
 where tool = 'github.read';

update public.tool_permissions
   set enabled = false,
       disabled_reason =
         'not implemented. src/google/mail.ts exports parseFrom and refreshMail and '
         'nothing else - there is no draft writer, and the description claimed one. '
         'gmail.send stays off by policy; this one is off because it does not exist.'
 where tool = 'gmail.draft';

update public.tool_permissions
   set enabled = false,
       disabled_reason =
         'no route from a user request. The notebook.push_document handler is '
         'registered and correct, and nothing enqueues it: the nine artefacts a '
         'planner can request are all NotebookLM generations. Closest of the three '
         'to being real - it needs a way to ask, not an implementation.'
 where tool = 'note.create';
