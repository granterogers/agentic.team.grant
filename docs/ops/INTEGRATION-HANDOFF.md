# Integration handoff — Production Reliability

**Written 22 September 2026. Branch `claude/production-reliability`, HEAD
`4d00bf5`. Committed, pushed, working tree clean, 0 unpushed commits.**

## 1. The headline: integration has already happened, in the other direction

**`4d00bf5` is an ancestor of `origin/claude/human-simulation-harness`
(`0e8050e`).** Verified now, not previously:

```
git merge-base --is-ancestor HEAD origin/claude/human-simulation-harness   -> yes
git log --oneline origin/claude/human-simulation-harness..HEAD | wc -l     -> 0
```

**Zero of the 18 commits are missing from the sibling.** It absorbed this
branch at **04:57** today in `376be3d` *"integrate
claude/production-reliability, and keep the collision as history"*, resolving
one conflict — `package.json`, where both branches added npm scripts — by
keeping both sets.

So there is no merge to perform from this side. What remains is bookkeeping
and the post-merge proofs below.

### The clean merge re-verified as of now

| Check | Result |
|---|---|
| `merge-tree HEAD × sibling` | exit 0, single tree, **no conflict lines** |
| reverse direction | exit 0 |
| `merge-tree HEAD × main` | exit 0 |
| `main` is an ancestor of HEAD | yes — **no main changes to absorb**; main is still `3c94150` |
| `src/db/executor.ts` in the merged tree | **`status >= 500` present at line 133** |

## 2. Integration map

### Commits and files unique to Production Reliability

18 commits, 37 files against `main` — **all already in the sibling**:

- **9 migrations:** `0535`–`0538`, `0540`–`0544`
- **3 source files:** `src/db/executor.ts`, `src/handlers/chores.ts`,
  `supabase/functions/hq-api/index.ts`
- **1 unit test:** `tests/db/a-gateway-error-is-not-an-answer.test.ts`
- **10 verify/tooling files:** `verify/escapes.ts`, `backups.ts`,
  `journals.ts`, `resumes.ts` (new); `artifact-slack.ts`, `chaos.ts`,
  `collaborates.ts`, `progress.ts`, `transport.ts`, `check-leaks.ts`,
  `e2e.ts`, `backup/rehearse-restore.ts` (changed)
- **2 scratch tools:** `scratch/apply-one.ts`, `scratch/kick-probe.ts`
- **9 docs** under `docs/ops/`
- `package.json` (npm scripts — the one merge conflict, resolved by union)

### Already incorporated by the sibling

**Everything.** All three source files are **byte-identical** to this
branch's, and all three markers are present in their tree: `status >= 500`,
`chores_for_backups`, `kickWorker`.

### Conflicts and migration-number collisions

**One collision, and it must not be "fixed".** Both branches took `0543`
eleven minutes apart and **both are applied**:

```
0543_an_offer_a_harness_made_is_not_an_offer.sql   applied 21 Sep 21:53:58  (sibling)
0543_a_failed_backup_reaches_grant.sql             applied 21 Sep 22:04:49  (this branch)
```

`app.schema_migrations` is keyed on NAME, so both rows are real and the
database is correct. They touch disjoint functions —
`app.harness_suggestion` / `app.hq_governance` against
`app.page_backup_failure`.

**`npm run check:migrations` is RED on the merged tree** with
`[sequence/duplicate] sequence 0543 used by 2 files`. Confirmed from
`src/migrations/check.ts:135`.

> **Renaming either file is UNSAFE.** Both are applied, and the check also
> refuses an applied migration that is no longer on disk
> (`[checksum/missing]`) — encountered live in this session. Renaming one
> would orphan its applied row and trade a duplicate for a worse finding.
> The safe resolutions are to accept the duplicate (widening the check to
> permit a recorded, deliberate collision) or to leave it red and
> documented. **Do not renumber.**

For completeness: `check:migrations` was *also* red on this branch alone, for
the mirror-image reason — `[sequence/gap]` at 0534 and 0539, the sibling's
files. The gaps close on merge; the duplicate appears. It is red either way
until somebody decides about 0543.

### Database migrations already live

All nine of this branch's migrations are applied:

```
0535 0536 0537 0538 0540 0541 0542 0543 0544
```

### Code currently deployed

| Component | Version | Deployed | Carries this branch's work? |
|---|---|---|---|
| `worker` | **v681** | **22 Sep 06:19 UTC** | **yes** — built from the merged tree; the merge landed 04:57, v673 was deployed at 05:22 and v681 at 06:19 |
| `hq-api` | v682 | 21 Sep 18:47 UTC | **yes** — deployed by this workstream; the same code is in the sibling |
| `telegram-webhook`, `voice`, `slack-events`, `mcp`, `google-oauth` | — | unchanged | not touched by this branch |

### Code still undeployed

**None of this branch's code remains undeployed.**

`src/db/executor.ts`'s 5xx handling — the one item this branch previously
reported as undeployed — is in the deployed lineage: the worker was deployed
twice from a tree containing `status >= 500`, after the merge that brought it
in. The sibling's own commit `92a56ac` records running `verify:escapes` and
`verify:backups` green against that deployed worker, **including both of
`verify:escapes`' controls**.

**What is still NOT proven about it:** neither session has injected a live
Management-API 5xx, because the gateway cannot be made to return one on
demand. The behaviour is covered by six unit tests in
`tests/db/a-gateway-error-is-not-an-answer.test.ts`, proved by sabotage
(reverting to `[429, 503]` turns exactly the three 5xx cases red and leaves
the throttle, the 400 and the 401 green). Treat it as *deployed and
unit-proven, not live-proven.*

## 3. Preserved evidence — do not remove

**Two escaped-delivery rows, 21 Sep 21:09:28.** Telegram `message_id 1265`
to Grant's own chat, and one Slack message, both from `verify:history` before
0541/0542 closed the send-time hole. They are the only evidence the guard
ever had a hole.

`npm run check:leaks` is **RED for exactly this and nothing else** — every
sweepable class reads 0: fixture tasks 0, harness tasks on his list 0,
personal tasks with a run token 0, probe providers 0, fixture connectors 0,
stranded autonomy rows 0, test destinations registered 0, harness tools 0,
retired fixture specialists 0.

```
harness traffic that reached a real destination SINCE the guard: 2 · refused by it: 86 · before it existed: 162
```

**Do not delete or reclassify them to make the check green.** The counter is
unwindowed by design; making it green requires a deliberate decision from
Grant, not a cleanup.

**Shadow Grant's in-flight harness artifacts were never touched.** At the
time of the final gate run they numbered 11 tasks across three runs; their
own teardown has since cleared them and the count is now 0. This session
swept only rows it could positively attribute to its own gate runs.

## 4. REQUIRED POST-MERGE PROOFS

Three are already done by the sibling against the deployed worker and are
marked so. The rest are outstanding.

| # | Proof | Status | How |
|---|---|---|---|
| 1 | Deploy the combined worker | **DONE** — v681, 22 Sep 06:19, from the merged tree | record the version each time |
| 2 | Management API 5xx is treated as transport failure and retried | **partial** — deployed and unit-proven; **not live-proven** | `npm test -- tests/db/` (6 tests). A live injection needs a gateway that can be made to fail; if one becomes available, prove it end to end |
| 3 | Synthetic/harness traffic cannot reach Telegram or Slack | **DONE by the sibling against v673**, controls included | `npm run verify:escapes` — re-run against v681 |
| 4 | A terminal backup failure pages Grant exactly once | **DONE by the sibling** (`verify:backups` green) | `npm run verify:backups` — six scenarios incl. once-only, cooldown, harness-never, recovery, timeout-retry |
| 5 | Team HQ still kicks the worker correctly | **outstanding** | `npx tsx scripts/scratch/kick-probe.ts <a fixture project uuid>` — expect pickup in single-digit seconds against a ~46 s no-kick baseline |
| 6 | The complete gate against the integrated HEAD | **outstanding** | 45 checks, in segments; the gate exceeds ten minutes and must not be backgrounded. Expect `check:leaks` red (§3) and `check:migrations` red (§2) |
| 7 | No production or test debris introduced | **outstanding** | `npm run check:leaks` and confirm every sweepable class reads 0 |

## 5. DR limitations — unchanged, and not to be softened

- **No offsite backup.** The only copy is a private bucket inside the
  Supabase project it protects. **Logical corruption is covered; loss of the
  project is not — the backup goes with it and no RTO figure applies.**
- **Vault / credential recovery is not demonstrated.** `vault-export` has
  never run. A restore yields a working database with **36 credentials to
  re-enter by hand**, several behind third-party consent flows.
- **9 m 46 s is DATABASE RESTORE TIME, not complete service RTO.** It is the
  measured round trip for 153,259 rows across 122 tables. Full recovery also
  needs a provisioned project, 540 migrations, 8 edge functions, the pg_cron
  heartbeat and three re-authorisations. **That total has never been measured
  end to end.**

## 6. What would make merging unsafe

1. **Renumbering either 0543.** Both are applied; renaming orphans an applied
   row. See §2.
2. **Deploying the worker from `claude/production-reliability` alone.** It
   lacks the sibling's 20+ `src/` files and would roll their work back. The
   next worker deployment must come from the reconciled codebase — as the
   current one did.
3. **Deleting the two escaped-delivery rows** to make `check:leaks` green.
4. **Cleaning another session's in-flight harness state.**
5. Treating `check:migrations` or `check:leaks` red as a blocker without
   reading §2 and §3 first — both are red for known, documented, deliberate
   reasons.
