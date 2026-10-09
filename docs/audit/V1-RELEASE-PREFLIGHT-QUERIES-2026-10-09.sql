-- V1 release PREFLIGHT reads (9 October 2026). READ-ONLY, NONE HAS BEEN RUN AGAINST PRODUCTION.
-- Each is one statement for `ALLOW_PRODUCTION_CHECKS=1 npm run qq -- "<statement>"`, and needs Grant's explicit authorisation
-- for the READ. They select no secret, no secret reference and no message text. They were parsed and executed on the migrated
-- isolated replica (schema through 1035) to prove the column names; an empty replica returns empty answers.
-- The expected answer is written beside each, so a result is read against a stated expectation rather than against a feeling.

-- P01 the ledger: how many applied, and the highest. EXPECT 798 and 1022 (docs/ops/deployment-state.json). Anything else = STOP:
--     the state changed since 6 October and the plan is not valid as written.
select count(*) as applied, max(name) as highest from app.schema_migrations;

-- P02 no pending number is already applied under a different name. EXPECT zero rows.
select name from app.schema_migrations where name >= '1023' order by name;

-- P03 the worker heartbeat is active and nothing has run for long. EXPECT active = true, running small, oldest_running_min null or small.
select (select active from cron.job where jobname = 'worker-heartbeat') as heartbeat_active, count(*) filter (where state = 'running') as running, round(extract(epoch from now() - min(started_at) filter (where state = 'running')) / 60) as oldest_running_min, count(*) filter (where state in ('queued', 'retrying')) as waiting from public.jobs where created_at > now() - interval '1 day';

-- P04 free tier: database and storage bytes, largest tables, projection. EXPECT database under 85 percent of 500,000,000 bytes AND storage under
--     85 percent of 1,000,000,000 (proposed thresholds, for Grant's approval; the 6 October projection said the database could cross 85 percent
--     between 8 and 13 October). Over either = STOP, do not migrate: a database at its limit goes read-only mid-sequence.
select jsonb_pretty(app.free_tier_headroom());

-- P05 deliveries the new worker's first redrive would RESEND: claimed, lease lapsed, no send recorded as begun (every pre-1029 row has
--     send_started_at null), younger than the two-day window. EXPECT zero. Any row = Grant decides, per row, BEFORE the worker is deployed.
select d.delivery_id, d.channel, d.purpose, d.state, d.created_at, d.lease_expires_at, d.error_code from public.deliveries d where d.state = 'claimed' and d.lease_expires_at < now() and d.send_started_at is null and d.created_at > now() - interval '2 days' order by d.created_at;

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
select * from public.test_origins order by 1 desc limit 10;

-- P17 what the office has said to him in the last hour, so a quiet window is confirmed before anything is changed.
select channel, purpose, state, count(*) as n from public.deliveries where created_at > now() - interval '1 hour' group by 1, 2, 3 order by n desc;

-- P19 the scheduled commands: nothing scheduled may call a function 1025, 1029 or 1030 removes (app.over_budget(text), app.spent_today(text), the 6-argument say_in_project,
--     the 4-argument record_delivery_failure). EXPECT zero rows (the worker heartbeat pokes an edge function; the duties are rows, not cron commands).
select jobname, schedule, active, left(command, 160) as command from cron.job where command ~* '(over_budget|spent_today|say_in_project|record_delivery_failure)' order by jobname;

-- P18 backups: the office's own backup and restore-rehearsal health. EXPECT the newest backup inside backup_max_age_hours (36) and a rehearsal inside
--     rehearsal_max_age_hours (192; the last passing rehearsal on record is 21 September, so an overdue rehearsal is KNOWN and is itself a reason to
--     run `npm run backup:rehearse` first). It states offsite = false: the only copy is a bucket in the project it protects.
select jsonb_pretty(app.backup_health());
