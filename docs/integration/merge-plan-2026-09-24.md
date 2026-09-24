# Merge plan — 24 September 2026

**Nothing here has been merged.** This is the plan, written from a candidate
that was built, deployed and driven, and it is exact enough to follow without
this conversation.

## What is being merged, and in what order

| # | Branch | Head at the time of writing | Why this position |
|---|---|---|---|
| 1 | `claude/human-simulation-harness` | `3bb5bb8` | The largest. `main` **and** `claude/production-reliability` are both ancestors of it, so merging either separately is redundant and would only invent conflicts. |
| 2 | `claude/fresh-install-onboarding` | `23ebdf1` | Adds `scripts/fresh/**`, the baseline and `check:fresh`. Touches almost nothing the backend does. |
| 3 | `claude/basecamp-team-hq` | `f116a22` | The frontend. Adds no migration that the backend does not already have. |

`claude/production-reliability` is **not** in the list on purpose:

```
$ git merge-base --is-ancestor origin/claude/production-reliability \
                              origin/claude/human-simulation-harness && echo contained
contained
```

## The conflicts, and how each was resolved

Five files, and only one of them needs a person to think.

| File | Shape | Resolution |
|---|---|---|
| `package.json` (×2) | two disjoint blocks of scripts | keep both; no key overlaps either time |
| `.gitignore` | two disjoint blocks | keep both |
| `CLAUDE.md` | both branches appended traps | keep both |
| `scripts/check-leaks.ts` | two select-list items — **and a shared `/*`** | keep both, with a comma between, and RE-OPEN the comment (see below) |
| `supabase/functions/hq-api/index.ts` | **the one to read** | see below |

**The gateway conflict ends mid-function.** `HEAD`'s side finishes at
`else keepAlive(kick)` and the shared line *after* the marker is the single `}`
that closes whichever function came last. Concatenating the two sides therefore
leaves `kickWorker` unterminated — which is exactly the damage the previous
candidate took, and `tsc` cannot see it because it does not typecheck Deno edge
functions. **Give `kickWorker` its own closing brace, then run
`npx biome ci supabase/functions/hq-api/index.ts`.**

**And `scripts/check-leaks.ts` has the same shape one layer down.** The line
immediately above `<<<<<<<` is a bare `/*`, so both sides' comment bodies hang
off one opening — and `HEAD`'s side closes it with `*/`. Concatenating them
leaves the second side's prose as SQL. It parses perfectly as TypeScript,
because it lives inside a template literal, and announces itself much later as
`42601: syntax error at or near "no"` from a query nobody has changed. Re-open
the comment before the second side.

Both of these are the same lesson: a conflict marker is a TEXT boundary and the
things it cuts through — a function body, a comment — do not care.

## The migration numbers

The integrated corpus is **608** files with **thirteen** numbers used twice.

**Leave all thirteen alone.** `app.schema_migrations` is keyed on the migration's
NAME, so both files are recorded and both ran; renaming either would make the
repository claim a number it did not run under. They are recorded as evidence in
`migrations/collisions.json`, and `npm run check:migrations` reports each as a
NOTE rather than a finding — and still fails on a collision that is *not* in that
manifest, which was proved by removing one.

**Three were renumbered**, and only because they are in no ledger anywhere:
`claude/fresh-install-onboarding`'s last three took 0534–0536, which
`claude/human-simulation-harness` also used. They became **0592, 0593, 0594**.
The backend corpus is complete at 0591, so the numbers cannot move under them.

**0595 is new** and belongs to this integration: `app.enqueue_inbound`'s body
illustrated `origin_ref` with Grant's real Telegram chat and a real Slack
channel of his, so the schema — which the fresh-install baseline captures —
carried his identifiers. It replaces the example and keeps the explanation.

## The steps, in order

```bash
# 1. the candidate
git checkout -b integration/2026-09-24 origin/claude/human-simulation-harness
git merge origin/claude/fresh-install-onboarding     # package.json, additive
git merge origin/claude/basecamp-team-hq             # five files, see above
npx biome ci supabase/functions/hq-api/index.ts      # the gateway actually parses

# 2. the three numbers nobody has run
git mv migrations/0534_the_mcp_address_is_this_offices_or_it_is_nothing.sql \
       migrations/0592_the_mcp_address_is_this_offices_or_it_is_nothing.sql
git mv migrations/0535_a_column_comment_that_names_a_bot_nobody_else_has.sql \
       migrations/0593_a_column_comment_that_names_a_bot_nobody_else_has.sql
git mv migrations/0536_an_office_can_connect_its_own_thinking.sql \
       migrations/0594_an_office_can_connect_its_own_thinking.sql

# 3. prove it before anything is applied anywhere
npm run check:migrations        # 608, 604 applied, 13 collision notes
npm run check:reconcile         # UNEXPLAINED 0, CHECKSUM DISAGREEMENTS 0
npm run fresh:zero-state -- --preconditions    # 608/608 from an empty database
npm run fresh:baseline          # REQUIRED after any migration is added or renamed
npm run check:fresh             # clean

# 4. the rest of the matrix
npm run lint && npm run typecheck && npm run test
npm run check:secrets && npm run check:templates
npm run basecamp:gate

# 5. apply, then deploy — a migration is not a deploy
npm run migrate
npm run deploy:worker
npm run deploy:hq               # the page AND hq-api
npm run deploy:signin
npm run live:mirror && npm run basecamp:gate2
```

## What must happen in the same breath as the merge

- **`npm run fresh:baseline`.** `migrations/baseline/baseline.json` lists every
  migration by name; any add or rename leaves it stale, and a stale baseline
  means a fresh install arrives missing the difference — silently, because the
  office looks complete. `npm run check:fresh` catches it.
- **`npm run deploy:hq`.** The gateway in this candidate carries a real fix
  (three verdicts rather than two, so a throttled identity service no longer
  signs people out) and the page carries ADR-0048. A migration is not a deploy
  and neither is a merge.
- **`npm run config:site` runs inside `deploy:hq` and `deploy:preview`.** It
  writes `web/studio/config.js`, which is gitignored. A deploy that skips it
  ships a dashboard that does not know which office it belongs to — and says so
  honestly rather than guessing, which is the point.

## The candidate carries more than the three branches do

Merging the three branches reproduces the candidate's TREE, not its work. The
pass found defects that only exist where two branches meet, and the fixes for
them live on `trial/integration-2026-09-24b`. Most were pushed back to the
branch that owns them; four commits are the integration's own and have nowhere
else to go.

**Already on `claude/basecamp-team-hq`**, so the merge picks them up:

| | |
|---|---|
| ADR-0048 | the dashboard resolves its own office, `config:site`, `check:backend-ref` |
| the gateway | three verdicts rather than two, so a throttle no longer signs people out, plus the test that holds it |
| the preview | `VERCEL_PREVIEW`, `HQ_API_SLUG`, the sign-in ceremony origin and its rate-limit wait |
| the live suites | four timing assumptions and one route pattern |
| basecamp CSS | three tokens that resolved to nothing |
| `verify:basecamp-chat` | rewritten for the session architecture, and the two defects that found |

**Only on the candidate**, and to be cherry-picked in the same step as the
merge — each names the branch it really belongs to:

| Commit | What | Whose |
|---|---|---|
| `7e07ede` | preconditions 0539–0591, the neutralise fix, migration 0595, `probe-understand`'s project ref | fresh-install + backend |
| `c6f74cf` (the `scripts/` half) | `check:tokens` understands an experience | whoever owns `check:tokens` |
| `655f906` | the callers baseline shrinks by three; `check:provenance` stops counting a suite's blockers | backend |
| `0a8f030` | `check-leaks.ts`'s re-opened comment | this merge |
| `b354ebf` (the `src/migrations` half) | `collisions.json` and the checker that reads it | this merge |

`docs/fresh-install/INTEGRATION-REQUESTS.md` (IR-3) says the same thing to the
fresh-install workstream in its own words, because a precondition staged by
NAME cannot live on a branch that does not have the migration it is named for.

## The one thing only a browser at the real origin could say

A server-side fetch sends no `Origin`, so it cannot detect a CORS
misconfiguration — CLAUDE.md records the voice call being dead for weeks while
every probe passed. The gateway this pass deployed is a new slug and the
preview is a new hostname, so neither had ever been asked from a browser.

From the deployed page, in real Chromium, with a real `Origin`:

```
gateway, no credential     401   (CORS fine)
gateway, a bad bearer      401   (CORS fine)
voice                      401   (CORS fine)
signin, from this origin   BLOCKED — TypeError: Failed to fetch
```

The last line is the point. `signin` keeps an allow-list of origins it will
mint a magic link for, the preview is not on it, and **it was not put on it**:
widening a production authorization boundary to make an integration pass is the
one thing this pass is forbidden to do. The ceremony happens at the allowed
origin instead and the session travels, which grants nothing the office did not
already grant.

## What is deliberately still standing

- `hq-api-integration` (v6) — the isolated gateway this pass drove. Nothing
  points at it but the preview. Delete it when the merge is deployed.
- The preview deployment. It has its own hostname and moved no alias.
