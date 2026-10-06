# Deep systems audit — 6 October 2026

**HEAD** `b8ffe44` · branch `claude/deep-systems-audit-3cwbtc` · **read-only run**: no production flag was set (`ALLOW_PRODUCTION_*` unset, the guard honoured), nothing was edited, migrated, deployed or enabled. The only files written are this report.

**P0: none found.** No cross-tenant read or write, auth bypass, unauthorised external contact or secret exposure was traced by seven independent read-only reviewers or by me. The highest findings are D1 (an external assistant's typed "yes" may answer the owner's approval questions) and the test-coverage gaps E1–E3.

## How to read this

- **PROVEN-LEAD** = I re-read the cited source myself. **MUTATION-PROVEN** = I broke it in a throwaway copy and watched the suite. **SUBAGENT** = a reviewer traced it with file:line; I did not independently re-trace it. **UNPROVEN** = cannot be tested safely here.
- Scope honesty: this was one wave of seven reviewers (tenancy, auth/edge, worker/jobs, agents/approvals, test architecture, cross-system, recovery/ops), my local gates, ten local mutations and spot verification. It was **not** eight hours of passes. Pass 7 (second independent review) was done only as my own re-reads of D1, B-04, B-05 and C1. What a second wave should target is in the last section.
- The message that launched the run ended at "specified below" with no spec attached; the eight-pass brief was used as the spec.

## Baseline (local, production credentials unset)

| Gate | Result |
|---|---|
| `npm ci` | ok |
| `typecheck` | **0** |
| `lint` (`biome ci`) | **exit 1**: one format error, `scripts/isolated/p3-cases/20-projects.ts`, plus 62 warnings. Installed biome is 2.5.11; the repo's own history says lint was last made clean on 5 Oct (`a9a8d39`), so this may be toolchain drift. Not established. |
| `vitest run` | **5313 passed, 21 skipped, 1 suite failed**: `tests/sessions/weather-is-not-a-failure.test.ts` aborts at import (`process.exit(2)`) because `scripts/sessions/run.ts` demands `SUPABASE_ACCESS_TOKEN` at module load. The unit suite is therefore **not hermetic**: it is red without a production credential and, with one, imports a production-capable executor into a unit test. |
| `check:office-raw-sql` | red at HEAD (74 unscoped vs baseline 68) per reviewer A; stale baseline plus one heuristic false positive. Not independently re-run by me. |

## Test-the-tests: mutation results (mine, throwaway copy outside the repo)

Baseline of the copy: one failure (`raw-sql-names-the-claimed-office`, because the copy has no `.git`). A mutation counts as caught only by a failure beyond that. Each sabotage printed proof it landed (exactly one match) before the run.

| Mutation | Result |
|---|---|
| M1 Telegram webhook secret check removed | **SURVIVES**: 5313 tests green. The only coverage is isolated-replica proofs, not `npm test` |
| M2 Slack `if (!verified.ok)` removed | **SURVIVES** |
| M2b Slack empty-signing-secret fail-closed removed | **SURVIVES** |
| M3 `approval-gate.ts` refusal on policy `refuse` disabled | **SURVIVES** |
| M4 / M4b approval gate "nothing approved" and forged/mismatch refusals removed | **SURVIVE** |
| M6 `perform.ts` untrusted-connector fence replaced with `true` | **SURVIVES** (the fence at the plan-step consumer has only a name-level check) |
| M17 worker containment refusal `if (contained !== null)` disabled | **SURVIVES** |
| M23 gateway lets `?office=` override the verified session office | **SURVIVES** (the most security-critical single line in `hq-api`) |
| M10 production gate `&&` to `\|\|` | caught (`production-gate`, `suite-guard`) |
| M24 / M24b operator-only and read-gate branches disabled | caught (`operator-only.test.ts`) |

**Reading:** the pure-function layers (production gate, Slack signature, untrusted-context fencing in retrieval, operator-only sets) are well controlled. The *call sites that make those functions matter* are largely uncovered by `npm test`: 9 of 12 meaningful mutations at call sites survived. This is the repository's own recurring "assert the call, not the name" trap, present at the most security-relevant seams. M23 surviving is the most serious: nothing in the unit suite fails if a client query string can choose the office. (The SQL layer would still scope by the credential's office only if the RPC trusts its own argument, which is exactly what is not asserted here.) Reviewer E nominated 25 mutations; the remaining 13 (M5, M7–M9, M11–M16, M18–M22, M25) were not run.

## Findings (ranked; deduplicated; evidence class stated)

### High

**D1 — a typed "yes" from an external MCP assistant may answer the owner's approval questions as the owner.** (SUBAGENT; mechanism PROVEN-LEAD in `migrations/0783…:626-631`.) `mcp_ask_team` (0922) inserts a command with `origin_channel='teamhq'`, key `teamhq:mcp_message:<hex>`, actor = the office owner. `app.open_questions_for_reply` treats every non-Telegram/Slack channel with *exactly one open question in the previous turn's tree* as bindable, and `instruction.ts:5081-5157` then calls `app.hq_answer_blocker(…, app.command_principal(…))` without any check of `command_origin`. The docs say an MCP turn is origin `unknown` and may only "think, answer and draft"; containment gates *job kinds*, and `office.instruction` is internal. Realistic path: the owner has one pending plan-step or "from now on" question; a connected assistant (possibly steered by injected text) calls `ask_team "yes"`. **Not exercised end to end** (needs a replica). Confirm by raising one open blocker in a dashboard turn tree and calling `mcp_ask_team('yes')`. Note 0852 respliced this function; I read 0783, so confirm against the latest definition.

**E1/E2/E3 (MUTATION-PROVEN) — the authentication and approval call sites are not under test.** See the table. Impact is not a live defect but the absence of any tripwire if one is introduced.

**G-1 — free-tier database ceiling.** (SUBAGENT, docs-derived.) Recorded size 63 MB (17 Sep), 328 (2 Oct), 346 (4 Oct), 372 (5 Oct); at 9–26 MB/day the 500 MB line is reached roughly **10–19 October**. `jobs` cannot be deleted by design; `events`, `job_state_transitions`, `job_impediments` are append-only; backups are never deleted and live in the 1 GB storage bucket. `app.free_tier_headroom()` is only displayed, with no alert. **Which of DB or Storage hits first is UNPROVEN** (needs a production read). Actual figures were not read by me.

**G-2 — there is no real restore path, and the evidence is stale and narrow.** (SUBAGENT.) The rehearsal loads every column as text into a scratch schema (constraints, types, triggers, RLS, composite keys untested). Backups cover only `public` and `app`: **not** `auth.users` (every login), Storage object bytes, `cron.job`, vault. Last passing rehearsal 21 Sep at migration 0533; schema is now 800 files. Backup is the same project as the data. Combined with G-1, the failure that fills the database also threatens the only backup.

### Medium

| ID | Finding | Class / evidence |
|---|---|---|
| B-01 | `hq-api/file-text.ts` RunLength decoding has no aggregate cap: a crafted 2 MB PDF took 10.7 s and ~1.9 GB RSS locally; `document_upload` runs it inline for any signed-in person, and signup is open. Authenticated DoS of the shared gateway. | SUBAGENT, **measured by the reviewer** |
| B-02 | Open signup plus operator-funded endpoints with no per-office metering in the functions (`voice-token`, `voice /note`, `voice /turn`). Conflicts with "~£0/month". DB-side budgets not checked. | SUBAGENT |
| B-04 | `signin` accepts any `back` that `startsWith` an allowed origin: `https://allowed.example.evil.com` passes. Magic-link tokens travel in the fragment. Containment depends on the Supabase Auth redirect allow-list, which is not in the repo. | **PROVEN-LEAD** (code); live exposure UNPROVEN |
| B-05 | Studio `adopt()` stores whatever `#access_token` the URL fragment carries, with no nonce: login CSRF / session fixation into an attacker's office. | **PROVEN-LEAD** |
| B-06 | The Vercel-served studio sets no CSP, frame or nosniff headers; refresh token and legacy machine key sit in `localStorage`. XSS sweep was clean, so this is defence in depth. | SUBAGENT |
| B-07 / A-7 | MCP OAuth: a session JWT pasted into the consent form is exchanged for a **non-expiring** `read write` token bound to no session, revocable only by the operator CLI; `/register` is unauthenticated and unbounded. | SUBAGENT |
| F-01 | MCP for a real person is unusable as documented: consent has no scope control (every client gets write), the in-product steps tell people to use `hq:token` which the endpoint rejects, and the machine key lands in the **TEST** office. Largest doc/product gap found. | SUBAGENT, high confidence on code |
| C1 | A job killed by lease expiry owes nobody a word. `owed_a_word` has no caller outside `lastWord`, which runs only after `runJob` returns; `recover_stalled_jobs` and `settle_exhausted_jobs` fail jobs silently. The repo's own comments claim "every terminal failure arrives here". | **PROVEN-LEAD** (grep) |
| C2 | `say_once` records "said" before delivery; a failed delivery then suppresses the retry's identical body for 20 h. | SUBAGENT |
| C3 | `tasks.remind` marks `reminded_at` before the output, gates and delivery, so any later refusal loses the reminder permanently; two same-titled tasks within 20 h silence the second. | SUBAGENT |
| C5 / F-03 | Time zone hardcoded `Europe/Athens` for reminder and due parsing for every office (including the Sample); confirmation text hardcodes it; day words resolve on the UTC day; all-day events floor to UTC. Header comments claim a zone is "passed in"; no caller passes one. | SUBAGENT (two reviewers independently) |
| C6 | Person offices likely receive a daily "could not give X a Slack channel: no_such_project" per project (sweep covers `kind='person'`, handler built with the deployment bot). Cross-office creation itself is blocked. | SUBAGENT, PLAUSIBLE |
| A-1 / C8 | The cost budget is deployment-wide: one office driving an agent to its daily limit defers **every** office's queued jobs for that agent to UTC midnight, with no notice. | SUBAGENT; the only real cross-tenant *coupling* found |
| A-2 / B-03 | No per-office queue fairness; the Sample per-visitor rate limit keys on a client-chosen id and all visitors share one login, so the real bound is the global 250/day. `Origin` is the only gate on the `sample` signin action. | SUBAGENT |
| A-3 | A Sample visitor may be able to store a standing rule via `remember()` (nothing checks office kind), contradicting "nothing a visitor does is saved". | SUBAGENT, PLAUSIBLE; replica drive recommended |
| D2 | The untrusted fence covers answering and `notebook.read`, but not `extract-tasks.ts`, `notion-import.ts` or `projects/brief.ts`, which feed all documents (including browser/MCP material) into prompts whose output is written as tasks or Notion content. The comment "every consequence-bearing reader takes only his own words" is false for these. | SUBAGENT; model compliance unproven |
| D3 | `register_connector` is open to any signed-in person and auto-runs `mcp.discover`, whose bare `fetch` has no private-address guard (the browser fetcher has a strong one). Possible SSRF from the worker. | SUBAGENT; egress policy unknown |
| F-02 | Calendar sync tombstones then purges a native event that was merely moved in Google beyond a 14-day window. Currently dormant (duty off, Google revoked). | SUBAGENT |
| F-05 | Telegram identity never recovers after disconnect and relink to a different office (chat rows stay in the old office; messages acknowledged and dropped); retired offices keep identities, so the user is "taken" for ever. | SUBAGENT |
| F-06 | Slack uninstall events update only `slack_workspaces.installed`, which nothing reads; status keeps saying connected. | SUBAGENT |
| G-4 | `ManagementApiExecutor` retries 5xx on writes with no timeout; a 5xx after commit double-runs SQL; the migration runner applies and records in two requests, leaving an applied-but-unrecorded state that blocks the runner with no runbook step. The code comment claims reconciliation that is not there. | SUBAGENT |
| G-5 | Infrastructure errors burn job attempts with no backoff (`requeue_retrying` ignores delay). | SUBAGENT, PLAUSIBLE |
| G-7 | The runbook's first-step incident calls reference functions dropped by 0841. | SUBAGENT, proven by migration text |
| G-8 | Health ages only queued/retrying jobs; jobs wedged in `running`, `committing`, `notifying` or `paused` appear only as an undated count. | SUBAGENT |
| G-9 / G-10 | Edge-function rollback artefacts are gitignored local files; the provenance guard forces a commit between migrate and deploy (as happened on 6 Oct). | SUBAGENT |
| B-10 / G-12 | `ALLOW_PRODUCTION_CHECKS` is documented as read-only but `q`/`qq` run arbitrary SQL under it. The guard stops accidents, not deliberate actors; sub-agents can set the flag themselves. | SUBAGENT; partly acknowledged by the docs |

### Low / process / documentation drift

D4 learning gate stores mixed-clause authority sentences if any presentation word is present (reviewer ran four examples). D5 untrusted material is laundered by the office's own derivative documents (`connector = NULL` is "trusted"). D6 fence delimiters not neutralised. D7 `tool_permissions` is global and fed by per-office provider input. D8 sent-claim detectors miss many past-tense shapes (honesty heuristic only). D9 owner-only enforcement differs by approval door (harmless with one principal per office). A-4 stale raw-SQL ratchet. A-6 ambient `'grant'` fallbacks (`learnedBy`, and any admitted sender's voice note calls `ci_reserve(p_by:'grant')`, spending the operator's Actions budget). A-8 provider error text visible to every office. B-08 unauthenticated `GET worker` makes a Management API call. B-09 pre-auth body parsing and JWT amplification. B-11/B-12 SSRF and link-scheme residuals. B-14 non-ASCII bearer returns 500. C4 "still working" notes repeat every 10 min for a paused root turn and five stale pauses starve new ones. C7 retry "backs off" comment is false. C9/C10/C11 delivery resend window, heartbeat swallowing, drain defaults. F-04 Vikunja round trip quantises priority. F-07 Google cache can't tell the office's own diary events. F-08 Notion mirror detection matches title only. F-09 calendar docs overclaim producers. G-3 backup dump is one in-memory select per table. G-11 provenance bypass accepts any 20+ character string and logs locally only. G-13 migration plan promises rollback files that exist for few migrations. G-14 `drop_pending_updates:true` on webhook redeploy; signin probe asserts refusals only. G-15 `.catch(() => 'grant')` promotes a lesson to an order on DB error.

### Documentation state (cross-checked against `migrations/applied.json`)

- 800 migration files and 800 `applied.json` entries with identical sets. `CLAUDE.md` still says "Production has 770 applied… 0906/0907/0920–1022 not applied"; `docs/ops/deployment-readiness-2026-10-05.md` §13 says all applied (worker v975, hq-api v896, mcp v664), `drive-index` and `calendar-event-sync` duties OFF, Google revoked. `docs/HANDOFF.md` lines 1–22 and 24–37 disagree with each other. **Which doc is canonical for deployment state is undefined.**
- `CLAUDE.md`'s "next phase has not begun" is contradicted by HANDOFF (multi-user P0–P4, public Sample, Team HQ UX v2 recorded as done and live). The "47 functions still carry `default 'grant'`" claim does not match the latest definitions; `PINNED` is empty.
- `bridge-baseline.json` is a dead artefact; `conversion-manifest.json` lacks 186 functions created since 0863 (only the legacy ratchet is enforced); `ownership-manifest.json` is current.
- A zero-byte file named `=` is tracked at the repo root. `SAMPLE-PERSON.md`, `slack-app-status.md`, `ux-be-vikunja-audit.md` are internally contradictory or superseded. GitHub Actions: all nine workflows are `workflow_dispatch` only, as claimed.

## Negative results (tried and failed to break)

Constant-time or hash-compare secrets that fail closed when empty (hq-api, signin, worker, mcp, speaker, Telegram, Slack); Slack signature (raw body, `v0`, ±300 s both ways); single-use OAuth state for Slack and Google; MCP exact redirect match, S256-only PKCE, hashed codes, one-office client binding; the gateway deletes client `p_office`/`office_id`/`owner_key` and injects the verified office; every non-`office:true` section or action is operator-only; no RLS policy to `anon/authenticated/public` and table/function grants revoked (0642, 0841), so a Sample guest's JWT has no PostgREST reach; Telegram/Slack admission derives office from the verified sender; Vikunja, Notion, NotebookLM and Google deployment credentials are refused to person offices (0800); stale workers fenced by `claim_gen`; dequeue serialised by advisory lock; duty double-fire, parent-retry duplication and fan-in waits all bounded; pursue loop bounded (3 rounds / 120 s); no model tool-calling exists in `src` and the MCP client is discovery-only; plan executors write only internal tasks; forwarded content cannot answer approvals; SSRF shape check in the browser fetcher (decimal/hex IPv4, mapped IPv6, redirects re-judged per hop) held; XSS sweep of `web/studio` found `esc()` applied consistently; the production gate (flags, host, staging binding) and `check-gate coverage` are strongly tested.

## UNPROVEN / not safely testable here

Live production values (table sizes, Storage total, `accounts.open_signup`/`max_person_offices`/`sample.turns_per_day`, any current client holding `write` scope, whether any `office.instruction` is long-paused); Supabase Auth configuration (redirect allow-list for B-04, email/password change and global signout for the shared Sample login, confirm-email); edge isolate memory ceiling (B-01); authenticated MCP `tools/list` and a real consent (F-01); live Slack uninstall (F-06); Telegram relink (F-05); real Google/Vikunja behaviour (F-02, F-04); whether the Management API commits before a 5xx (G-4); worker egress policy (D3); whether free models obey injected text (D2); and every `gate:safe` step in the sample/identity/ops parts plus `check:ownership`, `check:office-edges`, `check:anon-exposure`, `check:machine-key`, `check:callers`, `check:consumed`, which read production. `gate-safe.ts` itself requires both production flags, so even starting it here would breach the standing rule.

## What a second wave should do

1. Build the replica (`bash scripts/isolated/replica.sh`) and **drive** D1, A-3, F-05, C6, A-1 with real functions; the repo's own history says reading a migration proves only that it parses.
2. Run the remaining 13 nominated mutations, then add the missing tests: gateway office-from-credential (M23), webhook auth wiring (M1, M2), approval-gate bodies (M3, M4), perform.ts fence (M6), worker containment (M17).
3. Re-verify D1 and C1 against the **latest** function definitions (0852 respliced several).
4. Drive the unproven SSRF (D3) and file-text (B-01) cases against the edge runtime with its real memory limit.
5. Reconcile `CLAUDE.md` / `HANDOFF.md` / readiness doc into one canonical deployment-state source, and re-run lint on the author's toolchain version to decide whether the format error is real.
