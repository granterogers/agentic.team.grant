begin;

-- ---------------------------------------------------------------------------
-- 0399 - the office knows it can pull tasks out of a document (#130, #64)
--
-- `capabilityBrief` builds every agent's prompt from `tool_permissions`. A
-- capability that exists and is not listed there is one the office will tell
-- Grant it cannot do - #64's defect, and the cheap direction of being wrong:
-- being told no about something possible costs a feature request, while being
-- told yes about something impossible costs the work silently.
--
-- `delivered_by` names what performs it, which 0298 added precisely so a
-- registry row cannot claim a capability with nothing behind it. That row was
-- `web.search`: level 0, ENABLED, listed on all eight sheets, and nothing in
-- the repository implementing it.
--
-- The description says what the capability NEEDS, not merely that it exists.
-- 0368's lesson: `task.create` was four words, and an agent invented a
-- four-field intake form twice in two sessions because nothing said otherwise.
-- So this one states the two things that are actually true and easy to get
-- wrong - it reads what the office already HOLDS, and it creates the tasks
-- rather than listing them.
-- ---------------------------------------------------------------------------

insert into public.tool_permissions (tool, level, description, enabled, verbs, delivered_by)
values (
  'task.extract',
  1,
  'Find the things that need doing inside a document the office has already '
  'read, and create them as tasks. Say which document - "the pricing brief" is '
  'enough, it is matched on the title - or say nothing and it reads what the '
  'project holds. It only reads material already IN the office: if it is in a '
  'notebook or a Drive folder nobody has brought in, say so first. It CREATES '
  'the tasks rather than listing them for approval, and offers one undo for '
  'the batch, so never promise a list to confirm.',
  true,
  array['pull the tasks out of a document and create them on the project'],
  'office.extract_tasks'
)
on conflict (tool) do update
  set description  = excluded.description,
      verbs        = excluded.verbs,
      delivered_by = excluded.delivered_by,
      enabled      = true;

commit;
