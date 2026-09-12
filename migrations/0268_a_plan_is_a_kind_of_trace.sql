-- 0268 — `plan` is a kind of trace
--
-- 0257 fixed the trace kinds to seven: prompt, model, tool, retrieval,
-- decision, degradation, note. 0267 added an eighth thing worth recording — the
-- plan a write-capable job makes before it acts (#131) — and the worker writes
-- it as `plan`.
--
-- The CHECK would refuse it. And `trace()` swallows every failure by design,
-- for a good reason (a job that completed and then died writing a note about
-- completing would be the worst bug available here) — so the refusal would be
-- silent and every plan trace would vanish without a word. A check that passes
-- for the wrong reason, arrived at from the other direction.
--
-- `note` would have worked and is wrong: a plan is the one trace you want to
-- filter on, because it is the only one that says what was about to happen to
-- something outside the office.

begin;

alter table public.job_traces drop constraint job_traces_kind_known;
alter table public.job_traces add constraint job_traces_kind_known check (kind in
  ('prompt', 'model', 'tool', 'retrieval', 'decision', 'degradation', 'note', 'plan'));

commit;
