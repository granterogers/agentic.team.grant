-- 0600 - A question is asked once, whatever became of it (#371, residual 2).
--
-- `askUnasked` in src/jobs/worker.ts is the recovery half of R46: it asks a
-- paused job's question when the worker died before asking. Its only record of
-- having asked was a row in `deliveries` - and a notifier that finds no
-- destination, or that the sending gate refuses, writes no row. So the sweep
-- asked again on every tick, for ever, and on the refusing branch appended an
-- impediment each time to a ledger that refuses DELETE. Reproduced in
-- isolation: `sweepCallsPerTick [1,1,1]`, 0 delivery rows.
--
-- "Was it sent" and "did we try" are different facts and only the first had a
-- column. `asked_at` is the second: when the office last tried to put this
-- question in front of him, whatever the outcome. The worker stamps it after
-- every attempt, inline or from the sweep, and the sweep takes only questions
-- that were never tried. Nullable with no default, so every existing question
-- reads as never tried, which is what the sweep assumed about them already.

alter table public.blockers add column if not exists asked_at timestamptz;

comment on column public.blockers.asked_at is
  'When the office last TRIED to deliver this question to Grant, whatever the '
  'outcome (sent, no destination, refused). Distinct from a delivery row, which '
  'exists only when something was sent. Stamped by the worker; the unasked-'
  'question sweep takes only rows where this is null (#371).';
