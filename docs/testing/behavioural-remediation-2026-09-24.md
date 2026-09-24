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
| R2 | P1 | same | a retry does not repeat a write | 4 rows from one job | `app.my_task_add` / `app.task_add` had no idempotency on (job, title) | FIXED 0592 (unapplied) · `verify:retry-writes` live 1/5, `--with` 5/5 |
| R3 | P1 | `rem-continuity` t5 "Mark the Hartley one done." | task done, or an honest "I can't" | "Task … is now marked as done" — row still `todo` | no door for state; `acted` counted 2 convened specialists so `claimsToHaveMade` (creation verbs only) could not fire | FIXED: `taskStateChange` + `pickByName` → `app.hq_task_state`; `claimsToHaveChangedTask` vs new `tasksChanged` count (fires 0/4000 real, 4 harness incl. measured); 0593 + 0594 (unapplied); `verify:task-state` 8/8 with, control red under sabotage |
| R4 | P1 | `rem-continuity` t2 "And put it down as mine." | assignment / no-op | new task titled **"down as belonging to Grant"** | rewrite "put the task down as…" matched `taskRequest` SHAPE 3 / fallback on a DEFINITE `the task` | FIXED `tasks.ts`: definite singular task noun = reference; "Create the task." still creates; 0/146 historical instructions newly declined |
| R5 | P2 | t1 "Actually make that Monday." | due → 28th | "nothing has gone on your list in this conversation" | `my_task_referent` excluded harness tasks from harness turns — untestable path | FIXED in 0593 (harness turn sees own world; real turn byte-identical, controlled) |
| R6 | P2 | t3 "Add checking the figures as a subtask under it." | subtask linked | flat task titled "checking the figures as a subtask under the …" | no subtask reading; `task_add` has no parent | open |
| R7 | P2 | `rem-preambles` t1 "Thanks. Also one to book the minibus…" | second task | invented intake form (project + owner) | elliptical "one to …" not a task request; model invents required fields | open |
| R8 | P2 | `rem-preambles` t3 "what have I got on this project now?"; Grant's REAL 20 Sep "Tell me what are my current tasks?" → "I have no record of any current tasks" | names his tasks | denial / count without names | (a) harness turns could not see their own tasks; (b) **product**: `taskSpine` reads only overdue/today/upcoming and every open task on his real list is undated, so it said "holds 9 item(s), none of them due" with no names | FIXED: unscheduled bucket named; harness flag passed (identical for real turns) |
| R9 | P3 | "by the 30th" | due 30th | title kept "by the 30th", no due | `whenFor` read an ordinal only after "on" | FIXED |

| R10 | P1 | 0593 door + readers | "bin it" leaves his list | a `cancelled` personal task stayed in Inbox/Today/Upcoming | every `my_tasks` bucket meant open as `state <> 'done'` | FIXED 0594 (unapplied), rollback-proved |
| R11 | P1 (latent) | a correction "Don't use bullet points" | rule keeps the don't | drafted "From now on, use bullet points." (and "Stop sending me updates" → "From now on, sending me updates") | `readCorrection` stripped a NEGATING opener as a rejection | FIXED `correction.ts`; sabotage turns 4 tests red |
| R12 | P2 | `rem-callitoff` t1 "Stop that, I've sorted the coach myself." | call-off acknowledged | standing-rule offer "From now on, that, I've sorted the coach myself." | referent + first-person report kept as a rule | FIXED `correction.ts` |
| R13 | P3 | `rem-capability` t0 WhatsApp, `rem-callitoff`, `rem-preambles` | honest refusal | prefix "…could not carry it out — say it again in a sentence and I will." on 290 harness answers (0 real yet) — a false promise for a capability gap | `sayWhatHappened` blocked_needs_user generic sentence | FIXED: "I have not done this yet, and nothing has been changed." |
| R14 | P3 containment | Grant's REAL personal list | no test debris | 5 fixture tasks with run tokens ("UI probe ymt90dgo", "Ring the caterers gxja7vft", 3× "Chase the printers …") from today's promotion suites, visible on his list | seeded through the dashboard door (real, job-less); a suite killed at the shell timeout never reaches its `finally` | reported by `check:leaks` already; cleanup in reconciliation |

Passing: `rem-capability` 3/3 (no false send, no retroactive "it went through", calendar "No" — `calendar.write` is enabled but only as a job kind for task→calendar sync, so "can you add things to my calendar" answered No is defensible; recorded as an open question). `rem-callitoff` 3/3 on expectations (see R12). `rem-not-an-order` 4/4 (conditional, quoted past message, discussion,
same-message withdrawal — no writes, no deliveries). `rem-baits` 3/3.

## Next

R6/R7 (subtask, elliptical 'one to'), `rem-routing`, then untouched areas: approvals, cross-interface, Slack/Telegram paths, voice notes, duplicate submit, long-running status. Reconciliation must sweep session tasks (`npm run session -- --sweep`) and the R14 debris.
