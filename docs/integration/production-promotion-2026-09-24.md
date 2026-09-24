# Production promotion — 24 September 2026

The three-branch integration (Backend `claude/human-simulation-harness`,
Production `claude/production-reliability` inherited through it, Frontend
`claude/basecamp-team-hq`) is on `main` and deployed. The trial is recorded in
`three-branch-trial-2026-09-24.md` and was planned in
`three-branch-reconnaissance-2026-09-24.md`, which is on
`claude/gracious-volta-48lh36`. Out-of-scope findings are in #370.

## Git

| | |
|---|---|
| previous `main` | `3c9415084f4b2664bf8147d995412609e58a24f8` |
| promoted to | `78ba12a13a606bee328e7d07666b46727dc26e6e` — the exact verified trial HEAD |
| method | **fast-forward push, no force, no new merge commit.** `main` was an ancestor of the candidate, so nothing was reconstructed or re-resolved |
| tree equivalence | `main^{tree}` = `78ba12a^{tree}` = `ee094f3fe2b200279e07f2d23702ae8013cd2c57`; the code differs from the verified `60ba0b3` in **0 files** (only `docs/integration/` changed after it) |
| integration commits promoted | `40b1dc1` merge · `0bb505b` contact_photo kick · `39b59bd` check:tokens · `60ba0b3` callers baseline · `b959032`, `78ba12a` trial documentation |
| fresh-install | `claude/fresh-install-onboarding` is not an ancestor; none of its commits is reachable |
| source branches | unchanged: `3bb5bb8`, `7be135f`, `9c51e1e`, fresh-install `23ebdf1` |

## Pre-deployment checks on `main`

- 0 conflict markers.
- lint, typecheck, `check:templates`, `check:secrets`, `check:pressable`,
  `check:backend-ref`, `check:tokens`, `check:migrations`, `check:callers`,
  `check:gateway-wrappers`, `check:icons` and `check:leaks`: all exit 0.
- Unit tests: **195/195 files, 3,130 tests**.
- `npm run migrate`: **Applied 0, skipped 604**. Before it, a dry run reported
  nothing pending.
- Leaks: **22 known, 0 new**.

## Deployment

Each change was an upload from `main`'s exact blob. **No function secret, vault
secret, Vercel env var, SSO setting, sign-in or voice allow-list was written.**
I read `deploy:hq`, `deploy:signin` and `deploy:voice` first; every one of them
rewrites shared configuration (see #370 item 10), so none was run as written.

| Target | Before | After | How |
|---|---|---|---|
| `hq-api` | v774 (`main` `3c94150`, no worker kick) | **v775** | upload only |
| `voice` | v552 (`3c94150`, no session path) | **v553** | upload only. Needed because the page no longer offers the office token, so a signed-in person's call must be accepted by session |
| `voice-token` | v582 (already Frontend's code) | **v583** (same code) | upload only |
| `signin` | v31 | **v31, untouched** | its deployed bundle already contains all of the candidate's source (165/165) |
| `worker` | v837 | **v837, untouched** | the merged `src/` equals Backend's, and v837 is Backend's |
| `ai-team-hq` page | `dpl_EafqeJb7PHg7BriEpBpDMkYyf5Pp` | **`dpl_DwDy6otbfEEkxncUhvoPPtdHzXnr`** (`ai-team-a9u3vk3oh`) | `hq.ts` minus its secret/SSO/env writes, uploading files by digest |

Two attempts came before the final page deploy:

1. **Inline mode was refused**: *"Request body too large. Limit: 10mb"*. Vercel
   rejected the request, so nothing was deployed (#370 item 8).
2. **`dpl_7FBUNFQqVBVVAkSdwEPWQCruActw` (`agszgy0gv`) was served for about four
   minutes with two sample files corrupted.** `hq.ts` treats `.wav` and `.zip`
   as text (#370 item 9). It was redeployed with both read as binary. All **183
   deployed files match the repository by sha1**. Do NOT roll back to
   `dpl_7FBUNFQq…`.

The Basecamp project's production deployment `dpl_5N6b5JTB…` and all four
aliases did not move.

## Post-deployment acceptance (production)

**Gateway**
- `verify:hq` **47/47**, including *"every section the page actually asks for
  is in it — 40/40"*. It was 46/47 before, as expected.
- Probes: no credential 401 · wrong credential 401 · office key 200 · fake
  session 401.
- Every quote-free line of `main`'s source is present in the deployed bundles
  (`hq-api` 1317/1317, kick block included · `voice` 269/269 · `voice-token`
  193/193 · `signin` 162/162).

**From the real `ai-team-hq` origin in Chromium**
- The gateway (GET and POST) and voice answer 401, with CORS readable.
- `signin` is allowed from `ai-team-hq` and from the Basecamp alias, and is
  **BLOCKED** from a preview origin and from `example.com`. The allow-list did
  not widen.
- Signed in with the office key: 19 calls, all to canonical `hq-api`, all 200;
  0 page errors; GETs only.
- The page derives `signin`, `chat`, `voice` and `voice-token` correctly.

**Frontend**

| Suite | Result |
|---|---|
| `verify:ui` | 54/54 |
| `verify:tasks-ui` | 52/52 |
| `verify:talk` | 40/40 (probes the newly deployed voice functions) |

`basecamp:gate2` against production:
- **16 of 16 mirror suites** pass on production's own bytes:

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
  | **voicenote** | **36/36** |
  | **livevoice** | **28/28** |
  | drive | 26/26 |

  The mirror matched production file for file. Its only failing condition is
  the Basecamp site's own 307 redirect at its bare domain, which the canonical
  root correctly does not have.
- **10 of 10 site suites** against `https://ai-team-hq.vercel.app`:

  | Suite | Result |
  |---|---|
  | photo | 11/11 |
  | waiting | 17/17 |
  | sources | 9/9 |
  | team | 12/12 |
  | addsource | 10/10 |
  | signin | 17/17 |
  | arrangement-live | 8/8 |
  | docorder-live | 21/21 |
  | todos-live | 25/25 on the one re-run (22/25 first; a read racing the write on a minutes-old gateway) |
  | running | 9/9 (first died waiting 30 s; then 8/9 on a 31x20 mid-layout measurement; an instrumented run measured 58x32 with computed styles identical to the preview's — #370 item 12) |

**Backend and Production**
- `check:answerable` (4 of his questions, all "starts work"), `check:believes`,
  `check:capabilities`, `check:standing`, `check:chatter`, `check:undo`,
  `check:consumed`, `check:callers` and `check:gateway-wrappers`: all 0.
- `verify:escapes` 13/13 · `verify:lastword` 10/10 · `verify:stop` 19/19 ·
  `verify:journals` 4/4 · `verify:resumes` 4/4 · `verify:artifact-slack`
  20/20 · `verify:collaborates` 13/13.
- `verify:backups` **14/14** on the one re-run. The first run was 13/14: its
  global-queue check counted the worker heartbeat's own `pg_net` request,
  queued one second earlier (#370 item 11).
- Migrations: 604 applied, nothing pending.
- The worker is still v837. Its kick contract was probed live: no credential
  401 · wrong 401 · secret 200.

## Data and containment

- Snapshot before deployment vs after all production testing: non-basecamp
  layouts, basecamp layouts (0), his open tasks, contacts (0), document orders
  (0) and autonomy settings all have **identical digests**.
- **0 new sent deliveries.** The only two deliveries created were harness
  (`slack:verify-artifact-slack`), and both were **suppressed**.
- `check:leaks` after everything: **22 known, 0 new**, refused 335; all 19
  witness columns returned live.
- Magic links in the suites come from admin `generate_link`, which returns the
  link and emails no one.

## Trial infrastructure

**Removed** (each named by this exercise or by the Frontend handoff as
temporary):
- functions `hq-api-trial3`, `hq-api-trialthree` and `hq-api-integration`
  (http 200);
- preview deployments `a14f0zvjs`, `dun85j0o1` and `o7falu7ke` (http 200).

**Retained deliberately:**
- the trial branch and this documentation;
- `ai-team-hq` `dpl_EafqeJb7` (the rollback point);
- `dpl_7FBUNFQq` (superseded; do not use);
- four earlier Basecamp previews and the `atg-integration-2026-09-24` Vercel
  project, which could not be attributed to this exercise and are left for
  whoever made them.

## Rollback

1. **Page**: Vercel instant rollback of `ai-team-hq` to
   `dpl_EafqeJb7PHg7BriEpBpDMkYyf5Pp`.
2. **Functions**:
   - redeploy `hq-api` and `voice` from `3c9415084f4b2664bf8147d995412609e58a24f8`,
     whose sources match v774 and v552 line for line;
   - `voice-token` and `signin` need nothing, since their code did not change;
   - the worker is untouched.
3. **Git**: `git revert` the promoted range on `main`. Never a force-push.

## Known reds remaining (pre-existing, reproduced on their source branch)

- `verify:modules` 14/16 · `verify:offline` 22/23 · `verify:inverse` 24/26
  (#368).
- `verify:another-go` 9/10 when the live worker loses a race to the suite's own
  cancel loop (#370 item 2).
- `verify:basecamp-reconcile` 19/21 in the sandbox proxy (#370 item 6).

## Security follow-up (manual, outstanding)

- The Vercel token printed in the Production Reliability session, and the
  GitHub PAT exposed on 10 September, still need rotating. That is Grant's
  action, and it is described in the promotion report.
- No credential value appears in this document or in any commit.
