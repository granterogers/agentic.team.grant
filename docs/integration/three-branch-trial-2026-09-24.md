# Three-branch trial integration — 24 September 2026

**Disposable candidate. Not merged into `main`, not deployed, not canonical.**
Plan: `docs/integration/three-branch-reconnaissance-2026-09-24.md` (written on
`claude/gracious-volta-48lh36`, on `main` since 29 September).

**Verdict: TRIAL INTEGRATION VERIFIED — READY FOR MAIN-MERGE AUTHORISATION.**

The first pass (below, from "Inputs" down to "Before `main`") ran without
credentials and ended BUILT — VERIFICATION BLOCKED. The second pass, recorded
in **Live verification** at the end of this file, ran every one of those
blocked gates against the live office and an isolated preview. It made **no
change to the candidate**. The integration code is still `60ba0b3`, and the
commits after it are documentation only.

## Inputs (frozen, verified to exist; none moved during the trial)

| | SHA |
|---|---|
| `main` | `3c9415084f4b2664bf8147d995412609e58a24f8` |
| Backend `claude/human-simulation-harness` | `3bb5bb828cf3485ceebeee706173c707c5a1cc92` |
| Production `claude/production-reliability` | `7be135f02325fb2c4cecb1fbd661da59285aacdb` — inherited through Backend, not merged |
| Frontend `claude/basecamp-team-hq` | `9c51e1e3b4bb1e0c0e2654ecbfb7de0fb7804ab7` (code = `129a706`) |

## Commits created for the integration

| Commit | What | Files |
|---|---|---|
| `40b1dc1` | merge of Frontend into Backend; parents `3bb5bb8`, `9c51e1e` | conflicts: `CLAUDE.md`, `package.json`, `scripts/check-leaks.ts`, `supabase/functions/hq-api/index.ts` |
| `0bb505b` | `contact_photo` kicks the worker after a successful write | `supabase/functions/hq-api/index.ts` |
| `39b59bd` | `check:tokens` understands an experience (`scripts/check-tokens.ts` from `c6f74cf` only) | `scripts/check-tokens.ts` |
| `60ba0b3` | callers baseline −3 | `docs/testing/callers-baseline.json` |

plus this document.

## Conflict resolutions

- **`package.json`**: the two disjoint script blocks joined. 373 scripts = main 277
  + Backend 35 + Frontend 61, with every value checked programmatically against
  its owning side (0 mismatches, 0 extra, 0 lost). Dependencies are identical
  on both sides.
- **`CLAUDE.md`**: both appended trap blocks kept. Every line either side added
  is present; the only removed lines are Backend's own two-line edit.
- **`hq-api/index.ts`**: Backend's `WORKER_URL`, `WORKER_KICK_SECRET` and
  `kickWorker()` are kept, and `kickWorker` gets its own closing brace; all of
  Frontend's `googleToken()` onward is kept. Every change hunk from both sides
  is present. `biome ci` and `esbuild` both parse it, and both were shown to
  go RED on the missing-brace version.
- **`check-leaks.ts`**: a comma after `harness_on_his_activity_panel` and a new
  `/*` for the harness-contacts comment. libpg-query parses all eight SQL
  statements and was shown to reject both the plain concatenation and the
  missing comma.

## Reconciliations

1. **`contact_photo` kick.** The generic dispatch kicks after `done.ok`;
   `contact_photo` returned before it and its `callRpc` never read the RPC
   status. It now records `r.ok` and calls `kickWorker()` only when the write
   was accepted, on both the remove and upload paths. Response bodies are
   unchanged, and refusals (400/502) return before any kick. Kick call sites
   are now the definition plus four calls: contact remove, contact upload,
   document upload, generic dispatch.
2. **`check:tokens`.** Patch applied onto an identical parent blob (`9586171`). 831
   findings → 0, and no baseline entry added. Sabotaged three ways (a bad token in
   `studio.css`, a bad token inside the basecamp experience, a basecamp token
   used outside it); each exits 1 naming the use, and restored exits 0.
3. **Callers baseline.** `hq_document_order_set`, `hq_document_order_reset`
   and `hq_output` removed from `unreached` and from `why`: 15 → 12, and
   `why` now names exactly the 12. Real callers: hq-api `document_order_set`,
   `document_order_reset` and the `output` section; `web/studio/app.js`
   `act('document_order_set')`, `act('document_order_reset')` and
   `read('output')`. The checker is unchanged. **`check:callers` itself is
   BLOCKED.**

Not ported: `collisions.json` and its reader, 0592–0595, `7e07ede`,
`reconcile-production.ts`, the `check-provenance.ts` half of `655f906`, and
`0a8f030`'s `verify:review` selector fix (a pre-existing Frontend test defect
outside both basecamp gates).

## Fresh-install exclusion

`claude/fresh-install-onboarding` (`23ebdf1`) is not an ancestor; 0 of its
unique commits are reachable; `scripts/fresh/`, `migrations/baseline/`,
`migrations/collisions.json`, `src/migrations/collisions.ts`, 0592–0595: all
absent.

## Results

**Repository:**
- 604 migration files: 71 added since `main`, 0 modified, identical to Backend's set.
- 0 conflict markers in any tracked file of any type, and no untracked files.
- Gate: 57 members = Backend ∪ Frontend exactly; all Production members are present, and every member has an npm script.

**Static checks:**

| Check | Result |
|---|---|
| lint (`biome ci .`) | exit 0 |
| typecheck | exit 0 |
| `check:migrations` | 604/604, 13 `[sequence/collided]` notes, 0 errors |
| `check:secrets` | clean, 1,773 files |
| `check:templates` | clean |
| `check:pressable` | exit 0 |
| `check:backend-ref` | exit 0 |
| `check:tokens` | exit 0 |
| `check:gateway-wrappers`, `check:icons` | BLOCKED |

**Unit tests:** 3,124 passed in 194/195 files. The failing file,
`tests/sessions/weather-is-not-a-failure.test.ts`, exits on a missing token
and was reproduced identically on unmodified Backend: **category 3**
(environment). The handoff-named tests all pass: a-dead-turn-still-speaks
14, it-may-not-deny 17, quality-messages 3, provenance-order 40,
a-throttle-is-not-a-refusal 5, migrations check 47 and runner 19.

**Leak witness, four parts:**
1. **Static:** the `piles` select parsed by Postgres's grammar has 19 columns,
   exactly Backend's 18 plus Frontend's `harness_contacts`.
2. **Completeness:** the offline half is part 1 on the real SQL. The live half
   (the row keys returned by the database) is BLOCKED.
3. **Sabotage:** the real script was driven against a stub that throws on any
   unanticipated query. Clean run: exit 0, 22 known / 0 new.
   - All 18 failing witnesses go red when fed debris: sweepable, live,
     unknown namespace, lost origin, a new escape, label/job disagreement, and
     12 pile counters including `registered_test_destinations`,
     `harness_on_his_activity_panel` and `harness_contacts`.
   - The 7 reported-only columns behave identically on Backend and the
     candidate.
   - Controls: Backend alone cannot see `harness_contacts`; Frontend alone
     cannot see test destinations, the activity panel or the disagreement.
4. **Live output:** BLOCKED.

**Backend (read in the source):**
- The notifier reads the `jobs.announce` column.
- `lastWord` sets announce (line 229) before `notify` (line 233).
- The `say_once` arity follows `output.topic`, and the result fails open
  (`say !== false`).
- `src/` is identical to Backend's except `src/migrations/check.ts`.
- Every database check and `verify:*` in the contract: BLOCKED.

**Production (read in the source):**
- `kickWorker`: definition plus four calls.
- `registered_test_destinations` is present and proven able to fire.
- The executor treats 429/5xx as retryable.
- `chores_for_backups` is present.
- Every `verify:*` in the contract: BLOCKED.

**Frontend:**
- `type Verdict`, and the 401 / 503 split, are present.
- Nothing under `web/` names an office. The one `supabase.co` hit is a
  placeholder in a comment in `backend.js`.
- `session.js` exists; `chat.js` calls `session.forget()`; `office.js` clears only on 401.
- `config.js` is gitignored.
- ADRs 0043, 0047 and 0048 are present, and `check:backend-ref` is in the gate.
- `verify:basecamp-chat` (source) 30/30, and `--prove-it` goes red then green.
- `verify:talk` 39/40; the one failure is the deployed-voice probe (BLOCKED).
- `verify:ui`, `verify:tasks-ui`, `basecamp:gate2` and the `-live` suites: BLOCKED.

`check:backend-ref --prove-it` exits 2, "SABOTAGE DID NOT APPLY", and does so
identically on unmodified Frontend: a **pre-existing defect in the control**.
Its text anchor predates `office.js` importing `UNCONFIGURED`. The same
sabotage done by hand goes red naming `office.js:32`, and the restored file is green.

**`basecamp:gate`**, each step run separately:

| Step | Result |
|---|---|
| covered, classes, actions | pass |
| home | 45/45 |
| routes | 64/64 |
| journey | 55/55 |
| keyboard | 31/31 |
| preservation | 26/26 |
| states | 64/64 |
| docs | 27/27 |
| chat | 30/30 |
| controls | 423 pressed, 0 unpressable, 0 findings |
| measure | pass |
| look | 17/19 |
| reconcile | 19/21 |

`look` and `reconcile` give identical results on unmodified Frontend, and both
are environmental:
- `look`: its writer leg needs the vault's office token.
- `reconcile`: the sandbox proxy answers `office.invalid` with
  `ERR_TUNNEL_CONNECTION_FAILED`, which the suite does not expect.

**Preview:** not attempted — BLOCKED (needs Supabase and Vercel tokens). Nothing
was deployed; no alias, slug, secret or worker was touched.

## Findings for the record (not fixed — outside the trial's remit)

- **ADR 0047 is used twice on the merged tree.** Backend's
  `0047-migration-numbering-across-concurrent-branches` and Frontend's
  `0047-the-to-do-interface-talks-to-a-port-not-to-a-provider`. 0043 was
  already doubled on Frontend. These are docs, not a ledger; any renumbering
  is a decision for later.
- `check:backend-ref --prove-it`'s anchor is stale (above).
- `verify:basecamp-reconcile` treats the proxy's tunnel failure as unexpected.

## Before `main`

1. With credentials, in this order, sequentially:
   - `npm run migrate` (it must report Applied 0, skipped 604)
   - `check:leaks` (exit 0, 22 known / 0 new, every counter line present)
   - `check:callers`, `check:gateway-wrappers`, `check:icons`
   - the Backend §13 checklist
   - the Production §13 checklist
   - `verify:ui`, `verify:tasks-ui`, `verify:modules`, `verify:offline`, `verify:inverse` (#368 baseline)
   - `verify:hq` (46/47 expected)
   - `basecamp:gate` `look` and `reconcile` (writer leg)
2. The isolated preview: `HQ_API_SLUG=hq-api-trial3` via
   `scripts/deploy/hq-basecamp.ts`, a `VERCEL_PREVIEW=1` page, the four gateway
   probes, CORS from the real origin with `signin` still blocked, then
   `basecamp:gate2` against it.
3. Only then, a main-merge decision.

---

# Live verification — second pass, 24 September 2026

Credentials present (`SUPABASE_ACCESS_TOKEN`, `VERCEL_TOKEN`), checked by
presence only; no value was printed, logged or committed. Candidate verified
unchanged at `b959032` before starting; every frozen source ref unchanged at
the start and the end.

**Code changes made during this pass: none.** Every product and suite file
is byte-for-byte the candidate. What changed was the environment: the proxy CA
was trusted for Chromium (`npm run trust:proxy-ca`, verification left on and
checked with bad certificates), and `libnss3-tools` and `espeak-ng` were
installed in the container.

## Database

| Check | Result |
|---|---|
| `npm run migrate -- --dry` | 604 already applied, **nothing pending** (run first, so nothing could be applied by surprise) |
| `npm run migrate` | **Applied 0, skipped 604**; 604 recorded; 13 `[sequence/collided]` notes; no checksum finding; `applied.json` rewritten byte-identical |
| `check:leaks` | exit 0; **22 known, 0 new**; refused 330, and 333 after all live suites. The three added refusals are the three suppressed harness Slack sends attributed below |
| leak witness, live completeness | the integrated `piles` select run against the database returns exactly the 19 expected columns |
| `check:callers` | exit 0, 12 in the baseline. **Control:** with Backend's 15-entry baseline put back, it fails naming exactly `hq_document_order_reset`, `hq_document_order_set` and `hq_output` — "something calls it now". Restored: exit 0 |
| `check:gateway-wrappers` | exit 0; 151 routed functions, all reachable through PostgREST |
| `check:icons` | exit 0 |

One harness error of mine, found and corrected. The first live read of the
`piles` SQL sent the template literal's SOURCE text, so `\\m` reached Postgres
as a literal backslash and two columns read 0 where `check:leaks` said 5.
Evaluating the literal as JavaScript does made the two readings agree. The
five token-shaped tasks are reported-only by design. All predate this session
(the latest was created 12:33 today) and came from other sessions' suites. I
left them alone: Grant's list is his to tidy.

## Backend acceptance

- **Standing checks**, all exit 0: `check:answerable` (4 of his questions, all
  "starts work", 0 STARTS NOTHING), `check:believes`, `check:capabilities`,
  `check:standing`, `check:chatter`, `check:undo`, `check:consumed`.
- `verify:stop` 19/19 · `verify:lastword` 10/10 · `verify:escapes` 13/13.
- Deployed worker (not redeployed): no credential 401, wrong credential 401,
  kick secret 200.
- **`verify:another-go` 9/10, twice** — a HARNESS DEFECT, pre-existing on
  Backend:
  - All 147 files in the suite's transitive import graph are byte-identical
    between the candidate and `3bb5bb8`.
  - Unmodified Backend passed 10/10 against the same database in between.
  - The job rows show the mechanism. In both failing runs the first report
    child carries `state_reason = "not this suite's job"`: `ask()`'s dequeue
    loop cancels any in-scope job it did not ask for, and here that was its
    own first report. The repeat then correctly found nothing in flight.
  - In the passing run the deployed worker had claimed that child first. This
    is the repository's recorded "a suite takes its own earlier work" shape
    (#184/#273), decided by a race with the live worker.

## Production acceptance

- `verify:escapes` 13/13 · `verify:backups` 14/14 · `verify:resumes` 4/4 ·
  `verify:journals` 4/4 · `verify:artifact-slack` 20/20 ·
  `verify:collaborates` 13/13.
- Autonomy settings digest unchanged across the run.
- Only three deliveries were created during those suites: all harness jobs,
  all `suppressed`.
- `app.office_health()` still carries its `backup` key; executor 429/5xx and
  `chores_for_backups` present; both kick paths present in the deployed
  candidate gateway.

## Frontend acceptance (this candidate, not the fresh-install trial)

- `verify:ui` 54/54 · `verify:tasks-ui` 52/52 · `verify:talk` 40/40.
- **`basecamp:gate`, every step:**

  | Step | Result |
  |---|---|
  | covered | pass (see below) |
  | classes, actions | pass |
  | home | 45/45 |
  | routes | 64/64 |
  | journey | 55/55 |
  | keyboard | 31/31 |
  | preservation | 26/26 |
  | states | 64/64 |
  | docs | 27/27 |
  | **look** | **21/21** (the writer leg, with the real office token) |
  | chat | 30/30 |
  | controls | 423 pressed, 0 unpressable, 0 findings |
  | measure | pass |
  | reconcile | 19/21 — environment, see below |

  `covered` first exited 1 because `.out/basecamp` held no captures in this
  checkout. After `npm run basecamp:shots`: 209 files, pass.
- **Reproduced pre-existing on unmodified `9c51e1e`**, same environment, same
  counts, same failing checks:

  | Suite | Result |
  |---|---|
  | `verify:modules` | 14/16 (#368) |
  | `verify:offline` | 22/23 (#368) |
  | `verify:inverse` | 24/26 (#368) |
  | `verify:hq` | 46/47 — missing `assigned, output` until the merged gateway is canonical |
  | `verify:basecamp-reconcile` | 19/21 — the sandbox proxy answers the deliberately unreachable `office.invalid` with `ERR_TUNNEL_CONNECTION_FAILED`, which the suite does not list |

## Isolated preview

- **Gateway: `hq-api-trialthree`** v1, uploaded byte-identical to the
  candidate's `supabase/functions/hq-api/index.ts`.
  - Deployed WITHOUT `scripts/deploy/hq-basecamp.ts`'s POST to `/secrets`:
    function secrets are project-wide, so that write reaches the canonical
    `hq-api`.
  - The six secrets it reads were confirmed present by name.
  - Probes: no credential 401 · wrong 401 · office key 200 · fake session 401.
- **Page:** `https://agentic-team-hq-basecamp-dun85j0o1-agentic-team-grant.vercel.app`
  (`VERCEL_PREVIEW=1`, so no target and no alias).
  - Its deployed `config.js` names `hq-api-trialthree` and `voice-basecamp`.
  - The page itself derives `signin`, `chat`, `voice-token` and
    `voice-basecamp`.
- **A first preview, `hq-api-trial3`, was invalid, and the cause is a latent
  Frontend defect.**
  - `backend.js`'s `sibling()` rewrites the gateway name with
    `/\/hq-api(-[a-z]+)?\/?$/`. A digit in the suffix does not match, so it
    silently returned the GATEWAY url for `signin`, `chat` and `voice-token`.
  - `livevoice` was 10/28 there. The same deployed bytes passed 28/28 with
    the address changed to `office.invalid`, which isolated it.
  - Not an integration regression: `backend.js` is unchanged by the merge, and
    every canonical slug is letters-only.
  - `hq-api-trial3` still exists, non-canonical, and should be retired with
    the others.
- **Real Chromium at the preview origin:** gateway GET and POST and
  `voice-basecamp` all 401 and readable (CORS correct). `signin` is
  **BLOCKED** for the preview origin and readable from the stable alias: the
  allow-list was not widened.
- **Signed in (office key):** 18 gateway calls, **all to `hq-api-trialthree`,
  all 200, none to the canonical `hq-api`**, 0 page errors, GETs only.
  `pulse` answers 200.
- **Writes through the preview, all no-effect:**
  - `document_order_reset` with a missing argument → 400; unknown action →
    400; on a slug naming no project → 200 carrying the RPC's own error, 0
    rows created.
  - `contact_photo`: missing args, bad id and non-image each → 400; removing
    a photo from a contact that does not exist → 200 `{result:{error}}`; 0
    contacts created. Frontend's response shapes are unchanged.
  - The upload path ran live and succeeded in `verify:basecamp-photo`.
- **`basecamp:gate2` against the preview:**
  - **Mirror-driven, 16 of 16:**

    | Suite | Result |
    |---|---|
    | board | 35/35 |
    | todos | 30/30 |
    | cards | 24/24 |
    | docs | 27/27 |
    | back | 20/20 |
    | contacts | 31/31 |
    | voice | 16/16 |
    | settings | 34/34 |
    | words | 22/22 |
    | affordance | 16/16 |
    | torture | 31/31 |
    | failures | 39/39 |
    | touch | 28/28 |
    | voicenote | 36/36 |
    | livevoice | 28/28 |
    | drive | 26/26 |

    The mirror was taken from the preview (`LIVE_HOST`), not the stable
    alias, which serves an older Frontend deployment.
  - **Site-driven, 10 of 10:**

    | Suite | Result |
    |---|---|
    | photo | 11/11 |
    | waiting | 17/17 |
    | running | 9/9 |
    | sources | 9/9 |
    | team | 12/12 |
    | addsource | 10/10 |
    | signin | 17/17 |
    | todos-live | 25/25 |
    | arrangement-live | 8/8 |
    | docorder-live | 21/21 |

  - `signin` and `docorder-live` first died on their first wait, before any
    assertion, against a cold deployment. The strip was then observed
    rendering, and one re-run passed both.
  - Magic links come from admin `generate_link`, which returns the link and
    emails nobody.
- **Left as found:**
  - Grant's non-basecamp layouts, his open tasks, contacts, document orders
    and autonomy settings all have identical digests before and after.
  - The one new sent delivery is his own 2-hourly `duty:notion-sync`
    (17:06), not test traffic.
- **Canonical production unchanged:**
  - Every edge function keeps its version: `hq-api` v774, `worker` v837,
    `signin` v31, `voice` v552, `voice-token` v582, `hq-api-basecamp` v15,
    `voice-basecamp` v11, and the rest. The only additions are the two trial
    slugs.
  - Both Vercel production deployments and all four aliases are unchanged.

## Not driven live, and why

- **The 503 could-not-check verdict** needs the identity service itself to
  fail, which cannot be arranged without changing production. It is held by
  `tests/gateway/a-throttle-is-not-a-refusal.test.ts`, as the Frontend handoff
  states.
- **The worker kick's own invocation.** The Management API logs endpoint
  refused both table names tried. What is proven instead:
  - the deployed gateway is the candidate blob, with the definition and four
    call sites;
  - both kick secrets are present;
  - every refusal returns before the kick point;
  - the success paths ran live.

## Final repository pass (candidate, with credentials)

- lint, typecheck, `check:migrations`, `check:secrets`, `check:templates`,
  `check:tokens`, `check:pressable` and `check:backend-ref`: all exit 0.
- Biome on the gateway: exit 0.
- **vitest 195/195 files, 3,130 tests.** The token-dependent file now passes,
  which confirms the first pass's environment classification.
- 0 conflict markers.

## Before `main`

1. Grant's main-merge authorisation.
2. After the merge: `npm run deploy:hq` (page + canonical gateway) and
   `npm run deploy:signin`. `verify:hq` then goes 47/47.
3. Retire `hq-api-trial3`, `hq-api-trialthree`, `hq-api-integration` and the
   preview deployments.
4. The findings above that are not the merge's — `sibling()`'s letters-only
   suffix, `verify:another-go` cancelling its own work, `check:backend-ref
   --prove-it`'s stale anchor, the doubled ADR 0047, `hq-basecamp.ts`'s
   project-wide secret write, `reconcile` versus the proxy, and the gate's cold
   first waits — are filed as #370.
