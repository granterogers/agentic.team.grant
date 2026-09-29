-- 0600 - A question is asked until it is delivered or cannot be (#371, residual 2).
--
-- `askUnasked` in src/jobs/worker.ts is the recovery half of R46: it asks a
-- paused job's question when asking did not happen. Its only evidence was
-- "does ANY delivery row exist", which conflates two different facts:
--
--   ATTEMPTED - the office tried to put the question in front of him;
--   DELIVERED - a message exists on his phone.
--
-- and got both directions wrong. A notifier that found no destination, or that
-- the sending gate refused, writes no row, so the sweep asked again on every
-- tick for ever (reproduced: sweepCallsPerTick [1,1,1], and on the refusing
-- branch one append-only impediment per tick). And a send that failed
-- RETRYABLY (a Telegram 429 or 5xx) or died mid-send leaves a `claimed` row,
-- so the sweep skipped it and the question was never sent at all.
--
-- The rule the worker now applies, each outcome decided by what is recorded:
--
--   sent / already sent          delivered - done
--   failed (terminal, gave up,   never again - a second copy is the one harm
--     indeterminate)             the delivery layer exists to prevent
--   held / suppressed            the containment guard's decision - done
--   claimed, lease lapsed        re-driven under the SAME key, so
--                                claim_delivery dedupes and the delivery
--                                layer's own max_attempts and backoff bound it
--   no row after a try           retried with backoff, three tries in all -
--                                a notifier that threw before recording
--                                anything is transient, and one with nowhere
--                                to send may have somewhere tomorrow
--
-- These two columns are the "attempted" half, which had no record at all.
-- Nullable / zero by default, so every existing question reads as never tried.

alter table public.blockers add column if not exists asked_at timestamptz;
alter table public.blockers add column if not exists ask_attempts integer not null default 0;

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'blockers_ask_attempts_nonnegative') then
    alter table public.blockers
      add constraint blockers_ask_attempts_nonnegative check (ask_attempts >= 0);
  end if;
end
$c$;

comment on column public.blockers.asked_at is
  'When the office last TRIED to deliver this question to Grant, whatever the '
  'outcome. Not evidence of delivery: that is a sent row in deliveries under '
  'blocker:<id>:<channel>. Stamped by the worker after every attempt (#371).';
comment on column public.blockers.ask_attempts is
  'How many times the office has tried to deliver this question. The unasked-'
  'question sweep stops retrying a try that left no delivery row at 3 (#371).';
