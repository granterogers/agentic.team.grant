# Deep systems audit, second wave: 6 October 2026

Linked from `docs/audit/DEEP-SYSTEMS-AUDIT-2026-10-06.md` (the first wave). **No production contact of any kind in this wave**: no canary, no
Management API, no production SQL, no logs or usage queries, no deploy, no production migration, no production flag. Evidence is local source,
vitest, throwaway worktrees and isolated replicas only (a marked local Postgres 16 built from the repository's migrations; the proofs refuse anything
else). Nothing in this document is a live reading of production.

Vocabulary, kept separate throughout: **PROVEN** (read and traced), **MUTATION-PROVEN** (the control was broken on purpose and a test went red),
**REPLICA-PROVEN** (driven on the isolated replica), **INFERRED** (reasoned from source), **UNPROVEN** (needs something this wave may not touch).
A surviving mutation proves a missing tripwire in the unit suite. It is not, by itself, a demonstrated production vulnerability, and it is not reported as one.

## What was done, in the order asked

| # | Task | Result |
|---|---|---|
| 1 | D1 approval principal binding | **Reproduced on the replica against the latest definitions (through 1022), fixed (migration 1023), proof 5/9 red before and 8/8 green after.** Details below |
| 2 | Complete mutation campaign | 32 mutations in a repeatable harness (`npm run` not needed: `npx tsx scripts/audit/mutation-campaign.ts`), 31 caught, 1 equivalent mutant (documented), 0 did not land |
| 3 | Tripwires for the known survivors | M1, M2, M2b, M3, M4, M4b, M5, M6, M17, M23 (+M23b), M25 each now caught, each sabotage shown red and restored green |
| 4 | B-04 sign-in redirect | Fixed: exact-origin validation (`src/auth/redirect-target.ts`), 63 tests, handler-level test, sabotage red |
| 5 | B-05 token adoption | Fixed: flow-bound adoption (`web/studio/flow.js`), 19 tests, two sabotages red |
| 6 | C1 silent terminal failure | Reproduced on the replica (three paths silent), fixed at one place (migration 1024 + sweep), 18-check proof, sabotages red |
| 7 | B-01 hostile PDF | Reproduced (OOM and timeouts in child processes), fixed with budgets inside the loops, 31 hostile documents, sabotages red |
| 8 | D3 connector SSRF | Fixed: one shared destination policy (`src/net/destination.ts`) used by MCP discovery, artifact collection and the page reader; fail-closed DNS; 130 tests |
| 9 | G-1 / G-2 capacity and recovery | See the capacity and recovery section (agent G) |
| 10 | Tenant fairness and shared budget | Reproduced on the replica (three defects), fixed (migration 1025), 10/25 red before and 23/23 green after, sabotages red |
| 11 | Test hermeticity | `npm test` is hermetic: production credentials are removed from every test environment; the one test that needed a token no longer does |
| 12 | Documentation and deployment state | One canonical machine-readable record (`docs/ops/deployment-state.json`) held by `check:deployment-state`; CLAUDE.md and HANDOFF defer to it |
| 13 | Lint baseline | Toolchain drift, not a repository defect: see below. Biome pinned to 2.5.11 |
| 14 | Re-run | See the final section |

## D1: can an external assistant answer an owner-only approval question? Yes, it could, and now cannot

**REPLICA-PROVEN.** Path driven on the replica built from every migration through 1022 (the latest effective definitions, not 0783): the owner has exactly
one open question on a dashboard turn; a connected assistant calls `app.mcp_ask_team('yes')`; the command is `origin_channel 'teamhq'`, key
`teamhq:mcp_message:<hex>`, actor the owner, and `app.command_origin` says `unknown`; `app.open_questions_for_reply` threads the conversation on
(channel, the part of `origin_ref` before the colon, subject), which is `teamhq` for the dashboard and the assistant alike, so the assistant's turn took the
dashboard turn as its previous turn and the owner's question was **bindable**; `app.hq_answer_blocker(…, app.command_principal(…))`, which is what
`instruction.ts` calls, then **resolved the question as the owner**. Containment did not intervene because it gates job kinds with external reach and
`office.instruction` is internal, and the handler checks `forwarded` but not origin.

Not demonstrated: the full handler loop (the model-free reading `entitled.answer('yes')` and the call are INFERRED from `instruction.ts:5081-5157`; the
SQL half is what was driven). Not claimed: that this was ever exploited in production (UNPROVEN; needs a production read of `blockers` answered with an
`mcp_message` command).

Variants tried: the same with a specialist addressed (`p_to`); the previous turn having pinned `awaiting_answer`; two assistant turns chained so the second's
previous turn is the assistant's own. The first reproduced; the other two did not bind on this schema (reported as passing controls, not as findings).

**Fix** (migration 1023): `app.open_questions_for_reply` returns nothing for a turn whose `command_origin` is `unknown`, spliced from the live definition with
one guard. `trusted` (every production adapter) and `harness` (already restricted to harness work by the function's last predicate) are unchanged.
**Regression**: `scripts/isolated/mcp-cannot-answer.ts`; controls: a trusted dashboard "yes" still binds the one open question and answering as the owner
through the answer door still works. **Sabotage**: the pre-fix function is the sabotage and the proof was 5/9 red against it; 8/8 green after. The proof is a
replica proof, so it is not in `npm test`; that is a standing gap of this repository (see the isolated-proof census).

## Mutation campaign

Harness: `scripts/audit/mutation-campaign.ts` with `scripts/audit/mutations.json`. A mutation breaks one control in a **git-backed throwaway worktree** of
the committed tree (the earlier file copy had no `.git`, so one test failed in every run and masqueraded as a catch). The campaign **refuses to run unless
the baseline is green**, refuses a dirty tree, reports a mutation whose anchor is not present exactly once as DID NOT LAND (never as caught), strips production
credentials from the child environment, and re-runs the baseline at the end to prove the tree was restored.

RESULTS_TABLE_PLACEHOLDER

## B-04, B-05, C1, B-01, D3, fairness: what was reproduced and how

See the individual fix commits; summary of evidence levels:

- **B-04**: REPRODUCED in code (prefix check accepts `allowed.example.evil.com`, `allowed.example@evil.com`, `allowed.example:444`); MUTATION-PROVEN fix. UNPROVEN: behaviour against live Supabase Auth.
- **B-05**: REPRODUCED in code; MUTATION-PROVEN fix (two sabotages). Cross-device opening of a magic link is now refused with an explicit message instead of silently adopted (a deliberate trade, argued in the commit). UNPROVEN: Supabase keeping `?flow=` on `redirect_to` (needs one live check before deploy; mitigation named).
- **C1**: REPLICA-PROVEN silent for lease expiry in `running`, in `output_created`, and for `settle_exhausted_jobs`; INFERRED silent for `committing`, `quality_review` and the dequeue-ceiling branch (same writer). Fixed at the state (`failed`, never told) by a sweep, not at each writer.
- **B-01**: PROVEN: the unfixed reader ran out of memory (RunLength, repeated content streams) or exceeded 40 s (ASCII-hex, many Flate streams, ObjStm with a lying `/N`, quadratic regexes in the PDF, HTML and DOCX paths) in child processes under a 256–384 MB heap. Fixed with budgets enforced inside the decoder loops and linear rewrites of the patterns.
- **D3**: PROVEN: the MCP discovery fetch followed redirects with no destination check, and the existing browser guard failed OPEN on a resolver error. One shared policy now.
- **A-1/A-2/C8**: REPLICA-PROVEN: one office's spend parked another's queued jobs; the office ceiling was the deployment's; a late job waited behind 197 of another office's 200.

CAPACITY_RECOVERY_PLACEHOLDER

## Test hermeticity, lint, documentation

- `vitest.config.ts` loads `tests/setup/hermetic.ts`, which removes every production credential and production-access flag from the environment of every test file; `tests/safety/hermetic.test.ts` asserts it from inside a test. The suite is green with `SUPABASE_ACCESS_TOKEN`, `ALLOW_PRODUCTION_CHECKS` and `ALLOW_PRODUCTION_WRITES` exported in the shell, and green without them. The failing suite had imported a production-capable module whose top level called `process.exit(2)`; the pure helper now lives in `scripts/sessions/weather.ts`.
- **Lint**: **toolchain drift**, not a repository defect. The lockfile and `biome.json` pin Biome 2.5.11; the commit `a9a8d39` ("Format one p4 file so lint exits clean") reformatted one file to the output of a *different* Biome and thereby broke it for the pinned one (the pinned formatter wants the original). `package.json` allowed `^2.3.14`, so any machine could drift. Pinned to exactly `2.5.11` and the file restored. Root `biome ci .` additionally fails while agent worktrees sit under `.claude/worktrees` (nested root configuration); that is environmental and ends when they are removed.
- **Deployment state**: `docs/ops/deployment-state.json` is the one record; `npm run check:deployment-state` holds it against `migrations/applied.json` (798) and the committed files, derives the pending set (now 1023 to 1026 as committed), and fails if CLAUDE.md or HANDOFF restate a production count or stop deferring to it. It is a record of what evidence proved on 6 October, explicitly `isLiveProductionReading: false`.

FINAL_PLACEHOLDER
