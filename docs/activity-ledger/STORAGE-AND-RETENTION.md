# Unified Activity Ledger - storage forecast and retention (phase 8)

11 October 2026. **Nothing here touched production.** Measured figures come from the isolated replica; the runs that produced them are named. Anything about
production is either RECORDED in this repository's own documents (the file is named) or INFERRED from them, and the baseline step of the runbook replaces both
with a real reading. The arithmetic is reproducible: `npm run activity:storage [headroom-MB]` (`scripts/ops/activity-storage-forecast.ts`, no database needed).

## The answer first

1. **The database is the constraint, and it was tight before the ledger.** `docs/ops/capacity-scenarios-2026-10-06.md` records 371.8 MB (74 percent of the 500 MB line) on 5 October,
   growing 9 to 26 MB a day, with 100 percent projected between 10 and 19 October. Today is 11 October. Whether that projection held is **UNKNOWN until the baseline read**
   (`select jsonb_pretty(app.free_tier_headroom())`, a production read that needs Grant's authorisation). **Activation must not proceed on this evidence alone**; see the storage gate below.
2. **The ledger's cost is two things.** (a) The eleven read indexes on the existing tables: about **21 MB once** on the recorded row counts (INFERRED), then about 0.5 KB per job. They are optional for
   correctness and required by the activation check for speed. (b) The native events: **750 bytes each with its indexes, measured; 850 planned** once a project and a job are attached.
3. **A thousand native events a day in one office is about 310 MB a year.** That is not affordable on this tier for more than one canary office, which is why the default now caps diagnostic writes
   (below) and why the retention choice is Grant's.
4. **Nothing authoritative is ever at risk from this.** The ledger reads the tables that own each fact; only the small native table is new, and nothing was deleted or will be without an approved decision.

## What was measured (isolated replica, PostgreSQL 16)

| Measurement | Result | How |
|---|---|---|
| Native event, heap | 400.2 B a row (average row 381.9 B) | 20 000 events through the strict writer, a 60 to 80 character summary, four metadata keys, `VACUUM ANALYZE` |
| Native event, indexes | 347.3 B a row (idempotency key 150.7, office-time 75.0, id-office 60.6, primary key 39.3, user-visible 19.7; the job, project, correlation and external indexes are partial and empty without links) | same run, `pg_relation_size` per index |
| TOAST | 0 bytes | rows stay far below the 2 KB threshold; the summary is capped at 300 characters and metadata is cleaned and bounded |
| **Total, no project or job** | **749.6 B** | `pg_total_relation_size / count` |
| Total, planning figure with a project and a job | 850 B | the two partial indexes add about 35 to 60 B between them (rounded up) |
| Read index on `job_state_transitions` | 22.6 B a row | `REINDEX` after giving every row a distinct timestamp (the replica's cloned rows share timestamps and a btree deduplicates them, which first gave a misleading 6.6 B) |
| Read index on `inference_usage` | 40.9 B a row | same |
| Three read indexes on `deliveries` | 41.4 B a row each | same |
| Read index on `outputs` | 23.3 B a row | same |
| Vacuum overhead | none to speak of | the native table is append-only: no updates or deletes, so no dead tuples; autovacuum only freezes and sets visibility bits |

Limits of the measurement: the replica is not the production host (about 434 MiB of memory) and its rows are synthetic; a real tool call may carry a longer summary or more metadata than four keys, which moves
the heap figure, not the shape. The index figure for the existing tables is per row of those tables and the production row counts are inferred (rows = recorded table bytes / replica bytes per row).

## Scenarios (850 B an event; 100 MB of free space assumed for the last column, set it with the argument)

| Scenario | Events a day | MB a day | MB a year | Days to use 100 MB |
|---|---|---|---|---|
| Low: one office, a little tool use | 55 | 0.05 | 17 | 2 139 |
| **Expected: one canary office** | 410 | 0.35 | 127 | 287 |
| At the default cap (500 diagnostic a day), one office | 610 | 0.52 | 189 | 193 |
| Heavy, **without** the cap: 2 000 diagnostic a day | 2 520 | 2.14 | 782 | 47 |
| Expected, five offices | 2 050 | 1.74 | 636 | 57 |
| At the cap, twenty-five offices | 15 250 | 13.0 | 4 731 | 8 |
| External workers at their daily cap (4 000 a day), one office, cap on | 4 510 | 3.83 | 1 399 | 26 |

The event rates are **ASSUMED** (no production traffic has ever been recorded in the ledger: it is off). The shape is what matters: growth is linear in offices times events a day, so a rate nobody has
measured times twenty-five offices is the number that fills the allowance. The canary is the measurement that replaces them: read `select count(*), pg_size_pretty(pg_total_relation_size('public.activity_events')) from public.activity_events` after a week.

## What the ledger holds, by kind of data

| Kind | Where it lives | Retention today | Proposed |
|---|---|---|---|
| 1. Authoritative source records (jobs, transitions, approvals, deliveries, outputs, usage, impediments, events) | their own tables | whatever those tables have | **unchanged, never touched by the ledger.** Their growth is what the indexes follow |
| 2. Native audit events with consequence (`system.recovered`, `budget.threshold_reached`, `activity.corrected`, an external worker's reports of output or a review) | `public.activity_events` | none; append-only | **keep.** These are the only copy; tens a day |
| 3. Diagnostic native events (`tool.call_requested`, `completed`, `failed`; an external worker's usage and evaluation reports) | `public.activity_events` | none; append-only | **bound the writing now (done), then a horizon for Grant to decide** |
| 4. Derived or reproducible projections (everything the read model shows from the owning tables) | nowhere: computed on read | n/a | nothing stored, nothing to keep |
| 5. Temporary operational data (`activity_write_failures`, 200 an hour per office at most) | `public.activity_write_failures` | not pruned | a 90 day prune is proposed with the others below |

## What was done (non-destructive)

**A daily cap on diagnostic native events, per office** (`app.record_activity_safely`, migration 1060): the setting `activity.diag_native_per_day` (0 to 100 000, **default 500**). Past it the best-effort
write is refused and **counted** in `activity_write_failures` (so it is visible, never silent) and the caller's work is untouched. It applies only to diagnostic types on the best-effort path:
the strict writer, every consequential type and an outside worker's reports (which already have their own caps of 300 an hour per worker, 1 000 an hour and 4 000 a day per office) are not capped.
At the default one office can write about 190 MB a year of diagnostics at most, which is still a lot; **a value near 100 a day holds the canary to about 35 MB a year.** The default is a starting
point for the canary, not a recommendation for steady state. Proved by `activity-ledger-durability` (5 checks, sabotage S57).

## Options that need a decision (none implemented)

| Option | Effect | Cost and risk | Needs |
|---|---|---|---|
| A. Keep everything, cap only (status quo plus the cap) | bounded per office per day | grows without end; affordable for one canary office only | nothing; **acceptable for the canary** |
| B. Lower the cap (for example 100 a day) | about 35 MB a year per office of diagnostics | tool-call detail beyond the first hundred a day is lost for that day (counted) | a number from Grant; one `update` of a setting |
| C. Stop recording `tool.call_requested` (record only the outcome) | roughly halves tool-call volume | the page can no longer show a call that started and never finished | a code change in the worker; Grant's choice |
| D. Age out diagnostic native events older than N days (for example 90) to a verified archive, then delete | steady state of N days a day instead of growth | **destructive.** The table is append-only on purpose: this needs an audited path that disables the guard for one purpose, a verified export, a tested restore, and the archive itself uses file storage, which is a separate 1 GB limit | Grant's explicit decision, a migration, a rehearsal; not done |
| E. Partition `activity_events` by month and drop old partitions | cheap deletes | **rejected:** the per-office idempotency uniqueness (`unique (office_id, idempotency_key)`) cannot be enforced across partitions, which would break exactly-once recording | an ADR and a redesign |
| F. Paid capacity (a larger database plan) | removes the constraint | **a cost Grant must approve**; the free-tier constraint in `CLAUDE.md` is deliberate; no price is assumed here | Grant's approval |

**Recommendation:** run the canary on A with the cap at 100 to 500, read the measured size after a week, and decide D (a horizon such as 90 days for kind 3, indefinite for kind 2) before any second office.
Do not combine this release with more offices until the baseline shows the headroom below.

## Storage gate for activation (added to the runbook)

Activation is allowed only if the baseline (`app.free_tier_headroom()`) shows free database space of at least
**indexes (about 21 MB) + 90 days of the canary's expected growth (about 32 MB) + 25 percent margin, so roughly 65 MB, and the projection must not reach 100 percent inside the observation window**.
If the 5 October projection held, there is no such headroom and **the release stops at deployment with the master switch off** until space is freed (`npm run backup:prune` is a dry run by default and
is Grant's to run) or capacity is approved. This is a stop condition, not a recommendation.
