-- THE PRODUCTION CAPACITY BASELINE (read-only). Written 11 October 2026 for docs/activity-ledger/STORAGE-CAPACITY-DECISION.md.
--
-- RUN ON 12 OCTOBER 2026 (08:12 to 08:16 UTC) under approval A3, through the Management API's READ-ONLY endpoint (it executes as supabase_read_only_user, so the
-- database refuses any write) with the repository's static single-select check in front: it was run with
--
--   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/release/preflight-read.ts --file=docs/audit/ACTIVITY-CAPACITY-BASELINE-QUERIES-2026-10-12.sql [--only=Q01,...]
--
-- (this copy lives under docs/audit/ because that tool only reads statement files there; scripts/ops/capacity-baseline.sql is an identical copy). Results:
-- docs/activity-ledger/PRODUCTION-BASELINE-2026-10-12.md. Q06 needs an extension that is NOT installed in production and failed harmlessly. Q16 to Q23 were added on
-- 12 October. Any rerun needs a fresh authorisation for a production READ.
--
-- Every statement is a single plain SELECT over catalogue views and public tables: no function in the `app` schema is called (the read-only
-- role may not execute them), nothing is written, no row content is selected (counts, sizes and names only), and nothing returns a message,
-- the name of a person or a secret. They are the "five baseline reads" of the runbook and the inputs to
-- `npm run activity:storage <headroom-MB> <MB-a-day>`. The statements are separated by their Q numbers; none ends in a semicolon.
--
-- Q01 the database against its allowance. Decimal MB is what the allowance is counted in here; the 500 MiB reading is the same figure on another base.
select pg_database_size(current_database()) as db_bytes,
       round(pg_database_size(current_database())::numeric / 1000000, 1) as db_mb_decimal,
       round(pg_database_size(current_database())::numeric / (500 * 1000 * 1000) * 100, 1) as percent_of_500_mb_decimal,
       round(pg_database_size(current_database())::numeric / (500 * 1024 * 1024) * 100, 1) as percent_of_500_mib,
       round(500 - pg_database_size(current_database())::numeric / 1000000, 1) as headroom_mb_decimal
-- Q02 where the bytes are, by schema.
select n.nspname as schema, count(*) as relations, sum(pg_total_relation_size(c.oid))::bigint as bytes
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r', 'm') and n.nspname <> 'pg_toast'
 group by 1 order by 3 desc
-- Q03 the thirty largest tables: heap, TOAST, indexes, live rows, dead rows, updates and bytes a row. Bytes a row far above the width of the row is bloat.
select c.relname as table_name,
       pg_relation_size(c.oid) as heap_bytes,
       coalesce(pg_total_relation_size(c.reltoastrelid), 0) as toast_bytes,
       pg_indexes_size(c.oid) as index_bytes,
       pg_total_relation_size(c.oid) as total_bytes,
       s.n_live_tup, s.n_dead_tup, s.n_tup_upd, s.n_tup_hot_upd,
       case when s.n_live_tup > 0 then round(pg_total_relation_size(c.oid)::numeric / s.n_live_tup) end as total_bytes_per_live_row,
       s.last_autovacuum::date as last_autovacuum
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  left join pg_stat_user_tables s on s.relid = c.oid
 where c.relkind = 'r' and n.nspname = 'public'
 order by pg_total_relation_size(c.oid) desc limit 30
-- Q04 the thirty largest indexes and how often each has been used since the statistics were last reset (an index with no scans that is not a key is a candidate, never a conclusion).
select s.relname as table_name, s.indexrelname as index_name, pg_relation_size(s.indexrelid) as index_bytes, s.idx_scan, i.indisunique as is_unique, i.indisprimary as is_primary
  from pg_stat_user_indexes s join pg_index i on i.indexrelid = s.indexrelid
 where s.schemaname = 'public'
 order by pg_relation_size(s.indexrelid) desc limit 30
-- Q05 an estimate of wasted space in the largest tables, from the planner's own statistics (no extension needed): the pages a table occupies against the pages its live rows would
-- need at their average width. A ratio near 1 is a table at its natural size; 3 or more is a table a rewrite would shrink. An ESTIMATE: Q06 is exact.
select c.relname as table_name, c.relpages as pages_now, c.reltuples::bigint as est_rows,
       round(c.relpages::numeric / greatest(ceil(c.reltuples::numeric * (28 + coalesce(w.width, 0) * 1.1) / 8192.0), 1), 1) as ratio_now_over_needed,
       round((c.relpages - ceil(c.reltuples::numeric * (28 + coalesce(w.width, 0) * 1.1) / 8192.0)) * 8192 / 1000000.0, 1) as est_wasted_mb
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  left join (select tablename, sum(avg_width) as width from pg_stats where schemaname = 'public' group by 1) w on w.tablename = c.relname
 where c.relkind = 'r' and n.nspname = 'public' and c.relpages > 200 and c.reltuples > 0
 order by 5 desc nulls last limit 15
-- Q06 (optional, exact) the free space inside the table that matters most. Needs the pgstattuple extension, which the platform ships but which may not be installed in this database:
-- if it is not, the statement fails harmlessly and Q05 stands. It reads the whole table, so run it once, in a quiet minute.
select table_len, tuple_count, tuple_len, dead_tuple_count, free_space, round(free_percent::numeric, 1) as free_percent from extensions.pgstattuple_approx('public.jobs')
-- Q07 the row counts of what the ledger's eleven read indexes cover (estimates from the statistics: the sizes the forecast needs).
select relname as table_name, n_live_tup as est_rows from pg_stat_user_tables
 where schemaname = 'public' and relname in ('jobs', 'job_state_transitions', 'inference_usage', 'deliveries', 'outputs', 'inbound_commands', 'blockers', 'events', 'job_impediments', 'job_steps', 'job_plans', 'job_traces')
 order by 1
-- Q08 the two indexes the ledger's read plan relies on, which main already created.
select indexname from pg_indexes where schemaname = 'public' and indexname in ('jobs_office_idx', 'job_transitions_job_idx') order by 1
-- Q09 how much of the work is real and how much is the test office: jobs by office kind (counts only).
select o.kind as office_kind, count(*) as jobs, count(*) filter (where j.is_fixture or j.synthetic) as harness_jobs
  from public.jobs j join public.offices o on o.office_id = j.office_id group by 1 order by 2 desc
-- Q10 the event rate the ledger would inherit: executed plan steps a day over the last 30 days (counts only), and job transitions a day for scale.
select coalesce(d.day, t.day) as day, d.steps, t.transitions
  from (select date_trunc('day', began_at)::date as day, count(*) as steps from public.job_steps where began_at > now() - interval '30 days' group by 1) d
  full join (select date_trunc('day', occurred_at)::date as day, count(*) as transitions from public.job_state_transitions where occurred_at > now() - interval '30 days' group by 1) t on t.day = d.day
 order by 1 desc
-- Q11 growth history, if the capacity watch has been sampling (public.capacity_samples exists once migration 1026 is applied; one row a day for the database and for storage).
select sampled_on, scope, bytes, level from public.capacity_samples where scope in ('database', 'storage') order by sampled_on desc, scope limit 60
-- Q12 file Storage, the other 1 GB allowance: objects and bytes by bucket.
select bucket_id, count(*) as objects, sum(coalesce((metadata ->> 'size')::bigint, 0)) as bytes from storage.objects group by 1 order by 3 desc
-- Q13 the statement timeouts in force (the F2 baseline).
select rolname, rolconfig from pg_roles where rolname in ('anon', 'authenticated', 'service_role', 'authenticator', 'postgres') order by 1
-- Q14 the settings that decide whether an index build spills and how much WAL the volume can take.
select name, setting, unit from pg_settings where name in ('statement_timeout', 'lock_timeout', 'maintenance_work_mem', 'max_wal_size', 'work_mem', 'shared_buffers', 'autovacuum') order by 1
-- Q15 the backups bucket: nightly object counts and bytes over the last 30 days (a date and numbers, no object names).
select date_trunc('day', created_at)::date as day, count(*) as objects, sum(coalesce((metadata ->> 'size')::bigint, 0)) as bytes from storage.objects where bucket_id = 'backups' and created_at > now() - interval '30 days' group by 1 order by 1 desc
-- Q16 the migration catalogue: how many are applied, the highest, and whether any of the ledger's three (1060 to 1062) is applied.
select count(*) as applied, max(name) as highest, count(*) filter (where name >= '1060') as at_or_above_1060 from app.schema_migrations
-- Q17 the ledger's activation state: whether its table exists and how many activity.* settings are held (counts only; no value is selected).
select to_regclass('public.activity_events')::text as ledger_table, (select count(*) from public.system_config where key like 'activity.%') as activity_settings
-- Q18 database error and pressure indicators since the statistics were last reset (counters only).
select numbackends, xact_commit, xact_rollback, deadlocks, conflicts, temp_files, temp_bytes, blks_read, blks_hit, stats_reset from pg_stat_database where datname = current_database()
-- Q19 index health: how many public indexes are invalid (an interrupted concurrent build leaves one).
select count(*) filter (where not i.indisvalid) as invalid_indexes, count(*) as indexes from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
-- Q21 the newest applied migrations (names only), to compare with the repository's migrations/ directory before 1060 to 1062 are numbered into the sequence.
select name from app.schema_migrations where name >= '1040' order by name
-- Q22 the privilege inputs of the human review: default table privileges that a NEW table in public inherits (role names and privilege letters only), and who has USAGE on schema app.
select r.rolname as owner_role, n.nspname as schema, d.defaclobjtype as object_type, d.defaclacl::text as acl from pg_default_acl d join pg_roles r on r.oid = d.defaclrole left join pg_namespace n on n.oid = d.defaclnamespace order by 1, 2, 3
-- Q23 schema app reachability by the browser and gateway roles (booleans only).
select has_schema_privilege('service_role', 'app', 'USAGE') as service_role_app_usage, has_schema_privilege('authenticated', 'app', 'USAGE') as authenticated_app_usage, has_schema_privilege('anon', 'app', 'USAGE') as anon_app_usage, has_schema_privilege('service_role', 'public', 'CREATE') as service_role_create_in_public
-- Q20 connections by state (counts only; no statement text).
select state, count(*) as connections from pg_stat_activity where datname = current_database() group by 1 order by 2 desc
