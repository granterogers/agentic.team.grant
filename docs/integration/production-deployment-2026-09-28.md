# Production deployment — backend + Team HQ integration, 28 September 2026

The integrated release candidate from
`docs/testing/integration-rc-2026-09-28.md` is on `main` and deployed. This
file records what production was changed from and to, every acceptance result,
and what is left.

## What changed in production

| | Before | After |
|---|---|---|
| Migrations | 604 applied (latest `0591`) | **612** — `0592`–`0599`, applied once each, in order, all exit 0 |
| `worker` | v837 | **v841**, built from `bc55608` (v839 was the interim `9830a26` build) |
| `ai-team-hq` page | `dpl_DwDy6otbfEEkxncUhvoPPtdHzXnr` | **`dpl_GwmxkoNNac7MmfKia4VWVmxszdFD`** |
| Other edge functions | code as recorded | **code unchanged** (see the version note below) |
| `agentic-team-hq-basecamp` experiment project | `dpl_5N6b5JTB…` | untouched |
| `main` | `d1c9247` | the head of the branch carrying this file (fast-forward) |

**No secret, environment variable, SSO setting or allow-list value changed.**
`deploy:worker` rewrites three function secrets, and all three were proved,
by digest and before running it, to already hold the values it writes. Doing
so bumps the version number of every edge function without redeploying it:
`hq-api`, `voice`, `signin` and the rest now read two higher, and their
`updated_at` timestamps all predate this deployment.

**The page** was deployed as production's own file list with only the
candidate's 14 changed studio files replaced, at both served paths (28
entries, 14 uploads). The other 157 files were reused by digest, including
`config.js`, `vercel.json` and the notebook functions. The deployed file tree
matches the manifest for all 185 files, and the public URL serves the
candidate's bytes. `deploy:hq` was not used, because it also redeploys
`hq-api`, upserts a Vercel environment variable and sets a function secret
(#370 item 10).

## The candidate, and the defect acceptance found

`9830a26` passed every migration and backend acceptance gate on v839. The
production #374 check then found that after *"ok thanks"* the office asked for
a yes or no, and then *"yes please"* answered nothing. The spoken-answer lookup
read only the questions raised by the turn immediately before, and the
acknowledgement's turn raised none.

Deployment stopped there and Grant chose to fix it and continue. `bc55608`
binds the clarification's turn to the one blocker it asked about, and the next
reply may answer only that blocker: while it is open, from the turn
immediately before, in the same chat. Worker only; no migration. The
migration-ledger commit `448e8fb` sits between the two, so the repository
records that `0592`–`0599` are applied.

| Proof | Result |
|---|---|
| `scripts/isolated/acknowledgement-sequence.ts` (real handler, 4 channels) | **36/36**; 24/36 on `9830a26`; 24/36 without the binding; 32/36 with an any-question-in-the-chat lookup, because the stale-question control catches it |
| `tests/agents/spoken-answer.test.ts` | 59/59; 1 red on `9830a26` |
| `scripts/isolated/run-all.sh` | all pass |

## Acceptance, in production

| Check | Result |
|---|---|
| `verify:approval-race` | 1/1 |
| `verify:retry-writes` | 6/6 (rolled back) |
| `verify:task-state` | 8/8 (rolled back) |
| `verify:anchors` | 15/15 on v839. On v841, two runs hit the ten-minute ceiling: the second passed all 14 product checks, was killed inside its teardown, and its teardown assertion was checked by hand |
| `verify:composes` · `verify:mytasks` · `verify:pursues` | 19/19 · 89/89 · 47/47 (`task.create` restored byte-identical) |
| #374, deployed worker, harness conversation, announce closed | **19/19**: "ok thanks" leaves the question open → "yes please" resolves the ORIGINAL question once and starts nothing; the "no thanks" path declines it; 0 deliveries |
| Deployed Team HQ, signed in, read-only (desktop + phone) | **20/20**: the office's own data, project home, Chat composer, voice-note control, To-dos and legacy Studio render; 35/35 office reads 2xx per device; no write attempted; 0 page errors |
| Fake-office suites on the deployed bytes | voicenote 48/48 · failures 50/50 · stale-answer 8/8 · todos 30/30 · journey 56/56 |
| Live site suites against `ai-team-hq.vercel.app` | waiting 17/17 · running 9/9 · sources 9/9 · team 12/12 · signin 17/17 · docorder-live 21/21 · photo 11/11 · drive 26/26 · arrangement-live 7/8 then 8/8 |
| `verify:basecamp-todos-live` | 22/25 twice: **harness race, not a product defect**. The suite reads the task once, 4 s after the drop. A probe of the same footprint showed the deployed page sends `task_state → blocked` with the true reason and the office moves the task; the round trip took 5.0 s and 7.0 s |
| `verify:basecamp-addsource` | 9/10 twice: **stale wording assertion**. The UX branch deliberately renamed the card label "Something to read" to "A link to read" (`a165a04`); the suite's pattern does not accept the new words |
| `verify:basecamp-live` | not applicable to this host: its first step expects Basecamp at the site root, which is true only of the experiment project (the 24 Sep promotion recorded the same) |

## Reconciliation

- **Health:** `app.office_health()` shows 0 failed, 0 stalled, 0 waiting, 0 failing kinds.
- **Grant's state:** real tasks (15), autonomy settings, contacts (0), active projects (5), open questions of his (4) and real lessons (143) are **byte-identical** to the pre-deployment snapshot.
- **Deliveries:** 16 were sent during the deployment, **every one a scheduled duty**. `check:leaks` shows 38 known / **0 new**; the increase from 22 is 0598's reclassification of historical escapes, which was predicted.
- **Harness jobs:** 72 created by acceptance, all terminal.
- **Debris:**
  - Seven archived proof projects from the acceptance suites (they hold jobs, so they cannot be deleted).
  - The teardowns of two timed-out `anchors` runs were completed with the suite's own statements.
  - Two to-dos created by the #374 acceptance question were removed.
  - Two `verify:pursues` harness questions remain open on cancelled jobs, as #372 records: never shown to Grant, never deliverable.
- **Incident:** one harness child job was briefly visible as queued between two statements of the first #374 acceptance script. The live worker ran it, and it wrote "There was no plan to carry out"; nothing was delivered or created. The script was corrected to create and cancel in one transaction.

## Rollback

- **Page:** instant rollback of `ai-team-hq` to `dpl_DwDy6otbfEEkxncUhvoPPtdHzXnr`.
- **Worker:** redeploy an earlier build. `main`'s old worker (v837) is compatible with `0592`–`0599`, but it brings back "ok" = yes and loses R45, R46 and R48.
- **Migrations:** there is no down-migration; see the integration report, §13.

## Remaining known debt

- **#373**: dashboard turns carry no project.
- **#371**: two worker residuals; the unasked-question sweep has 0 exposure today.
- **#375**: minor findings, now with four more:
  - `verify:pursues` commits its "rolled back" revocation;
  - `todos-live`'s single fixed-wait read;
  - `addsource`'s stale wording;
  - `basecamp-live` assumes the experiment host.
- **#372** and **#344**, as before.
