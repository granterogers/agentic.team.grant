-- 0036 — remove a live global preference left behind by a test
--
-- `notification_preferences` held one row: subject `grant`, no project,
-- `min_severity = 'important'`. It was applied on 2026-09-03 at 14:57 by
-- `scripts/poc/gate-3.ts`, which demonstrates §12's two example instructions
-- against the real preference store and ends with the comment *"clean up the
-- probe rows; the preference stays as evidence"*.
--
-- That was a reasonable-sounding decision and it was wrong, for a reason worth
-- writing down: **evidence and configuration are different things, and this
-- table is configuration.** The evidence — what Grant said, when, and what it
-- was taken to mean — lives in `preference_instructions`, which is append-only
-- and still holds all three rows. Keeping a copy in the live table did not
-- preserve the evidence; it changed the system's behaviour.
--
-- What it changed: every routine notification, on every channel, was
-- suppressed. From 2026-09-03 until today that cost nothing, because nothing
-- delivered notifications — the worker's `notifying` state moved a job to
-- `complete` with the reason "delivered" and sent nothing. The two defects
-- concealed each other exactly: a mute that suppressed nothing, in front of a
-- notifier that did not exist.
--
-- It surfaced the first time both were fixed, in the same hour: the end-to-end
-- check in `verify:slack` posted a real result through the real preference
-- gate and got `suppressed by notification preferences`. The check was right
-- and its assumption was wrong, which is the good version of this — the system
-- reported honestly what it had done.
--
-- Deleted rather than adjusted. `min_severity = 'important'` is a preference
-- Grant may well want, and if he does he should set it: inheriting it from a
-- test run three days ago is not a choice he made. §21's autonomy default
-- (`suggest`) is set by migration for the same reason.

begin;

delete from public.notification_preferences
 where subject = 'grant'
   and project_id is null
   and min_severity = 'important'
   and quiet_until is null
   and muted_channels = '{}'::text[];

-- The instruction history is untouched on purpose: it is the record that this
-- happened, and 0013's own trigger makes it append-only anyway.

commit;
