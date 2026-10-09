-- V1 release monitoring queries (9 October 2026). READ-ONLY. Each is one statement and runs with the repository's reader:
--   ALLOW_PRODUCTION_CHECKS=1 npm run qq -- "<the statement>"
-- which needs Grant's explicit authorisation for the window it is used in (docs/audit/V1-PRODUCTION-RELEASE-PLAN-2026-10-09.md).
-- Every query below was executed against the migrated isolated replica (schema through 1035) and parses there; on an empty
-- replica they return zero rows, so a zero here proves the column names, not the health of production.
-- `:since` below is written as a literal interval so each statement stands alone; change the interval, never the predicate.
-- Harness traffic is excluded with app.harness_job, the canonical predicate (CLAUDE.md), never with a name list.

-- M01 job states in the window (a retry storm or a stuck queue shows as one state growing)
select state, count(*) as n from public.jobs where created_at > now() - interval '30 minutes' and not app.harness_job(job_id) group by state order by n desc;

-- M02 stale leases: a running job whose lease has lapsed and that nothing has recovered
select count(*) as stale_leases, min(leased_until) as oldest_lease from public.jobs where state = 'running' and leased_until < now();

-- M03 retry exhaustion and terminal failures, by kind and reason
select kind, left(coalesce(state_reason, ''), 70) as reason, count(*) as n from public.jobs where state = 'failed' and finished_at > now() - interval '1 hour' and not app.harness_job(job_id) group by 1, 2 order by n desc;

-- M04 retry storm: jobs on a late attempt, and jobs created per minute
select date_trunc('minute', created_at) as minute, count(*) as created, count(*) filter (where attempt >= 3) as late_attempts from public.jobs where created_at > now() - interval '30 minutes' and not app.harness_job(job_id) group by 1 order by 1 desc limit 30;

-- M05 duplicate consequential delivery: more than one SENT result for one job to one destination
select job_id, channel, target_ref, count(*) as sent_n from public.deliveries where state = 'sent' and purpose = 'result' and created_at > now() - interval '2 hours' group by 1, 2, 3 having count(*) > 1;

-- M06 delivery ambiguity: parked as indeterminate, and claims whose lease lapsed (never auto-resent when a send had begun)
select count(*) filter (where error_code like 'indeterminate:%' and state = 'failed') as indeterminate, count(*) filter (where state = 'claimed' and lease_expires_at < now()) as lapsed_claims, count(*) filter (where state = 'claimed' and lease_expires_at < now() and send_started_at is null) as would_be_redriven from public.deliveries where created_at > now() - interval '2 days';

-- M07 model fallback frequency, refusals and admissions of a backup model's answer
select count(*) filter (where kind = 'decision' and detail ->> 'fallback' = 'true') as fallback_decisions, count(*) filter (where kind = 'decision') as decisions, count(*) filter (where kind = 'degradation' and detail ? 'fallback_answer_refused') as refused, count(*) filter (where kind = 'degradation' and detail ? 'fallback_answer_admitted') as admitted from public.job_traces where at > now() - interval '1 hour';

-- M08 model cost and latency by model (real traffic only)
select u.model_id, count(*) as calls, round(sum(u.cost_usd)::numeric, 5) as usd, max(u.latency_ms) as worst_ms, count(*) filter (where u.outcome <> 'ok') as not_ok from public.inference_usage u where u.occurred_at > now() - interval '1 hour' and (u.job_id is null or not app.harness_job(u.job_id)) group by 1 order by usd desc;

-- M09 delivery failures and suppressions by channel
select channel, state, left(coalesce(error_code, suppressed_reason, ''), 60) as why, count(*) as n from public.deliveries where state in ('failed', 'suppressed') and updated_at > now() - interval '2 hours' group by 1, 2, 3 order by n desc;

-- M10 what reached a person, and by what purpose (compare with the smoke-test script: nothing else may appear)
select channel, purpose, state, count(*) as n, min(created_at) as first, max(created_at) as last from public.deliveries where created_at > now() - interval '1 hour' group by 1, 2, 3 order by first;

-- M11 office isolation: a delivery whose office is not its job's office (must be zero rows) ...
select d.delivery_id, d.office_id as delivery_office, j.office_id as job_office from public.deliveries d join public.jobs j on j.job_id = d.job_id where d.office_id <> j.office_id and d.created_at > now() - interval '2 days';

-- M11b ... and traffic by office kind in the window
select o.kind, count(*) as deliveries from public.deliveries d join public.offices o on o.office_id = d.office_id where d.created_at > now() - interval '1 hour' group by 1;

-- M12 free tier: database and storage size, the five largest tables and the growth projection (a production read)
select jsonb_pretty(app.free_tier_headroom());

-- M13 reminders that should have fired and did not (due more than 20 minutes ago, never reminded)
select task_id, remind_at, state, remind_sends from public.tasks where remind_at < now() - interval '20 minutes' and reminded_at is null and state not in ('done', 'cancelled') and not is_fixture order by remind_at limit 20;

-- M14 team-turn ordering for one conversation: lead reply first, synthesis last, nothing after. Replace the uuid.
select d.sent_at, d.channel, d.purpose, j.kind, j.recipient_agent, left(regexp_replace(coalesce(o.body, ''), '\s+', ' ', 'g'), 70) as said from public.deliveries d join public.jobs j on j.job_id = d.job_id left join lateral (select body from public.outputs x where x.job_id = d.job_id order by x.created_at desc limit 1) o on true where d.correlation_id = '00000000-0000-0000-0000-000000000000'::uuid order by d.sent_at nulls last, d.created_at;

-- M15 worker heartbeat: the pg_cron runs of the last half hour (a stall or a launcher failure shows as few or failed runs)
select status, count(*) as runs, max(start_time) as latest from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'worker-heartbeat') and start_time > now() - interval '30 minutes' group by status;

-- M16 the office's own health reading (failing kinds, stalled and waiting work, cannot_think)
select jsonb_pretty(app.office_health(app.operator_office(), 1));

-- M17 what answers are waiting on him (open questions, including a delivery that failed or may not have arrived)
select requested_action, state, created_at, on_answer ->> 'kind' as kind from public.blockers where state = 'open' order by created_at desc limit 30;

-- M18 the migration ledger after step 1 (must list exactly the eleven pending names, 1042 to 1052 (authored 1023 to 1035 and
--     renumbered, see docs/audit/V1-INTEGRATION-RELEASE-CANDIDATE-2026-10-09.md), in order)
select name from app.schema_migrations where name >= '1042' order by name;

-- M21 POST-MIGRATION, BEFORE the worker is deployed: would 1033's containment refuse a real delivery that was sent in the last week? EXPECT zero rows. A row is a destination the
--     migration now treats as another office's: STOP, do not deploy the worker, and show Grant the row (the answer is the destination, not a secret).
select d.delivery_id, d.channel, d.purpose, d.created_at, app.delivery_refusal(d.job_id, d.dedupe_key, d.channel, d.target_ref) as refused_because from public.deliveries d where d.state = 'sent' and d.created_at > now() - interval '7 days' and not app.harness_job(d.job_id) and app.delivery_refusal(d.job_id, d.dedupe_key, d.channel, d.target_ref) is not null limit 20;

-- M19 duties: what is enabled, when it last ran (drive-index and calendar-event-sync must stay OFF)
select slug, job_kind, enabled, period_minutes, last_run_at from public.responsibilities where slug in ('drive-index', 'calendar-event-sync', 'capacity-watch') or last_run_at > now() - interval '1 hour' order by slug;

-- M20 task and reminder series: a repeating series must still be open after one occurrence is completed
select task_id, title, state, repeat_every, remind_at, last_fired_for, last_completed_for from public.tasks where repeat_every is not null and not is_fixture order by updated_at desc limit 10;
