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

**Score: 32 mutations, 31 CAUGHT, 1 SURVIVED as a documented equivalent mutant (M21), 0 did not land. Security-critical (30): 30 caught.**
Every mutation landed (its anchor occurred exactly once). The baseline was green before each batch and again after the last, so no catch is an infrastructure
artefact. "Before" is the state before this wave's tripwires: of the twelve mutations run in the first wave, nine survived (M1, M2, M2b, M3, M4, M4b, M6, M17,
M23); M5 and M25 survived when first run in this wave; the rest were first run here.

| ID | Control / invariant | Expected test | Caught by | Before | Now | Severity if the tripwire were missing |
|---|---|---|---|---|---|---|
| M1 | Telegram webhook refuses a request without the shared secret | webhook-authentication | webhook-authentication | SURVIVED | CAUGHT | high |
| M2 | Slack events refuses a bad or stale signature | webhook-authentication | webhook-authentication | SURVIVED | CAUGHT | high |
| M2b | Slack events fails closed with no signing secret | webhook-authentication | webhook-authentication | SURVIVED | CAUGHT | high |
| M3 | a recorded yes does not outrank a policy `refuse` | approval-gate-refusals | approval-gate-refusals | SURVIVED | CAUGHT | high |
| M4 | no approval means no start | approval-gate-refusals | approval-gate-refusals | SURVIVED | CAUGHT | high |
| M4b | a forged or mismatched approval does not start work | approval-gate-refusals | approval-gate-refusals | SURVIVED | CAUGHT | high |
| M5 | notebook write consumes the approval gate's answer | every-external-kind-is-gated | same, now per handler block | SURVIVED | CAUGHT | medium |
| M6 | outside material does not travel into a later plan step | perform-untrusted-fence | perform-untrusted-fence | SURVIVED | CAUGHT | high |
| M7 | `isUntrusted` recognises outside connectors | untrusted-context | perform-untrusted-fence | caught (first run) | CAUGHT | high |
| M8 | `contextBlock` fences outside, not trusted, material | untrusted-context | untrusted-context | caught (first run) | CAUGHT | high |
| M9 | gmail is an outside connector | untrusted-context | untrusted-context | caught (first run) | CAUGHT | medium |
| M10 | a production write needs both flags | production-gate | production-gate | caught | CAUGHT | high |
| M11 | only the literal 1 is the production flag | production-gate | production-gate | caught (first run) | CAUGHT | high |
| M12 | a production host is recognised | production-gate | production-gate | caught (first run) | CAUGHT | high |
| M13 | a deploy script imports the writes gate | production-gate-coverage | production-gate-coverage | caught (first run) | CAUGHT | high |
| M14 | the migration runner imports the writes gate | production-gate-coverage | production-gate-coverage | caught (first run) | CAUGHT | high |
| M15 | harness work is contained | containment | containment | caught (first run) | CAUGHT | high |
| M16 | an unclassified kind is external | containment | containment | caught (first run) | CAUGHT | high |
| M17 | the worker cancels contained work before the handler | worker-refuses-contained-work | same | SURVIVED | CAUGHT | high |
| M18 | no module sends to Slack outside the delivery path | containment | containment | caught (first run) | CAUGHT | medium |
| M19 | a far-future Slack timestamp is stale | slack/signature | slack/signature | caught (first run) | CAUGHT | high |
| M20 | the Slack signature is compared | slack/signature | slack/signature | caught (first run) | CAUGHT | high |
| M21 | empty expected Telegram secret returns false (**equivalent mutant**: the next line and the hash comparison already refuse every input, so removing it has no observable effect) | telegram | none, by design | equivalent | SURVIVED (equivalent) | low |
| M22 | Slack tokens are redacted | secrets | router (provider-error redaction) | caught (first run) | CAUGHT | medium |
| M23 | the office is the credential's, never a query parameter | office-from-credential | same | SURVIVED | CAUGHT | high |
| M23b | the office is the credential's, never a header | office-from-credential | same | new | CAUGHT | high |
| M24 | operator-only actions refuse a non-operator | operator-only | operator-only | caught | CAUGHT | high |
| M24b | operator-only sections refuse a non-operator | operator-only | operator-only | caught | CAUGHT | high |
| M25 | the "put somebody else on it" hand-off starts one child, not two | one-live-attempt (per-kind test added) | same | SURVIVED | CAUGHT | medium |
| M25b | a plan starts once unless deliberately repeated | one-live-attempt | same | caught (first run) | CAUGHT | medium |
| M26 | task extraction fences outside material in the prompt | extract-tasks | same | new | CAUGHT | medium |
| M26b | task extraction says outside material is present | extract-tasks | same | new | CAUGHT | medium |

Recommended regression tests are the ones named in the "Expected test" column; each is new in this wave where "Before" says SURVIVED, and each asserts behaviour:
the two webhooks are loaded as the deploy bundles them (`tests/helpers/edge-bundle.ts`) and driven with unauthenticated, wrongly authenticated, stale and unconfigured
requests, asserting 401 **and that nothing downstream was reached**, with an authenticated control; the approval gate is driven with a permissive policy database so the
refusals are the only thing standing; the plan-step fence is shown a retrieval holding one hit of every connector kind and asserted on what a downstream step is handed;
the worker is driven through `runJob` with harness, unknown and unanswerable origins; the office is asserted from the real gateway for two credentials with hostile office
identifiers in the query, headers, cookie, body and arguments. **M23 is the control the first-wave brief singled out: it proves the unit suite could not detect removal of the
office binding. It did not prove a cross-tenant read, and none was found.**

Findings of the campaign itself: (1) `every-external-kind-is-gated-or-named` judged a handler "gated" if ANY handler in its file was, so one file hosting five kinds
could lose one gate unnoticed (M5): now judged per handler block, with a control; (2) a `toContain('app.enqueue_child_once')` assertion was satisfied by any occurrence
(M25): now per kind; (3) one mutation is equivalent, and the harness has a field for that so an equivalent survivor is not read as a gap.

## B-04, B-05, C1, B-01, D3, fairness: what was reproduced and how

See the individual fix commits; summary of evidence levels:

- **B-04**: REPRODUCED in code (prefix check accepts `allowed.example.evil.com`, `allowed.example@evil.com`, `allowed.example:444`); MUTATION-PROVEN fix. UNPROVEN: behaviour against live Supabase Auth.
- **B-05**: REPRODUCED in code; MUTATION-PROVEN fix (two sabotages). Cross-device opening of a magic link is now refused with an explicit message instead of silently adopted (a deliberate trade, argued in the commit). UNPROVEN: Supabase keeping `?flow=` on `redirect_to` (needs one live check before deploy; mitigation named).
- **C1**: REPLICA-PROVEN silent for lease expiry in `running`, in `output_created`, and for `settle_exhausted_jobs`; INFERRED silent for `committing`, `quality_review` and the dequeue-ceiling branch (same writer). Fixed at the state (`failed`, never told) by a sweep, not at each writer.
- **B-01**: PROVEN: the unfixed reader ran out of memory (RunLength, repeated content streams) or exceeded 40 s (ASCII-hex, many Flate streams, ObjStm with a lying `/N`, quadratic regexes in the PDF, HTML and DOCX paths) in child processes under a 256–384 MB heap. Fixed with budgets enforced inside the decoder loops and linear rewrites of the patterns.
- **D3**: PROVEN: the MCP discovery fetch followed redirects with no destination check, and the existing browser guard failed OPEN on a resolver error. One shared policy now.
- **A-1/A-2/C8**: REPLICA-PROVEN: one office's spend parked another's queued jobs; the office ceiling was the deployment's; a late job waited behind 197 of another office's 200.

## Capacity and recovery (G-1, G-2), built without a production query

Full workings: `docs/ops/capacity-scenarios-2026-10-06.md`, `docs/ops/restore-procedure.md`, `docs/adr/0068-*.md`, migration 1026.

- **Capacity (INFERRED from recorded figures only).** Recorded database size: 63 MB (17 Sep), 328 (2 Oct), 346 (4 Oct), 372 (5 Oct), decimal MB, against the 500 MB free-tier ceiling. At 9, 17 and 26 MB a day (optimistic, central, pessimistic, each with its documented basis) the database reaches 100% roughly **10 to 19 October** in the central range, and the 1 GB Storage allowance, which also holds every backup (never deleted), may be reached first. Which resource hits first is UNPROVEN; it needs the real sizes. These are scenarios, not forecasts.
- **Built (REPLICA-PROVEN, 34/34):** a capacity watch (70/85/95% with hysteresis, a bounded daily sample, a projected-days-to-limit figure), a duty and a chore on the existing path, a notice composed in code that speaks only on a crossing and at most daily afterwards; backup retention (newest 7 plus one a week for 8 weeks; never the newest verified; never an object it did not create; a dry run by default and a deletion only with an attended flag). **No historical or provenance data is deleted or compacted anywhere**; the retention analysis (requirement, evidence, safe action, not safe) is in the scenarios document, and it found that the mail cache is never aged out while its duty is off. **None of it runs until migration 1026 is applied and the worker is deployed.**
- **Recovery.** The first-wave rehearsal loaded every column as text and so proved only that rows parse. A typed restore now runs on a fresh isolated replica (REPLICA-PROVEN, 55/55; 121,233 rows in 162 tables restored in 7 s): foreign-key order with cycles resolved, real column types, triggers journaled and restored, sequences set, counts and content fingerprints, a structure fingerprint, and a smoke through product readers. Its controls were shown to fail: a corrupted column type (the all-text rehearsal accepts the same value), a changed value of the right type, a dropped parent table, an unmarked or non-empty target (refused). The dump pages by key so a large table no longer needs one in-memory select (the old dump ran out of a 96 MB heap at 53 MB; the paged one peaks at 69 MB).
- **What a restore still cannot reconstruct (DESIGN-ONLY, UNPROVEN):** `auth.users` (the export carries whitelisted columns and never hashes or tokens; re-creation through the Auth admin API with the original ids is specified, not run), Storage object bytes (a manifest with checksums is recorded; re-upload is a procedure), `cron` jobs (redacted statements are generated), vault secrets (names only), function sources and webhook registrations. The off-project copy is **not wired**: only packaging, a public-key encryptor that refuses a private key, and manifest verification exist; no vendor was called and any free-tier figure for a candidate store is UNVERIFIED. **Backups remain in the same Supabase project as the data.** Realistic RTO today is **hours**, dominated by manual steps; RPO is up to one nightly cycle. Both are design-level until a real drill into a scratch project.

## Test hermeticity, lint, documentation

- `vitest.config.ts` loads `tests/setup/hermetic.ts`, which removes every production credential and production-access flag from the environment of every test file; `tests/safety/hermetic.test.ts` asserts it from inside a test. The suite is green with `SUPABASE_ACCESS_TOKEN`, `ALLOW_PRODUCTION_CHECKS` and `ALLOW_PRODUCTION_WRITES` exported in the shell, and green without them. The failing suite had imported a production-capable module whose top level called `process.exit(2)`; the pure helper now lives in `scripts/sessions/weather.ts`.
- **Lint**: **toolchain drift**, not a repository defect. The lockfile and `biome.json` pin Biome 2.5.11; the commit `a9a8d39` ("Format one p4 file so lint exits clean") reformatted one file to the output of a *different* Biome and thereby broke it for the pinned one (the pinned formatter wants the original). `package.json` allowed `^2.3.14`, so any machine could drift. Pinned to exactly `2.5.11` and the file restored. Root `biome ci .` additionally fails while agent worktrees sit under `.claude/worktrees` (nested root configuration); that is environmental and ends when they are removed.
- **Deployment state**: `docs/ops/deployment-state.json` is the one record; `npm run check:deployment-state` holds it against `migrations/applied.json` (798) and the committed files, derives the pending set (now 1023 to 1026 as committed), and fails if CLAUDE.md or HANDOFF restate a production count or stop deferring to it. It is a record of what evidence proved on 6 October, explicitly `isLiveProductionReading: false`.

## Isolated-proof census (a finding of its own)

All 96 proofs under `scripts/isolated/` that open a replica were run each on a fresh copy of a replica built from the full chain (which also proves migrations 1023 to 1026
replay cleanly after 1022): **49 pass, 43 fail, 4 exit with a usage error.** Of the 43, 35 stop at an `INSERT` that predates the multi-user columns (`jobs.office_id`,
`inbound_commands.project_id`, `blockers.office_id`, …, all NOT NULL now): stale fixtures, not product failures (INFERRED for each: the first error is the constraint, but
no baseline run per proof was made, and the proofs cannot say whether the behaviour they were written for still holds). Four assert an old schema by design (`compat-0600`,
`job-skew`, `fresh-replay`, and a precondition). Five reds are not obviously fixtures and **need triage, not assumption**: `enumeration-agreement` (two CHECK constraints list
channels that differ from `CHANNELS`: `channel_link_challenges_channel_check`, `events_origin_channel_known`), `guidance-stated` (5/6), `p1-operator` (19/25) and
`p1-storage-order` (14/18) (both report the gateway answering 503 "could not check who you are", which points at their fake auth, not at the gateway), and
`project-provenance`. **These proofs are not in `npm test` and nothing runs them as a gate; the controls that matter most for tenant isolation therefore rest on suites that rot silently.**
Passing at the final commit: `mcp-cannot-answer` 8/8, `terminal-job-owes-a-word` 18/18, `office-fairness` 23/23, `capacity-warning`, `backup-restore-typed` 55/55,
`approver-identity` 44/44, `sender-authorization` 39/39, `job-origin` 22/22, `containment` 19/19, `principals` 83/83, the Sample proofs, among others.

## Final classification of every original High and Medium finding

Severity here is the audit's own rating of the *finding*; "final" is after this wave. A fix that lives only in the repository does **not** change production: nothing
was deployed and migrations 1023 to 1026 have never been applied anywhere but replicas, so every original defect below is, as far as any evidence here shows, **still live
in production until a deploy**.

| ID | Orig | Final | Evidence level | Fix | Regression test | Sabotage result | Remaining risk | Production dependency |
|---|---|---|---|---|---|---|---|---|
| D1 assistant "yes" answers owner approval | High | Low (fixed in repo) | REPLICA-PROVEN | migration 1023 (origin guard in `open_questions_for_reply`) | `scripts/isolated/mcp-cannot-answer.ts` (8 checks, 3 variants, 2 controls) | pre-fix function: 5/9 red; fixed: 8/8 | handler loop inferred not driven; replica proof is not in `npm test`; old MCP tokens still carry write | needs 1023 applied; has it been exploited: a read of answered blockers |
| E1 webhook auth wiring untested | Medium | Low | MUTATION-PROVEN | tests only | `webhook-authentication.test.ts` | M1, M2, M2b red then green | secret rotation, replay at Telegram not driven | none |
| E2 approval refusals untested | Medium | Low | MUTATION-PROVEN | tests only | `approval-gate-refusals.test.ts` | M3, M4, M4b red | the SQL `authorize_effect` is covered by replica proofs that are red-by-staleness | none |
| E3 plan-step fence untested | Medium | Low | MUTATION-PROVEN | tests only; M5 per-block fix | `perform-untrusted-fence.test.ts`, architecture test | M5, M6, M7 red | see D2/D5 | none |
| M17, M23 tripwires | High (missing tripwire) | Low | MUTATION-PROVEN | tests | `worker-refuses-contained-work`, `office-from-credential` | red then green | DB side of office binding relies on replica suites | none |
| G-1 free tier is the first wall | High | Medium | INFERRED (scenarios) + REPLICA-PROVEN (watch) | migration 1026 capacity watch, retention command | `capacity-warning.ts` 34/34, vitest 106 | level function constant: 14 red; hysteresis removed: 4 red | **time-bound: central estimate 10 to 19 Oct**; nothing runs until 1026 + worker deploy; sizes are recorded not measured | real sizes, and production write authorisation to apply 1026 |
| G-2 no real restore | High | Medium | REPLICA-PROVEN (data) / DESIGN-ONLY (auth, storage, cron, off-project) | typed restore, paged dump, manifests, procedure, ADR 0068 | `backup-restore-typed.ts` 55/55, vitest | corrupted type, dropped parent, unmarked target all refused/red | same-project failure domain; no off-project copy; RTO hours | a real restore drill into a scratch project |
| B-01 hostile PDF resource exhaustion | Medium | Low | PROVEN (OOM/timeouts) then MUTATION-PROVEN | budgets inside every decoder loop, linear rewrites | `tests/text/hostile.test.ts` (31 documents, child processes) | 6 sabotages red | chosen limits not derived from the edge isolate; huge legitimate files refused honestly | the real isolate memory/CPU limits |
| B-02 open signup, unmetered operator-funded endpoints | Medium | Medium | PROVEN absent in function code | none | none | n/a | CONFIRMED BUT NOT FIXED | DB-side budgets, signup settings |
| B-04 sign-in redirect prefix match | Medium | Low | PROVEN (code) + MUTATION-PROVEN | exact-origin validation | `redirect-target.test.ts` (63) + handler test | prefix restored: 28 red | live Supabase redirect behaviour | the Auth redirect allow-list; the `?flow=` check |
| B-05 token adoption login CSRF | Medium | Low | PROVEN (code) + MUTATION-PROVEN | flow-bound adoption, cross-device refused | `signin-flow.test.ts` (19) | 2 sabotages red (12 and 3) | cross-device honest case needs a second request; nonce readable by XSS; email not bound | live check that `?flow=` survives `redirect_to` |
| B-06 no security headers | Medium | Medium | PROVEN | none | none | n/a | CONFIRMED BUT NOT FIXED | none |
| B-07 / A-7 MCP OAuth laundering, open registration | Medium | Medium | PROVEN (code) | none (D1 limits what an assistant can do) | none | n/a | CONFIRMED BUT NOT FIXED | revocation, existing clients |
| F-01 MCP unusable for a person as documented | Medium-High | Medium-High | PROVEN (code) | none | none | n/a | CONFIRMED BUT NOT FIXED (a product gap, with documentation drift) | a real consent and `tools/list` |
| C1 terminal job failure silent | Medium-High | Low | REPLICA-PROVEN (3 paths), 3 INFERRED | migration 1024 + worker sweep, one place | `terminal-job-owes-a-word.ts` 18/18 + vitest 5 | 3 sabotages red (9, 15, 17 of 18) | paused turns, outages over 30 min, real Telegram/Slack send from the sweep unproven | 1024 applied + worker deployed; count of silently failed real jobs |
| C2 say_once before delivery | Medium | Medium | PROVEN (ordering) | none | none | n/a | CONFIRMED BUT NOT FIXED | none |
| C3 reminder marked before delivery | Medium | Medium | PROVEN | none | none | n/a | CONFIRMED BUT NOT FIXED | none |
| C5 / F-03 time zone hardcoded to Athens | Medium | Medium | PROVEN | none | none | n/a | CONFIRMED BUT NOT FIXED | none |
| C6 person offices get daily channel-failure messages | Medium | Medium | PLAUSIBLE | none | none | n/a | UNPROVEN, not fixed | none |
| A-1 / C8 shared budget defers other offices | Medium | Low | REPLICA-PROVEN | migration 1025 per-office accounting | `office-fairness.ts` 23/23 + vitest 4 | 4 sabotages red | no per-job cap; in-flight spend invisible; a person's conversation exempt from deferral; no deployment-wide backstop | 1025 applied; real spend distribution |
| A-2 queue fairness / B-03 Sample key | Medium | Low (queue) / Medium (Sample key) | REPLICA-PROVEN (queue) | fair-share ordering term in `dequeue_job` | `office-fairness.ts` | red without the term (20/23) | the Sample's per-visitor limit still keys on a client-chosen id: CONFIRMED BUT NOT FIXED | none |
| A-3 Sample visitor may store a rule | Medium | Medium | INFERRED (no office-kind check in `app.learn` or `remember()`) | none | none | n/a | UNPROVEN end to end, not fixed | none |
| D2 untrusted material into other consumers | Medium | Low-Medium | PROVEN (path), MUTATION-PROVEN (mitigation) | task extraction fences outside material and states documents are data | `extract-tasks.test.ts` (4 new) | M26, M26b red | **prompt-level mitigation only**; `notion-import` and `projects/brief` unchanged; model compliance UNPROVEN | none |
| D3 connector SSRF | Medium | Low | PROVEN + MUTATION-PROVEN | `src/net/destination.ts`, fail-closed DNS, redirects re-validated | `tests/net/destination.test.ts` (130) | 3 sabotages red | DNS rebinding narrowed not closed; `notion/files.ts` upload URL unguarded; fail-closed behaviour in the Deno runtime unproven | worker egress policy; existing connector endpoints on other ports |
| F-02 calendar purge on move | Medium | Medium | PROVEN (code) | none | none | n/a | dormant (duty off, Google revoked); NOT FIXED | none |
| F-05 Telegram identity never recovers | Medium | Medium | PROVEN (code) | none | none | n/a | NOT FIXED | none |
| F-06 Slack uninstall not honoured | Medium | Medium | PROVEN (code) | none | none | n/a | NOT FIXED | none |
| G-4 retried writes / migration double apply | Medium | Medium | PROVEN (code) | none | none | n/a | NOT FIXED | none |
| G-5 infrastructure errors burn attempts | Medium | Medium | PLAUSIBLE | none | none | n/a | UNPROVEN | none |
| G-7 runbook calls dropped functions | Medium | Medium | PROVEN | none | none | n/a | DOCUMENTATION/PROCESS ONLY, NOT FIXED | none |
| G-8 health blind to wedged states | Medium | Medium | PLAUSIBLE | none | none | n/a | UNPROVEN, not fixed | none |
| G-9 / G-10 rollback artefacts, provenance gap | Medium | Medium | PROVEN | none | none | n/a | DOCUMENTATION/PROCESS ONLY | none |
| B-10 / G-12 `CHECKS` is not read-only | Medium | Medium | PROVEN | none | none | n/a | NOT FIXED; the guard stops accidents, not a deliberate actor | none |
| Docs state (CLAUDE.md, HANDOFF, readiness, applied.json disagree) | Medium | Resolved | PROVEN | `docs/ops/deployment-state.json` + `check:deployment-state`, deferral markers | `deployment-state.test.ts` (8, each rule shown failing) | n/a | the record is evidence at a date, never a live reading | none |
| Lint red on a clean checkout | Low | Resolved | PROVEN | Biome pinned to 2.5.11, file restored | `npm run lint` exits 0 (62 warnings, 33 infos, all pre-existing) | n/a | none | none |
| Unit suite not hermetic | Medium | Resolved | MUTATION-PROVEN | setup removes production credentials; helper split | `tests/safety/hermetic.test.ts` | loop disabled with a token exported: red | replica proofs are outside `npm test` | none |

## Direct answers

- **Complete mutation score:** 31 of 32 caught, the 32nd an equivalent mutant; **security-critical 30 of 30 caught.** Before this wave's tripwires, 9 of the 12 first-run mutations survived.
- **Is D1 actually exploitable?** At the database layer on the replica: **yes** (REPLICA-PROVEN: an assistant-origin "yes" resolved the owner's question). End to end through the live handler and in production: UNPROVEN (the handler's call is inferred from source; whether it ever happened needs a production read). It is fixed in the repository and **not** deployed.
- **Is office identity behaviourally protected?** At the gateway: **yes**, MUTATION-PROVEN for query string, headers, cookie, body, arguments and two credentials. That the database functions then honour the argument rests on the P2/P3 replica suites, several of which are red by stale fixture and were not re-verified here. No cross-tenant read or write was found in either wave.
- **Is webhook authentication behaviourally protected?** **Yes** for Telegram and Slack (M1, M2, M2b, M19, M20), including fail-closed with no secret and no downstream call.
- **Are approval refusals behaviourally protected?** **Yes** at `mayStart` (M3, M4, M4b, M5). The SQL decision (`app.authorize_effect`) is protected only by replica proofs that are not in the gate and are partly stale.
- **Can untrusted external material cross a consequence-bearing boundary?** Into a later plan step: **no**, behaviourally pinned. Into task extraction: **yes, with a prompt-level fence and statement** (a mitigation; compliance UNPROVEN). Into the Notion curriculum import, the project brief, and via the office's own derivative documents (`connector = NULL` is read as trusted): **yes, unchanged** (D2 remainder, D5).
- **Can terminal jobs disappear silently?** Before: yes, for lease expiry and exhausted attempts (REPLICA-PROVEN). After 1024 and a worker deploy: not for a `failed` turn inside a 30-minute window. Still possible: a turn that parks rather than fails, an outage longer than the window, and anything before the deploy.
- **Can connector discovery SSRF?** MCP discovery, artifact collection and the page reader now share one policy and refuse private, loopback, link-local, mapped, numeric-form and redirect-to-private destinations and fail closed on DNS errors (130 tests). Residual: DNS rebinding is narrowed not closed, one Notion upload URL is unguarded, and whether the Deno runtime allows the DNS lookups the guard needs is UNPROVEN.
- **Do hostile PDFs have bounded consumption?** In the repository, yes: 31 hostile documents each finish in under 4 s and under about 320 MB peak, inside a 256 MB heap limit, with honest "too large or too complex" answers. Whether the limits are low enough for the real edge isolate is UNPROVEN.
- **Is the test suite fully hermetic?** `npm test` is: green with production credentials and both production flags exported, green without, nothing contacts the network. The replica proofs are not part of it, and 43 of 96 are red by rot.
- **Realistic free-tier risk:** from existing evidence only, the database reaches its limit in roughly **4 to 13 days from 6 October** (central range), and Storage with its undeleted backups may be first. It is the one finding with a clock on it. The warning that would have said so is built and undeployed.
- **Realistic recovery capability:** the data can be restored into a fresh database with real types and constraints (replica-proven, seconds). The system around it (logins, stored files, schedules, secrets, functions, webhooks) is a manual checklist in the same failure domain: **hours**, unrehearsed on a real project.
- **Remaining P0:** none. **P1:** G-1 (time-bound, and every fix here is undeployed); G-2's missing off-project copy. **P2:** B-02, B-06, B-07/A-7, F-01, C2, C3, C5/F-03, the Sample's client-chosen visitor key, A-3, the D2 remainder and D5, F-05, F-06, G-4, G-5, G-8, B-10/G-12, F-02 (dormant); and the rotting replica proofs.

## What still genuinely requires production evidence (parked; nothing here attempted it)

1. Real database and Storage sizes, bucket contents, and per-table growth (G-1, and what `backup:prune` would list).
2. Whether D1 was ever exploited: blockers answered by a command whose key begins `teamhq:mcp_message`.
3. How many real, user-visible jobs ended `failed` with no delivery by a recovery path (C1 prevalence).
4. Supabase Auth: the redirect allow-list (B-04), whether `?flow=` survives `redirect_to` (B-05), email and password change for the shared Sample login, confirm-email, and any signup limits.
5. The edge isolate's real memory and CPU ceilings (B-01), whether `Deno.resolveDns` is allowed (D3), the worker's egress policy, and whether any existing connector uses a port other than 443 or 8443.
6. Applying migrations 1023 to 1026 and deploying the worker, hq-api, signin and mcp: **a production write that needs your explicit authorisation and a pushed commit**; the replica is not production (its fidelity was measured on 25 September).
7. An authenticated MCP `tools/list` and a real consent; a real restore drill; per-office spend and queue depth.

## Recommendation

**B: a narrowly authorised production READ, not a canary and not a release. Run it in parallel with a short wave of A for the remaining P2s.**

Evidence for B: (1) the capacity clock is the only finding that gets worse by waiting: the central scenario puts the database at its ceiling between roughly 10 and 19 October and the
estimate rests on a figure last recorded on 5 October, so one read of sizes decides whether this is a week-one action; (2) D1 and C1 are defects that either have or have not already
happened in production, and two read-only queries (answered blockers whose command key begins `teamhq:mcp_message`; failed real turns with no delivery and a recovery or no-attempts reason)
tell you whether the fixes are urgent or routine; (3) three assumptions the fixes depend on can only be checked live (the Auth redirect behaviour for `?flow=`, the Deno DNS lookup behind the
fail-closed SSRF guard, the isolate limits behind the PDF budgets). A READ of about ten statements answers (1) to (3) and the sizes and bucket listing; it writes nothing.

Why not C: releasing means a production write (four migrations, worker, hq-api, signin and mcp deploys), none of which has met the real database; the replica is faithful but is not production,
three behaviours are live-only, and the capacity warning does nothing until it is deployed, so the order matters (apply 1026 and the worker together, then watch the duty fire). Why not only A: more local
hardening has diminishing returns while the two things with a deadline and the three live-only assumptions cannot be closed locally. A still has value for the P2 list and for reviving the 43 rotted proofs
(put the critical ones into a gate that runs).

## Process disclosures

A `git stash -u` was run by mistake and popped at once (nothing lost). A commit briefly staged the agents' embedded worktrees and was amended before any push. One sabotage in a *throwaway worktree*
(never the repository) used a one-line Python replace; mutation campaigns use the harness. One fix agent ran `biome format --write` on three of its own new files, against the repository's
no-in-place-formatter rule; the results were read back and `biome ci` is clean. Sub-agents were instructed to be read-only for production and none contacted it; I checked no output for secrets because none were requested or printed.

