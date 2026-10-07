# Efficiency changes revalidated against current main (7 October 2026)

`origin/main` = `b8ffe444`, the code and the 798 migrations production runs. Branch `claude/efficiency-deep-optimization` was reconciled by a
**merge** (`702ffe57`, nothing rewritten). **No production contact**: every number below is MEASURED ON A LOCAL REPLICA (buffers touched =
hit + read per call, statements from `pg_stat_statements`) unless it says otherwise. Nothing here says the changes fix an outage, Disk IO or
memory pressure; the polling readers are not shown to have caused the host incidents.

## Reconciliation

* Two conflicts, both deploy tooling: `hq-function-staged.ts` (kept main's production-writes gate, kept this branch's `--save-live`) and
  `hq-page-delta.ts` (one `meta` now carries main's commit SHA and this branch's page fingerprint).
* `hq-api/index.ts` auto-merged: main did not touch session resolution or the `thinking` section, so single-flight and `cannot_think` stand.
* Main did not touch `web/`, `vercel.json`, `api/`, `requirements.txt`, `scripts/notebook/` or the dequeue.
* Two of main's provenance tests then failed on the merged result, both real interactions, fixed on this side: the read-only Vercel inventory
  moved from `scripts/deploy/` to `scripts/vercel/` (main requires the production-writes gate of every deploy script), and main's test that
  pins `meta: { gitCommitSha: ...` now tolerates the formatter's line breaks (the one edit to a main test). A new test pins that the later
  `meta` spread keeps the fingerprint; without it no deployment would ever record one and the skip could never fire (sabotage-proved).

## The replica

Rebuilt from scratch (`scripts/isolated/replica.sh`, then main's chain through 1022 only), seeded to production shape (22,602 jobs, 167k
transitions, 10k outputs). The seven pinned `pre` fingerprints equal main's live-line definitions exactly. Each candidate is a chained copy with
one migration applied. **Seed defect found and fixed:** seeded projects were created today, after their 40 days of seeded work, which emptied
`studio_unseen`'s window (`greatest(seen cursor or created, now - 7 days)`) and made it look 90x cheaper than production's old projects. The seed
now makes them 60 days old. The budget still refuses an unseeded replica (`post`, 2 jobs: REFUSED).

## Validity (old lineage = the earlier replica; current = main's chain)

| Change | Old | Current | Before | After | Saving | Semantics | Tests |
|---|---|---|---|---|---|---|---|
| 1023 health reading | -88.9% | STILL VALID | 915,776 buf, 62,510 stmts | 87,206, 1,038 | -90.5% | proof PASS (+sabotage) | poll-readers-equivalence |
| 1028 thinking (+ gateway `cannot_think`) | -100% | STILL VALID | 87,206 (after 1023); 915,776 on main | 53, 7 stmts | -99.9% (-100.0% vs main) | proof PASS | thinking-equivalence |
| 1027 pulse | -33% | STILL VALID | 138,822 | 70,761 | -49.0% (stmts 8 to 13) | proof PASS | pulse-equivalence |
| 1025 unseen | 1,204k to 226k | STILL VALID, figure revised | 1,201,681; 211,609 stmts | 302,305; 155,398 | -74.8% | proof PASS | page-readers-equivalence |
| 1025 team_work | -75% | STILL VALID | 359,948; 20,373 stmts | 91,340; 3,585 | -74.6% | proof PASS | page-readers-equivalence |
| 1031 unseen counts | 150k stmts to 54 | STILL VALID, figure revised | 155,416 stmts | 4,908 stmts | -96.8% statements; buffers +0.9% (neutral) | proof PASS | page-readers-equivalence |
| 1029 lately | -86% | STILL VALID (0920 is applied on main) | 320,550; 34,432 stmts | 43,867; 469 | -86.3% | proof PASS | page-readers-equivalence |
| 1024 activity (extra; the budget assumes it) | -38.7% studio | STILL VALID | 1,114,638; 43,084 stmts | 685,178; 18,242 | -38.5% | proof PASS | studio-activity-equivalence |
| 1030 idle dequeue | 2.6k to 0.47k | STILL VALID | 2,017 buf | 301 | -85.1% (stmts 72.6 to 67.6) | 44-case proof PASS; counter 1 to 0; main's live dequeue is byte-identical to the frozen predecessor | dequeue-ceiling-equivalence |
| Team HQ requests | 15 / 16 per load | STILL VALID | 15, 16, 6/min | 8, 2, 0/min | desktop and phone | storm check red with the defect back (5,058 reads) | verify:startup |
| Settings retry | looped | MODIFIED BUT VALID | 329 reads per section | 6 reads, once | fixed `b2751dfa` | retries only on a person's open | lazy-settings-honesty |
| Log-query guard | | STILL VALID | 110 queries | window-minutes capped | derived | 40 tests; coverage scan red on a planted script | log-query-budget |
| Gateway single-flight | 24 to 3 | STILL VALID | 24 upstream | 3 (DERIVED) | | 4 tests incl. control | single-flight |
| Production-test safeguards | | STILL VALID | | | protective | p4/p5/p6, reasoned raises, fail-closed canary | tests/safety |
| excludeFiles | -20.2% | STILL VALID | 21.49 MiB | 17.16 MiB (EXPERIMENTAL, preview) | -20.2% | `act.py` kept | function-exclude, bundle-budget |
| Fingerprint skip | | MODIFIED BUT VALID | | | up to ~15% of deploys | fails open; two sabotages red (13 and 4) | page-fingerprint, page-deploy-guard |
| Retention planner | | MODIFIED BUT VALID (CLI moved) | 241 deploys, 7.753 GiB (5 Oct) | keep 49, delete 192 | proposal only, stale | cannot delete | vercel-retention |
| Resource budget | | MODIFIED BUT VALID | | | protective | unseen ceiling 100 to 6,000 | forensics:budget |

Budget: PASS on the candidate with 1024; a copy without 1031 fails `unseen` (155k > 6,000). Scenarios on main vs the candidate: one visible tab
per minute 3.17M to 0.21M (-93.3%); a page load 4.05M to 1.20M (-70.4%; -60.0% without 1024); idle 2.0k to 298 a minute (-85.2%).

## Freeze pass (7 October 2026, same day, 1024 included)

Selected set, applied in order on a replica rebuilt from scratch on main's chain: **1023, 1024, 1025, 1027, 1028, 1029, 1030, 1031**, plus the
non-migration changes. Whole scenarios, settled baseline against the candidate (MEASURED ON A LOCAL REPLICA): one visible tab per minute 2.53M to
0.213M buffers (-91.6%); a page load 3.81M to 1.18M (-69.2%); three tabs per minute 7.58M to 0.64M (-91.6%); idle worker pass 2.4k to 304 (-87.5%).
All six equivalence proofs pass (44 of 44 dequeue cases), and each sabotage goes red and is restored.

Two replica artifacts were found and fixed in the SEED, neither a candidate regression (the unmodified baseline shows both): a never-run daily
duty (07:00 briefing) fired by the first pass after the clock passed its anchor, and planner statistics that were stale on a copy that had been
written to (`provision_missing_channels` 558 buffers on one copy, 106 on its twin, 120 after `analyze`). The budget protocol is now stated in
`resource-budget.json`: judge a replica that has already run one probe pass (a never-probed replica reads `worker.dispatch_due` at 36 statements
against a ceiling of 8, on the baseline as much as the candidate).

## Hold (not revived)

1026 (saving not reproduced), `model_order` caching, `shared_buffers`, compute or plan changes, deleting anything on Vercel, index changes,
a set-based harness check, a polling redesign.
