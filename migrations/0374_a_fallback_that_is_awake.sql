-- 0374 — a fallback that is awake
--
-- 0373 put one paid model in front of the free ones and left the free ones as
-- the fallback. verify:router found the hole in that within the hour: inject a
-- failure on the first candidate and the next two are free models whose daily
-- allowance is spent, so the office had a failover path that could not answer.
--
-- Worse than a missing fallback, because it reads as present. The registry
-- listed eight usable models and the router would walk three of them.
--
-- The failure is not hypothetical either. Pinned to its cheapest upstream host,
-- the chosen model returned `429 queue_timeout` from AkashML earlier the same
-- afternoon; 0373's companion change lets OpenRouter pick another HOST for the
-- same model, and this one gives the office another MODEL when every host for
-- the first is refusing at once.
--
-- Both are probed, both answered the same two-part instruction correctly, both
-- sit far inside the budget columns 0373 added:
--
--   qwen/qwen3.7-flash                        http 200 via Alibaba, 9.5s
--                                             cost 0.00011091, 70 in / 837 out
--   mistralai/mistral-small-3.2-24b-instruct  http 200 via Venice, 0.6s
--                                             cost 0.0000079, 63 in / 8 out
--
-- They are deliberately from three different families with three different
-- upstream host sets. A fallback that fails for the same reason as the thing
-- it is backing up is not a fallback; this repository has the same lesson
-- written about checks that restate a definition instead of calling it.
--
-- Priorities leave gaps of ten so a model can be slotted between two without
-- renumbering the rest.

insert into public.provider_models
  (provider, model_id, status, pricing_prompt, pricing_completion, priority, last_success_at)
values
  ('openrouter', 'qwen/qwen3.7-flash', 'usable', '0.00000003', '0.00000013', 20, now()),
  ('openrouter', 'mistralai/mistral-small-3.2-24b-instruct', 'usable', '0.000000075', '0.0000002', 30, now())
on conflict (provider, model_id) do update
  set status               = 'usable',
      pricing_prompt       = excluded.pricing_prompt,
      pricing_completion   = excluded.pricing_completion,
      priority             = excluded.priority,
      last_success_at      = excluded.last_success_at,
      consecutive_failures = 0,
      last_error           = null;
