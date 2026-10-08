# Efficiency / dev cycle closeout (8 October 2026)

**EFFICIENCY / DEV CYCLE CLOSED AND FROZEN — 2026-10-08**

This is the record of the Supabase and Vercel efficiency cycle that ran on branch `claude/efficiency-deep-optimization`
(5 to 8 October 2026). It is written so the work can be paused for months and resumed without ambiguity. It makes no production
change. Every number below is either a fact read from production on 8 October 2026 or is marked as measured elsewhere.

## Cycle status

* No further Supabase efficiency migration is authorised in this cycle.
* No further Vercel retention deletion is authorised in this cycle.
* No further optimisation work is authorised in this cycle.
* Future work must begin with a fresh revalidation of production and of `origin/main`. Nothing in this document is a substitute for
  that: numbers, deployment ids and the migration ledger will have moved.

## What shipped

### Supabase (applied to production, 7 October 2026, one at a time through the rollout gate)

| Migration | What it does | Applied | Recorded |
|---|---|---|---|
| `1023_the_health_reading_asks_the_cheap_question_first.sql` | the office health reading asks the cheap question first | 2026-10-07 13:31Z | `app.schema_migrations` 13:48Z |
| `1027_the_pulse_reads_each_table_once.sql` | the pulse reader reads each table once | 2026-10-07 14:48Z | `app.schema_migrations` 15:08Z |

Checksums, identical in production and in `migrations/applied.json`: 1023 `3298fd850579f8b1897b0304820d62b0657e6f48abc4bbe75d0ef29b3d0519ea`,
1027 `8dca35908c2c238d4b299969680e18bf2b8c7d58a8afafe1c026a98d9271528a`.

### Team HQ page (Vercel production deployment, 7 October 2026 18:49Z, built from commit `fa1ba62f`)

* **Request reductions.** Settings and Usage read lazily, one `thinking` read per load, a refused credential stops the reads and the poll,
  no invented Cost card for a signed-in person, and concurrent gateway callers of one credential share one session resolution
  (commits `253ac356`, `d9ab42d9`, `04d69440` and their companions).
* **Settings retry fix.** A failed Settings read is asked again only when a person opens Settings, never by a loop (`b2751dfa`, `1eef7b59`).
* **Vercel `excludeFiles`.** The static site is excluded from both Python function bundles (`cc69d2e6`).
* **Deployment fingerprinting.** A page-deploy fingerprint and a read-only, fail-open skip guard, wired into `deploy:hq` and
  `deploy:hq-page`; it includes each environment variable's environments and type (`13113a23`, `3b2d39fc`, `d49956ec`).
* **Safer page deployment and configuration handling.** A page deploy is refused without the generated `config.js`
  (`478529b4`); a one-deployment preview that can never take the production alias (`0834de05`, `hq-page-preview.ts`); the startup
  harness can run against a deployed page and blocks every request toward Supabase (`fa1ba62f`); the rollout tooling has a two-GO gate,
  an approved health classifier and a write log (`a3c932d2`, `aa1aab4c`, `fa20cfae`).
* **Vercel retention tooling and safety guards** (`3cc8e9a8`, `6e434cc3`):
  `scripts/vercel/vercel-retention-freeze.ts` (read-only, writes a hashed proposal and a hashed keep file) and
  `scripts/vercel/vercel-retention-delete.ts` (dry run by default, `--go` required, at most 25 exact ids per run, only ids the hashed
  proposal lists as candidates, a fresh read of production, aliases, the whole inventory and the deployment before each request, an
  fsynced attempt entry before each DELETE, one request at a time, a stop at the first unexpected or ambiguous answer, never a retry).
  Library: `scripts/deploy/lib/retention-{freeze,delete,hash}.ts`, `vercel-live-read.ts`. Tests: `tests/deploy/retention-*.test.ts`
  against a stateful fake Vercel, with five sabotages (production protection, alias protection, allow-list, proposal hash, stop on
  error) each shown to turn tests red, and a timestamp sabotage added after the log-timestamp defect found in the first two real runs.

## Verified production outcomes

Only what was measured or observed in this cycle:

* **Migration 1023 healthy in production** after apply and after the post-apply canary reads; recorded in the ledger.
* **Migration 1027 healthy in production** on the same basis; recorded in the ledger.
* **Ledger and bookkeeping agree.** On 8 October 2026 a read-only query of `app.schema_migrations` returned 800 rows, last
  `1027_the_pulse_reads_each_table_once.sql`, with the two checksums above; `migrations/applied.json` has 800 entries, last the same.
  None of 1024, 1025, 1026, 1028, 1029, 1030 or 1031 is in the production ledger.
* **Team HQ healthy on production, desktop and mobile**, checked after the page deploy.
* **A real Notebook read works through production** (one genuine, non-destructive read through the deployed gateway).
* **Python function bundles reduced from about 21.49 MiB to about 17.15 MiB each.** Read from build output on 8 October 2026: the
  rollback deployment `dpl_BaQDvaKi1PMQhnXCYCaBKrbd42Cx` has 2 bundles totalling 45,077,481 B (21.49 MiB each); production
  `dpl_Dj7erfTXZYqDJhEgxQ9eTBzsnc8H` has 2 bundles totalling 35,974,773 B (17.15 MiB each). The preview experiment of 5 October measured
  17.16 MiB.
* **An identical Vercel deploy calculation can SKIP.** The skip rule is proven by unit and end-to-end tests, and the production deployment now carries
  the page fingerprint (`pageFingerprint 18c8c59195c0c8c1…`) the guard compares against. A real second identical deploy was not made.
* **Vercel Functions Storage reduced from about 7.987 GiB to about 2.336 GiB, about 5.65 GiB reclaimed.** The measured quantity is the
  sum of Python function bundle bytes over every deployment (2,508,383,388 B now, from 8,576,314,026 B at the start). Static deployment
  storage is not measurable through the API and is not included.
* **154 old deployments deleted by us**, in 9 sequential batches (1, 4, 10, 20, 25, 25, 25, 25, 19), every one a real DELETE returning HTTP 200
  with a post-delete read confirming it gone. After every batch the deployment count fell by exactly the number deleted, no other
  deployment changed or disappeared, and the storage drop equalled the deleted bundle sizes exactly.
* **Production deployment preserved.** `dpl_Dj7erfTXZYqDJhEgxQ9eTBzsnc8H`, READY, `ai-team-hq.vercel.app` answers 200.
* **Rollback deployment preserved.** `dpl_BaQDvaKi1PMQhnXCYCaBKrbd42Cx`, READY.
* **Aliases preserved.** `ai-team-hq.vercel.app` and `ai-team-hq-agentic-team-grant.vercel.app` point at the production deployment.
* **Validation preview preserved.** `dpl_CdoJAfxD4ybdVgxEykYSNyrNBMCy`, READY.
* **Remaining held-back Vercel candidates intentionally untouched** (next section).

One observation outside our actions: between 7 and 8 October, 11 of the oldest deployments (all 7 September, zero-byte) disappeared on
their own, before any deletion by us. They were about 31 days old. The likely cause is Vercel's own age-based expiry; this was not checked
against Vercel's documentation. The defect found in our deletion log (every entry carried the run-start time) was fixed after the first
two real runs; the log entries of those two runs (the first 5 deletions) carry the old stamp, all later runs carry their own times.

## Intentionally deferred, not shipped

These are **deferred, not rejected.** The files exist on the branch and were proven on a replica; none was applied to production.

| Item | State |
|---|---|
| `1024_the_project_activity_asks_who_answered_once.sql` | deferred |
| `1025_the_page_load_readers_ask_the_window_before_the_harness.sql` | deferred; the next candidate if this is ever resumed |
| `1026_the_self_improvement_ceiling_reads_the_window_first.sql` | deferred; its saving was not reproduced on current main (`passes-2-10-2026-10-06.md`) |
| `1028_the_thinking_reading_asks_only_whether_the_office_can_think.sql` | deferred (it needs its matching gateway section) |
| `1029_the_activity_panel_asks_the_window_before_the_harness.sql` | deferred (needs `0920`, which production has not applied) |
| `1030_the_dequeue_asks_the_self_improvement_ceiling_only_when_it_needs_it.sql` | deferred |
| `1031_the_unseen_counts_take_each_projects_window_once.sql` | deferred |
| model-order caching | deferred |
| `shared_buffers` changes | deferred |
| compute-plan changes | deferred |
| speculative index changes | deferred |
| broader polling redesign | deferred |

## Held-back Vercel items

Twelve deployments remain on the final frozen proposal as deletion candidates (0.096 GiB). They were deliberately left untouched: quota
pressure was already solved (2.336 GiB of 10 GiB) and the benefit of deleting them is negligible.

* **9 zero-byte deployments** (static-only, no function bundle, nothing to reclaim): `dpl_AANviSeAVwMne78q9tiaPL7eM8Gs`,
  `dpl_D768YtEMmB2DQ49cm2roTHq4tDZY`, `dpl_2C96oPdL3BrDJDcmQKmhKmePoH9G`, `dpl_6xCETnx2jPUu1igxrMXvjPiMAiSQ`,
  `dpl_GM2EoePGbWq4hAcfz6pP1MQ58Abu`, `dpl_BzJ9wCoSZYxJ4v4xxypV3UNCrbDE`, `dpl_BfB9rnSzUs8XF3x5HVVBsyAmsmUk`,
  `dpl_7mzX1cFzzvcjishHpLRShm7rpbcS`, `dpl_HoTxZuS7AdTmkszFgLT171DwzXzo`.
* **1 outlier of about 17 MB** (one bundle, about 60% below the median of 42 MB): `dpl_14HR2WnRYV1Z4fQJUjvyJSqYTfJj`.
* **2 ordinary deployments held because of protected-neighbour proximity** (each 42.98 MB, within 8 to 10 minutes of
  `dpl_EafqeJb7PHg7BriEpBpDMkYyf5Pp`, which is named in a tracked file and is the last ready production deployment of its day):
  `dpl_6eGrPFm5q6Tu4gLcYE2JCMqmBM7f`, `dpl_G24NiM3Dt6GLPYXajVMRb1RPbtfM`.

Naming them in this tracked file also makes the retention rules treat them as referenced, so they will be kept by any future freeze.

## Known open questions

* **Supabase outage and root-cause attribution remain unproven.** Nothing in this cycle shows that the polling readers caused the host
  incidents, or that these changes fix an outage, Disk IO or memory pressure. Savings are measured buffers and statements on a replica.
* **The remaining frozen Supabase optimisations are prepared but intentionally deferred** (previous section).
* **`notebooklm-py` remains unpinned** in `requirements.txt`.
* The deletion tool was proven on the real Vercel API for 154 deployments, but the 30-day restore of a deleted deployment was never tested.

## Resume point

| Item | Value |
|---|---|
| Canonical branch | `claude/efficiency-deep-optimization` |
| Branch head before this closeout commit | `6e434cc34bb74fc93e249049f116eaa6b761fa58` (the closeout commit follows it; its SHA is the branch tip) |
| `origin/main` at closeout | `b8ffe4446a387a751385c4630db2c34086e39709` (the branch is 79 commits ahead and 0 behind) |
| Production page commit | `fa1ba62f857e9f4852e02a6727c21c2188d51ec8` (on the branch, not on main) |
| Current production Vercel deployment | `dpl_Dj7erfTXZYqDJhEgxQ9eTBzsnc8H` (READY, aliases above) |
| Rollback deployment | `dpl_BaQDvaKi1PMQhnXCYCaBKrbd42Cx` |
| Validation preview | `dpl_CdoJAfxD4ybdVgxEykYSNyrNBMCy` |
| Measured Functions Storage | 2.336 GiB (69 deployments, 57 kept plus 12 held-back candidates) |
| Efficiency migrations applied in Supabase | 1023 and 1027 only (ledger: 800 migrations, last 1027) |
| Next deferred candidate, if ever resumed | **1025**, and only after fresh production and `main` revalidation |

## Git state

`origin/main` contains **none** of this cycle's shipped changes: the branch is 79 commits ahead of it, main holds 798 migrations and
`migrations/applied.json` with 798 entries, no migration numbered 1023 to 1031, and none of the page, `vercel.json` or retention changes.
Production was built from the branch (`fa1ba62f`). Merging the whole branch is **not** safe: it would also bring in the seven unapplied
deferred migration files (1024, 1025, 1026, 1028, 1029, 1030, 1031), which a later `npm run migrate` would apply, and replica-only
experiments. The branch is left frozen as the historical source of this cycle. If anything is ever promoted to `main`, do it by selective
cherry-pick of the shipped commits (migrations 1023 and 1027 with their `applied.json` entries, the page changes, `vercel.json`, the
fingerprint and the retention tooling), then revalidate.

## Audit artifacts kept in the repository

`docs/performance/efficiency-cycle-audit-2026-10-08/` holds the evidence that otherwise lived only under the git-ignored `.out/`:

| File | What it is |
|---|---|
| `vercel-delete-log.jsonl` | every dry-run, attempt and completion of the 154 deletions (sha256 `28d910d5…60f4`) |
| `vercel-final-state-proposal.json`, `vercel-final-state-keep.json` | the frozen inventory, keep file and 12 remaining candidates after the last batch |
| `rollout-writes.jsonl`, `rollout-gate-log.jsonl` | the migration rollout write log and the gate readings of 6 to 7 October |
| `production-read-audit-2026-10-05.jsonl` | the read-only production audit of 5 October |

Frozen proposal hashes, in order of use (the full files were regenerable inputs and are not kept; each hash is that file's sha256):

| Proposal | Generated (UTC) | Inventory | Candidates | sha256 |
|---|---|---|---|---|
| initial | 2026-10-07 20:52 | 234 | 176 | `3b27715988a305f9cd4fde36ad283ec6762b9a90f661a40cf08e8a30d06e9581` |
| stage 1A | 2026-10-08 10:54 | 223 | 166 | `4304cadb34cabff51f01ff9f95e23611dbf73a18e523e4e1bb71c1e06c43d251` |
| stage 1B | 2026-10-08 11:06 | 222 | 165 | `90da0eacd284a6f7bfcc3974860d6d5920260234a056cb3c1b8daae21bcbc81c` |
| batch 3 (10) | 2026-10-08 11:21 | 218 | 161 | `a49a1697073856836c05a3eefeb86f3add91620143c7d310793c00f472e669aa` |
| batch 4 (20) | 2026-10-08 11:26 | 208 | 151 | `ff8955437a518a5fc260ed03971427c3ab8f354c1a364e958e341277856bbdce` |
| batch 5 (25) | 2026-10-08 11:34 | 188 | 131 | `86f140f811b3901afcd3228d401532eb4db76351948dae7b95d2245af29e28ef` |
| batch 6 (25) | 2026-10-08 11:43 | 163 | 106 | `cfca81934357df954e56c8d24fe4b96f39d1e9dc23d6298be2fb24f34f3fde76` |
| batch 7 (25) | 2026-10-08 11:48 | 138 | 81 | `1a75580d3c448499edb751c39abbb11d24c70779547e623d614c5de1a0152411` |
| batch 8 (25) | 2026-10-08 11:56 | 113 | 56 | `2aa5b9057931a2d4405b3111b57d14441bc22e82acde110cf12e4861e1ac7176` |
| batch 9 (19) | 2026-10-08 12:05 | 88 | 31 | `160cf189c120d4f16e2da16bbefdbe49179a6c92a179b7da82170fc610091272` |
| final state | 2026-10-08 12:07 | 69 | 12 | `7b7d912e5eba5b28f23042c63397e850987e54af44c578127a246129d69b7e90` |

Process note: the audit files were copied into the repository with `cp` (they are data copies, not edits); every source and document
edit went through Edit or Write.
