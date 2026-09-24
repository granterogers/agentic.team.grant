# Behavioural remediation — 24 September 2026

**Durable memory for the 12-hour backend behavioural testing and remediation
run.** If context is compacted: reread `CLAUDE.md`, then this file, and
continue from **Next** below.

## Baseline

| | |
|---|---|
| `main` at start | `d1c9247adc78c840c953c10450c81225a097e62c` (matches the handoff; not advanced) |
| branch | `claude/jolly-darwin-8rwmp3` — the harness only permits pushes here; the brief preferred `claude/behavioural-remediation`, which was not creatable as a push target in this environment |
| production | `hq-api` v775 · `voice` v553 · `voice-token` v583 · `signin` v31 · `worker` v837 (**not redeployed by this run**) |
| migrations | 604 applied, nothing pending at start |
| containment | `check:leaks` 22 known, 0 new |
| health at start | 0 in flight, 0 failed, 0 stalled in 24h (`app.office_health()`) |

### Deployment rule for this run

No canonical deploy, no migration applied to production. SQL fixes are
written as migration files on this branch and **proved inside `begin …
rollback`** against the live schema; TypeScript fixes are proved by unit tests
and, where the handler matters, by running the branch's code against fixture
jobs. Live behavioural sessions therefore measure the DEPLOYED v837 worker —
every finding below is reproduced on production, and every fix is verified
off it.

### Grant-state snapshot (before live testing)

| | digest / count |
|---|---|
| tasks | 14 rows, md5 `48bc6e07d2edaba4ef3ab5bac49ee792` |
| contacts | 0 rows |
| autonomy_settings | md5 `0f01f8ff5965da747057922fc7e79660` |
| lessons | 610 |
| sent deliveries | 2331, last 2026-09-24 18:33:05 |
| active projects | 5 |

## Test vehicle

`scripts/sessions/remediation.ts` — new corpus, fresh wording, registered in
`corpus.ts`, run with `npm run session -- --only <name>`. Everything goes
through `inbound_commands → app.enqueue_inbound → deployed worker`, actor
`verify-sess-…`, `announce` closed in the enqueue transaction (nothing reaches
Grant). `scripts/sessions/inspect.ts <session>` prints each turn beside the
task rows the session's fixture project holds (due, assignee, parent, state,
writing job), because "one task exists" is not the property.

## Findings

| id | P | scenario | expected | actual (production v837) | root cause | status |
|---|---|---|---|---|---|---|
| R1 | P1 | `rem-several` t0: "Add a task to renew … by the 30th, another … next week, and tell me …" | 2 tasks + answer | job **failed** after 4 attempts; **4 identical tasks**; apology sent | (a) `fabricatedWhen` refused "30 Sept" as invented — it only checks the string appears, and "the 30th" resolves to it; (b) the task write runs before the gate, every attempt | (a) FIXED `derivable.ts`; (b) see R2 |
| R2 | P1 | same | a retry does not repeat a write | 4 rows from one job | `app.my_task_add` has no idempotency on (job, title) | open |
| R3 | P1 | `rem-continuity` t5 "Mark the Hartley one done." | task done, or an honest "I can't" | "Task … is now marked as done" — row still `todo` | conversational path has no door for state; model claims it; `claimsToHaveMade` knows only creation verbs | open |
| R4 | P1 | `rem-continuity` t2 "And put it down as mine." | assignment / no-op | new task titled **"down as belonging to Grant"** | rewrite "put the task down as…" matched `taskRequest` SHAPE 3, whose article group admits the DEFINITE `the` | open |
| R5 | P2 | t1 "Actually make that Monday." | due → 28th | "nothing has gone on your list in this conversation" | in a HARNESS session `my_task_referent` excludes harness tasks, so it can never find its own; the product path is untestable (harness defect in product code) | open |
| R6 | P2 | t3 "Add checking the figures as a subtask under it." | subtask linked | flat task titled "checking the figures as a subtask under the …" | no subtask reading; `task_add` has no parent | open |
| R7 | P2 | `rem-preambles` t1 "Thanks. Also one to book the minibus…" | second task | invented intake form (project + owner) | elliptical "one to …" not a task request; model invents required fields | open |
| R8 | P2 | `rem-preambles` t3 "what have I got on this project now?" | lists the caterers task | "You don't have any tasks recorded yet" | harness turn's `my_tasks` excludes harness tasks (same class as R5) — needs re-test once fixed before calling it a product defect | open |
| R9 | P3 | "by the 30th" | due 30th | title kept "by the 30th", no due | `whenFor` read an ordinal only after "on" | FIXED |

Passing: `rem-not-an-order` 4/4 (conditional, quoted past message, discussion,
same-message withdrawal — no writes, no deliveries). `rem-baits` 3/3.

## Next

R2 → R3 → R4 → R5/R8 → R6/R7, then the remaining sessions
(`rem-capability`, `rem-callitoff`, `rem-routing`) and the areas not yet
touched: approvals, cross-interface, Slack/Telegram paths, voice notes.
