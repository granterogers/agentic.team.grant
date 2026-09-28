# AGENTIC TEAM — INTEGRATION & RELEASE-CANDIDATE REPORT, 28 September 2026

Integration branch `claude/agentic-team-integration-rc-dx8x7e`. **Nothing was
deployed, no production migration was applied, nothing was merged to `main`,
no message was sent to anybody.** Every production contact in this pass was a
read-only `select` (or `migrate --dry`).

## 1. Source and final SHAs

| | SHA |
|---|---|
| `main` (verified, unchanged) | `d1c9247adc78c840c953c10450c81225a097e62c` |
| backend `claude/jolly-darwin-8rwmp3` (verified) | `dcc03386` — 70 commits over `main` |
| UX `claude/dazzling-dirac-acjwqf` (verified) | `a8ed7e87` — 35 commits over `main` |
| merge base of the two | `d1c9247` |
| integrated candidate | the head of this branch, which carries this report (the commit hash is given in the reply that accompanies it) |

## 2. Integration method and conflicts

The two branches were merged with two `--no-ff` merges, backend first (`256c8cc`) and then UX (`a932c9c`).

**Textual overlap.** Only `package.json` overlapped. The script lines that each branch added were disjoint and auto-merged.

**Semantic analysis before any test was believed:**

- **Backend footprint.** `src/`, `migrations/0592–0599`, `scripts/isolated`, and the checks and suites. It changes no frontend file.
- **UX footprint.** `web/studio/bc/*`, `app.js`, `data.js`, `prose.js`, and the Basecamp suites. It changes no migration, edge function or API contract.
- **Shared contracts inspected:**
  - `/voice/turn` session shape. 0598 is deny-by-default, and UX added new routes to that door.
  - The reply `hq_answer_blocker` gives to a question that is no longer open (0596), read against how both pages word an answer.
  - Task states: 0594's "cancelled is not open", read against the Basecamp To-dos and the legacy My tasks.
  - The chat failure flags, read against the backend's new outcome wording. The UX side detects failure by flags, not by text, so they are safe together.
  - The delivery keys (R46).
  - The overload risk of `my_task_referent`'s new signature.
- **After integration.** Backend code in the candidate is byte-identical to `dcc0338`. The frontend differs from `a8ed7e8` only in the integration fix (§5).

## 3. Backend guarantees verified

Every proof was re-run on a replica that I first made faithful (§5.1).

| Guarantee | Evidence |
|---|---|
| R48: one stalled job cannot stop the office (0599 + a sweep that is never fatal) | recovery matrix PASS; the drain survives a raising sweep: PASS |
| R45: answering an approval performs the step once | `approval-execution` 15/15 |
| R46: the question reaches him once; harness questions are suppressed; a failed send is not looped; a question answered elsewhere is not asked | `approval-delivery` 9/9 |
| R37/0598: containment, including children of harness work | `containment` 17/17; **without the migrations 14/17** (control) |
| 0596: overlapping answers perform once | PASS; **without 0596 two children** (control) |
| 0598 on today's production data (read-only; the predicate evaluated inline, no DDL) | Every job it newly calls harness is a scripted shape (`scenario-a-*`, `deploy*`, `probe*`, `uxfix1`, `browserprobe`, and two developer probes of 7 Sep quoted in the voice door's own commit). **0 page-shaped sessions affected.** |
| Unit, lint, typecheck | **3525/3525** (3505 backend + 4 UX + 16 integration); lint and typecheck clean |
| Static and DB checks | exit 0: `check:migrations`, `secrets`, `templates`, `voice-sessions`, `icons`, `leaks` (22 known / 0 new; witnesses 1/0 and 18/0), `callers`, `consumed`, `pressable`, `gateway-wrappers`, `capabilities`, `answerable`, `standing`, `undo`, `believes`, `chatter` |

## 4. UX guarantees verified

Every suite below ran against the working tree with production credentials removed from the environment and every office request intercepted.

**Basecamp gate:**

| Suite | Result |
|---|---|
| covered, classes, actions | pass |
| home | 45/45 |
| routes | 64/64 |
| journey | 56/56 |
| keyboard | 31/31 |
| preservation | 26/26 |
| states | 80/80 |
| docs | 27/27 |
| reconcile | 21/21 |
| controls | pass |
| chat (SUBJECT=source) | 30/30 |
| measure | 0 violations |
| **stale-answer (new)** | 8/8 |
| **voice-session (new)** | 6/6 |

The home, journey, keyboard, states and controls suites were re-run after the integration fix.

**Gate 2, fake-office legs:**

| Suite | Result |
|---|---|
| board | 35/35 |
| todos | 30/30 |
| cards | 24/24 |
| back | 20/20 |
| contacts | 31/31 |
| **voicenote** | **48/48** |
| **failures** | **50/50** |
| livevoice | 28/28 |
| voice | 16/16 |
| settings | 34/34 |
| words | 22/22 |
| affordance | 16/16 |
| torture | 31/31 |
| touch | 28/28 |

**Legacy Studio:** `smoke` pass, `verify:wired` clean (78 attributes, 21 screens), `verify:ui` 54/54.

**Voice notes, specifically:**

- Recording stops when its composer disappears.
- The dock and Chat page instances do not steal each other's recording.
- A redraw cannot restore Send mid-transcription, and a failure is not erased.
- The dock files under the project it shows.

All of these come from the voicenote suite, 48/48 on the merged code. The transcript then takes the typed path, and `cleanDictation` is applied to every instruction in the worker.

**Gated, not run:** the `basecamp-look` writer leg (17/19; both failures read *"SUPABASE_ACCESS_TOKEN is not set"*), and the live Basecamp suites that write to production (#375 item 8).

## 5. Cross-boundary defects found, and what was done

1. **HARNESS DEFECT: the isolated replica was not faithful.** `replica.sh` piped psql into `grep -q ERROR`, and psql died of SIGPIPE mid-file. The replica lacked 33 app/public functions, `public.enqueue_inbound` among them. After the fix, 806/806 function bodies are md5-identical to production and 1366/1366 columns are identical. All proofs pass (`e635b4f`).
2. **LOCAL PRODUCT DEFECT (backend, found by the adversarial review): the worker could not be deployed.** `worker.ts` imported `../agents/stray-quotes.js`. tsc and vitest resolve that name to `.ts`; `deploy:worker` reads it literally and would have hit ENOENT, *after* the migrations had been applied. The new `tests/jobs/bundle-resolves` failed on 2 tests before the fix and passes 10/10 after (`a2e8fc44`).
3. **SYSTEMIC CROSS-BOUNDARY DEFECT: a question answered elsewhere was reported as answered by the press.**
   - Why it only exists after the merge: R46 and R33 put one question on Telegram and on the dashboard at once, and 0596 answers the second with `{already:true, resolution}`. Both pages said *"Answered."*, even when his real answer was the opposite.
   - Fix: `office.js` `alreadyAnswered()`. The Basecamp record stays open so the sentence can be read; the legacy page does not refresh it away. Withdrawn and expired questions are worded as such (`9733bf0`, `b0661c6`).
4. **Proved cross-boundary, no defect.** Every session the Basecamp page actually sends is one 0598 calls real. Both composers share one session per visit (`8820ce7`).

## 6. Migration verification

- **Pending set.** `migrate --dry` against production (read-only) would apply exactly `0592` → `0599`. Production has 604 applied, the latest `0591`. The UX branch adds none.
- **Clean build.** On the faithful replica, `0592` → `0598` apply with `ON_ERROR_STOP -1`, and then `0599`. Each file is one transaction under the Management API, so a failing data assertion rolls that file back alone.
- **Signatures.** Only `my_task_referent` changed. It drops the old signature first, has no public wrapper, and gives its new parameters defaults, so the **currently deployed worker** keeps working when the migrations land first. The branch worker falls back if the migrations are absent.
- **Recursion cost.** 0598 makes `app.harness_job` recursive. The depth is bounded (max depth 3; 1,442 child jobs out of 17,460). A current full-table scan of the predicate takes 580 ms.

## 7. Tests run: failures, retries and gated tests

- **Failures diagnosed during the pass:**
  - `basecamp-look` 17/19: needs the production token. Gated.
  - My first voice-session draft could not see the dock on the Chat page. That was a harness error, fixed by in-app navigation.
  - My first stale-answer draft had a vacuous check, because the record closed before the text was read. Fixed with a mutation observer.
  - `bundle-resolves` first flagged `slack-events` and `telegram-webhook`. Those functions are deployed by named copies, not by the graph walk, so they are now scoped out with the reason written down.
- **One batch ran past the ten-minute shell ceiling** and continued in the background. After that, every suite ran in its own call.
- **Not run:**
  - The backend in-process suites against the live database. They create harness traffic in production, and one of them caused R48.
  - `verify:slack` (creates channels that cannot be deleted) and `verify:latency` (messages Grant as Grant).
- **Red by design until the migrations apply:** `verify:approval-race`, `verify:retry-writes`, `verify:task-state`.

## 8. Negative controls: each new test proven able to fail

| Test | Sabotage | Result |
|---|---|---|
| stale-answer | unfixed code | 5/7 |
| stale-answer | the keep-open line removed | 7/8 |
| already-answered unit | helper silenced | 2/5 red |
| already-answered unit | withdrawn branch removed | 1/6 red |
| voice-session | page mints `sess-…` | 5/6 |
| bundle-resolves | the defect itself | 2 red; its fixture control must be reported missing |
| containment | no migrations | 14/17 |
| 0596 race | without 0596 | 2 children |

## 9. Production-safety reconciliation

- **Reads only.** `select` queries and `migrate --dry`. No enqueue, no write, no deploy, no alias change, no autonomy change, no message sent.
- **Recent harness jobs.** The 93 harness jobs in production's last 5 hours all predate this session (the last was at 09:37 UTC; the backend completion pass). This session created none.
- **Containment.** `check:leaks` shows 0 new escapes.
- **Office health.** `office_health`: no failing kinds, 0 stalled.
- **Isolation.** Browser suites ran with the credentials unset and offices intercepted. Replica proofs are refused by `guard.ts` anywhere but a marked local socket.

## 10. Remaining blockers and non-blocking debt

**No open blocker is a regression against `main` that the candidate ships unfixed.**

Needs Grant's judgement before or at review:

- **#374.** With R46 delivering questions to his chat, a reflexive *"ok thanks"* approves whatever was just asked, including a level-3 step.

Non-blocking:

- **#373 (P1, pre-existing).** Dashboard chat and voice-note turns carry no project, so a note on project A can land on `unnamed`.
- **#371 residuals** (commented there):
  - A paused job whose question the coherence gate refuses throws an illegal transition, and the question never reaches his chat. Pre-existing.
  - `askUnasked` re-asks every tick when there is no delivery row. New, latent. Production exposure today is **0**.
- **#375.** Eight minor items: retry argument order, "Ask again" while slow, a spoken-answer race, scratch scripts with production defaults, source-text tests, cancelled shown as done, a composer race, and the live suites that are still to run.
- **#344 (pre-existing).** A fresh-install migration corpus dies at 0534.

## 11. Proposed deployment order

1. **Pre-flight, read-only:**
   - `npm run migrate -- --dry`: expect exactly `0592`–`0599`.
   - The #371 query: open questions on `paused`, `announce` jobs with no `blocker:%` delivery. Expect 0; if it is not 0, read them before deploying the worker, because the sweep will ask them.
   - `check:leaks`: expect 0 new.
   - `app.office_health()`: expect 0 stalled.
2. **Migrations:** `npm run migrate`. They apply in order, one transaction per file. Stop at the first failure.
3. **Worker:** `npm run deploy:worker`. Bundling is now proven by `bundle-resolves`, and the deploy probes itself.
4. **Frontend:** the static `web/studio` deploy, through the existing `deploy:hq` / Basecamp site path.
5. **Voice function:** `deploy:voice`, only if the probe renames are wanted. This must come after 0598. The branch's deploy script already names its probe `verify-deploy-…`.

## 12. Post-deployment acceptance plan

1. **The three suites gated on the migrations:**
   - `verify:approval-race`: expect 1/1.
   - `verify:retry-writes`: expect 6/6.
   - `verify:task-state`: expect 8/8.
2. **The backend's list:** `verify:anchors`, `verify:pursues`, `verify:composes`, `verify:mytasks` (give it the full 600-second ceiling).
3. **The live Basecamp suites** in #375 item 8, one per call.
4. **The browser against the deployed pages,** after `npm run trust:proxy-ca`:
   - Answer one fixture-project question on the dashboard; see "Answered.".
   - Answer it a second time; see "already answered: …".
5. **Checks:** `check:leaks` expecting 0 new, `check:voice-sessions`, `check:answerable`, and `app.office_health()`.
6. **Watch** the first hour of `job_impediments` for `the sending path` rows repeating (the #371 residual 2).

## 13. Rollback considerations

- **Frontend.** Static. Redeploy the previous bundle. It has no dependency on the migrations.
- **Worker.** Redeploy `main`'s worker. It is compatible with 0592–0599: it calls `my_task_referent(uuid)`, which the defaults serve, and 0598 and 0599 only make containment stricter and recovery safer.
- **Migrations.** They are functions and data. There is no down-migration. Rolling a function back means re-creating the previous body from `main`'s migration files. Do not remove the `known_escapes` rows 0598 adds: that is evidence. 0593 dropped the old two-argument `my_task_referent`; if you restore it, restore it by exact signature.
- **The behaviour a rollback would lose:** the R48 stall protection, R45/R46 approvals, 0596's locking, and the 0598 containment widening. Rolling back the worker alone keeps the SQL halves.

## Conclusion

READY FOR CONTROLLED PRODUCTION DEPLOYMENT REVIEW
