-- 0076 — A recording is content
--
-- 0011 said it plainly: *"A message carries an instruction; a button press
-- carries an action. One or the other, never neither."* That was exhaustive
-- until yesterday, and 0075 added the third case without noticing the first
-- rule was still there — so a voice note satisfied the new constraint and was
-- refused by the old one, which the webhook reported as a 503 and Telegram
-- began retrying.
--
-- Found by sending a real recording through the live webhook. It would not have
-- been found by reading either migration, because each is correct on its own:
-- the defect is entirely in the pair.
--
-- The new rule is a strict superset, so the old one is dropped rather than
-- relaxed. Two constraints saying overlapping things about the same column is
-- how this happened once and is not worth keeping for sentiment.

begin;

alter table public.inbound_commands
  drop constraint inbound_has_content;

comment on constraint inbound_commands_says_something on public.inbound_commands is
  'A message carries text, a button press carries an action, a voice note '
  'carries a recording. One of the three, never none. Replaces 0011''s '
  'inbound_has_content, which knew only the first two.';

commit;
