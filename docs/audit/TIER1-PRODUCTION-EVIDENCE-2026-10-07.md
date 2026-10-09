# Tier 1 production evidence pass, 7 October 2026

Authorised scope: narrow, read-only, Tier 1 only. Five read-only SELECTs through `npm run qq` with
`ALLOW_PRODUCTION_CHECKS=1`. No write flag, no migration, no deployment, no RPC with side effects, no logs query,
no external message, no row created. The five reads are listed at the end. None returned message content, names or
secrets.

## 1. Capacity (measured at 2026-10-07 05:48 UTC)

| | Measured | Limit | Used | Headroom |
|---|---|---|---|---|
| Database | 369,724,563 B (369.7 MB, 352.6 MiB) | 500 MB | **73.9%** (70.5% if the limit is 500 MiB) | about 130 MB |
| Storage, all buckets | 451,787,266 B (451.8 MB) | 1 GB | **45.2%** (42.1% of 1 GiB) | about 548 MB |

Storage by bucket: `backups` 373.9 MB in 4,958 objects (83%); `build` 66.1 MB; `avatars` 9.8 MB; `files` 1.9 MB.
Database by schema: `public` 325.9 MB, `storage` 11.6 MB, `cron` 6.9 MB, `pg_catalog` 22.4 MB. Largest relations:
`jobs` 108 MB (of which about 99 MB table; 1.09 million updates against 23,440 live rows), `job_state_transitions`
40.6 MB, `events` 33.6 MB, `inference_usage` 24.9 MB, `document_chunks` 21.1 MB, `deliveries` 19.3 MB.

**Growth indicators (measured).** Nightly backup size over 16 days: 12.6 MB (21 Sep) to 26.0 MB (6 Oct), roughly
+0.9 MB per night each night, with a step of +4.6 MB on 4 Oct. Backup objects per night 246 to 286. Other buckets
added 0.36 MB in 7 days. Backups are never deleted by the product, so Storage growth is the sum of those nightly
sizes. The database itself did not move against the 5 October record (73.9%).

**Runway (projected, with its assumption stated).**

| Scenario | Storage 85% | Storage 100% |
|---|---|---|
| Nightly size flat at 26 MB | about 15 Oct to 19 Oct | about 28 Oct |
| Nightly size keeps rising 0.9 MB a night | about 19 Oct | about 23 Oct |

(85% needs 398 MB more, 100% needs 548 MB more.) These are projections from a 16-day trend; the 4 Oct step shows the
slope can change. The first-wave scenario "Storage could be full by 15 October" is **refuted**: the earliest
plausible 100% date is about 23 October. The database has no measured growth; its runway is "not shown to be finite
from this reading", and the earlier "5 days" figure applied only to a burst rate that did not occur.

## 2. D1 historical prevalence

Command rows with the `teamhq:mcp_message:` key: **0**. Blockers answered inside an MCP-origin turn: **0**. Offices
affected: **0**. Date range: none. D1 has never been exercised in production; no external assistant has ever sent a
message through that door. The exposure is real in code and unexercised in practice.

## 3. C1 historical prevalence

Population: failed, top-level, non-fixture jobs not classed harness by `app.harness_job`, 6 Sep to 6 Oct: **116**.

| Category | Jobs | Dates | Offices |
|---|---|---|---|
| Confirmed silent, died in the recovery or attempts-exhausted paths (the C1 conditions) | **0** | none | 0 |
| Confirmed silent, other cause (`handler threw: Buffer is not defined`, a Deno defect fixed long ago) | **1** | 8 Sep | 1 |
| Failed and notified | 0 by the live predicate | n/a | n/a |
| Failed, no delivery, not owed a word by the live `app.owed_a_word` | 115 | 6 Sep to 6 Oct | 4 |

Reading of the 115 (R5, split by job kind and origin): 113 are duty-, mcp-, upload- or grant-origin jobs that the
product does not owe a person-facing notice (45 `office.notion_sync`, 19 `google.read_calendar`, 19
`google.read_mail`, 10 `office.slack_rotate`, 4 `briefing.morning`, 3 `office.capacity_report`, 2 `office.sync`, 1
`office.backup`, 2 `office.instruction` from duty, 4 mcp `notebook.generate`, 3 upload `knowledge.read_source`, 1
grant `notebook.collect_artifact`). **Two are person-origin and ambiguous** (one Telegram and one Slack
`office.instruction`, both 14 Sep): not owed by the live predicate and no delivery; I have not read why, and doing so
needs more than counts. **None in the last 14 days.**

Conclusion: the specific C1 conditions have **not** hit a real job in production (0 of 116). C1's silent-failure
class is proven by replica, not by production history. The only confirmed silent real turn was a different cause on
8 Sep. Limit of this read: it counts `state = 'failed'` only; a non-resumable `paused` job is not counted.

## 4. Unexpected production condition (reported, not investigated)

`office.notion_sync` shows 45 failed duty runs from 16 Sep to 6 Oct with no delivery. It is outside the three
questions, so I did not read why. Whether it is still failing today is not known from this pass.

## 5. Urgency of migration 1026 plus worker deployment: **SOON (several days)**

Reason: Storage reaches 85% about 15 to 19 Oct and 100% about 23 to 28 Oct, and nothing in production stops
backup growth. That is days to weeks, not hours, so not EMERGENCY and not URGENT (24 h). It should not be ROUTINE,
because the margin is under three weeks and a rehearsal plus deploy takes days. Neither D1 (0 prevalence) nor C1 (0
prevalence in its own conditions) raises urgency. I did not apply anything.

## 6. Which changes are justified

- **1026 plus the worker's backup retention and capacity watch: justified now (SOON).** The retention step deletes
  old backup objects, which is destructive. Per your standing rule it needs your explicit decision on how many
  nightly backups to keep before it runs.
- **1023 (D1), 1024 (C1), 1025 (fairness): hardening, not time-driven.** No production instance of D1 or C1; no
  evidence of cross-office starvation was read. They are cheap, replica-proved and safe to ride the same sequence,
  but nothing here makes them urgent.

Proposed order (each its own authorised step, clean tree and pushed commit): 1023, 1024, 1025 (SQL only, additive);
deploy worker (needs 1024's functions to exist first); 1026; deploy worker with retention enabled last and only after
your retention decision. Rollback points: migrations are immutable, so the rollback is the previous worker build
(roll the worker back before any database rollback), and retention is off by default until set.

## 7. Tier 2 probes still believed necessary

None is required for 1026. For 1023 to 1025 the replica proofs answer the question. Nothing in this pass changes
that; no Tier 2 pre-proposal is made.

## 8. Local P2 wave

No progress in this window: the time went to the Tier 1 reads and this report. The 43 red isolated proofs and the
remaining P2 items are still open.

## Production reads performed

| # | Purpose | Sensitive data returned |
|---|---|---|
| R1 | Database and storage sizes, schema and relation sizes, bucket totals | No |
| R2 | Backups per day (count, bytes), other buckets last 7 days | No (no object names) |
| R3 | D1 prevalence (counts and timestamps) | No |
| R4 | C1 prevalence (counts, dates, anonymised reason shapes) | No |
| R5 | C1 split by job kind and origin prefix (counts and dates) | No |
