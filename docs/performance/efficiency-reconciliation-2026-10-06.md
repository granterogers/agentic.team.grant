# Efficiency reconciliation and validation, 6 October 2026

**NO PRODUCTION CHANGES WERE MADE. No migration was applied to production, nothing was deployed, no production query was run, nothing was
deleted.** Everything below was done on isolated local replicas and in local browsers.

This supersedes the NUMBERS (not the method or the findings) in `efficiency-run-2026-10-06.md`, which were measured on a replica whose `jobs`
heap was 14 MB. The reconciled replica below has the production-sized heap (about 90 MB, 11.3k pages), and several results changed.

## 1. The authoritative base (conclusion and confidence)

| Branch | Tip | Relationship (from history, not names) |
|---|---|---|
| `main` | `b82c277` | 121 commits ahead of the public Sample's base; contains everything except integration's one docs commit |
| `integration/team-hq-ux-on-p4` | `6e8032f` | `main` plus one docs commit. A **superset of `main`** |
| `claude/multi-user-p4` | `1869d7e` | Branched at `28569e6`, 121 commits **behind** main/integration, with **2 unique commits**: the public Sample Office (migrations 0897 to 0905, `hq-api` guest kind, `signin` sample action, 7,271 lines). `git cherry` confirms neither commit is in main |
| `claude/efficiency-deep-optimization` | `7a49dc0` | Based on `6e8032f` (30 commits). Preserved untouched |
| `claude/eloquent-cerf-rv2gum` | `3f7e829` | Frozen evidence branch. Untouched |

The repository clone was shallow; counts above are after `git fetch --unshallow` (the shallow numbers were wrong).

**Production is not `main`.** `docs/multi-user/PUBLIC-SAMPLE.md` and `HANDOFF.md` on the Sample branch record the Sample as LIVE in production
(migrations 0897 and 0898 applied, `hq-api` v891, `signin` v126, page `dpl_3yZSXF...`, then the showcase layer 0899 to 0905 and page
`dpl_34UgA3...`), while integration's migrations 0892 to 1022 are not applied. So the product we continue from is
**integration plus the Sample's two commits**, which exists on no branch. Confidence: **HIGH** on the topology (history-derived, trial merge
conflicts only in two docs files); **MEDIUM** on exactly which of 0899 to 0905 are applied (the docs say so; production was not queried; Q1 of
`db-growth-readonly-query-set.md` settles it in one tiny read).

**Authoritative base used: `integration/team-hq-ux-on-p4` @ `6e8032f`, completed with the Sample's two commits on the reconciliation branch.**
`claude/efficiency-reconciliation` was created from `6e8032f`; neither integration nor the Sample branch was modified.

## 2. Reconciliation branch

`claude/efficiency-reconciliation` (this branch). Order: (0) merge the Sample (`17528796`); (1) tooling; (2) DB readers; (3) client; (4) gateway
and worker; (5) production-test budgets; (6) Vercel; (7) docs and fixes found on the way. Not a wholesale merge of the efficiency branch: each
group was carried, compared against current code, and validated on its own.

## 3. Conflicts and how they were resolved

| Where | Cause | Resolution |
|---|---|---|
| `CLAUDE.md`, `docs/HANDOFF.md` | both sides appended | both kept |
| **Migration numbers 0897 and 0900** | The Sample's 0897/0900 are APPLIED and immutable; integration's unapplied `0897_project_calendar_events` and `0900_documents_are_logical_items...` collided | integration's two renumbered **0906** and **0907** (inside the 0900-0919 range their own notes assigned, before every dependent: first reference is 0920, calendar tools 0924). Header notes added; `tests/migrations/audit-1021.test.ts` path updated. Full chain replays |
| `scripts/deploy/hq-page-delta.ts` | The Sample added `--root=` (a staged studio folder: live bytes plus one change); the fingerprint wiring replaced the private file walk | re-derived: `collectPageFiles(root, studioDir?)` takes the staged folder, `--root` preserved; new test `page-files-staged-root`; the fingerprint source-lock accepts the staged call form and its sabotage control still fails |
| `tests/architecture/office-key-is-a-machine.test.ts` (2) | A source-regex lock on the old two-kind gateway text; the Sample added the guest kind. **Fails on the Sample branch itself** | lock now accepts the guest clauses and still asserts a guest acts only through `GUEST_MAY` and an unnamed kind stays a test member |
| `production-gate-coverage` (2) | `scripts/sample/public-showcase-ui.ts` reaches the deployed page with no gate (integration's stricter guard) | it now imports `require-production-checks` |
| `tests/studio/chat-retry.test.ts` (5) | The Sample's chat reads `signedIn`, `isSample`, `visitorId`; the test's session mock lacked them. **Fails on the Sample branch itself** | mock extended (signed-in person, not a sample) |

Three of these are defects of the Sample branch's own state (stale tests and an ungated script), found by running integration's guards over it.

## 4. Migration-number reconciliation

Across every remote branch: only **0897 and 0900** collide (above). 1023 to 1028 are unique to the efficiency work (maximum number on any other
branch is 1022). The Sample's 0897 to 0905 occupy numbers integration left free (0898, 0899, 0901 to 0905), so only two integration migrations
moved. Dependency check: the functions redefined by the Sample's 0897 to 0905 (19) and by integration's 0892 to 1022 (163) do not overlap; none
of the eight functions rewritten by 1023 to 1027 is redefined by either. **Each frozen reference equals the reconciled chain's live definition
(comments and schema name stripped) before the efficiency migrations are applied**, so the splice is from the correct predecessor. The full chain
`0599` to `1028` replays on two clean clones (without and with 1026). `applied.json` is unchanged (761); whether the Sample's 0897 to 0905 are
applied in production is the one thing to read (Q1) before any `npm run migrate`, because a pending-looking applied migration must not be re-run.

## 5. What was carried, what was not

Carried (and validated): DB readers 1023, 1024, 1025, 1027, 1028; the Team HQ no-office / refused-credential guards, one `thinking` read per
load, lazy Settings/Usage reads, single-flight `whoami`; gateway session single-flight; worker connection retry; resource budget and probe;
production-test budgets, canary and suite-guard coverage; Vercel `excludeFiles`, page fingerprint, retention planner; the isolation proof, the
startup harness (now with a phone profile and a public-Sample-visitor scenario) and the evidence documents.

**Deliberately NOT carried: migration 1026 (`self_improvement_spent`, the "worker empty-pass optimisation").** On the production-sized heap the
planner already reads that function by index: 1,822 hits before, 1,999 after, zero `jobs` sequential scans either way. The earlier win depended
on the planner choosing a hash join on a small replica. It is equivalent and harmless but its benefit is **not reproduced**, so it stays on
`claude/efficiency-deep-optimization` (with its proof) as a proposal. Numbering 1026 is left unused.
Also not carried by design (Grant's list): windowing `model_record`, moving the lease, polling cadence, any index change, retention, shared_buffers,
resize, plan, Vercel deploys or deletions.

## 6. Validation on the reconciled code

* **Equivalence, sabotage and isolation proofs** against the seeded reconciled replica: poll readers, studio activity, page readers, pulse,
  thinking, office isolation: **all PASS** (each with its own controls that must fail). The public Sample's own proofs, run with 1023 to 1028
  applied: `sample-office` 47/47, `sample-showcase-readers` 35/35, `sample-dates` 11/11, `empty-command-id` 13/13.
* `npm run verify:startup` and `verify:startup:phone`: PASS (established office, public Sample visitor, no office, refused credential, office creation).
* `verify:auth-hang` 21/21; `verify:wired` clean; `smoke` and `check:templates` clean.
* `tsc` clean; `check:secrets` clean; `check:migrations` passes (803 files, 761 recorded applied); `check:suite-classes` clean.
* Full unit suite: **5548 passed, 1 failed, 21 skipped; 2 files failed**: `weather-is-not-a-failure` (does not load) and
  `staging/binding` (one test). **Both fail identically on the untouched base `6e8032f`.**
* Deploy bundle and fingerprint: `tests/deploy` 195 passing (excludeFiles pattern re-derived against the reconciled static tree: top-level
  folders are still only `bc fonts logos samples textures vendor`).
* Not run (they contact production or need the real gateway): `verify:offline`, `check:callers`, `check:gateway-wrappers`, signed-in browser suites.

## 7. Re-measured results (reconciled replica, vacuumed, 22.6k jobs, ~90 MB heap, per call)

| Probe | Hits before | Hits after | `jobs` seq scans | ms before | ms after |
|---|---|---|---|---|---|
| `thinking` (poll, every 20 s per tab) | 739,260 | **42** | 0 to 0 | 815 | 0.4 |
| `pulse` (poll) | 105,801 | 70,733 | 3 to 2 | 80 | 44 |
| `studio` (load, each refresh) | 1,108,921 | 680,493 | 0 | 1,518 | 343 |
| `lately` | 322,692 | 44,856 | 0 to 1 | 301 | 31 |
| `unseen` | 1,200,674 | 227,573 | 0 | 1,430 | 440 |
| `team_work` | 359,596 | 91,452 | 1 to 1 | 341 | 73 |
| whole health reading (other callers) | (as `thinking`) | 86,834 | 2 | 815 | 51 |
| worker idle pass (67 statements) | 2,029 | 2,024 | 0 | 16.4 | 14.6 |
| `model_order` | 47,695 | 47,695 | 1 | 79 | 55 |

The earlier replica understated the pulse and the heap scans (it held a 14 MB heap against production's 94 MB), so the pulse saving is smaller
here (-33%) than first reported (-45%), `thinking` is larger, and the worker pass saving did not reproduce. Local browser: an established
office makes 8 requests on load (was 15, `thinking` twice); a signed-in person with no office 2 and no polling (was 16 plus 6 a minute); a refused
credential 1 and none (was 8 plus 6 a minute); on both a desktop and a phone profile and for a public Sample visitor.

## 8. Compute reassessment (after reconciliation)

* **How much normal recurring work was removed?** For one open tab, per poll (pulse plus thinking): 845k to 71k buffer hits (**-91.6%**), so
  about 2.5M to 0.21M a minute. A page load or a refresh (studio, lately, unseen, team_work, pulse, thinking): 3.84M to 1.12M hits (**-71%**) and
  about 4.5 s to 0.9 s of database time. The worker's idle pass (about 2k hits a minute) was already small and is unchanged.
* **What expensive normal paths remain?** (1) The pulse: two heap sequential scans of `jobs`/`outputs` every 20 s per tab (71k hits). (2) Each
  refresh re-reads the studio payload (680k hits) whenever the digest moves, which is whenever any job changes state, per tab. (3) `unseen`
  (228k). (4) `studio_activity`'s per-output harness check. (5) `model_order`, O(usage history), per model call. (6) 10 non-HOT updates per job.
* **Production-only unknowns:** the number of tabs open and for how long; how often the digest moves; real row widths and TOAST; the real
  planner choices on production statistics; the host's behaviour under any of this; whether growth is data or harness residue.
* **Nano after these optimisations:** the single largest measured recurring load (Team HQ polling) fell about 90%, which moves Nano toward
  sufficient for CPU and buffer traffic, but the evidence for the host (434 MiB, constant paging at idle, three outages before multi-user work) is
  not about this load. **NOT YET DETERMINABLE.** The nearer hard limit is storage (500 MB; 371.8 MB on 5 Oct, growing 17 to 26 MB a day).
* **The measurement that would settle it:** after an approved staged rollout of 1023 to 1028 (migrations, then `hq-api`, pages), compare 24 hours
  before and after on production: `pg_stat_database` (blks_hit, blks_read, temp_bytes) rates, the cron job-1 duration series, platform health
  episodes, and gateway request counts per minute with the number of distinct signed-in tabs. Production's own statistics, not the replica, decide.

## 9. Where the audit runner was preserved

`scripts/forensics/audit-reads.ts` (sha256 `7d40361b...0f909c`) was moved out of the repository, not committed anywhere and not discarded:
`/root/evidence-preserved/audit-reads.ts` and a second copy under the session scratchpad `.../scratchpad/evidence/audit-reads.ts`. The repository
has no untracked file left from this work.

## 10. Needs Grant's approval

1. Authorise Q1 to Q4 (and Q5/Q6 if Tier A calls for them) of `db-growth-readonly-query-set.md`. 2. Approve any production migration, in the
order below. 3. Approve deploys of `hq-api`, the page and the worker. 4. Decide the held items: window `model_record`, move the lease, change the
poll, any index, retention/archiving/deletion, `shared_buffers`, compute size or plan, Vercel deployment cleanup. 5. Whether the Sample branch should
be merged to integration by someone else instead of being carried here (this branch carries it).

## 11. Staged rollout (for later approval) and rollback

Rollout: (a) read Q1 and Tier A; (b) apply the Sample-era and integration migrations as already queued (separately approved); (c) apply 1023,
1024, 1025, 1027 one at a time, checking the canary and `forensics:budget` between; (d) apply 1028, then deploy `hq-api`; (e) deploy the page
(fingerprinted, `--force` available); (f) deploy the worker; (g) observe 24 hours. Rollback, reverse order: worker, page, `hq-api` (before dropping
`cannot_think`), then re-apply the frozen definitions in `scripts/isolated/reference/*` (function-only, no data changed).
