-- 0088 — Two messages, one instruction
--
-- Grant sent a voice note to Emma — *"push this video into a new notebook
-- project called AI Learning, then find me the transcription and report back
-- all the repositories that are mentioned"* — and, as a separate message, the
-- link. That is how sharing works on a phone: tap Share on the video, pick the
-- chat, then say what you want done with it.
--
-- The system read them as two instructions. The bare link became "deal with
-- this", which is the correct reading of a bare link, and with one active
-- project it went into that project. The voice note arrived without a URL and
-- described work on a video the handler could not see. Both halves behaved
-- correctly; the result was the video in the wrong notebook and the plan never
-- formed.
--
-- This column is what stops the fix from doing the work twice. When two
-- commands are joined, both are marked, so neither is re-read as an
-- instruction of its own on a later drain.

begin;

alter table public.inbound_commands
  add column paired_with uuid references public.inbound_commands (command_id);

comment on column public.inbound_commands.paired_with is
  'The other half of this instruction, when a link and its instruction arrived '
  'as separate messages. Set on BOTH rows: a message consumed as half of '
  'something else must not be acted on again alone.';

create index inbound_commands_pairable
  on public.inbound_commands (origin_channel, received_at desc)
  where paired_with is null and callback_action is null;

commit;
