-- V1 release PREFLIGHT reads (9 October 2026). READ-ONLY, NONE HAS BEEN RUN AGAINST PRODUCTION.
-- Each is one statement for `ALLOW_PRODUCTION_CHECKS=1 npm run qq -- "<statement>"`, and needs Grant's explicit authorisation
-- for the READ. They select no secret, no secret reference and no message text. They were parsed and executed on the migrated
-- isolated replica (schema through 1035) to prove the column names; an empty replica returns empty answers.
-- The expected answer is written beside each, so a result is read against a stated expectation rather than against a feeling.

-- CORRECTED 9 October 2026 (integration run, docs/audit/V1-INTEGRATION-RELEASE-CANDIDATE-2026-10-09.md): the first version of
-- this file expected 798 and 1022 and named the reliability migrations 1023 to 1035. Production already held a DIFFERENT 1023 and
-- 1027 (the efficiency workstream, 7 October) and 1040 and 1041 (Team HQ, 9 October), so the eleven are renumbered 1042 to 1052.

-- P01 the ledger: how many applied, and the highest. EXPECT 802 and 1041 (docs/ops/deployment-state.json, which is a RECORD of
--     9 October and not a live reading). Anything else = STOP: the state changed and the plan is not valid as written.
select count(*) as applied, max(name) as highest from app.schema_migrations;

-- P02 nothing at or above 1042 is applied, and production's own 1023 and 1027 are the efficiency files, not ours. EXPECT exactly
--     three rows: 1023_the_health_reading_asks_the_cheap_question_first (3298fd85...), 1027_the_pulse_reads_each_table_once
--     (8dca3590...), and nothing named 1042 or higher. (The first 8 hex of each checksum are enough to tell them from ours.)
select name, left(checksum, 8) as checksum8 from app.schema_migrations where name >= '1023' and name < '1040' or name >= '1042' order by name;

-- P03 the worker heartbeat is active and nothing has run for long. EXPECT active = true, running small, oldest_running_min null or small.
select (select active from cron.job where jobname = 'worker-heartbeat') as heartbeat_active, count(*) filter (where state = 'running') as running, round(extract(epoch from now() - min(started_at) filter (where state = 'running')) / 60) as oldest_running_min, count(*) filter (where state in ('queued', 'retrying')) as waiting from public.jobs where created_at > now() - interval '1 day';

-- P04 free tier: database and storage bytes, largest tables, projection. EXPECT database under 85 percent of 500,000,000 bytes AND storage under
--     85 percent of 1,000,000,000 (proposed thresholds, for Grant's approval; the 6 October projection said the database could cross 85 percent
--     between 8 and 13 October). Over either = STOP, do not migrate: a database at its limit goes read-only mid-sequence.
select jsonb_pretty(app.free_tier_headroom());

-- P05 deliveries the new worker's first redrive would RESEND: claimed, lease lapsed, no send recorded as begun (every pre-1029 row has
--     send_started_at null), younger than the two-day window. EXPECT zero. Any row = Grant decides, per row, BEFORE the worker is deployed.
select d.delivery_id, d.channel, d.purpose, d.state, d.created_at, d.lease_expires_at, d.error_code from public.deliveries d where d.state = 'claimed' and d.lease_expires_at < now() and d.created_at > now() - interval '2 days' order by d.created_at;
-- (CORRECTED 9 October, final preflight run: the first version also tested `d.send_started_at is null`, a column only migration 1047 (authored 1029) adds, so it can
--  never run on production before the migration. The condition is dropped: it is true of every pre-migration row by construction, so the result is the same set.)

-- P06 failed result deliveries that 1032's first sweep would turn into Needs-me items (at most 50 per pass, last two days). EXPECT a small
--     number Grant has already seen; each item will carry up to 500 characters of the answer it failed to deliver.
select count(*) as would_raise from public.deliveries d where d.state = 'failed' and d.purpose = 'result' and d.job_id is not null and d.dedupe_key like 'job:' || d.job_id::text || ':%' and coalesce(d.error_code, '') not like 'superseded:%' and d.updated_at > now() - interval '2 days';

-- P07 open questions waiting on him now, so the deployment is not blamed for them.
select count(*) as open_blockers, count(*) filter (where created_at > now() - interval '2 days') as recent from public.blockers where state = 'open';

-- P08 pending reminders and repeating series in Grant's office (what 1027 and 1034 change the behaviour of).
select count(*) filter (where remind_at is not null and reminded_at is null and state not in ('done', 'cancelled')) as pending_reminders, count(*) filter (where repeat_every is not null and state not in ('done', 'cancelled')) as open_series from public.tasks where not is_fixture and office_id = app.operator_office();

-- P09 offices and what each is (the isolation test needs the Sample and the TEST office to exist and be active).
select kind, state, count(*) as n from public.offices group by 1, 2 order by 1, 2;

-- P10 the connections, state only (no credential, no reference). EXPECT: google revoked since 15 September (the recorded state), slack and telegram ok.
select service, credential, purpose, state, fault_kind, checked_at from public.connection_health order by service, credential;

-- P11 Telegram bots: the chief's bot is the only enabled one (the 7 September decision). EXPECT exactly one enabled row, is_pager true, staff_slug chief-of-staff.
select staff_slug, username, is_pager, enabled from public.telegram_bots order by enabled desc, staff_slug;

-- P12 the model chain the router reads: order and health (no key). EXPECT gpt-oss-120b first, then qwen3.7-flash, then mistral-small-3.2.
select provider, model_id, status, priority, consecutive_failures, last_success_at from public.provider_models where provider = 'openrouter' order by priority, model_id limit 8;

-- P13 spend ceiling in force (the cost guard the router enforces), and whether the account may call paid models at all.
select provider, enabled, free_only, max_price_prompt, max_price_completion, max_cost_per_call_usd from public.providers where provider = 'openrouter';

-- P14 the duties: which are enabled. EXPECT drive-index and calendar-event-sync OFF; note which others will fire in the first hour.
select slug, job_kind, enabled, period_minutes, last_run_at from public.responsibilities order by enabled desc, slug;

-- P15 the standing config the plan depends on. EXPECT telegram.only_chief_speaks true; slack.per_office_delivery absent or false until the worker deploy sets it.
select key, value from public.system_config where key in ('telegram.only_chief_speaks', 'slack.per_office_delivery', 'jobs.lease_seconds') order by key;

-- P16 test destinations registered and still live (the approved destinations for the smoke test must be named here or by Grant).
select channel, count(*) as registered, count(*) filter (where released_at is null and expires_at > now()) as still_live from public.test_origins group by channel order by channel;
-- (CORRECTED 9 October, final preflight run: the first version was `select *`, which would print conversation identifiers, which a preflight does not need.)

-- P17 what the office has said to him in the last hour, so a quiet window is confirmed before anything is changed.
select channel, purpose, state, count(*) as n from public.deliveries where created_at > now() - interval '1 hour' group by 1, 2, 3 order by n desc;

-- P19 the scheduled commands: nothing scheduled may call a function 1025, 1029 or 1030 removes (app.over_budget(text), app.spent_today(text), the 6-argument say_in_project,
--     the 4-argument record_delivery_failure). EXPECT zero rows (the worker heartbeat pokes an edge function; the duties are rows, not cron commands).
select jobname, schedule, active, left(command, 160) as command from cron.job where command ~* '(over_budget|spent_today|say_in_project|record_delivery_failure)' order by jobname;

-- ADDED 9 October 2026 (final preflight run). The read-only database role the preflight uses may not execute `app.*` functions (P04, P08 and P18 were refused with
-- 42501 "permission denied for function"), so these three restate the SAME questions from catalogue and table reads only: no function call, nothing that writes.
-- P04b the free-tier reading without app.free_tier_headroom(): the same arithmetic as migration 0180 (database size against 500 MB, storage metadata against 1 GB).
select pg_database_size(current_database()) as db_bytes, round(pg_database_size(current_database())::numeric / (500 * 1024 * 1024) * 100, 1) as db_percent_of_500mb, (select coalesce(sum(coalesce((metadata ->> 'size')::bigint, 0)), 0) from storage.objects) as storage_bytes, (select round(coalesce(sum(coalesce((metadata ->> 'size')::bigint, 0)), 0)::numeric / (1024 * 1024 * 1024) * 100, 1) from storage.objects) as storage_percent_of_1gb, (select count(*) from storage.objects) as storage_objects, (select jsonb_agg(x) from (select c.oid::regclass::text as table_name, pg_total_relation_size(c.oid) as bytes from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and n.nspname not in ('pg_catalog', 'information_schema') order by 2 desc limit 8) x) as largest;
-- P08b pending reminders and open repeating series by office KIND (counts only; no title, no person), without app.operator_office().
select o.kind, count(*) filter (where t.remind_at is not null and t.reminded_at is null and t.state not in ('done', 'cancelled')) as pending_reminders, count(*) filter (where t.repeat_every is not null and t.state not in ('done', 'cancelled')) as open_series from public.tasks t join public.offices o on o.office_id = t.office_id where not t.is_fixture group by o.kind order by o.kind;
-- P18b the backup reading without app.backup_health(): the same sources (the backups bucket manifests, the rehearsal events), no object name printed beyond the run time.
select (select max(created_at) from storage.objects where bucket_id = 'backups' and name like '%manifest.json.gz') as newest_backup_at, (select round(extract(epoch from (now() - max(created_at))) / 3600.0, 1) from storage.objects where bucket_id = 'backups' and name like '%manifest.json.gz') as newest_backup_age_hours, (select count(distinct split_part(name, '/', 1)) from storage.objects where bucket_id = 'backups' and name like '%manifest.json.gz') as finished_backups_kept, (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects where bucket_id = 'backups' and name like (select split_part(name, '/', 1) from storage.objects where bucket_id = 'backups' and name like '%manifest.json.gz' order by created_at desc limit 1) || '/%') as newest_backup_bytes, (select max(occurred_at) from public.events where action_type = 'backup.rehearsed' and after_state ->> 'outcome' = 'passed') as last_passing_rehearsal_at, (select max(occurred_at) from public.events where action_type = 'backup.rehearsed') as last_rehearsal_at, (select after_state ->> 'outcome' from public.events where action_type = 'backup.rehearsed' order by occurred_at desc limit 1) as last_rehearsal_outcome;

-- P18 backups: the office's own backup and restore-rehearsal health. EXPECT the newest backup inside backup_max_age_hours (36) and a rehearsal inside
--     rehearsal_max_age_hours (192; the last passing rehearsal on record is 21 September, so an overdue rehearsal is KNOWN and is itself a reason to
--     run `npm run backup:rehearse` first). It states offsite = false: the only copy is a bucket in the project it protects.
select jsonb_pretty(app.backup_health());
