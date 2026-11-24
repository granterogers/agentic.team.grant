-- 1107 — the activity feed reads an office's newest events in order (Q7, 21 November 2026)
--
-- app.hq_studio_lately takes the newest events of an office, filters them, and keeps the first few hundred. The office index
-- (events_office_idx) finds the office's rows but not their order, so the feed read about 24,000 rows, ran two helper
-- checks on each, and sorted the lot: about 1.3 seconds of a 3.2 second feed. With this index the newest rows come out
-- already in order and the read stops once it has enough. Nothing about the feed's answer changes.
--
-- Plain index, no data changes. Reversible: drop index public.events_office_time_idx.

create index if not exists events_office_time_idx
  on public.events (office_id, occurred_at desc);
