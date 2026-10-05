-- Seed an ISOLATED replica to the SHAPE and SIZE production had on 5 October 2026, so a plan or a buffer count measured on it
-- means something. An empty replica cannot show a sequential scan of `jobs` (an idle pass touches 164 buffers of nothing).
--
--   psql -h /tmp/pgs -p 55432 -U postgres -d post -v jobs=22600 -f scripts/isolated/seed-production-scale.sql
--
-- Refuses anything that is not the marked replica. No production row, secret or identifier is used: every value is generated.
--
-- What it reproduces (docs/ops/evidence/2026-10-05/capture-2026-10-05.jsonl, 07:36 UTC; all MEASURED there):
--   jobs 22,647 live rows, a heap near 94 MB (wide rows plus the bloat 49 non-HOT updates a row leave behind), ten indexes;
--   job_state_transitions about eight rows a job; outputs 11.5k; inference_usage 16k; deliveries 8k; inbound_commands 5k;
--   a person office holding about nine tenths of the jobs, a test office with harness traffic, the system office;
--   a handful of live work (6 queued, 3 retrying, 4 paused) and the rest terminal, which is the shape that makes a sweep over
--   `state in ('retrying','paused')` read the whole heap when no index serves it.
-- What it does NOT claim: the real distribution of kinds, the real width of pinned_config (UNKNOWN until pg_stats is read), or
-- how a 434 MiB host behaves. It is a count-of-work fixture.
\set ON_ERROR_STOP on
\if :{?jobs}
\else
  \set jobs 22600
\endif
\if :{?filler}
\else
  \set filler 40
\endif

do $$
begin
  if inet_server_addr() is not null or to_regclass('public.isolated_replica_marker') is null then
    raise exception 'REFUSED: this seed runs only against the marked local replica';
  end if;
  if (select count(*) from public.jobs) > 100 then
    raise exception 'REFUSED: the replica is already seeded (% jobs); rebuild it with scripts/isolated/replica.sh', (select count(*) from public.jobs);
  end if;
end $$;

-- Triggers (origin stamping, transition logging, office checks) are skipped on purpose: they are what a REAL write does, and
-- the seed writes the end state directly. Foreign keys are still honoured by inserting parents first.
begin;
set local session_replication_role = replica;
set local synchronous_commit = off;

create temp table seed_ctx as
select (select office_id from public.offices where kind = 'person' limit 1) as grant_office,
       (select office_id from public.offices where kind = 'test' limit 1) as test_office,
       (select office_id from public.offices where kind = 'system' limit 1) as system_office;

-- Four more projects for the person office (the replica has one).
insert into public.projects (slug, name, status, office_id)
select 'seed-project-' || g, 'Seed project ' || g, 'active', (select grant_office from seed_ctx)
from generate_series(1, 4) g;

create temp table seed_kinds (kind text, requested_by text, weight int, with_model boolean);
insert into seed_kinds values
  ('drive.watch',            'duty:drive-watch',       350, false),
  ('tasks.remind',           'duty:task-reminders',    250, false),
  ('google.read_calendar',   'duty:calendar-refresh',   40, false),
  ('office.sync',            'duty:discovery-sync',     40, false),
  ('office.prune_job_traces','duty:job-trace-retention',40, false),
  ('office.chores',          'duty:credential-chores',  40, false),
  ('office.notion_sync',     'duty:notion-sync',        20, true),
  ('office.instruction',     'telegram:grant',         110, true),
  ('office.pursue',          'telegram:grant',          30, true),
  ('office.synthesise',      'telegram:grant',          30, true),
  ('research',               'teamhq:grant',            30, true),
  ('artifact.report',        'teamhq:grant',            20, true);

create temp table seed_jobs as
with k as (
  select kind, requested_by, with_model, sum(weight) over (order by kind) as cum, sum(weight) over () as total from seed_kinds
), picks as (
  select g,
         (random() * (select max(total) from k))::int as r,
         random() as r_state, random() as r_office, random() as r_h, random() as r_age
  from generate_series(1, :jobs) g
)
select g as n,
       gen_random_uuid() as job_id,
       (select kind from k where k.cum >= greatest(1, p.r) order by k.cum limit 1) as kind,
       (select requested_by from k where k.cum >= greatest(1, p.r) order by k.cum limit 1) as requested_by,
       (select with_model from k where k.cum >= greatest(1, p.r) order by k.cum limit 1) as with_model,
       case when p.r_office < 0.90 then (select grant_office from seed_ctx)
            when p.r_office < 0.98 then (select test_office from seed_ctx)
            else (select system_office from seed_ctx) end as office_id,
       case when p.r_state < 0.885 then 'complete' when p.r_state < 0.925 then 'failed' else 'cancelled' end as final_state,
       (now() - (p.r_age * interval '40 days')) as created_at,
       p.r_h < 0.17 as harness
from picks p;

-- Live work, as the 5 Oct snapshot held it: 6 queued (harness), 3 retrying, 4 paused. Chosen from the newest rows.
create temp table seed_live as
select n, case when rn <= 6 then 'queued' when rn <= 9 then 'retrying' else 'paused' end as live_state
from (select n, row_number() over (order by n desc) rn from seed_jobs where office_id = (select grant_office from seed_ctx)) x
where rn <= 13;

-- pinned_config: a job's pinned configuration is the one unbounded jsonb. The filler is sized so the table lands near 94 MB.
insert into public.jobs (job_id, correlation_id, project_id, state, idempotency_key, kind, intent_class, requested_by, recipient_agent,
                         priority, pinned_config, state_reason, attempt, max_attempts, leased_by, leased_until, created_at, updated_at,
                         started_at, finished_at, not_before, announce, trace_steps, trace_tokens, trace_pence, trace_ms, office_id,
                         synthetic, claim_gen, origin_kind, origin_class)
select s.job_id, gen_random_uuid(),
       (select project_id from public.projects p where p.office_id = s.office_id order by p.slug limit 1 offset (s.n % 5)),
       coalesce(l.live_state, s.final_state)::public.job_state,
       'seed-' || md5(s.job_id::text) || '-' || s.n,
       s.kind, case when s.kind like 'office.%' or s.kind = 'research' then 'assignment' else null end,
       case when s.harness then 'verify:seed-' || s.n else s.requested_by end,
       (array['chief-of-staff','finance-director','growth-director','research-director'])[1 + (s.n % 4)],
       100,
       jsonb_build_object('prompt_version', 3, 'router', 'seed', 'autonomy', 'act_with_review',
         'filler', (select string_agg(md5(s.n::text || i::text), '') from generate_series(1, :filler) i)),
       case coalesce(l.live_state, s.final_state) when 'retrying' then 'attempt failed; will retry' when 'paused' then 'no handler for kind ' || s.kind else 'seed' end,
       case coalesce(l.live_state, s.final_state) when 'queued' then 0 when 'retrying' then 2 else 1 end, 5,
       null, null, s.created_at, s.created_at + interval '30 seconds',
       s.created_at + interval '1 second',
       case when coalesce(l.live_state, s.final_state) in ('complete','failed','cancelled') then s.created_at + interval '30 seconds' end,
       null, false,
       case when s.with_model then 4 else 1 end, case when s.with_model then 1800 else 0 end,
       case when s.with_model and (s.n % 10) < 7 then 0.4200 else 0 end, case when s.with_model then 5200 else 40 end,
       s.office_id, false, 1, case when s.requested_by like 'duty:%' then 'duty' else 'inbound' end,
       case when s.harness then 'harness' else 'trusted' end
from seed_jobs s left join seed_live l using (n);

-- Eight transition rows a successful job (docs: one on insert, one per state change); fewer for a failed or cancelled one.
insert into public.job_state_transitions (job_id, from_state, to_state, reason, actor, occurred_at, attempt)
select j.job_id, t.f::public.job_state, t.t::public.job_state, 'seed', 'seed', j.created_at + (t.k * interval '4 seconds'), 1
from public.jobs j
cross join lateral (values
  (0, null, 'queued'), (1, 'queued', 'running'), (2, 'running', 'output_created'), (3, 'output_created', 'quality_review'),
  (4, 'quality_review', 'committing'), (5, 'committing', 'committed'), (6, 'committed', 'notifying'), (7, 'notifying', 'complete')
) as t(k, f, t)
where j.state = 'complete' and j.pinned_config ->> 'router' = 'seed';
insert into public.job_state_transitions (job_id, from_state, to_state, reason, actor, occurred_at, attempt)
select j.job_id, v.f::public.job_state, v.t::public.job_state, 'seed', 'seed', j.created_at + (v.k * interval '4 seconds'), 1
from public.jobs j
cross join lateral (values (0, null, 'queued'), (1, 'queued', 'running'), (2, 'running', j.state::text)) as v(k, f, t)
where j.state in ('failed','cancelled') and j.pinned_config ->> 'router' = 'seed';

insert into public.outputs (job_id, staff_id, body, confidence, evidence, deterministic, reviewer_status, reviewed_at, model, created_at)
select j.job_id, (select staff_id from public.staff order by slug limit 1),
       'seed output ' || repeat('lorem ipsum dolor sit amet ', 20), 'medium', 'inferred', not (s.with_model), 'approved', j.finished_at,
       case when s.with_model then 'seed/model' end, j.finished_at
from public.jobs j join seed_jobs s using (job_id) where j.state = 'complete' and (s.n % 2) = 0;

insert into public.inference_usage (provider, model_id, job_id, correlation_id, outcome, prompt_tokens, completion_tokens, cost_usd,
                                    provenance, occurred_at, latency_ms, office_id)
select 'openrouter', (array['openai/gpt-oss-120b','qwen/qwen3.7-flash','mistralai/mistral-small-3.2-24b-instruct','free/seed-a','free/seed-b'])[1 + (s.n % 5)],
       j.job_id, j.correlation_id, (array['ok','ok','ok','ok','provider_error','rate_limited'])[1 + (s.n % 6)], 900, 300, 0,
       'estimated', j.created_at + interval '5 seconds', 1200, j.office_id
from public.jobs j join seed_jobs s using (job_id), generate_series(1, 2) k
where s.with_model and ((s.n + k) % 3) <> 0;

insert into public.routing_decisions (job_id, intent_class, confident, intent_reason, subject_terms, duplicate_resolution, roster, roster_reason, decided_at)
select j.job_id, 'assignment', true, 'seed', array['seed'], 'none_found', array['chief-of-staff'], 'seed fixture roster reason', j.created_at
from public.jobs j where j.kind = 'office.instruction' and j.pinned_config ->> 'router' = 'seed';

insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, purpose, state, lease_expires_at, message_ref, job_id, correlation_id, office_id, created_at, updated_at, sent_at)
select 'telegram', 'seed:' || j.job_id, 'seed-bot', '4242', 'result', 'sent', j.finished_at, '1', j.job_id, j.correlation_id, j.office_id, j.finished_at, j.finished_at, j.finished_at
from public.jobs j where j.state = 'complete' and j.kind in ('office.instruction', 'tasks.remind') and (random() < 0.45) and j.pinned_config ->> 'router' = 'seed';

insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at, processed_at, job_id, project_id, office_id, synthetic)
select 'telegram', 'seed:' || j.job_id, '1', 'seed instruction', 'seed:cmd:' || j.job_id, j.created_at, j.created_at, j.job_id,
       coalesce(j.project_id, (select project_id from public.projects limit 1)), j.office_id, false
from public.jobs j where j.kind = 'office.instruction' and j.pinned_config ->> 'router' = 'seed';

-- Bloat: production's heap is 94 MB for 22.6k live rows because every job was updated about 49 times and few of those were HOT.
-- One full round of updates (new version each), vacuumed but not rewritten, leaves the same shape: a big file, mostly live rows.
\if :{?bloat}
\else
  \set bloat 1
\endif
select 'bloat rounds: ' || :bloat as note;
-- Triggers stay off for the churn too (session_replication_role is still replica).
select 'update public.jobs set updated_at = updated_at + interval ''1 second'' where pinned_config ->> ''router'' = ''seed''' from generate_series(1, :bloat) \gexec
commit;

vacuum (analyze) public.jobs;
vacuum (analyze) public.job_state_transitions, public.outputs, public.inference_usage, public.routing_decisions,
                 public.deliveries, public.inbound_commands, public.projects;

select 'jobs' rel, (select count(*) from public.jobs) n, pg_size_pretty(pg_relation_size('public.jobs')) heap,
       pg_size_pretty(pg_indexes_size('public.jobs')) indexes, pg_size_pretty(pg_total_relation_size('public.jobs')) total
union all select 'job_state_transitions', count(*), pg_size_pretty(pg_relation_size('public.job_state_transitions')), pg_size_pretty(pg_indexes_size('public.job_state_transitions')), pg_size_pretty(pg_total_relation_size('public.job_state_transitions')) from public.job_state_transitions
union all select 'outputs', count(*), pg_size_pretty(pg_relation_size('public.outputs')), pg_size_pretty(pg_indexes_size('public.outputs')), pg_size_pretty(pg_total_relation_size('public.outputs')) from public.outputs
union all select 'inference_usage', count(*), pg_size_pretty(pg_relation_size('public.inference_usage')), pg_size_pretty(pg_indexes_size('public.inference_usage')), pg_size_pretty(pg_total_relation_size('public.inference_usage')) from public.inference_usage
union all select 'deliveries', count(*), pg_size_pretty(pg_relation_size('public.deliveries')), pg_size_pretty(pg_indexes_size('public.deliveries')), pg_size_pretty(pg_total_relation_size('public.deliveries')) from public.deliveries
union all select 'inbound_commands', count(*), pg_size_pretty(pg_relation_size('public.inbound_commands')), pg_size_pretty(pg_indexes_size('public.inbound_commands')), pg_size_pretty(pg_total_relation_size('public.inbound_commands')) from public.inbound_commands;
select state, count(*) from public.jobs group by 1 order by 2 desc;
