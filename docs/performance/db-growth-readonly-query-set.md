# Database growth: the smallest read-only production query set (PROPOSAL, NOT RUN)

**Status: nothing here has been run against production.** It needs Grant's explicit authorisation of exactly this set
(`ALLOW_PRODUCTION_CHECKS=1`, read-only; `docs/production-access-guard.md`). Nothing in it writes, deletes, archives, vacuums or changes
a setting.

## Why a query set at all

Production's database was 371.8 MB on 5 October 07:37 UTC (public schema 330 MB; 500 MB is the free-plan ceiling). It grew about 17 to
26 MB a day on 3 to 5 October (`docs/ops/evidence/2026-10-05/capture-2026-10-05.jsonl`). That evidence says how big, not what is growing, and
there is no size history inside the database. The 5 October capture already holds `biggest_relations` (heap plus indexes plus TOAST per
table) and the `jobs` table counters, so **a single fresh size reading, differenced against that capture, attributes the growth per
relation with no history query at all.** The rest of the set separates real data from harness data and from bloat.

## Preconditions (a refusal here is the guard working)

1. Read the platform health first (`GET /v1/projects/<ref>/health`) and the heartbeat canary (`cron.job_run_details`, job 1: last five
   runs succeeded, each under 1 s, ten runs in the last ten minutes, no "job startup timeout" in the hour). If either is unwell, stop.
2. Run the queries one at a time, in this order, with the canary read between Tier A and Tier B. One connection, no retries into a sick host.
3. Total request budget: 7 statements. If any one times out, stop and report; do not rerun.

## Tier A: catalog and statistics only (read no table rows)

Cost: measured on a replica with production's shape (22.6k jobs, a 90 MB heap): Q1 76 buffer hits, Q2 14.3k, Q3 14.1k, Q4 8.9k. Together about
37k buffer hits, **less than one Team HQ pulse call today (70k).** Production's catalog is smaller than the replica's (140 public relations).

**Q1. Which queued or renumbered migrations are actually applied?** (tiny table)
Required because the public Sample's 0897 to 0905 are said to be live in production while `migrations/applied.json` records 761 entries, and
two other migrations had to be renumbered around that. Whether a migration is applied decides whether renumbering is safe.
```sql
select name from app.schema_migrations where name ~ '^(089[2-9]|09[0-9][0-9]|10[0-9][0-9])_' order by name;
```

**Q2. Relation sizes: heap, indexes and TOAST separated, largest 30.** Required to difference against the 5 October `biggest_relations` and
to see whether growth is heap, index or TOAST (a TOAST-heavy `jobs` means wide `pinned_config`).
```sql
select n.nspname, c.relname,
       pg_relation_size(c.oid)                          as heap_bytes,
       pg_indexes_size(c.oid)                           as index_bytes,
       coalesce(pg_total_relation_size(c.reltoastrelid), 0) as toast_bytes,
       pg_total_relation_size(c.oid)                    as total_bytes
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'r' and n.nspname in ('public', 'storage', 'auth', 'cron', 'net', 'realtime', 'vault')
 order by pg_total_relation_size(c.oid) desc
 limit 30;
```

**Q3. Live and dead rows, bytes per live row, update and HOT counters, last autovacuum.** Required to tell bloat from data: a table whose
heap bytes per live row is many times its row width, with dead tuples and a low HOT percentage, is bloat (the 5 October capture already
shows `jobs` at 108 MB for 22.6k rows and 5% HOT; `projects` at 8 MB for a handful of rows).
```sql
select s.relname, s.n_live_tup, s.n_dead_tup,
       round(pg_relation_size(s.relid)::numeric / nullif(s.n_live_tup, 0)) as heap_bytes_per_live_row,
       s.n_tup_ins, s.n_tup_upd, s.n_tup_hot_upd,
       round(100.0 * s.n_tup_hot_upd / nullif(s.n_tup_upd, 0), 1) as hot_pct,
       s.last_autovacuum, s.last_autoanalyze, s.autovacuum_count
  from pg_stat_user_tables s
 where s.schemaname = 'public'
 order by pg_total_relation_size(s.relid) desc
 limit 30;
```

**Q4. The 20 largest indexes and whether anything uses them.** Required for the "indexes" part of the question and for the index
quarantine candidates (a large index with `idx_scan = 0` since the statistics reset is a candidate, never a decision).
```sql
select i.relname as table_name, i.indexrelname as index_name, pg_relation_size(i.indexrelid) as bytes, i.idx_scan
  from pg_stat_user_indexes i
 where i.schemaname = 'public'
 order by pg_relation_size(i.indexrelid) desc
 limit 20;
```

**What Tier A answers by itself:** growth per table since 5 October (jobs, job_state_transitions, events, inference_usage, document_chunks,
deliveries, documents, job_traces, inbound_commands, projects, and their indexes), the heap/index/TOAST split, and a bloat indicator per
table. It cannot say whether the rows are harness or real: that is Tier B, and only for the tables Tier A names as the growers.

## Tier B: conditional, one statement each, only for what Tier A shows is growing

**Q5. How much of `jobs` is harness-generated?** One sequential read of `jobs` (measured 11.3k buffer hits on the replica, about a sixth of one
pulse call). Required because `jobs` is the largest relation and `pinned_config` (TOAST) is its weight; the two generated flags and the origin
class are the cheap, column-only witnesses (the canonical `app.harness_job` is per row and is NOT used here: it would cost a probe chain per
row). Read the answer as a LOWER bound on harness traffic: a job the flags do not mark but the canonical predicate would is not counted.
```sql
select j.is_fixture, j.synthetic, j.origin_class, o.kind as office_kind,
       count(*)                             as jobs,
       sum(pg_column_size(j.pinned_config)) as pinned_config_bytes,
       sum(pg_column_size(j.*))             as row_bytes_excluding_toast
  from public.jobs j left join public.offices o on o.office_id = j.office_id
 group by 1, 2, 3, 4
 order by 5 desc;
```

**Q6. Rows per day, last 14 days, for the two tables with a time-leading index.** Index-only (measured 17 buffer hits). Required to see
whether recent growth is a steady rate or a burst (a suite run), for `inference_usage` and `job_traces`. No other table is counted by day:
the rest have no such index and a count would read the whole table. For those, differencing Q2 against the 5 October capture gives the same
answer for free.
```sql
select 'inference_usage' as t, date_trunc('day', occurred_at)::date as day, count(*) from public.inference_usage
 where occurred_at > now() - interval '14 days' group by 2
union all
select 'job_traces', date_trunc('day', at)::date, count(*) from public.job_traces
 where at > now() - interval '14 days' group by 2
 order by 1, 2;
```

## Deliberately NOT in the set

* No `pgstattuple` / `pgstattuple_approx` (the extension is available, but it reads the heap; Q3's bytes-per-live-row and dead-tuple count
  are the cheap indicator, and an exact figure is a second step only if Q3 leaves the question open).
* No per-row `app.harness_job` classification of `job_state_transitions`, `events`, `outputs` or `deliveries`: each would join through a probe
  chain per row. If Q5 shows `jobs` is mostly harness, those tables follow it (they hang off jobs); say so rather than measure it.
* No `pg_stat_statements`, no logs endpoint, no host metrics: not needed to attribute storage growth.
* Nothing is archived, deleted, vacuumed or reindexed. Retention, archiving and reclaim are decisions after this reading.

## How the answer maps to the classes asked for

| Class | Answered by |
|---|---|
| Real durable product data | Q2 differenced against 5 Oct, minus Q5's harness share; documents/chunks/events are product data unless Tier A shows otherwise |
| Harness/test-generated data | Q5 (jobs, lower bound), then the tables that hang off jobs |
| Bloat | Q3 (bytes per live row, dead tuples, HOT %) |
| jobs, job_state_transitions, events, inference_usage, documents/chunks, deliveries, job_traces, inbound_commands | Q2 and Q3 rows for those relations; Q6 for usage and traces by day |
| Indexes | Q2 `index_bytes`, Q4 |
