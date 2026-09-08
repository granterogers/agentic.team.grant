-- 0133 — The office keeps its own time
--
-- Grant: *"stop using github actions completely please, find another way to do
-- thing... for any process."* He had spent 1,800 of 2,000 monthly minutes and
-- the spending was mine — a five-minute worker cron and a ten-minute sync cron,
-- 432 runs a day between them.
--
-- Every schedule in `.github/workflows` is removed. The recurring work moves to
-- the mechanism that already exists and costs nothing: `responsibilities`, the
-- duty table, dispatched by `app.dispatch_due_responsibilities()` on every pass
-- — and a pass runs every minute inside the Supabase Edge Function that pg_cron
-- kicks. That machinery has been carrying the calendar refresh since 0109; it
-- simply had never been given the rest.
--
-- ## What moved, and what could not
--
--   discovery / sync      → duty, hourly. Pure fetch, no node built-ins.
--   slack channel rotation → duty, four-hourly. Same.
--   vault export          → duty, weekly. Same.
--
--   nightly backup        → did NOT move. `pg_dump` is a binary and the edge
--                           runtime has no subprocesses. Left as a manual
--                           workflow, and named in the README as a decision:
--                           Supabase's own backups, a paid tier, or a hand-run.
--   voice transcription   → did NOT move. faster-whisper is Python in a
--                           subprocess. See `voice.transcription` below.
--
-- ## Why voice gets a setting rather than a silent failure
--
-- Without a runner nothing can turn a voice note into words, and the honest
-- failure is to say so at the moment the note arrives — not to accept it, queue
-- it, and leave it unanswered. That is precisely the ten-minute silence Grant
-- complained about this morning, and shipping it again as a side effect of a
-- billing change would be worse than the billing.
--
-- `voice.transcription` is 'none' until he chooses. The webhook reads it and
-- replies immediately when it is 'none'.

begin;

insert into public.system_config (key, value, description)
values
  ('voice.transcription', to_jsonb('none'::text),
   'How a voice note becomes words. "none" = we cannot, and the bot says so on '
   'arrival rather than queueing a job nothing can do. "runner" = a GitHub '
   'Actions run per note, which is what Grant asked to stop. "api" = a '
   'third-party speech service, which would send his voice off our own '
   'compute and is his decision to make, not mine (ADR-0009).')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The duties that used to be crons
-- ---------------------------------------------------------------------------
--
-- `enabled = false` for anything whose handler does not exist yet. A duty that
-- fires into a kind with no handler parks the job as `paused` — recoverable,
-- and still noise every hour. Switched on in the same change that adds each
-- handler.

insert into public.responsibilities
  (slug, staff_id, description, job_kind, period_minutes, enabled)
select 'discovery-sync', s.staff_id,
       'Look for new sources in every attached project and pull them in, so the '
       'team notices a document arriving without being told.',
       'office.sync', 60, false
  from public.staff s where s.slug = 'operations-director'
on conflict (slug) do nothing;

insert into public.responsibilities
  (slug, staff_id, description, job_kind, period_minutes, enabled)
select 'slack-rotation', s.staff_id,
       'Rotate the Slack channel set so old project rooms are archived and the '
       'sidebar stays readable.',
       'office.slack_rotate', 240, false
  from public.staff s where s.slug = 'operations-director'
on conflict (slug) do nothing;

insert into public.responsibilities
  (slug, staff_id, description, job_kind, period_minutes, enabled)
select 'vault-export', s.staff_id,
       'Send Grant an encrypted copy of the vault, so the credentials survive '
       'losing this Supabase project (§16).',
       'office.vault_export', 10080, false
  from public.staff s where s.slug = 'operations-director'
on conflict (slug) do nothing;

commit;
