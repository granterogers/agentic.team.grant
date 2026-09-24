# Three-branch trial integration — 24 September 2026

**Disposable candidate. Not merged into `main`, not deployed, not canonical.**
Plan: `docs/integration/three-branch-reconnaissance-2026-09-24.md` (on
`claude/gracious-volta-48lh36`).

**Verdict: TRIAL INTEGRATION BUILT — VERIFICATION BLOCKED.** Everything that
can run without credentials passed or was classified with evidence. Every gate
that needs the database or Vercel is BLOCKED: this environment has no
`SUPABASE_ACCESS_TOKEN`, `VERCEL_TOKEN` or `HQ_API_TOKEN`. None of those gates
was inferred to pass.

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
