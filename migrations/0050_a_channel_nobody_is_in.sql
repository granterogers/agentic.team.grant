-- 0050 — a channel Grant is not in is a channel he never reads
--
-- The office provisioned its first real project channel today, posted a
-- correctly attributed, correctly labelled result into it with all six §12
-- buttons, and Grant saw nothing. The bot created the channel, so the bot was
-- its only member. Every one of the 56 checks in `verify:slack` passed, because
-- each of them asks whether the MESSAGE arrived — and it did, into a room with
-- one occupant.
--
-- That is this project's recurring defect wearing yet another costume: a check
-- whose result does not depend on the thing it is meant to establish. "Was it
-- delivered" and "was it delivered to somebody" are different questions, and
-- only the second one is §12's.
--
-- So the provisioner invites the human. It needs to know who that is, and a
-- Slack user id is not derivable from anything already stored: the workspace
-- has exactly one human, but "the only member who is not a bot" is a rule that
-- silently picks a stranger the day a second person joins.
--
-- Not a secret — a user id is public within the workspace, appears in every
-- mention, and is read by application code that has no vault access. It sits
-- in `system_config` beside the timezone and the avatar host for that reason.

begin;

insert into public.system_config (key, value, description, self_adjustable)
values (
  'slack.subject_user_id',
  '"U0BUNF6AALC"'::jsonb,
  'Slack user id for Grant. Invited to every channel the app provisions, because a channel the human is not in is a channel that receives results nobody reads. Not a secret: a user id is public within the workspace.',
  false
)
on conflict (key) do update
  set value = excluded.value,
      description = excluded.description;

commit;
