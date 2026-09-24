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
| R6 | P2 | t3 "Add checking the figures as a subtask under it." | subtask linked | flat task titled "checking the figures as a subtask under the …" | no subtask reading | FIXED `subtaskRequest` + handler press through `my_task_add(p_parent)`; vetoes flat readers; needs 0593 to act |
| R7 | P2 | `rem-preambles` t1 "Thanks. Also one to book the minibus…"; and "Add a task to ring the printers. Actually scrap that and add one to ring the venue instead." (nothing filed) | a task | invented intake form / nothing | elliptical "one to …" is a task only by antecedent | PARTLY FIXED: `taskRequest` resolves "add one/another to…" against the same message (re-driven: "ring the venue" filed once); the cross-TURN antecedent ("Also one to…" with no verb) remains open |
| R8 | P2 | `rem-preambles` t3 "what have I got on this project now?"; Grant's REAL 20 Sep "Tell me what are my current tasks?" → "I have no record of any current tasks" | names his tasks | denial / count without names | (a) harness turns could not see their own tasks; (b) **product**: `taskSpine` reads only overdue/today/upcoming and every open task on his real list is undated, so it said "holds 9 item(s), none of them due" with no names | FIXED: unscheduled bucket named; harness flag passed (identical for real turns) |
| R9 | P3 | "by the 30th" | due 30th | title kept "by the 30th", no due | `whenFor` read an ordinal only after "on" | FIXED |
| R10 | P1 | 0593 door + readers | "bin it" leaves his list | a `cancelled` personal task stayed in Inbox/Today/Upcoming | every `my_tasks` bucket meant open as `state <> 'done'` | FIXED 0594 (unapplied), rollback-proved |
| R11 | P1 (latent) | a correction "Don't use bullet points" | rule keeps the don't | drafted "From now on, use bullet points." (and "Stop sending me updates" → "From now on, sending me updates") | `readCorrection` stripped a NEGATING opener as a rejection | FIXED `correction.ts`; sabotage turns 4 tests red |
| R12 | P2 | `rem-callitoff` t1 "Stop that, I've sorted the coach myself." | call-off acknowledged | standing-rule offer "From now on, that, I've sorted the coach myself." | referent + first-person report kept as a rule | FIXED `correction.ts` |
| R13 | P3 | `rem-capability` t0 WhatsApp, `rem-callitoff`, `rem-preambles` | honest refusal | prefix "…could not carry it out — say it again in a sentence and I will." on 290 harness answers (0 real yet) — a false promise for a capability gap | `sayWhatHappened` blocked_needs_user generic sentence | FIXED: "I have not done this yet, and nothing has been changed." |
| R14 | P3 containment | Grant's REAL personal list | no test debris | 5 fixture tasks with run tokens ("UI probe ymt90dgo", "Ring the caterers gxja7vft", 3× "Chase the printers …") from today's promotion suites, visible on his list | seeded through the dashboard door (real, job-less); a suite killed at the shell timeout never reaches its `finally` | reported by `check:leaks` already; cleanup in reconciliation |
| R15 | P1 | `rem-routing` t0 "If tickets are 35 quid and each head costs us 21 in food and 6 for the room, what is our margin per person?" | £8, once | answered £8 AND "handed this on in 3 pieces"; the job had failed attempt 1 | `fabricatedWhen` matched month PREFIXES — "8 margin" = 8 March ("decisions" = December, "separate" = September); real answers contain "5 decisions", "42 decisions"; 62 harness date refusals | FIXED: whole month words (`MONTH_WORD`, shared with the resolver); "September 12th" now checked too |
| R15b | P2 | same | a question is not failed work | children and the answer opened "I have not done this…" | `readClause` read the fragment "6 for the room" as an imperative; and a leading "now/ok/so/then/right" hid real requests ("OK. Add a task to…") | FIXED `request.ts`; 21 of 833 historical readings change, all to the right reading |
| R16 | P1 | same, attempt 2 | a retry reuses finished child work | the Operations child was enqueued AGAIN with the same obligation key after the first completed | live-only unique index on `idempotency_key` + `enqueue_child_once` insert | FIXED 0595 (unapplied), rollback-proved; another parent still creates |
| R17 | P2 | two overlapping answers to one approval (dashboard + Telegram, or a double press) | performed once | **2 child jobs** — reproduced on production by `verify:approval-race` (harness fixture, inert kinds, children cancelled before any lease) | `hq_answer_blocker` reads without a lock and its update does not re-check state; `decide_suggestion` same shape (→ duplicate permanent lesson) | FIXED 0596 (unapplied): `FOR UPDATE` in both; sequential behaviour rollback-proved unchanged; concurrent half needs deployment — run `verify:approval-race` after |
| R18 | P2 | the same message twice, 3 s apart (`scripts/sessions/double.ts`) | one task | two identical tasks, both confirmed | a re-send is a second job; nothing compared it to the conversation's recent tasks | FIXED 0592 + handler: same conversation, same title, 10 min → "already on your list from a moment ago"; `verify:retry-writes` 6/6 with, 1/6 live |
| R19 | P2 | `rem-propagate` t0 "Get Emma to dig out … deposit … and then have Daniel work out what share of £20,000 …" | Emma then Daniel | plan = two `task.create` steps "Emma locate…", "Daniel compute…"; pursuit parked asking Grant to approve adding colleagues' work to HIS list; reply promised to come back | model broke prompt rule 3c; `validate()` had no check | FIXED `goal.ts`: task.create naming a roster member as doer is refused (first names from `public.staff`); the audience-based first draft would have dropped 30/87 real task steps and was replaced; exactly 2 historical steps match |
| R20 | P3 | `rem-status` t0 | substantive answer | whole reply = the outcome prefix alone | the draft promised unbacked work; the commitment rewrite fell back to the canonical sentence; root cause R21 | mitigated by R21; open as a class |
| R21 | P2 | "Right, can you ask Emma to pull together everything we have on the Holloway Barn booking and flag anything risky" | Emma convened | routed to Quality by the word "risky"; Emma never convened; history: "Ask Ruby about it instead." answered by Finance | nothing read a colleague NAMED in the text | FIXED `named.ts` `namedColleague` (delegation frame or vocative, names from `public.staff`), per clause so the #128 handoff works; 6/924 recorded instructions affected, all correct; **re-driven on branch code: Emma answers with the planted £4,317 / 2 Oct / 30% / Marta Quill and flags risks** (production: "I have not done this") |
| R22 | P2 | same request, after R19 | £4,317 → 21.6% | step 2 "calculate share" planned as `draft.create`; at `suggest` (all 5 of Grant's real projects) a draft needs approval → parked | no reasoning capability; rule 3b broken; 93/118 historical draft steps from requests asking for nothing written, 28 of those plans died parked | FIXED `withoutUnaskedDrafts`; re-driven on branch code: one-turn correct answer (£4,317, 21.6%) and the Emma→Daniel handoff child carries `from_output` |
| R23 | P3 | same | no "I have not done this" before a correct answer | prefix added | handoff child is enqueued after the output, so pending count was 0 | FIXED: planned handoff counts as pending |
| R4b | P1 | "And put it down as mine." (re-driven on branch code after R4) | no new task | resolver rewrote it into a CREATION; a second copy of the task was filed | creation readers read model-decomposed texts as well as his words | FIXED `groundedIn` (≥ half the title's content words in his pre-rewrite words); 2/13 historical conversational tasks fail it — exactly the defects; re-driven: one task |
| R24 | P2 | "remind me at 3pm to call Sarah back", "in 20 minutes", "Friday morning" | reminder at that time | task titled "At 3pm to call Sarah back", no date, no `remind_at` → nothing ever fires | nothing in the conversation set `remind_at` | FIXED `remind-at.ts` (clock, relative, parts of day, Europe/Athens), title stripped, reply "I will remind you around 15:00" |
| R25 | **P0 latent** | a harness session's reminder once R24 exists | never reaches Grant | `app.reminders_due` / `app.tasks_to_push` filter `is_fixture` only, and `my_task_add` stamped every harness personal task `added_by 'grant'` (is_fixture false) → a real duty would have delivered a test reminder to his chat | writer mislabelled + readers trusted the label | FIXED at the writer (0592: `verify:grant` for a harness job) and the readers (0597: `app.harness_task`); rollback-proved; **0592 + 0597 MUST deploy before or with R24** |
| R26 | P1 | "Actually forget it, don't bother with that."; "scrap that and book the barn instead" | call-off / replacement kept | call-off not recognised (prose asked again; rule offered "From now on, forget it…"); replacement SWALLOWED as a call-off target "that and book the barn instead" | TAIL allowed no second withdrawal/report; NAMED spanned coordinators; call-off reader never saw his literal words for a pure withdrawal | FIXED `calloff.ts`, `correction.ts`, handler; re-driven: "Nothing was still running — 1 had already finished." |

### Driving this branch's handler live

`scripts/sessions/branch-turn.ts <session> <projectSlug> "<msg>" …` enqueues through the real door (harness actor, announce closed), claims the job immediately with a scoped dequeue and runs it with `buildPass` from THIS checkout, reporting `BRANCH CODE` or `DEPLOYED WORKER` per turn. Children it spawns are run by the deployed worker. It cannot exercise anything that depends on an unapplied migration (0592–0596).

Passing: `rem-capability` 3/3 (no false send, no retroactive "it went through", calendar "No" — `calendar.write` is enabled but only as a job kind for task→calendar sync, so "can you add things to my calendar" answered No is defensible; recorded as an open question). `rem-callitoff` 3/3 on expectations (see R12). `rem-not-an-order` 4/4 (conditional, quoted past message, discussion,
same-message withdrawal — no writes, no deliveries). `rem-baits` 3/3.

## Next

R6/R7 (subtask, elliptical 'one to'); R20 class; cross-interface (task listing across channels is blocked until R5/R8 deploy); Slack/Telegram paths; voice notes; long-running status; documents; contacts; reminders. Approvals and duplicate submit have had a first pass (R17, R18). Reconciliation must sweep session tasks (`npm run session -- --sweep`) and the R14 debris.
