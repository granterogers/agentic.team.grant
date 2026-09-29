# Release candidate — #373 + #371 + #375, 29 September 2026

Branch `claude/agentic-team-integration-rc-dx8x7e`, built from `main` at
`1095b04` by merging `claude/373-project-provenance`,
`claude/371-paused-edges` and `claude/375-harness`, plus review fixes made on
the candidate itself. **Not merged, not deployed, and migration 0600 is not
applied to production.** Everything below was run on an isolated replica or a
fake office, with production credentials stripped. The only production
contact was one read-only SELECT (exposure) and read-only GETs of function
versions, both recorded below.

## What it changes, by deployable surface

| Surface | Files | What |
|---|---|---|
| Migration | `0600_a_question_is_asked_once_whatever_became_of_it.sql` | adds `blockers.asked_at timestamptz` and `blockers.ask_attempts int not null default 0` (with a `>= 0` check) and comments. Additive; no data change |
| Worker | `src/jobs/worker.ts` | #371: a paused question whose wording is refused is still asked, in the blocker's own words; the unasked-question sweep decides by what is recorded (below) |
| `voice` edge function | `supabase/functions/voice/index.ts` | #373: a stated project id is filed (`project_id`) and scopes the conversation (`<session>/<project>`); a turn number that cannot collide within a millisecond |
| Page | `web/studio/chat.js`, `web/studio/call.js` | #373: every Chat turn, dock turn, voice note and live-call turn states its thread's project id |
| Harness only | `scripts/verify/{pursues,basecamp-todos-live,basecamp-addsource,basecamp-live}.ts`, `scripts/isolated/*`, one unit test | #375 items 9–12; the isolated proofs; `replica.sh` now builds `post` as the full candidate schema |

`voice-token`, `hq-api` and every other function: source unchanged.

## The decisions, and the evidence for each

### #373 — a Team HQ turn keeps its project

`docs/design/373-project-provenance.md` has the lifecycle trace, the
invariants and the review.

- **A cross-project authorization defect on `main`, closed by this
  candidate.** With the session-wide conversation key, "yes please" typed in
  project B's Chat **resolved a question raised in project A** on the same page
  visit, because the #374 spoken-answer lookup scopes by conversation. Driven
  with the real door and the real `office.instruction` handler: on the
  candidate B's reply leaves A's question open and A's reply resolves it; with
  the old key restored, B's reply resolves A's.
- Found in review and fixed: a refused (deleted) project id fell back to the
  visit's no-project conversation; it now keeps its own thread.
- Found by the concurrency check and fixed (present on `main`): two turns in
  the same millisecond on one session shared a dedupe key, and the second was
  lost with "could not record what you said".

| Proof | Before | Candidate |
|---|---|---|
| `scripts/isolated/project-provenance.ts` (real door, real canonical layer, real handler) | 7/15 on `main` | **20/20** |
| `npm run verify:basecamp-project-turn` (real page in Chromium, fake office, loop-back call) | 3/10 on `main` | **17/17** |

Controls re-run on the merged candidate: removing the conversation key → 12/19;
the `project_id` write → 12/19; the previous refused-id behaviour → 18/19; the
old conversation key → invariant 10 fails (B answers A).

### #371 — attempted is not delivered

The first version of 0600 recorded one fact, "the office tried to ask". That
conflated attempted with delivered in both directions:

- a **retryable** transport failure (a Telegram 429/5xx) or a send that died
  after its claim leaves a `claimed` delivery row, and "a row exists" meant
  the sweep skipped it: the question was **never sent**. This was also true
  before 0600;
- a notifier that threw before recording anything was abandoned after one try.

The rule now, decided per question by its delivery rows and 0600's attempts:

| Recorded | Decision |
|---|---|
| a `sent` row on any channel | delivered — done |
| a `failed` row (terminal, gave up, indeterminate) | never again on that channel — a second copy is the one harm the delivery layer prevents |
| a `suppressed` row | the containment guard's decision — done |
| a `claimed` row whose lease has lapsed, and not sent anywhere | re-driven under the **same key**: `claim_delivery` reclaims it and dedupes every other channel; the delivery layer's `max_attempts` and backoff bound it |
| no row, never tried | asked (the worker died before asking) |
| no row, tried | tried again at 10 minutes, then 60 — three tries in all |

Only open questions of paused, announcing jobs, created 2 minutes to 2 days
ago. Without 0600's columns the sweep's query fails and it asks nothing (the
safe direction); `askedOnPause` still asks inline.

| Proof | First version | Candidate |
|---|---|---|
| `scripts/isolated/ask-unasked-loop.ts` | 1/5 on `main`; 8/12 against the first 0600 | **19/19** |
| `scripts/isolated/paused-incoherent.ts` | 4/7 on `main` | **8/8** |

Cases covered: nowhere to send; sending gate refused; worker died before
asking; three days old; retryable failure; died mid-send; terminal;
indeterminate; the three-try cap; a notifier that threw before recording;
answered meanwhile; withdrawn while the job stays paused; two channels (sent on
one → the other's lapsed claim is left; failed for good on one → only the
other is re-driven); and two workers on two connections sweeping at once,
forced to overlap by a barrier, for a never-tried question and a lapsed claim.

Each clause's sabotage turns a case red: the lapsed re-drive (12/15), the
"sent anywhere" guard, the attempts cap (14/15), the backoff, the refused-
question fix (6/8). Bypassing the delivery dedupe makes both concurrent cases
double-send. The open-question guard is enforced twice; removing both copies
turns the withdrawn case red.

### #375 items 9–12

Not run: they are live suites and need production. Their mechanics were
proved offline. `pursues`' registry probe was run on the replica and rolled
back: `{"verdict":"refuse","carriesRun":true,"identical":true,"enabled":true}`,
and without the raise, `identical:false`. `addsource`'s assertion was checked
against the real rendering (`tone: link`, "A link to read"). `basecamp-live`'s
entry was checked on a local studio: the root draws no Basecamp and would time
out, while `/basecamp` draws it.

## Regression on the candidate

| Gate | Result |
|---|---|
| lint, typecheck, `check:migrations` (0600 pending), `check:secrets`, `check:templates`, `check:voice-sessions`, `smoke` | all exit 0 |
| `npm test` | **227/227 files, 3568 tests.** One file needs `SUPABASE_ACCESS_TOKEN` set in order to import; it makes no request, and was run with a placeholder |
| isolated `run-all.sh` on a freshly rebuilt replica | all pass: recovery matrix, drain, approval-execution 15/15, approval-delivery 9/9, containment 17/17, acknowledgement 32/32, acknowledgement-sequence 36/36, project-provenance 20/20, paused-incoherent 8/8, ask-unasked-loop 19/19, 0596 race |
| all 31 offline Basecamp suites | all pass, including `controls` (439 pressed, 0 findings) and `covered` (after `basecamp:shots`) |
| `verify:wired`, `verify:layouts` | pass (64 states, 0 findings) |
| `verify:chat` (legacy dashboard) | 31/57, **identical to `main`** check for check; phone leg times out intermittently on both. Filed as #377 |

Replica fidelity: 31 of the replayed files end in data assertions that need
production rows. All 31 were read. The 29 assertions, 0054's bot-row inserts
(which need vault tokens), and 0573's drive block. 0573's DDL was confirmed
present (`hq_undo` knows `document_move`).

**Not covered here:**

- `verify:ui`, `verify:hq` and `verify:talk` need production credentials or the
  deployed origin.
- The Deno runtime itself was not run: no `deno` in the sandbox. The `voice`
  file was run end to end under Node with a Deno shim, and it uses only
  web-standard APIs.

## Review: ways it could look right and be wrong

Each of these is a way the candidate could pass every test and still fail in
production. Each was checked against the real code or schema, not the tests.

- **Does the page's `id` really hold a project UUID?** Every browser case
  feeds a fake office. `app.hq_studio_core` emits `p.project_id as id`, and the
  page already sends the same `id` to `conversation_history(p_project_id uuid)`
  to read threads, which works in production. So `projectIdOf` fires. The
  reserved Unnamed project is active and not a fixture in production (read
  only), so it is in the payload and the portfolio dock states it.
- **Does the sweep see every production channel's rows?** Production's
  notifier is `reply`, `slack` and `pager` (`src/office/pass.ts`). All three
  key through `deliveryKey`, and the unit test pins all three, so their rows
  carry `blocker:<id>:<channel>`.
- **Can the lapsed-claim re-drive send twice?** Only if a transport left an
  ambiguous send `claimed`. Telegram classifies a network failure on a
  non-idempotent write as `indeterminate`, which is recorded as `failed` and
  never resent. Slack does the same through `toTransportError`. A plain throw
  leaves `claimed`, which is the delivery layer's existing reclaim-after-crash
  rule, and it only fires after the 2-minute claim lease.
- **The live call.** `call.js` had no test at all. It now has one: a loop-back
  realtime peer, and Claire's tool call arriving over the data channel. A
  hand-off from a call opened on A states A, including after the page moves to
  B. Removing the field turns it red.
- **A composed question bypasses the creation gate.** The words come from the
  blocker row (`requested_action` from the plan step, `why_needed` from the
  policy), not from the refused sentence. The sending gate still runs on them
  at delivery.

Residuals, accepted and stated:

- If the reserved Unnamed project were ever missing from the payload, the
  portfolio dock would fall to `PROJECTS[0]`. That is the page's existing,
  visible choice ("Filed under …"), and with this candidate it would also be
  stated.
- A tab left open on a project that is archived afterwards still states it,
  and the answer is filed there. It is visible until the next reload.
- The Deno runtime was not run.

## Production, read-only, 29 September

- worker **v841**, `voice` v555, `voice-token` v585, `hq-api` v777.
- **612** migrations applied, latest `0599`, so 0600 is the only pending one.
- Exposure to the new sweep at its first tick: **0** open questions on paused,
  announcing jobs (0 lapsed-unsent, 0 never recorded, of any age).

## Compatibility across a partial deploy

| Deployed | Not yet | Behaviour |
|---|---|---|
| 0600 | worker | old worker ignores the columns — unchanged |
| worker | 0600 | the sweep's query fails closed and asks nothing; the inline ask and the refused-question fix still work; the `asked_at` stamp fails silently |
| voice | page | pages send no `project` → exactly today's behaviour (invariant 5) |
| page | voice | the old door ignores `project` → today's behaviour |
| page open across the voice deploy | — | keeps sending no `project` until reloaded; a reload is a new session anyway |

No order is unsafe. The intended order is below, chosen so that each step is
honoured by the one before it.

## Deployment procedure (requires Grant's explicit authorization of this commit)

**Preconditions.**

1. Authorization names the candidate head commit.
2. Re-run, at that commit:

       npm run lint && npm run typecheck && npm test
       npm run check:migrations && npm run check:secrets && npm run check:templates && npm run check:voice-sessions
       sudo bash scripts/isolated/replica.sh && bash scripts/isolated/run-all.sh

3. Read-only: the exposure query above, and `select count(*), max(name) from
   app.schema_migrations` (expect 612, `0599`).
4. Secret digests: `deploy:worker` rewrites three function secrets, and
   `deploy:voice` sets `HQ_API_TOKEN` and `VOICE_ALLOWED_ORIGIN`. As on 28
   September, prove by digest before running each that the values it will
   write equal what production holds. If any differs, stop: it is a
   configuration change, and not part of this candidate.

**Steps.** One at a time, each verified before the next.

1. **Migration 0600** — `npm run migrate` (0600 is the only pending file).
   Verify both columns and `blockers_ask_attempts_nonnegative` exist, and that
   the ledger reads 613.
2. **Worker** — `npm run deploy:worker`; expect v842 and its probes green.
   Watch one tick's log: no `asking sweep failed`.
3. **Voice** — `npm run deploy:voice`. Its probes must pass: an
   unauthenticated call gets 401, and a real question is answered from state.
   Its probe session `verify-deploy-…` is harness-shaped and contained. This
   also redeploys `voice-token` from unchanged source.
4. **Page** — as on 28 September, deploy production's own file list with only
   `studio/chat.js` and `studio/call.js` replaced, at both served paths. Do
   **not** use `deploy:hq`: it also redeploys `hq-api`, upserts a Vercel
   environment variable and sets a function secret.

**Acceptance.** These are production-mutating, and each needs its own
authorization.

- #373: in `ai-team-hq`, type one harmless sentence in project A's Chat and
  one in B's. Read `inbound_commands` read-only: `project_id` is A and B, and
  `split_part(origin_ref, ':', 1)` is `<session>/<A>` and `<session>/<B>`.
  Each answer appears only in its own Chat. Repeat once with a voice note.
- #375: `verify:pursues`, `verify:basecamp-todos-live`,
  `verify:basecamp-addsource`, and
  `BASECAMP_SITE=https://ai-team-hq.vercel.app npm run verify:basecamp-live`.
- #371: no safe production trigger exists without raising a real approval
  question; its proof is the isolated suite.

**Rollback**, per surface:

- page: redeploy `dpl_GwmxkoNNac7MmfKia4VWVmxszdFD`;
- voice: `deploy:voice` from `1095b04`;
- worker: `deploy:worker` from `1095b04`, which restores v841's code;
- 0600: leave it in place. It is additive and the old worker ignores it.
