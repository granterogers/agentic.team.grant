-- What a capability NEEDS, not just that it exists.
--
-- Issue #237. `capabilityBrief` builds every agent's prompt from
-- `tool_permissions`, and the description of the one write an agent can make
-- was four words: "Create an internal task". So the model filled the gap
-- itself, and invented an intake form that does not match the function:
--
--   "Sure, I'll create it. I need a few details first:
--    1. Title  2. Due date  3. Owner  4. Parent task (if any)"
--
--   "I'll create a task for Ruby... Give me the project, the date, and any
--    parent you want attached."
--
-- A task needs a TITLE. `due_on` and `assignee_staff` are nullable and default
-- null in the writer, the project comes from the job, and a PARENT TASK IS NOT
-- A PARAMETER AT ALL -- it was invented twice, in two different sessions,
-- because nothing said otherwise.
--
-- This is #64's family: what an agent says about itself has to match what it
-- can do. 0298 added `delivered_by` so a registry row could not CLAIM a
-- capability with nothing behind it; this is the same table telling the truth
-- about the shape of the ones that are real.
--
-- Written as data rather than into the prompt builder, deliberately: Grant
-- edits this table, and a sentence about what a tool needs is exactly the kind
-- of thing that changes when the tool does.

update public.tool_permissions
   set description =
     'Create a task on the dashboard. It needs a TITLE and nothing else - the '
     'project comes from the conversation, a due date and an owner are optional, '
     'and there is no such thing as a parent task. Never ask for more than a '
     'title, and never say you have created one unless the office tells you it '
     'did.'
 where tool = 'task.create';

update public.tool_permissions
   set description =
     'Write a draft. Every answer you give is already a draft until it is '
     'reviewed - you do not need to do anything to invoke this.'
 where tool = 'draft.create';

-- And the two that were most often described in the first person as already
-- done. The wording is about WHEN, because that is the part the model gets
-- wrong: it reports sending as past tense while the message has not left.
update public.tool_permissions
   set description =
     'Post into Slack. This happens AFTER your answer, through the channel '
     'adapter, and never while you are writing - so never say you have posted, '
     'messaged or notified anybody. Say what you will do, or hand the work over.'
 where tool = 'slack.post';
