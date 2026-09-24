# Three-branch integration reconnaissance — 24 September 2026

**Read-only phase. Nothing was merged, rebased, cherry-picked, deployed or
migrated.** No source branch and not `main` was touched. The only artefact is
this document, on the integration session's own branch.

Scope is exactly three development branches into `main`:
`claude/human-simulation-harness` (Backend), `claude/production-reliability`
(Production), `claude/basecamp-team-hq` (Frontend).
**`claude/fresh-install-onboarding` is out of scope** and nothing below depends
on it.

Every claim here was checked against Git or by running the check. Where a
handoff said something different, that is called out.

---

## 1. Frozen ground truth (fetched 24 Sep 2026, ~14:25 UTC)

| Ref | SHA | Last code-bearing | Notes |
|---|---|---|---|
| `main` | `3c9415084f4b2664bf8147d995412609e58a24f8` | same | unmoved since every branch forked from it |
| Backend | `3bb5bb828cf3485ceebeee706173c707c5a1cc92` | `04dc5a6` | `3bb5bb8` changes two markdown files only (per its handoff; matches) |
| Production | `7be135f02325fb2c4cecb1fbd661da59285aacdb` | `4d00bf5`/`6133168` | `7be135f` = handoff doc |
| Frontend | `9c51e1e3b4bb1e0c0e2654ecbfb7de0fb7804ab7` | `129a7069d69f8614cfbd88db1473687621c874fc` | **moved during this session**: `129a706 → 9c51e1e`, one file, `docs/integration/branch-handoff-basecamp-team-hq.md` (+892). Documentation only. |

## 2. Topology

```
main 3c94150 ──┬──────────────────────────────────────────────► Frontend 9c51e1e   (140 commits, 0 merges)
               │
               ├── Production 7be135f (19 commits)
               │        │  4d00bf5 ──merged by 376be3d──┐
               │        └─ 7be135f ──merged by 73309ad──┤
               └──────────────────────────────────────────┴──► Backend 3bb5bb8  (251 commits, 2 merges)
```

- Merge bases: every pair = `3c94150`, **except** Backend↔Production = `7be135f`.
- Ancestry: `main` ⊂ all three. **Production ⊂ Backend** — `git merge-base
  --is-ancestor` true; `git rev-list --left-right --count B...P` = `232 0`.
  Absorbed by two merge commits on Backend (neither on first-parent):
  `376be3d` (merges `4d00bf5`, only conflict `package.json`, both sets kept) and
  `73309ad` (merges tip `7be135f`).
- Production content in Backend, file by file: all nine Production migrations
  byte-identical; every Production non-migration file identical in Backend
  except `package.json`, `scripts/check-leaks.ts`, `scripts/e2e.ts`, which are
  strict supersets (every Production script key, gate member and leak counter
  is present in Backend unchanged). `hq-api/index.ts` Backend = Production.
- Frontend has absorbed **nothing** ancestrally from Backend or Production:
  no shared commits, **zero patch-id overlap**, no common commit subjects.
- The reverse direction is not ancestral either: **Backend carries copies** of
  all fourteen Frontend migration files, byte-identical, copied in by
  `1dc1608`, `afb9730`, `006aa3b` (and `de5a448` for 0577/0578 per its
  message) because the shared production database had applied them and
  `npm run migrate` refuses on `checksum/missing`. Copies, not cherry-picks —
  patch-ids differ because each commit carried other work.

**Effective integration: ONE merge.** `main ← Backend ← Frontend`. A separate
Production merge contributes zero commits and zero bytes.

## 3. Change surface by effective component

| | Backend (incl. Production) | Frontend |
|---|---|---|
| Size vs main | 288 files, +55,195/−368 | 165 files, +47,939/−434 (incl. handoff) |
| Migrations | 71 added, 0 modified (57 own + 14 Frontend copies) | 14 added, 0 modified |
| `src/` | agents/*, handlers/*, jobs/worker+lastword, db/executor, knowledge/retrieval, simulation/*, migrations/check+runner | **only `src/migrations/check.ts`** |
| Edge functions | `hq-api` +60 (kick) | `hq-api` +486, `voice`, `voice-token`, new `signin` |
| Web | none | `web/studio/**` (34 files incl. `bc/`), `web/voice/index.html` |
| Auth | none | ADR-0043 session auth, 3-verdict gateway, `office_members`, `signin` |
| Deploy scripts | none | `deploy/*` (hq, site, hq-basecamp, voice-basecamp, vercel, voice), `config:site` |
| Checks / gate | +15 gate members, `check:*` ×8, `check-leaks` +358 | +1 gate member (`check:backend-ref`), `check:gateway-wrappers`, `check-leaks` +26 |
| Dependencies | none | none — `package-lock.json` identical on all four refs |

**Merged `src/` equals Backend's `src/` except `src/migrations/check.ts`**, which
the worker bundle does not import. The worker source that would deploy from the
integrated tree is the source already running as worker v835.

### Files changed by both effective components (7 + 14)

`CLAUDE.md` · `package.json` · `scripts/check-leaks.ts` · `scripts/e2e.ts` ·
`src/migrations/check.ts` · `supabase/functions/hq-api/index.ts` ·
`tests/migrations/check.test.ts` · and the 14 migrations (identical blobs).

## 4. Migration reconciliation

- Merged `migrations/` = **604 files = Backend's set exactly**. Frontend adds
  **zero** new files; its 14 are identical blobs already on Backend.
- Merged `migrations/applied.json` = Backend's (Frontend never touched it): 604
  entries, 0591 last.
- **13 recorded collisions verified**: 0534 0535 0536 0537 0538 0539 0543 0577
  0580 0581 0582 0583 0584 — each two differently-named files. 0535–0538 and
  0543 are Production-vs-Frontend/Backend pairs; the rest Backend-vs-Frontend.
- Objects defined by Frontend's migrations and by Backend-only migrations are
  **disjoint** (no function/table/view/policy/trigger defined by both).
  Cross-references exist and are consistent with application order:
  Frontend 0582/0583 redefine `app.hq_studio_core` reading Backend 0569's
  `public.needs_me`; Backend 0572 names Frontend's `hq_contact_*` in the undo
  map; no Backend-only migration redefines `hq_studio_core`.
- **`check:migrations` run on the virtual merge tree** (exported to scratch):
  **exit 0, "604 migration(s), 604 recorded as applied", 13
  `[sequence/collided]` NOTEs.** Also on Backend alone: identical. Frontend
  alone: exit 0 (547/533). Production alone: exit 1, two `sequence/gap`
  (0534, 0539) — closes by ancestry, confirmed.
- **Correction to the Frontend handoff:** it says thirteen duplicate findings
  appear unless `migrations/collisions.json` and its reader (from
  `trial/integration-2026-09-24b`, `b354ebf`) come across. On the three-branch
  tree that is **false** — Backend's own checker (`376be3d`) already treats an
  all-applied duplicate as a note. The manifest is **not required** here; it
  belonged to the four-branch candidate.
- Live ledger: **not directly readable from this session** (no
  `SUPABASE_ACCESS_TOKEN`). The Backend handoff reports `npm run migrate`
  "Applied 0, skipped 604"; the committed `applied.json` agrees with that. The
  trial must re-establish it live before anything else (stage 0 below).
- **Integration migration effect: none.** No file added, renamed, renumbered
  or modified; nothing to apply.

## 5. Textual conflicts (from `git merge-tree` of Backend × Frontend)

Exactly four: `CLAUDE.md`, `package.json`, `scripts/check-leaks.ts`,
`supabase/functions/hq-api/index.ts`. Auto-merged cleanly: `scripts/e2e.ts`,
`src/migrations/check.ts`, `tests/migrations/check.test.ts`.

| File | Each side contributes | Required union |
|---|---|---|
| `package.json` | B 35 new scripts, F 61 new + `deploy:hq` modified; **zero key overlap**, no non-script field differs | keep both blocks; JSON must parse; key count = 97 new + main's |
| `CLAUDE.md` | B +1,092 lines (several hunks), F +46 (one hunk), both append at line 2915 | keep both; append-only |
| `hq-api/index.ts` | B: `WORKER_URL`, `WORKER_KICK_SECRET`, `kickWorker()`; F: `googleToken()` and 480 more lines | keep both; **give `kickWorker` its own closing `}`** — the conflict region ends at `else keepAlive(kick)` and the shared `}` after the marker closes whichever function comes last |
| `check-leaks.ts` | B: `registered_test_destinations` (Production), `harness_on_his_activity_panel`; F: `harness_contacts` — all inside one SQL select, under one shared `/*` | keep both, **comma after the Backend item, re-open `/*` before the Frontend comment** |

### Proven on the virtual merge tree (exported to scratch)

- `npx tsc --noEmit`: **exit 0 with conflict markers still present** —
  `check-leaks.ts` markers sit inside a template literal; `supabase/` is not in
  `tsconfig.json`'s include.
- `npx vitest run`: 3,124 tests pass, 194/195 files — **also with markers
  present**. `tests/gateway/a-throttle-is-not-a-refusal.test.ts` PASSES on a
  gateway that does not parse: it reads source, it is not a parse witness.
  The one failed file is `tests/sessions/weather-is-not-a-failure.test.ts`,
  which imports `scripts/sessions/run.ts` and exits on a missing
  `SUPABASE_ACCESS_TOKEN` — environment, not merge.
- `npx biome ci .`: 15 errors, **all parse errors in `hq-api/index.ts`**.
  Biome catches the gateway; **nothing static catches `check-leaks.ts`**.
- `check:pressable` exit 0 even on the unparseable gateway (regex over keys).

So: **tsc, vitest and check:pressable are blind to both dangerous conflicts;
biome sees only the gateway; only running `check:leaks` against the database
sees the other.**

## 6. Semantic (non-textual) analysis

| Area | Finding | Verdict |
|---|---|---|
| Gate membership | union of B (56) and F (42) = 57 = merged `e2e.ts` GATE, nothing lost, nothing extra. Production's 4 members all present | coexists |
| Leak witness | union aliases/consumers = merged (incl. conflict text); B+P 7 new counters/uses + known/new escapes + label/job disagreement; F 1 (`harness_contacts`) | coexists iff §5 resolution done right |
| Migration checker | B: `note` severity for all-applied duplicates, runner refuses on errors only. F: `sequence/gap` asks the ledger. Orthogonal functions of one file; auto-merged; checker proven on merged tree | coexists |
| Gateway auth vs kick | F's 3-verdict auth runs before `POST`; B's two kick call sites land after `document_upload` and the generic dispatch, after success | coexists |
| **Kick property gap** | B's comment states the kick fires "after any successful POST". F's `contact_photo` action returns early and **does not kick**. Harmless (it enqueues nothing; pg_cron floor remains) but the stated property is false on the merged tree | **decision for the trial** (see §8) |
| `check:tokens` | in `main`'s gate already; red on Frontend alone and on the merged tree: **831** findings (measured). Basecamp tokens live under `:root[data-experience='basecamp']` | known red; fix is `c6f74cf`'s `scripts/check-tokens.ts` only — its parent blob is identical to B/F's, so it ports cleanly; its CSS half is already on Frontend; its `reconcile-production.ts` half is fresh-install-only and must NOT come |
| `check:callers` | Backend baselines `hq_document_order_set`, `hq_document_order_reset`, `hq_output`; Frontend's gateway calls them. The baseline may only shrink, so the merged tree goes red **by design** | required integration edit: remove the three (`655f906`'s baseline half; parent blob = Backend's) |
| Worker | merged `src/` = Backend's; F adds no job kind; F's new actions go through the kicked generic path | no redeploy needed for the trial |
| Shared DB semantics | Frontend's live suites already ran against the shared DB carrying Backend's migrations (e.g. `hq_governance`, `needs_me`, `studio_tasks`) | co-tested at DB level; not at gateway-code level |
| Voice / signin | F only; production `voice` is still main's code | first real behaviour change reaches prod only at post-merge deploy |
| Production gateway | currently a Backend/Production-built `hq-api` (kick, **no** session auth). Merging to `main` and running `deploy:hq` introduces F's session auth to canonical production | the largest production behaviour change of the whole integration |
| Frontend evidence | 15 Frontend commits after `d77dfd4` were verified only on `trial/integration-2026-09-24b`, which contains fresh-install | **that evidence is contaminated**; basecamp:gate/gate2 must be re-earned on the three-branch trial |

## 7. Previous candidates

`trial/integration-2026-09-23`, `-24`, `-24b` **all contain
`claude/fresh-install-onboarding`**. None contains `129a706`.

**Reusable:** both conflict shapes and their fixes (gateway brace, comment
re-open, `0a8f030`'s one-line check-leaks change); biome as the gateway parse
witness; `check:tokens` experience-awareness (`c6f74cf`, scripts half);
callers baseline −3 (`655f906`, baseline half); `verify:hq` 46/47 until the
merged gateway deploys; CORS proof from a real origin and `signin` allow-list
not widened; isolated slug + preview-hostname deployment method.

**Not applicable (fresh-install-dependent):** `migrations/collisions.json` and
its reader (`b354ebf`); renumbering 0534–0536 → 0592–0594; migration 0595
(chat id in `enqueue_inbound`'s comment — found via the FI baseline;
if wanted it is new work, separately authorised); `7e07ede` entire (baseline,
preconditions, neutralise, `reconcile-production.ts`, `probe-understand`);
`fresh:zero-state 608/608`; `check:fresh`, `fresh:baseline`,
`check:reconcile`; the "608 files" corpus count (ours is 604); the
four-branch merge order; the MERGE-READY verdict; `655f906`'s
`check-provenance.ts` half (data-driven, not in the gate, not merge-caused —
optional, record only).

## 8. Trial design (not executed)

- **Branch:** `trial/three-branch-integration-2026-09-24`, created from Backend
  `3bb5bb8` (not from `main`: `main` is its ancestor, so this is identical to
  merging Backend into `main` fast-forward-wise and avoids a ceremonial merge).
- **Frozen inputs:** main `3c94150…`, Backend `3bb5bb8…`, Production `7be135f…`
  (inherited, not merged), Frontend `9c51e1e…` (code = `129a706`).
- **Sequence:** (0) re-verify SHAs; (1) branch at Backend; (2) `git merge
  --no-ff 9c51e1e`; (3) resolve the four conflicts as §5; (4) three
  integration commits, each separate and named: `scripts/check-tokens.ts` from
  `c6f74cf`; callers baseline −3; the `contact_photo` kick decision — either
  add `kickWorker()` before its successful return (keeps Backend's stated
  property, one line) **or** leave it and amend the comment; recommended: add
  the call, because the invariant is written as a property.
- **No other changes.** `verify:review`'s selector fix (`0a8f030`) is a
  pre-existing Frontend test defect outside both basecamp gates — record, do
  not port unless asked.

### Stage gates

| After | Runs |
|---|---|
| step 1 (Backend only) | lint, typecheck, test, check:migrations, check:leaks → baseline numbers for comparison |
| each conflict | `node -e JSON.parse` on package.json; `npx biome ci supabase/functions/hq-api/index.ts`; `grep -c kickWorker` = 3 (def + 2) or 4 with contact_photo; check-leaks alias inventory = 21 aliases incl. `registered_test_destinations`, `harness_on_his_activity_panel`, `harness_contacts`; `grep -c '^<<<<<<<\|^>>>>>>>' -r .` = 0 |
| all resolutions | full static matrix below + `check:leaks` live + witness-integrity proof |
| before preview | full unit suite ≥3,124 (+ token-dependent file), all standing checks, basecamp:gate |
| after preview | gateway probes, CORS, basecamp:gate2 against preview, verify:hq |

### Witness-integrity proof for `check:leaks`

1. **Static inventory:** extract every `) as <alias>` and every `pile.<alias>`
   from the merged file; assert it equals the union computed from Backend and
   Frontend (script in scratch, not committed).
2. **Runtime completeness:** run the merged SQL once and assert
   `Object.keys(piles.rows[0])` contains every expected alias — catches a
   comment-swallowed counter, which the numeric checks cannot (`?? 0` reads a
   missing column as zero).
3. **Branch sabotage in a scratch copy:** for each counter, flip its threshold
   so its failing branch must fire; confirm red naming the class; restore;
   confirm green. Print proof each sabotage landed.
4. **Output reading:** exit 0 with `known historical escapes: 22 · new … 0`,
   the label/job disagreement line, and the activity-panel line present.

### Verification matrix

- **Static:** `npm run lint` · `typecheck` · `npx biome ci
  supabase/functions/hq-api/index.ts` · `check:templates` · `check:secrets` ·
  `check:migrations` (604/604, 13 NOTEs, 0 errors) · `check:pressable` ·
  `check:gateway-wrappers` · `check:callers` (after −3) · `check:backend-ref`
  and `-- --prove-it` · `check:tokens` (0 after port) · `check:icons` ·
  merged gate list = 57 · `git diff --stat 3c94150 -- migrations/` shows 71
  added, 0 modified.
- **Backend contract:** handoff §13 in order — `check:leaks`, `check:migrations`,
  `npm run test`, `check:answerable`, `check:believes`, `check:capabilities`,
  `check:standing`, `check:chatter`, `check:undo`, `check:consumed`,
  `verify:another-go` (10/10; one red = unproven, rerun once, #367),
  `verify:stop` 19/19, `verify:lastword`, `verify:escapes`; by eye: notify.ts
  reads the `announce` column, lastword sets it before `notify`, worker picks
  `say_once` arity by `output.topic`.
- **Production contract:** handoff §13 — kickWorker count, 
  `registered_test_destinations`, `verify:escapes` 13/13, `verify:backups`,
  `verify:resumes`, `verify:journals`, `verify:artifact-slack` 20/20 (no real
  workspace post), `verify:collaborates` 13/13 (autonomy unchanged), executor
  `status >= 500`, `chores_for_backups`, `office_health()` backup key,
  escape rows still present. Note: its "check:leaks red for two rows" is
  superseded by Backend's known_escapes — expect exit 0, 22 known.
- **Frontend contract:** handoff §13 priorities 1–6 — biome on the gateway,
  throttle test, `type Verdict`, 401/503 split, backend-ref ± prove-it,
  `grep -rn supabase.co web/ | grep -v config.js` empty, smoke,
  `SUBJECT=source verify:basecamp-chat` 30/30 and `--prove-it`, `verify:talk`
  40/40, `verify:ui` 54/54, `verify:tasks-ui` 52/52, `basecamp:gate` (15),
  `basecamp:gate2` after preview, `.gitignore` still ignores config.js, ADRs
  0043/0047/0048 present.
- **Database:** `npm run migrate` must report "Applied 0, skipped 604"
  (dry — if it would apply anything, STOP); no checksum disagreement; no
  pending; no new file.
- **Browser:** default Team HQ (renders, 0 page errors, no basecamp
  experience), Basecamp HQ, sign-in, gateway, Chat, To-dos, Docs/Files,
  arrangement persistence across two contexts, console errors printed.
- **Clean-database test:** not required for this integration — no migration
  file changes. If wanted, it can be done without fresh-install by applying
  the 604 files in filename order to a throwaway local Postgres; note that the
  collided pairs would apply in filename order, not historical order. Not
  proposed as a gate.

### Preview

- Gateway: `HQ_API_SLUG=hq-api-trial3 tsx scripts/deploy/hq-basecamp.ts` —
  a new slug; never `deploy:hq` (hardcodes `hq-api`, target production).
- Page: `VERCEL_PREVIEW=1 VERCEL_PROJECT=agentic-team-hq-basecamp npm run
  deploy:preview` pointed at that slug — own hostname, moves no alias,
  `ai-team-hq` unreachable from `site.ts` by design.
- Worker: **not redeployed** (only one slug exists and its source is unchanged).
- **Caution:** the preview gateway talks to the production database and its
  function secrets are project-wide, so it kicks the real worker. Writes from
  the preview are real writes. Only read paths and fixture-named writes; no
  sign-in bursts (one link per address per minute).
- Probes: no credential 401 · wrong 401 · office key 200 · fake session 401;
  CORS from the real preview origin; `signin` still BLOCKED from it.

### Abort conditions

Any source SHA moves after freeze · `migrate` would apply or skip ≠ 604 ·
checksum disagreement · a conflict whose union needs a design decision ·
any Backend, Production or Frontend invariant unpreservable · a Production
invariant absent from the merged tree · gateway auth regression (a 401 where
503 is due or vice versa, a session accepted on shape, allow-list widened) ·
`check:leaks` reports a new escape or loses a class · any real external
delivery from trial traffic · preview pointing at `hq-api`, `worker` or the
`ai-team-hq` alias · contradictory verdicts that cannot be classified ·
any finding that depends on fresh-install.

## 9. Known reds and interpretation (before the trial)

| Check | Before | Expected on trial | New regression if |
|---|---|---|---|
| `check:tokens` | F red 831 | 0 after `c6f74cf` port | any finding after port |
| `check:callers` | B green | red until −3 edit, then green | red after edit (gateway lost) |
| `verify:hq` | F 46/47 | 46/47 until preview/deploy of merged gateway | anything else failing |
| `verify:modules/offline/inverse` | 14/16, 22/23, 24/26 (#368) | same | different counts |
| `verify:another-go` | intermittent (#367) | one rerun | two reds |
| model-spending suites | stochastic / quota | classify each | invariant failure with quota available |
| `verify:mytasks` | ~597 s of 600 | may time out | a result (not timeout) below 89/89 |
| Management API 429 | throttles | retry, run DB suites sequentially | red without a 429 |
| `weather-is-not-a-failure` test | needs token | passes with token | fails with token |
| `check:leaks` | exit 0, 22 known / 0 new | same | new > 0, fewer classes, 42601 |
| Production `check:migrations` gaps | red on P alone | closed | any gap/duplicate error |

## 10. What currently prevents a safe trial

Nothing in the branches. Two environment prerequisites for the **DB-backed**
stages: this session has no `SUPABASE_ACCESS_TOKEN` (so `check:leaks`,
`check:callers`, `migrate`, every `verify:*` against the office, and the
preview deploy cannot run here), and no Vercel token. The static stages can
run without either. The trial may be built; it must not be declared passing
until the DB-backed stages have run.

Carried open items, not caused by integration: Vercel token printed to a
transcript and unrotated (Production §10D); GitHub PAT unrotated since 10 Sep;
DR limits (no offsite backup, vault recovery unproven, 9m46s is not RTO);
#362, #365, #358, #367, #368, #369.
