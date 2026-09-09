-- A better pen, when he wants one.
--
-- Grant: *"you were supposed to make these people pass the Turing test."*
--
-- The messages are written now rather than templated, and they vary, and every
-- number in them is checked against the facts they were built from. What they
-- are not, reliably, is good. Two previews of the same morning note:
--
--   "One decision is waiting on you. We logged 96 items yesterday, but 2
--    failed and 2 messages never arrived—that silence needs a quick check."
--
--   "Decision: review the two unsent messages that look like silence from you.
--    We closed 96 pieces of work yesterday, 2 failed, and the missing messages
--    need a look."
--
-- The first reads like a person. The second does not. Same prompt, same facts,
-- one run apart.
--
-- That gap is the model. Every model in the allow-list is an OpenRouter `:free`
-- variant, which is inference config A of decision D2 — still open, still
-- Grant's, and it costs money.
--
-- So the answer is a setting rather than an argument: name a model here and
-- everything a human reads is written by it, while every other call in the
-- system stays free. Empty is the default and means the ordinary failover
-- order.

begin;

insert into public.system_config (key, value, description)
values
  ('voice.writing_model', to_jsonb(''::text),
   'The model that writes what Grant reads — the morning note, and anything a '
   'staff member says to him. Empty means the ordinary free failover order, '
   'which varies a sentence adequately and writes a good one about half the '
   'time. Naming a paid model here changes only the writing path.')
on conflict (key) do nothing;

commit;
