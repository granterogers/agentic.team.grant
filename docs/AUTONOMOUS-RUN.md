# Autonomous run state

**Read this immediately after `CLAUDE.md` if you are a fresh session.** It says
what the mission is, where the work is, what the standing sequence is, and what
to do next. It is kept current deliberately, because a compaction has already
destroyed one specification in this repository.

**Context compaction is EXPECTED and is NOT a stopping condition.** If it
happens: reread `CLAUDE.md`, reread this file, reread
`docs/spec/ux-qa-v2-2026-09-15.md`, reconstruct the backlog from the GitHub
issues named below, identify the current checkpoint, and **continue
autonomously**. Do not return control to Grant merely because compaction
occurred.

The recovery procedure, in four words Grant gave:
**REREAD REPOSITORY STATE → RECONSTRUCT BACKLOG → IDENTIFY CURRENT CHECKPOINT →
CONTINUE AUTONOMOUSLY.**

---

# ⭐ CURRENT MISSION — PRODUCTION CORRECTIVE RUN (20 September 2026)

**Started at `581070e`, tree clean, 522 migrations.** This block is the first
thing a compacted session must read. The Personal Tasks run below is finished;
Grant's real Telegram use contradicted it within the hour, and this run fixes
the CLASSES behind that rather than the screenshots.

## THE FINDING THAT OUTRANKS EVERYTHING ELSE — anchor C

A reminder reading **"Reminder: Remind me khgkowx8."** arrived on Grant's real
Telegram. `khgkowx8` is a `verify:mytasks` run token — from a gate run made
during the previous session, at 07:33 this morning.

Traced in one query, and the answer is not debris:

| | |
|---|---|
| job `409cb8d3` | `kind = tasks.remind` · `requested_by = verify:mytasks-khgkowx8` |
| | **`is_fixture = true`** · **`app.harness_job() = true`** · `announce = true` |
| delivery `3edbb00c` | `telegram -> 1386648496` (Grant's real chat) · **`state = sent`** · `suppressed_reason = NULL` |

**The office knew it was harness traffic and delivered it anyway.** Nothing in
the delivery path consults `is_fixture`. Cleanup could never have prevented it:
the send happened 0.26 seconds after the output.

**Blast radius, measured:** `162` harness deliveries have been SENT to real
destinations across `42` distinct harness runs — **87 to Grant's own Telegram**
(chat `1386648496`), 50 to Slack `C0C276SFM7D`, 25 across two more channels.
Seventeen more sit unsent, all terminal `failed` against synthetic chat ids.

**THE PERMANENT INVARIANT THIS RUN INSTALLS:** harness identity must be a
DELIVERY BOUNDARY, enforced in the database, not a label a reader may consult.
A job that is harness traffic may not produce a delivery to a production
destination, and no future suite can reach Grant by forgetting cleanup.

## The other three anchors

- **A — multi-intent.** *"I've told you to always give your information in
  clear bullet points. Also, I want you to tell me what my current tasks are."*
  The preference was stored; the task query was never answered. Find the
  general multi-clause orchestration defect, not this sentence.
- **B — spoken self-correction + delegated generation.** *"Create a task for me
  and the um... No actually, you know what? Scan the entirety of the Legacy
  Coaching Project and create appropriate tasks for me to review."* Reproduced
  offline: `personalTaskRequest` returns a task titled *"For me and the um... No
  actually, you know what? Scan the entirety…"* — canonical row
  `9e2d60ed`, `added_by = grant`, created 08:35:52. TWO defects: the abandoned
  clause is not discarded, and delegated task GENERATION is being read as
  literal task creation.
- **D — the clarification state.** *"Happy to add that. What should it be
  called?"* Trace the surrounding canonical state before judging it.

## Why the previous acceptance missed all of this

88/88, 46/46, 47/47 and a green gate said the DATABASE was clean at the end of
a run. None of them asked whether a synthetic side effect had already left the
building, whether every surviving clause of a multi-clause sentence executed,
or whether the report Grant reads matches what actually happened. The new
invariants are written against exactly those three gaps.

## Order of work, and why

1. **C first** — it is live, and every test this run performs would otherwise
   hit Grant again. The guard is a precondition for the rest.
2. B, then A, then D.
3. The spoken-language corpus, cross-channel coherence, specialist visibility
   in Slack, truthful progress for long work.

---

# PREVIOUS MISSION — PERSONAL TASKS COMPLETION RUN (#259)

**Started 19 September 2026, after the deep-acceptance run ended at `4e68eee`.**
This block is the first thing a compacted session must read.

## The mission, in one sentence

Finish **native Personal Tasks** (#259) to production quality — complete,
reliable, attractive, accessible, responsive, integrated with the agent
experience — and make the task domain structurally ready for a Vikunja
provider **without** requiring one.

**Two strictly sequenced phases.** Phase 1 is native Personal Tasks with NO
Vikunja dependency, and must pass a full Definition of DONE plus an
independent second acceptance pass. Phase 2 (deploy Vikunja, implement the
real provider) begins only after that, and only if run time remains.

**Scope discipline:** this run is Personal Tasks and nothing else. Not the
release tag, not credential rotations, not unrelated beautification.

## Verified starting state

| | |
|---|---|
| branch | `claude/phase-7-communications-kh8ow8` |
| starting SHA | **`4e68eee`** (local == remote, tree clean) |
| migrations applied | 511 |

## The audit of #259 against reality — done, not assumed

**Already real and verified by `verify:mytasks` (57 checks):** `public.tasks`
with `assigned_to_human` as the personal/agent boundary (ADR-0041);
`app.my_tasks(bucket, limit, query, sort)` serving Today · Overdue · Upcoming ·
Inbox · Unscheduled · Done · All; `my_tasks_counts()`; `my_task_add`;
`my_task_set` (title, detail, priority, due, project, labels, remind_at,
repeat, clear-list); recurrence performed by the `tasks_repeat_on_done`
trigger; the human-action bridge in three triggers (`blocker_makes_a_task`,
`task_answers_blocker`, `blocker_closes_its_task`); conversational creation
("remind me tomorrow …") reaching the canonical row; the credential-chore
path; the studio My Tasks screen with buckets, search, sort, details editor
and a two-way tick.

**Genuinely missing — this run's work:**

1. **Reminders are stored and never delivered.** `remind_at` feeds the Today
   filter and the editor, and NOTHING in `src/` reads it. The dead-dial class.
2. **No subtask can be created.** `parent_task_id` is read (the `children`
   count) and neither `my_task_add` nor `my_task_set` takes a parent, so no
   door a person has can make one.
3. **No deletion or archive.** Only `state`. #259 and the brief both ask for
   explicit delete/archive semantics.
4. **No provider seam at all** — no external-identity mapping, no revision
   column, no tombstones, no sync status. Phase 1 requires these so Phase 2 is
   an integration rather than a task-domain rewrite.

## Invariants this run must not break

- Supabase is canonical; a provider is a projection, never the database.
- Personal Tasks ≠ Agent Jobs; linked, never merged.
- ONE Personal Tasks interface; a canonical task is never shown twice.
- Sync metadata lives beside the task, never in the canonical task row.
- Disconnecting a provider must never lose a native task.

## PHASE 1 IS COMPLETE — 20 September 2026

All four gaps are built, deployed and verified, and the **independent second
acceptance pass is clean**. Ending SHA of Phase 1: see the last `#259` commit
on this branch.

| | |
|---|---|
| reminders delivered | 0512 · `tasks.remind_at` → `app.reminders_due` → the `task-reminders` duty → `src/handlers/reminders.ts` |
| the provider seam | 0513 · `tasks.revision`, `public.task_links`, `public.task_tombstones`, push watermark, `my_task_delete` |
| subtasks | 0514 / 0515 · `p_parent`, `app.task_parent_ok`, `my_task_reparent`, children in the payload |
| delete and archive | 0513 / 0517 · with a refusal that says which of two things is wrong |
| the referent for a follow-up | 0516 · `tasks.seq`, `app.my_task_recent` |

**Verification:** `verify:mytasks` **88/88** · `verify:tasks-ui` **46/46** on
desktop and phone · `verify:layouts` 64 states / 0 findings · `verify:ui`
54/54 · 2,057 unit tests · the full 40-entry readiness gate green.

### What the independent pass found, after Phase 1 was called complete

Nine defects, in a product that had passed its own corpus. The three worth
remembering:

1. **A branch performed the request again.** #233's fan-out hands every extra
   convened specialist a child job with the same instruction, so every
   deterministic action ran once per person — *"Call it Review the onboarding
   copy"* put THREE tasks on the list from one reply. `isBranch` existed and
   guarded only PDFs and page-fetches. It now gates all ten action paths, and
   `tests/artifacts/one-per-request.test.ts` asserts the property over the
   list so the next path added without it fails there.
2. **Two false positives.** *"Remind me how the pricing works"* created a task
   and swallowed the question; *"Did I ever add a task about the domain?"*
   created *"Did I ever about the domain?"*.
3. **Details sat 24px off the edge of every task row on a phone.**
   `flex-basis: 100%` plus a 44px indent. Invisible to `npm run wide`, because
   the row clips rather than scrolling the page.

**And the harness was wrong nine times against three product defects.** Every
one is written up in the file it lives in. The pattern worth carrying: when a
check does not fire, suspect the check.

### Deliberately NOT changed, with the reason

- *"note to self: cancel the gym membership"* is not claimed as a personal
  task. `classifyIntent` already reads "note to self" as a deliberate remark,
  and a sentence of that shape is as often a note as a task. Grant's call.
- *"change the wording to X"* with no referent is refused. Nothing in it points
  at the last task, and a rename could be about anything on the screen.
- *"scrap the deadline on that"* — clearing a due date by talking. The UI can
  (`p_clear`); the conversation cannot, because `PersonalTaskChange` has no way
  to say "remove" as distinct from "unchanged".
- **53% of a phone screen is spent before the first task** (448px of 844,
  2 of 4 rows visible, measured by `npm run space`). The composer already
  discloses its date and project progressively; the remaining cost is the
  title, the search row and the bucket strip.

## PHASE 2 IS BUILT AND PROVED — 20 September 2026

Against a REAL Vikunja v2.6.0, not a fake. `npm run vikunja:dev` fetches the
released binary, checks its published sha256, runs it on SQLite, registers an
account and mints a scoped API token — no hosting account, nothing paid for,
nothing to cancel. **`npm run verify:vikunja` is 47/47.**

| | |
|---|---|
| the inbound half the seam never had | 0518 · `app.task_pulled`, the conflict policy, the tombstone rule |
| the provider, as one implementation | `src/tasks/provider.ts` (the interface), `src/tasks/vikunja.ts`, `src/tasks/sync.ts` |
| Grant's own door | 0519–0522 · `hq_set_vikunja`, `hq_forget_vikunja`, `task_sync_panel`, the `tasks.sync` duty, the Connections card |
| the decision, written down | **ADR-0043** |

Proved: create/edit/complete/reopen both ways · idempotent rounds · mapped
dates and priorities (they run in OPPOSITE directions) · a delete that could
not be delivered stays owed and the provider cannot put the task back · the
provider dies and the office does not · reconnecting catches up ·
**disconnecting loses no task and takes the credential with it** · and nothing
the run did not create moved.

### The two things to know before touching this

1. **A sync round is GLOBAL.** `tasks_to_push` takes no scope and must not get
   one. The suite snapshots the revision of every task it did not create and
   fails if any moved.
2. **The conflict check was worthless for three revisions.** It changed both
   sides and ran a round — which pushes before it pulls, so the canonical value
   always won for the wrong reason, and disabling the conflict branch entirely
   left it green. It is driven through `app.task_pulled` directly now, and the
   same sabotage turns five checks red.

## WHAT IS NOT DONE, AND WHAT GRANT HAS TO DECIDE

**The Vikunja this was proved against lives in this container and is gone when
the container is.** Nothing about that is a defect in the integration, and
finishing it needs one decision that is not an agent's to make:

> **Where should Vikunja live?** It needs a host with a public HTTPS address.
> The standing constraints forbid creating paid infrastructure or making an
> irreversible external commitment without him, so this stops here.

Once he has one, the whole of the remaining work is:

1. Open the dashboard → Settings → Connections → *Your task list elsewhere*.
2. Paste the address, the project id and an API token from that Vikunja
   (Settings → API tokens there; the office needs tasks read/write, projects
   read/write and labels read).
3. Press Connect. The `tasks.sync` duty starts itself and runs every fifteen
   minutes.

Nothing else is outstanding. The office is currently left with nothing
connected, no credential stored and the duty disabled.

## NEXT ACTION

Grant's, not an agent's: choose a host for Vikunja, or leave Personal Tasks
native — which is a complete product on its own and is what the office is
running today.

---

## WHERE THE WORK IS NOW — beta, 18 September 2026

**The completion run below is FINISHED.** What replaces it is CLAUDE.md's
standing rule: **real usage is the primary source of behavioural findings.**
The first beta session is written up at
`docs/testing/handover-2026-09-18-beta.md` — two reports from Grant, four
defects, migrations 0486–0489, all deployed.

Do not start another synthetic campaign. When Grant reports something:
investigate the canonical evidence before theorising, classify it in his
words, fix it at the right abstraction, convert it into a permanent
regression, and say which gates you ran.

**Still open, in the order worth taking them:**

1. **Slack config-token rotation** fails with `internal_error` from Slack's own
   `tooling.tokens.rotate`. 0489 made the office able to SAY so; the cause is
   still open, and the likeliest answer is regenerating the pair by hand.
2. **E — #261**, the agent computer, in vertical slices. Check what is
   independent of the Cloudflare credential first.
3. **G**, the self-learning loop.
4. **H**, the visual campaign.
5. **The routing pattern**: eleven of thirteen misses are decided by the
   literal trigram matcher before the semantic layer is consulted
   (`docs/testing/e2e-2026-09-18.md`).

**Two corrections to everything below**, which is now stale on both: Google is
reconnected, and the Telegram chief bot token was never missing — the office
was wrong about it for four days, which is what 0487 is.

---

## THE MANDATE IN FORCE — 12-HOUR AUTONOMOUS COMPLETION RUN, 18 September 2026

**This supersedes the backlog-to-zero mandate below it, which it continues
rather than replaces: the priority order, the classification scheme and the
five closing imperatives all still hold.**

Grant's priorities for this run, in his order:

| | |
|---|---|
| **A** | **#276 — drive the `check:pressable` baseline toward zero.** Retain only entries with an explicit architectural justification. *"A control that renders but has never been pressed is not verified."* |
| **B** | **#41 — deep end-to-end proof against the DEPLOYED stack.** |
| **C** | **#258 — artifact generation**: request → retrieve project knowledge → research → compose → generate → validate → store → deliver, PDF over Telegram. *"Do not settle for dumping model text onto white pages."* |
| **D** | **#172 — Gmail project intelligence** joined to unified knowledge, tenant isolation, provenance and the redaction rules preserved. |
| **E** | **#261 — the agent computer as VERTICAL SLICES**, not parallel architecture. |
| **F** | **#259 — personal tasks.** |
| **G** | **the self-learning loop** — evidence-based, versioned, reversible, governed. |
| **H** | **premium visual beautification**, with a screenshot-driven loop. |

The verification ladder he named, lowest to highest: static → unit →
integration → database → browser → deployed browser → a real, safe end-to-end
fixture. And: commit and push regularly, do not stop early, finish with a
handover report.

### Where THIS run stands

| | |
|---|---|
| **started at** | `dc765a4` |
| **current** | `46a1e97` |
| **migrations** | 484 applied |
| **`check:pressable`** | **27 → 15** |
| **`check:callers`** | 10 |

Done so far, each proved by driving the press through the DEPLOYED gateway and
each detector deliberately broken and watched go red:

1. **Tags and collections** (`document_tag`, `collection_put`,
   `collection_take`) — 0479 taught `studio_documents` to carry both, the
   document sheet grew a `.docorg` block, Project Settings lists the
   collections it used to only describe. `npm run verify:organising` 25/25.
   Capturing it found a phone defect in `.docacts` that had been live since
   #152 and that no check could see.
2. **The three ways back** (`project_unarchive`, `reattach`,
   `browser_session_forget`) — 0480 makes archiving undoable and adds
   `app.recoverable_projects`; **0481 fixes a real defect**: un-archiving
   raised ADR-0014's deferred constraint at commit instead of refusing, so any
   project whose sources were disconnected could never come back.
   `npm run verify:recovery` 25/25.

3. **`job_progress`, beside the Stop button** — the one screen with a Stop
   control showed no progress at all. Named steps rather than a bar, because
   the office does not know how many steps a job will take. `check:pressable`
   **27 → 15**, and every survivor now carries an explicit justification, the
   two CI readers with a measurement (`public.ci_runs` holds zero rows).
   **Priority A is at its honest floor.**
4. **Priority B (#41) — the deep pass.** All 34 gate suites against the
   deployed stack: 31/34. Found `office.propose` **queued for eight hours**
   because the deployed worker predated its handler (a migration is not a
   deploy); found `verify:judge` accusing a working judge, and its survey mode
   — the only way to pick a judge on evidence — dead on a type error. Report:
   `docs/testing/e2e-2026-09-18.md`.
5. **Priority C (#258) — the live Slack round trip.** A real question in a real
   Slack channel, the deployed worker answering, and the link FETCHED. Found
   that **`storagePath` had never reached a Slack message**, so every artifact
   ever produced took the honest-degradation branch; and that **one request
   made two reports**, because the hand-off child read the same instruction.
   `npm run verify:artifact-slack`, 17/17, in the gate.

6. **Priority D (#172) — blocked on a credential, and said so.** Google's
   refresh token is dead (`invalid_grant`, re-checked 07:26 on the 18th), so
   Gmail and Calendar return nothing and `gmail.draft` cannot be exercised at
   all. Inspection also found `tool_permissions.gmail.draft` naming
   `src/google/mail.ts`, which has no draft function — 0298's defect, currently
   harmless only because the row is disabled. Reported on the Issue and paged.
   **Grant: Team HQ → Settings → Connections → Google → Reconnect.**
7. **Priority F (#259) — My Tasks, built.** ADR-0041: a Personal Task is a
   `tasks` row with `assigned_to_human`, a column modelled since #11, never
   once set, read by nothing. 0482 adds labels, a reminder, recurrence and the
   seven buckets; 0483 stops the two existing readers showing one row in two
   lists; 0484 is the human-action bridge, fed by `connection_health` rather
   than by `blockers` (all five open blockers are approvals, not errands).
   Routing: "remind me Friday to…" is his, "I need you to…" is the office's,
   decided grammatically. `verify:mytasks` **37/37**, in the gate.

### Next, in order

- **E — #261**, the agent computer, as vertical slices. Note that
  `browser_session_establish` is blocked behind the Cloudflare account, so
  check what is independent of it first.
- **G**, the self-learning loop — evidence-based, versioned, reversible.
- **H**, premium visual beautification with a screenshot loop.
- **#259's remainder**: the Vikunja provider. Deliberately not started —
  #261's standing decision is no paid infrastructure and a Vikunja server is
  infrastructure, so the hosting question is Grant's. ADR-0041 designs the
  boundary.
- **#172's remainder**: `gmail.draft` behind #131's dry run, once Google is
  reconnected. Do not build it before then — this run found two capabilities
  that passed every unit test and had never worked in production.

Still open on the priorities already worked: #41's §8 chaos list (100MB file,
clock skew, two workers on one job) and the routing-breadth pattern where
twelve of thirteen misses were decided by the literal matcher before the
semantic layer was consulted; #258's images, DOCX and slides.

---

## THE MANDATE IN FORCE — BACKLOG TO ZERO, 17–18 September 2026

**This supersedes every mandate below it, including the capability run of the
same day, whose work is merged and recorded further down.**

Grant, 2026-09-17, verbatim on the objective:

> *"Your mission is to drive the repository as close as safely and legitimately
> possible to ZERO OPEN ACTIONABLE ENGINEERING ISSUES. Do not optimize for the
> number zero. Optimize for a genuinely working, coherent, secure, usable
> product. An honestly open future-roadmap issue is preferable to a falsely
> closed or half-implemented capability."*

His priority order when things conflict, in his words: **REAL WORKING PRODUCT →
DATA / SECURITY INTEGRITY → REGRESSION SAFETY → ISSUE COMPLETION → TEST
CLEANLINESS → DOCUMENTATION → ISSUE COUNT.**

And the five lines he ended on:

> *"DO NOT MANAGE THE BACKLOG — FINISH THE BACKLOG. DO NOT BUILD INVISIBLE
> CAPABILITIES — MAKE THEM USABLE. DO NOT STOP WHEN ONE THING IS BLOCKED — MOVE
> TO THE NEXT INDEPENDENT THING. DO NOT CLAIM SUCCESS — PROVE IT. DO NOT
> OPTIMIZE FOR PASSING TESTS — OPTIMIZE FOR THE PRODUCT ACTUALLY WORKING."*

### Where this run starts

| | |
|---|---|
| **starting commit** | `86c451f` on `claude/phase-7-communications-kh8ow8` |
| **migrations** | 472 applied |
| **unit tests** | 1,683 across 84 files |
| **gate** | 30 suites; last complete run 27/29 at `1243b83`, both failures harness defects since fixed; the confirming 30-suite run is in flight at this commit |
| **open issues at the start** | **13** |

### The complete open backlog, classified

Grant's letters: **A** implement now · **B** verify and close · **C**
dependency chain · **D** Grant action required · **E** intentional roadmap ·
**F** obsolete / duplicate.

| # | what it is | class | the reading |
|---|---|---|---|
| **276** | 25 gateway actions and sections with no control | **A** | the run's primary target. Two closed already (document approve/discard). `project_unarchive` needs a rule for what belongs on a recovery list before it needs a button — evidence on the Issue. |
| **272** | 11 capabilities in `check:callers`' baseline | **A** | classify each as reachable-but-invisible, should-be-wired, or dead. The baseline should shrink. |
| **270** | the Slack `channels:join` scope | **A**, was D | **Grant has already looked and the scope is not offered in his app.** §10 of the mandate forbids sending him back. Treat it as an engineering problem: read the manifest, find out why, and prefer redesigning the fixture lifecycle over making him accommodate the test. |
| **258** | artifact generation and delivery | **A** | built and proved end to end (`verify:artifact` 12/12). What is left is one LIVE Slack round trip. |
| **172** | Gmail as project intelligence | **A** | `mail_awaiting` shipped. What remains is "decisions and deadlines" and `gmail.draft`, both bounded by the metadata-only cache. |
| **41** | deep end-to-end systems test | **A** | a programme, not a checkbox. Cancellation closed; each run adds a dimension. |
| **260** | NotebookLM generated artifacts | **C/E** | quota-blocked at the provider. The page and the reader exist; the artifacts do not arrive. |
| **259** | unified personal tasks | **E** | Grant deprioritised it explicitly in the previous mandate. |
| **261** | persistent computer runtime | **E** | his decision stands: no paid infrastructure. Record which criteria genuinely need it. |
| **135** | a browser tab in every project | **C** | depends on #16 and on #261's answer. |
| **16** | browser-capable agents | **D** | needs a Cloudflare account and token (free tier), which only he can create. |
| **18** | `github.read_token` still live | **D** | rotation is his. Do not ask again; it is recorded. |
| **213** | rotate the Slack bot token and signing secret | **D** | same. |

### Dependency order for this run

1. **#276 and #272 together**, because they are the same question one layer
   apart and several entries resolve each other.
2. **#270**, because it is reclassified and nobody has yet read the manifest.
3. **#258**'s live round trip, once #270's investigation says what a Slack test
   may safely do.
4. **#172**'s remaining half.
5. **#41** continuously, as each of the above lands.
6. **#260, #259, #261, #135** left honestly open with the reason recorded.

### The three decisions already made, never to be asked again

Recorded in full further down: **#257** upstream deletion is archive-and-hide
(ADR-0040) · **#258** delivery is a signed link, not a Slack upload scope ·
**#261** no paid infrastructure until the free architecture is proved.

### Human-only actions, consolidated

**#18** rotate `github.read_token` · **#213** rotate the Slack bot token and
signing secret · **#16** create a Cloudflare account and API token. Nothing
else in the backlog needs him, and none of these blocks any other work.

---

## THE PREVIOUS MANDATE — the 12-hour capability run, 17 September 2026

**This supersedes every mandate below.** The completion run merged as PR #274
(`main` at `68b7958`): #273, #263, #264, #265, #262 closed, #272 down from 40
to 15, #17 shipped, ADR-0039 written. This run starts from that.

Grant, 2026-09-17, continuing:

> *"Continue reducing the remaining capability backlog by implementing real,
> user-reachable, production-quality capabilities, not merely satisfying tests
> or adding architectural scaffolding."*

**The recorded starting target is #133** — replay real history against a
change — *"unless inspection of current repository state establishes a concrete
reason not to."* After it, the highest-value unblocked work, with the sequence
**reconstructed from the repository rather than taken from a list**:

> *"Do not blindly follow this ordering… do not automatically prioritize #259
> merely because it was previously described as the largest unstarted
> capability. Unified knowledge, artifact generation and correspondence
> intelligence may be more foundational."*

Candidates named: #41, #257, #258, #172, #259, the rest of #272.

**If compaction happens: reread `CLAUDE.md`, reread this file, continue.
Do not ask Grant to repaste the prompt.**

### GRANT'S DECISIONS — made 2026-09-17, do NOT ask again

Three product questions were reserved for him across three runs. He answered
all three. They are recorded here, on the issues, and (for the first) in an
ADR, so a compaction cannot turn them back into open questions.

| | His decision, in his words |
|---|---|
| **#257** upstream deletion | *"archive-and-hide from normal retrieval/search by default, while preserving provenance/history and making restoration possible. An upstream deletion must not silently destroy institutional history, but deleted/stale material must not contaminate ordinary retrieval."* → **ADR-0040** |
| **#258** Slack artifact delivery | *"signed-link delivery, reusing the existing signed-URL infrastructure rather than requesting additional Slack file-upload scope, unless repository evidence proves this cannot satisfy the acceptance criteria."* |
| **#261** paid computer runtime | *"Do not enable or purchase paid infrastructure. Continue proving the free/ephemeral-compute + persistent-state architecture first. Record precisely which acceptance criteria, if any, genuinely cannot be met without paid compute."* |

The standing instruction that goes with them: **reserve something for Grant
only when it needs expenditure, his own authentication, a destructive or
irreversible action, a credential action, or a product direction that cannot
reasonably be inferred.** Everything else is an ordinary engineering decision
to make and state.

### The chain this run works, and why that order

Grant: *"Prefer work that most strengthens the central Agentic Team
experience: understand project knowledge → coordinate agents → perform work →
create real artifacts → preserve state → deliver results through the user's
channel."* And explicitly: **do not prioritise #259 merely because it is
large.**

So the dependency order is **#133 → #257 → #258 → #172 → #41**, with #259 and
#261 after them:

- **#133** first because it is the instrument. Everything below changes
  behaviour, and there is currently no way to tell a change that improved the
  office from one that damaged it.
- **#257** next because it is the bottom of the chain: *project association ⇒
  discoverable project knowledge*. #258 and #172 both stand on it — an artifact
  is only as good as what was retrieved to make it, and mail is only project
  intelligence if it lands in the same index.
- **#258** then, because it is the first capability where the whole chain shows
  up in one request: retrieve → generate → validate → store → deliver.
- **#172** after, because it adds a SOURCE to an index that already works
  rather than a Gmail-specific memory.
- **#41** continuously, as a programme rather than a checkbox.

### WHERE THIS RUN IS — updated as it goes

| | |
|---|---|
| **started from** | `68b7958` (PR #274 merged) |
| **branch** | `claude/phase-7-communications-kh8ow8`, restarted from main |
| **migrations** | 463 |
| **#133** | **DONE and closed** — `npm run replay` + `npm run verify:judge`, both controls proved |
| **#257** | retrieval, reconciliation and the end-to-end criterion all done — `npm run verify:unified` 10/10 |
| **#258** | Slack signed-link delivery built and tested; the remaining box is one LIVE Slack round trip |
| **gate** | **24/24** on a clean tree at 1,290s, including `verify:judge` and `verify:unified` |
| **#258** | Slack signed-link delivery + `verify:artifact` 11/11 end to end; open, one live Slack round trip left |
| **#172** | `app.mail_awaiting` — what has gone quiet, both directions; `verify:mail` 30/30 |
| **suites** | `verify:judge`, `verify:unified`, `verify:artifact`, `verify:knowledge`, `verify:mail` all added to the gate |
| **#41** | cancellation dimension closed — Grant can STOP a running job; `verify:stop` 13/13 |
| **#272** | baseline 15 → 12 (one caller added, two dead functions removed) |
| **#276** | NEW — `check:pressable`, and the 27 gateway actions and sections with no control |
| **migrations at close** | **470** |
| **defect found last** | `verify:unified` read the output only when the suite itself ran the job, so a job the deployed worker answered correctly scored NO OUTPUT. The read is unconditional now — 10/10. |
| **#276** | two of the 27 closed — the review queue, `verify:review` 17/17, baseline 27 → 25 |
| **migrations** | **471** |
| **next** | #276 again: `project_unarchive`, then `revoke_tool`, then #265's three connector actions |

**The most useful thing this stretch produced is a new class of check.**
`check:callers` walks database functions and cannot see a gateway action, so
`stop_job` sat unpressed since the browser work — the action existed, the
function worked, and Grant could not stop a running job. `check:pressable`
asks the question one layer up, is in the gate, and found 27. Each is
baselined WITH A REASON separating a missing control from something
deliberately for an agent (#13) from a reader the page does not need.

**What is genuinely left on each open issue, so nobody re-derives it:**

| issue | what remains |
|---|---|
| #258 | one LIVE Slack round trip. Everything below it is tested and the wire format asserted. Weigh it against the cost: `verify:slack` leaves a permanent channel in Grant's workspace, because Slack cannot delete one. |
| #172 | "identify decisions and deadlines" and "prepare replies" (gmail.draft is enabled and unexercised). The commitments question is answered as far as metadata honestly allows — see the CLAUDE.md entry about the recipient COUNT. |
| #260 | quota-blocked on NotebookLM. |
| #259 | unstarted, deliberately deprioritised by Grant. |
| #272 | 15 baseline entries; 9 want a product surface rather than a caller. |
| #261 | free architecture; no acceptance criterion has yet been shown to REQUIRE paid compute. That test is the deliverable, not a bill. |
| #16 / #135 | Cloudflare account + token (free tier), Grant's to create. |
| #18, #213, #270 | human actions, recorded, not to be re-asked. |

**#172, what inspection found.** Further along than the Issue reads:
ADR-0037, migration 0432, `app.mail_for_project`, `mail_search`,
`forget_mail_before` and a 180-day retention all exist, and the instruction
handler already brings correspondence alongside documents. What is left is the
question Grant singled out — *"are there outstanding commitments I have
forgotten?"* — and it is **bounded by the cache**: `src/google/mail.ts` fetches
`format=metadata`, so there are no message BODIES anywhere. A commitment
extractor over subject lines and hundred-character snippets would be guessing,
and the honest version is narrow. Say that on the Issue rather than building a
plausible-looking thing that invents commitments.

**#257, where it stands.** Every acceptance box is now met and evidenced:
NotebookLM and Drive both feed one index through their own ingestion
contracts (`verify:unified` proves two connectors answering one query);
retrieval returns each document ONCE and excludes archived material (0464);
upstream deletions reconcile under ADR-0040 with two strikes, a blast-radius
refusal and a symmetric return path (0465, 0466); provenance is cited;
isolation is proved in both directions. `verify:knowledge` 38/38,
`verify:unified` 10/10, both in the gate.

**What #133 shipped, and the two things that make it evidence rather than
code:**

- `npm run replay` re-asks real past requests against current code. The corpus
  is chosen by four structural witnesses (not a fixture, not a harness job,
  from a real channel, and the answer was ACTUALLY DELIVERED to a person),
  because chasing probe names failed three times running.
- `npm run verify:judge` calibrates the comparative judge against five
  invented pairs with a known direction — **in the gate**, because a
  measurement whose instrument decays silently is worse than none.
- **Control 1:** `--degrade` sabotages every request and the run must come back
  WORSE. It does (2 worse against 1 better), and the command exits non-zero if
  it does not.
- **Control 2:** an ordinary run must not manufacture a regression. It reports
  NO DIRECTION with 0 worse.

**Four defects found by building it**, all recorded in CLAUDE.md and fixed:
61 + 29 harness jobs reading as things Grant asked (0460, 0463); a replay able
to deliver through the children it spawned (0461, 0462); and a judge design
that could not see a sabotaged run at all.

### What inspection established about #133, before starting it

`job_traces` does NOT carry what #133 assumed. It holds four kinds — `prompt`,
`decision`, `degradation`, `plan` — and the `prompt` row is
`{"kind": "...", "attempt": 1}`. **The prompt text, the retrieved documents and
the model are not in it**, so "replay from the trace" cannot be done as
written.

What IS recoverable is better: `jobs.pinned_config.instruction` holds the
request verbatim, on 482 real `office.instruction` jobs, with the project, the
requester and the original `outputs.body` all joinable. So the replay reads
CANONICAL STATE, not the trace, and the Issue is answered by a different route
than the one it proposed. `app.now_utc()` is `now()` with no override, so the
clock freeze has to happen where the handler reads the date, not in SQL.

---

## THE PREVIOUS MANDATE — the 8-hour completion run, 17 September 2026

**This supersedes the capability campaign below as the ACTIVE mandate.** That
one ran the dependency order and advanced nine issues; none was closed, which
is what this run exists to correct.

Grant, 2026-09-17:

> *"Your objective is not to spend the session planning, narrating, auditing
> endlessly, or expanding the backlog. Your objective is to materially reduce
> the outstanding backlog and leave the repository substantially more
> complete, reliable and usable than it is now."*
>
> *"Prefer five genuinely completed issues over five partially started
> epics."* · *"A successful run should ideally end with FEWER meaningful open
> issues than it started with."*
>
> *"Do NOT stop after completing one issue. Do NOT ask Grant what to do
> next."*

**The loop, and it does not end with a report:**
AUDIT → SELECT → IMPLEMENT → EXERCISE → FIX → VERIFY → COMMIT → CLOSE ISSUE →
SELECT NEXT.

### The order this run follows, and why

| Priority | Work | Why here |
|---|---|---|
| **A** | **#273** — the gate reports 15/22 for harness reasons | *"A green result that depends on luck, timing or hidden cleanup is not green."* Nothing below can be trusted until the signal is. |
| **B** | **#272** — triage the `check:callers` baseline | Every entry is either a missing production caller, dead code, or something mislabelled as production. *"Do not mechanically connect functions merely to satisfy check:callers."* |
| **C** | Close what is genuinely finished | #263, #262, #264, #265 are each built and verified and still OPEN. Verify against acceptance criteria and close with evidence, or name the one box left. |
| **D** | The roadmap, in dependency order | #259 is unstarted and self-contained; #133 and #41 are testing infrastructure; the rest are advanced. |

### The product principle that decides every design question here

> *"The recurring failure mode we are trying to eliminate is: capability
> exists somewhere in the repository but the actual user cannot reach it."*
>
> Prefer **natural request → canonical routing → real capability → canonical
> state → useful result → delivery** over **function exists → unit test
> passes**.

### Human-blocked, recorded once and then SKIPPED for this run

Do not stop to remind Grant about these again.

| Issue | Exact human action |
|---|---|
| **#18** | Rotate `github.read_token` at https://github.com/settings/personal-access-tokens — it was pasted into a chat transcript on 2026-09-09 and is still live. |
| **#213** | Rotate the Slack bot token and signing secret at https://api.slack.com/apps — both were pasted into chat. |
| **#270** | Add the `channels:join` scope to the Slack app. `npm run slack:add-scope -- channels:join` prepares the manifest; the install has to be approved by a person. |

### Cost rule, restated because #261/#16/#135 keep meeting it

Nothing paid may be enabled. Where an issue needs non-free compute:
investigate the free alternative, implement everything that does not depend on
the decision, mark only the irreducible part blocked, and continue. The
assessment at `docs/agent-runtime-assessment-2026-09-17.md` already did this
once and found Cloudflare's browser free tier.

### RUN LOG — append one line per completed unit, newest last

Kept so a fresh session knows what this run has already done without reading
the git log. A unit is finished when it is committed AND its issue is updated.

- **#273 CLOSED.** verify:recovers took its own parked job. `mine()` asks for a
  specific job; section 2 settles its parked one. 18/18 three times. Gate
  15/22 -> 19/22.
- **#272 advanced, 40 -> 15.** Two wired to the Governance page (stranded work,
  the eval score), eight functions dropped on evidence the check produced, and
  check:callers learned that an OPERATOR COMMAND is a caller — eight entries
  were reachable all along by an `npm run` Grant uses.
- **#263 CLOSED.** 0457 makes an approval bind to a sha256 of the exact action;
  an unbound approval pause is refused by CHECK and by the function.
  `credential()` pauses instead of failing when a secret is missing.
  verify:checkpoints 27/27 with a harness audit.
- **#264 CLOSED.** The two unproven boxes were the security half: a hostile
  event moves no permission row, the work goes to the specialist the TRIGGER
  names, and `event_triggers` has no column that could grant reach. The
  framework was also invisible — the Governance page now shows what listens.
- **#265 CLOSED, and it found a real defect.** `guess_reach` classified
  `delete_everything` as READ because a hostile description said so — and
  underneath, snake_case names never matched at all, so every classification
  ever made came from the untrusted description. 0458: the name is evidence,
  the description may only escalate. The suite now discovers against the
  office's own MCP server over real HTTP (10 tools), and Connections shows
  registered providers.
- **#262 CLOSED.** Three unproven boxes: permissions never union (the
  asymmetry had to be CONSTRUCTED — every agent holds the same sixteen tools),
  nothing serialises the branches, and a single-domain request cannot fan out.
  Plus a check on the branch ceiling that reads the setting rather than the
  number. verify:parallel 19/19 -> 29/29.
- **#257 advanced** — a real defect: a file renamed at the SOURCE kept its old
  title for ever, because `record_file_document` returned `already_there` and
  touched nothing. 0459 remembers what the source last called it, so an
  upstream rename applies unless Grant renamed it himself. Two boxes left and
  one of them is a PRODUCT DECISION (below).

### WHERE THIS RUN ENDED — start here after a compaction

**Five issues closed: #273, #263, #264, #265, #262.** Nineteen open became
fourteen. Every close carries its checklist box by box in a comment on the
Issue itself; read that rather than reconstructing it.

**The state of the signal.** `check:callers` is green at **15**, down from 40
at #272's title. The gate was 15/22 when this run started and the three reds
were: verify:recovers (fixed, #273), check:leaks (fixture debris, swept) and
check:callers (mid-edit).

The run's LAST gate came back 17/22, and four of the five reds were the
harness disagreeing with removals it had not been told about rather than
anything in the product — all four repaired, each at the layer where the
decision is made:

| red | what it actually was |
|---|---|
| `verify:tasks` | it was the only caller of the task API 0454-0456 removed. Rewritten against `task_add`, `hq_task_state`, `studio_tasks` — what the studio presses. **24/24** |
| `verify:schema` | it read the COMMENT in `hq_governance` explaining why `what_i_can_do` is gone as a call to it. Reads past comments now, with a control counting what survives the strip and a proved synthetic failure. **3/3** |
| `verify:wrappers` | it demanded a public wrapper for three functions nothing should call. Names the live pair instead. **43/43** |
| `check:leaks` | one fixture task. Swept. |

`verify:routing-breadth` is the fifth and is model variance; it now SAYS
which kind of miss it had.

**The next autonomous action, exactly.** Take #133 (*"Nothing replays real
history against a change"*) — it is testing infrastructure that makes every
other change safer, it is entirely local, and it needs no credential and no
model. After that, #41.

**Do NOT start these without Grant:**

| | |
|---|---|
| #257's deletion policy | a file vanishing from Drive is not the same event as Grant wanting it gone. Delete / archive-and-keep-searchable / archive-and-hide have genuinely different consequences for a shared folder he does not control. One sentence from him settles it. |
| #257's Telegram regression | needs `TELEGRAM_CHIEF_BOT_TOKEN` in the environment. This session resolves secrets from the Vault rather than materialising them, correctly. |
| #135 / #16 | `browser.cloudflare_account` and `browser.cloudflare_token`. Free, needs a Cloudflare account in his name. |
| #261 | the only genuinely paid question. Priced in the assessment; nothing enabled. |
| #18, #213, #270 | the three human-blocked, recorded above. |

**#259 is the largest unstarted capability** and is self-contained; it is the
right thing to begin when the testing work above is done.

---

## The capability campaign, 17 September 2026 — SUPERSEDED BY THE ABOVE


**This supersedes the backlog campaign below as the ACTIVE mandate.** That one
finished: 71 open became 21, and the twenty-one that remain are each a
substantial capability, a cost question or something only Grant can do.

Grant, 2026-09-17:

> *"Work down the remaining substantial capability backlog in dependency
> order, strengthening the underlying architecture before layering more
> complex capabilities on top."*
>
> *"Do NOT ask Grant to decide ordinary engineering questions."* ·
> *"A blocked issue is NOT a reason to end the autonomous run."*

### The dependency order, reconstructed from the code on 17 September

Grant proposed `#15 → #128/#129 → #257 → #260/#172 → #258 → #263 → #262 →
#264 → #265` and said to change it where the repository disagrees. It does not
disagree; what the code adds is WHY each edge exists.

| # | What it is | Why it sits here |
|---|---|---|
| **#15** | approval policy | Everything downstream acts outward. `autonomy_settings` and `app.autonomy_for` exist and **nothing in `src/` reads either** — the dial Grant can set is connected to nothing, and `raiseBlocker` in `handlers/drive.ts` asks unconditionally. That is #15's title exactly: interrupts on everything or nothing. |
| **#128 / #129** | hand-off, memory | Both write canonical state the layers above read back. |
| **#257** | unified knowledge | Foundational: project association must imply discoverable knowledge. |
| **#260 / #172** | NotebookLM artifacts, Gmail | Both are sources #257 has to be able to answer from. |
| **#258** | artifact generation | Needs retrieval (#257) to have something to generate FROM. |
| **#263** | checkpoints | Exactly-once external effects; generation is the first thing long enough to need resuming. |
| **#262** | parallel agents | Needs #263, or a fan-out that dies repeats external effects. |
| **#264 / #265** | event triggers, MCP intake | Both start governed work from outside; both need #15's policy to govern it. |

**#272** is reduced opportunistically — every layer above finds capabilities
with no caller. **#41** is an evolving certification suite, extended as each
capability becomes real, not a feature to close. **#133** waits for the traces
the layers above produce.

### What is already true, and must not be rebuilt

- `tool_permissions.level` is 0/1/2/3 across 22 tools — **that is the action
  class** #15 asks for, already data Grant edits.
- `public.autonomy_level` is `observe | suggest | act_with_review | act`;
  `app.autonomy_for(project)` resolves project-over-global with a conservative
  default. Two rows exist, both written by `verify:autonomy`.
- `public.blockers` already carries `requested_action`, `why_needed`,
  `consequences_of_delay`, `approval_options` and `work_can_continue` — the
  surfacing half of #15, with 397 resolved rows. It works; nothing decides
  when to use it.
- `src/tools/plan.ts` is #131's dry run: the plan is produced by the code path
  that performs the action. An approval shows the plan.
- `public.tool_requests` + `hq_approve_tool` / `hq_decline_tool` is ADR-0018,
  wired to the Governance page on 16 September (#272).

### Progress

| Issue | State | Evidence |
|---|---|---|
| **#15** | **done, ADR-0035** | 0421–0424 · `verify:approval` **28/28** with a harness audit (matrix cell flipped, suite went red naming it, restored, green) · `verify:drive` 42/42 · `verify:calendar` 7/7 · `verify:dryrun` 25/25 · `verify:layouts` 64 states 0 findings · `verify:controls` settings 96/0/0 |
| **#128** | **done** | `verify:sequence` **15/15** live, end to end: the finance director answered the margin clause and handed the announcement clause to the communications director, carrying the output; the comms director completed it in their own name citing nothing of the colleague's. CONTROL: the same request with "and" instead of "and then" hands nothing on and still fans out. `verify:handoff` 13/13 · `verify:collaborates` 10/10 · `verify:delegation` 17/17 · 1,541 tests |
| **#129** | **done, ADR-0036** | 0425–0426 · `verify:decisions` **16/16** with a harness audit (the `decisions_live` view was flattened, two checks went red, it was restored, green) · the log crosses every project, is append-only, supersedes without hiding, and is filled by answering a blocker and settling a proposal |
| **#257** | **advanced, still open** | 0427–0428 · `verify:knowledge` **24/24** · `verify:approval` **30/30** · 8 unit tests on the coverage sentence. What is done: the index now knows what it has NOT got and the office may no longer report an unindexed connector as an absence; Drive ingest chains to `drive.read_file`, which had no caller at all; and answering *"Add them to the project as source documents"* now adds them, which it never could. What remains: Drive rename and delete reconciliation, and the end-to-end Telegram regression. |
| **#260** | **advanced, still open** | 0429–0431 · `verify:notebook` **24/24** with a harness audit (the link-less artifact was given a URL, two checks went red, restored, green) · 11 unit tests on `artifactListing` · `verify:layouts` 64 states 0 findings · `verify:wired` 72 attributes / 21 screens · captured desktop and phone in both themes. What is done: the office can now ADOPT an artifact Grant made himself (`requested_by_job` null, `mine: false`), a finished artifact with no URL is demoted rather than given a fabricated link, a listing cannot un-finish something already finished, an unknown kind does not break enumeration, `notebook.list_artifacts` answers the question and the Sources tab shows *Made in the notebook* under what the project reads FROM. What remains: live enumeration against a real notebook has not been driven (quota), and Telegram/Slack rendering is inherited rather than re-proven. |
| **#172** | **advanced, still open** | ADR-0037 · 0432–0434 · `verify:mail` **24/24**, thirteen new, driven inside a rollback, with a harness audit (the matcher was widened to the excerpt, the excerpt control went red, restored, green) · 10 unit tests · **end to end on a real project**: the office derived the association from the subject, cited `mail:<id>` in `outputs.sources` beside five documents, and answered with the sender, the date and the preview quoted, inventing nothing about the thread. What is done: correspondence belongs to a project by DERIVATION (a contact, or an alias in the subject — never the excerpt), the two tiers are stated and never merged, the scope is per project with no unscoped agent reader, mail joins `project_knowledge` as a domain the office can be blind to, search takes a question rather than a phrase, and the cache is pruned at 180 days. What remains: forgotten commitments, decisions inside messages, preparing replies and attachments — all four need message BODIES the office deliberately does not fetch, which is a decision for Grant rather than an increment. |
| **#258** | **advanced, still open** | ADR-0038 · 0435 · `src/artifacts/` · 36 unit tests, six of them harness audits that damage a real file on purpose · **end to end twice on a real project, and the PDF reached Grant's Telegram as message 389**. What is done: a dependency-free PDF writer (the base-14 metrics parsed from Liberation and checked against the published values), a report layout engine that measures every line and strands no heading, a validator that follows every xref offset, storage as a `documents` row with `origin = 'made'` (no new table — every field the Issue asks for already existed), Telegram `sendDocument`, and an intent matcher where making outranks enumerating. Four writer defects and two live product defects were found by opening the pages and driving the delivery — the cover printed over the introduction, `?` for a non-breaking hyphen, a UTF-16 metadata title, a cell cut mid-word, `BOT_FOR_INBOUND` unable to answer 69 of Grant's 90 Telegram messages, and `app.discard_document` never having discarded anything. What remains: Slack file delivery, images, DOCX/slides, and the fact that a generated report lands as a draft behind #28's gate. |
| **#263** | **advanced, still open** | 0436 · `src/jobs/checkpoint.ts` · `verify:checkpoints` **19/19** with the CONTROL the Issue names (remove the skip, 15/20 with five named failures, restored, 19/19) · **live proof: a job created HELD with its gather and draft checkpoints planted, then released — 0 model calls where a fresh run costs 1, and a real 12,139-byte PDF**. What is done: `job_steps` recorded in two writes so an interrupted EXTERNAL step parks rather than repeating, a finished step is immutable, a stale schema version parks, `job_pauses` with the nine reasons plus reconciliation and staleness, `paused` and `waiting_on` finally real, the tick resumes only clock/rate-limit/provider waits, and `artifact.report` runs as three checkpointed steps. What remains: binding an approval to the exact plan (belongs with #131); rewind and fork, which the Issue says not to build first. |
| **#16 / #135 / #261** | **assessed, not built** | `docs/agent-runtime-assessment-2026-09-17.md`, posted to all three Issues. Persistent STATE costs nothing and persistent COMPUTE always costs something, and almost everything the three ask for is state wearing the language of compute. **Cloudflare Browser Rendering is on the Workers FREE plan** at 10 browser-minutes/day — forty to a hundred and twenty page visits — so #135's whole gather tier is free. What is not free is a terminal and a filesystem beside the browser: **~$0.50–$3.50/month** on a wake-on-demand Fly machine, or £0 if Grant reopens GitHub Actions for `workflow_dispatch` with a minute ceiling. Also measured: the edge worker has a **2-second CPU limit**, which nothing in the repository said. Three decisions are his and none blocks the £0 work. |
| **#135 / #16** | **gather tier built, both still open** | ADR-0039 · 0442–0446 · `src/browser/` · `verify:browser` **25/25** with two harness audits (widen the verb CHECK to accept `click` → the boundary check goes red, restored; make `harness_browsing` always false → the fixture-invisibility and budget checks go red, restored) · 21 unit tests · captured desktop and phone in both themes. The design is ADR-0039's one sentence: **a session that stays valid, not a browser that stays open** — the cookie jar is state and lives in the Vault, the browser is compute and is destroyed after every page, which is why ten free Cloudflare browser-minutes a day is enough. Gather only, enforced in three independent places (no acting method on the adapter, a CHECK the column will not hold an acting word against, and a capability sheet that lists pressing a button as reach `none`). Stop is a COLUMN on `public.jobs`, polled by #263's step runner between steps, because the runtime is elsewhere and there is no socket. Harness invisibility was built in at birth rather than retrofitted for the sixth time. A page the office reads lands as `origin = 'source'`, never `made`, so it cannot launder through `provenance.ts`. What remains: **the two Vault entries are unset, so nothing has opened a real page yet** — the unavailable adapter is what runs, deliberately; no download verb; no acting tier; no minute ledger beyond today's budget; #261's terminal and filesystem are still the paid question.
| **#262** | **advanced, still open** | 0437 · `src/handlers/synthesise.ts` · `verify:parallel` **19/19** with the CONTROL the Issue names · 9 unit tests on the anti-fabrication gate · **live: a real cross-domain question, two specialists, and a synthesis that names each of them, states where they agree and says plainly what is unanswered**. The finding: the office has fanned out for weeks and what was missing was the fan-IN, so `app.fan_in_over` takes the child jobs that already exist. Four defects found by running it, including `dependency_wait` missing from `resumable_now` (the first live fan-in sat paused for eighteen minutes) and the gate examining an empty string because the caller passes no name. What remains: a specific purpose per branch, required-vs-optional per request, and a per-parent token ceiling. |
| **#264** | **advanced, still open** | 0438–0439 · `verify:triggers` **16/16** with a harness audit (remove the loop guard, the cooldown and the rate limit → 11/16, restored, 16/16). `signals` is deliberately NOT `public.events`, which is the 2,641-row ledger of what the office DID. A storm rule for each failure that happens: dedupe, debounce, cooldown, rate limit, a loop guard on the job that caused the event, and `not_before_event_at` for replay after downtime. Every decision is recorded INCLUDING the refusals. First source: a document arriving, by database trigger, acted on by the worker tick, with fixture projects excluded. What remains: no trigger is configured, there is no UI, and the other sources (GitHub, Drive, Notion, mail, a webhook) are each an adapter that calls `record_signal`. |
| **#265** | **advanced, still open** | 0440–0441 · `src/mcp/client.ts` · `verify:connectors` **23/23** with a harness audit (make offering ENABLE the row → 20/23, restored) · 9 unit tests against a server that misbehaves. The finding: the office is an MCP SERVER and the client direction did not exist at all. Discovery writes `mcp_discovered_tools` and grants nothing; offering writes a DISABLED `tool_permissions` row; enabling is the existing approval path. `guess_reach` errs destructive-first and treats `unknown` as a write. The client can `initialize` and `tools/list` and deliberately cannot CALL anything. What remains: no real provider connected, no OAuth to a third-party server, nothing calls a discovered tool, no UI. |

**What #15 does NOT claim**, so nobody re-litigates it: three outward paths are
governed — `drive.watch`'s ingest, the calendar duty, and anything through
`governOutward`. `office.notion_sync` is deliberately NOT gated because it has
no dry-run plan, and gating it before it can say what it would do would be an
approval request nobody could read (#131). `notion-import` and
`notebook.generate` have their own approval flows and are not double-gated.

### Where to restart after a compaction

Reread `CLAUDE.md`, then this section, then the issue named as IN PROGRESS
below. Continue without asking Grant.

## THE MANDATE IN FORCE — the backlog campaign, 16–17 September 2026

**Grant, 2026-09-16, mid-run:**

> *"remove these issues — #113/#114/#136/#137/#138 as closed .. we can come
> back to this kind of things"*
>
> *"please continue until all open issues are closed .. to my count there are
> around 71 left"* · *"you have 12 more hours.. close them all please"*

| | |
|---|---|
| **Open at the start** | **71** |
| **Open now** | **21** |
| **Branch** | `claude/phase-7-communications-kh8ow8` |
| **Migrations** | **417** · tests **1,524** across 81 files |

### The standing reading of "close them all"

Fifty closed. Roughly half by **building the thing**, half by **verifying it
was already built** and saying so with the evidence rather than the assertion.
Three rules held throughout and are the reason the number is trustworthy:

1. **An Issue closes on evidence, not on a memory.** Every closing comment
   names the suite and its score, or the measurement, or the live run.
2. **Where the work was not done, it is not closed.** Twenty-one remain and
   each one's comment says what is missing and what it is waiting on.
3. **Where Grant's hands are needed, it stays open and says exactly what he
   has to do**, with URLs and steps: #18, #213, #270.

### What remains, grouped by what it is waiting on

| Waiting on | Issues |
|---|---|
| **Grant, a few minutes each** | **#18** rotate the GitHub PAT · **#213** rotate the Slack bot token and signing secret · **#270** re-issue the Slack app-configuration token, then Reinstall to Workspace |
| **Grant, a cost decision** | **#16**, **#135**, **#261** — a browser session needs a long-lived container and nothing in a £0/month architecture of edge functions and Postgres can host one |
| **Substantial single features** | **#128** an agent hands work to another · **#129** cross-project memory · **#133** replay real history · **#41** the deep systems test · **#172** Gmail · **#15** approval policy · **#272** the caller baseline |
| **His new capability asks, 15–16 September** | **#257**–**#265** |

### Where to restart

Take #128 or #129 first. Both are single features with clear boundaries, both
are named by #174 as what breadth actually depends on, and both are cheaper
than they look because the schema already carries most of what they need —
`jobs.parent_job_id` and `correlation_id` for the chain, `relations` and
`documents` for the memory.

Do NOT start #16/#135/#261 without asking him about the container first. The
engineering is straightforward and the cost is the whole question.

---

## THE MANDATE IN FORCE — second eight-hour run, 16 September 2026

**Grant, 2026-09-16T05:02Z, lifting the hold on #25 himself:**

> *"start working on 25 and you have the next eight hours to implement all open
> issues in terms of feature requests and everything else um, yeah just
> implement everything for the next eight hours uninterrupted don't ask for any
> more prompts just go ahead and do it thank you"*

| | |
|---|---|
| **Started** | 2026-09-16T05:02Z |
| **Minimum duration** | **8 hours**, to 13:02Z — uninterrupted, no further prompting |
| **First task, named by him** | **#25** — the project dashboard as a living map |
| **Then** | every open issue that is a feature request or otherwise implementable |
| **Branch** | `claude/phase-7-communications-kh8ow8` |

**#25 IS NO LONGER HELD.** The earlier instruction — *"dont start implementation
yet"* — is revoked by the sentence above. `docs/spec/project-dashboard-design-direction-2026-09-15.md`
is the verbatim brief and the thing to build against.

**125 issues are open and they cannot all be done in eight hours.** Five of them
(#113, #114, #136, #137, #138) are explicitly proposals *awaiting Grant's pick*
and must not be implemented on a guess. The order is: #25 and its children
first, because he named it; then the frontend and UX issues that make the
product usable; then anything else that can be finished and verified. Say at the
end what was not reached, rather than leaving it implied.

Everything in the previous run's contract still applies — §1 do not interrupt,
§2 the only three early-exit conditions, §3 what is not a blocker, and
**context compaction is expected and is NOT a stopping condition**.

### What this run has delivered so far

Newest first. Each row is committed, gated and pushed unless the last column
says otherwise. **After a compaction, read this table first** — it is the
cheapest reconstruction of where the run is.

| Issue | What landed | Migrations |
|---|---|---|
| **#268** | filed and fixed in the same run — every model call in `src/` now names the job it was for, or states why it cannot. A source check with a proven synthetic failure | — |
| **#156** | a project's history as a sequence — `app.project_history` derives it from the timestamps the rows carry, because `public.events` holds agent actions and no lifecycle. Found and fixed a ONE-WAY DOOR #25 shipped this morning: choosing Panels removed the toggle that switched back | 0401, 0402 |
| **#124** | density is a control — and appearance moved to the OFFICE (0400), because ADR-0021 says a preference about how the work is shown is not the browser's. Found that `verify:arrangement` had been failing since #25 landed this morning, so ADR-0021's guarantee was unverified | 0400 |
| **#123** | an empty section says so — and the check that says so can now FAIL. The floor measured the whole page (always 361+ characters) so it never could. Found two more defects in the audit itself: every settings pane measured the section behind it, and "the call" was a route to a screen #214 removed | — |
| ~~#124~~ | ~~looked at, not started~~ — done later the same morning, see above. The note below was written before I re-read ADR-0021, which answers the scope question itself. It is not a token swap: appearance is `localStorage`-only and ADR-0021 says a preference like this belongs in the office. The scope question — whether scheme/palette/texture move too — is Grant's. Recorded on the issue | — |
| **#130** (part) | the office can pull the tasks out of a document and create them — `office.extract_tasks`, a deterministic recogniser, the `tasks_extracted` shape's first rows, and one undo for the batch. `npm run verify:extract` 11/11. **Still open** for `research_summary` and `draft_document` | 0398, 0399 |
| **#37** | search can ask the graph — filters by kind, tag, date and one `related_to` that asks `app.relations_of`, so agent/contact/source/collection are one mechanism. `verify:search` 12/12 → 26/26 | 0397 |
| #269 | filed: 268 of 276 `public.staff` rows are retired harness specialists (invisible to Grant — checked) | — |
| **#131** | the plan Grant approved is the import that happens — `office.notion_import` executes the STORED plan instead of a second model call. `PlanStep.payload` makes the plan one artefact rather than two. Six unit tests with a control that must come back one | — |
| **#127** | a model is chosen on what it has actually done, per kind of work — `public.model_record` derived from inference_usage, quality may only DEMOTE, exploration by staleness, the choice explained in `job_traces`. `npm run verify:routing-quality` 13/13, ADR-0031. **`verify:fallback` caught my first attempt inverting the certified model chain** | 0394–0396 |
| **#147** | a correction becomes a standing rule on one press — `src/agents/correction.ts`, the offer on the Governance page, `npm run verify:rules` 24/24, ADR-0030. Four latent defects found by DRIVING the press, none visible from reading | 0390–0393 |
| #266, #181, #241 | harness traffic on three tables Grant reads | 0388, 0389 |
| #134 | a budget that says no | 0386, 0387 |
| #149 | ask the office from the portfolio, and see where the question went | 0385 |
| #155 | a team page, not an org chart | — |
| #125 | a project as one page you can hand to someone | — |
| #150, #189 | act on several tasks at once; a deploy that waits for its own function | — |
| #152 | a document is a row you can edit | 0382, 0383, 0384 |
| #122 | what changed since you last looked | 0381 |
| #157 | the studio can be linked to | — |
| #154, #179 | one filter idiom; the pills reach 44px | — |
| **#25** | **the project dashboard is a living map** — the item he named first | 0378, 0379, 0380 |

**Not reached, and why**, to be kept current rather than reconstructed at the
end: #113, #114, #136, #137 and #138 are proposals awaiting his pick and their
aesthetic children must not be implemented on a guess. #178 needs a change to
his own Notion workspace. Candidates identified and not yet started: #123
(empty sections), #124 (density preference), #126 (drag a file onto a project),
#156 (project history as a sequence), #128 (agent hands work to another agent),
#187 (a Slack channel per project), #123 (empty sections), #124 (density
preference), #126 (drag a file onto a project).

---

## THE MISSION

**UX BACKLOG IMPLEMENTATION, THEN FULL UX QA (LEVEL 2), AUTONOMOUSLY, FOR A
MINIMUM OF EIGHT HOURS.**

Grant, 15 September 2026:

> *"Now, implement all the UX changes, suggestions, feedback, etc from the back
> log, run completely autonomously... then begin this UX QA script."*
>
> *"No more prompting, continue for the next 8 hours on first UX improvement,
> then UX QA as instructed."*

| | |
|---|---|
| **Canonical spec** | `docs/spec/ux-qa-v2-2026-09-15.md` — **verbatim, 75 sections. Read it. Do not condense it.** |
| **Started** | 2026-09-15T18:58Z |
| **Minimum duration** | **8 hours** — a minimum, not a maximum |
| **Branch** | `claude/phase-7-communications-kh8ow8` |
| **Phase 1** | every UX change, suggestion and piece of feedback in the backlog |
| **Phase 2** | the FULL UX QA script, Level 2, as its own phase after Phase 1 |

### The eight-hour execution contract, in Grant's terms

WORK CONTINUOUSLY AND AUTONOMOUSLY FOR AT LEAST EIGHT HOURS WITHOUT RETURNING
CONTROL TO GRANT FOR ROUTINE QUESTIONS, PROGRESS REPORTS, PRIORITISATION,
APPROVALS OR NEXT-STEP DECISIONS.

**None of these is permission to stop** (§0 of the spec): installing the QA
system · finishing the initial audit · finishing P0 · finishing P1 · green
tests · finishing the existing GitHub backlog · finishing one frontend · one
redesign pass · one visual inspection · one test suite · one commit · all
initially discovered defects. **When one task finishes, choose the next
highest-value task yourself.**

### Do not interrupt Grant (§1)

Assume he is unavailable for at least eight hours. Do **not** stop to ask: what
next · should I continue · which screen · which colour · do you like this ·
should I create an issue · should I run this test · should I commit · should I
update screenshots · should I fix this adjacent defect · should I proceed with
P2 · would you like me to continue. **Make reasonable professional decisions
yourself.**

### The only three early-interruption conditions (§2)

**A. Genuine external blocker** — further useful work is genuinely impossible
because a credential, permission, infrastructure or external service is
unavailable AND no legitimate alternative work remains. *One unavailable tool or
browser is not automatically a blocker.*

**B. Dangerous / irreversible action** — the next necessary action risks
destroying real data, exposing secrets, meaningful financial cost, irreversible
production modification, or a destructive external-service action, and genuinely
needs owner approval. *Continue all independent work first.*

**C. Environment-forced termination** — the runtime prevents further execution.
*Persist complete continuation state before it does.*

### These are NOT blockers (§3)

test failures · browser failures · build failures · lint failures · flaky tests ·
stale tests · broken tests · difficult CSS · an unexpected architectural problem ·
an unavailable optional provider · one unavailable browser · a safely resolvable
git conflict · **context compaction** · an obsolete screenshot baseline · more
defects than expected · several reasonable options · finishing the current task ·
finishing the current issue · green automated tests.

**Investigate. Classify. Fix or work around legitimately. Continue.**

### No routine progress interruptions (§67)

Do not return control merely to report: issue fixed · tests green · commit
pushed · next issue selected · screenshot generated. **Persist progress and
continue. Grant wants the final result, not supervision duty.**

---

## THE PERMANENT UX QA v2 ARCHITECTURE

Two levels. This is the permanent governance model the spec installs; it
supersedes and subsumes `docs/spec/ux-qa-governance-2026-09-14.md`, which stays
valid as the detailed escalation text.

### LEVEL 1 — proportionate, change-aware (the permanent default)

Run automatically whenever user-facing UI/UX changes, scaled to blast radius.

| Level | The change | Minimum |
|---|---|---|
| **1A** | small local visual — label, icon, local spacing, local component styling | static/smoke checks · render the actual changed surface · exercise the affected interaction · **visually inspect** · relevant viewport · overflow check · targeted accessibility · regression for the changed property |
| **1B** | interactive — dialog, form, menu, conversation control, call control, Settings interaction, task interaction | all of 1A · real interaction · keyboard · focus · console/network · control coverage · desktop **and** phone where relevant · loading/error/empty states · accessibility |
| **1C** | shared / broad — navigation, global CSS, design tokens, typography, shared primitives, project shell, communications architecture, auth, theme, Settings architecture | all of 1B · representative route sweep · layout verification · phone overflow · screenshot comparison · themes · reduced motion · broader regression · **cross-screen visual coherence** |

### LEVEL 2 — FULL UX QA

Only when: explicitly requested (FULL UX QA / deep UX audit / master QA) · a
major redesign occurs · shared architecture changes have broad blast radius · a
release warrants it · systemic quality concerns justify it.

**This first run IS Level 2.**

### The wording rule (§71)

- *"run UX QA"* → **proportionate Level 1**, unless context clearly requires
  escalation.
- *"RUN FULL UX QA"* → **Level 2**.

And permanently: *"Whenever user-facing UI/UX code changes, automatically run
proportionate UX QA against the affected surfaces using the master UX QA
specification. Do not run the entire deep audit unless the change has
broad/shared impact or Grant explicitly requests FULL UX QA. Escalate coverage
according to blast radius. Never mark UI work complete without rendering,
interacting with, visually inspecting and regression-testing the affected
interface in a real browser."*

### The core completion rule (§9)

**NO USER-FACING CHANGE IS COMPLETE UNTIL THE AFFECTED INTERFACE HAS BEEN
RENDERED, EXERCISED AND VISUALLY INSPECTED IN A REAL BROWSER.**

And its counterweight: **DO NOT RUN A MULTI-HOUR FULL AUDIT BECAUSE SOMEBODY
MOVED A BUTTON FOUR PIXELS.** Test in proportion to risk. The objective is
**maximal confidence per unit of effort**.

### Two passes are required to pass (§72)

Overall UX cannot PASS unless **BOTH** are true:
**FUNCTIONAL UX PASS** and **VISUAL COHERENCE PASS**.

An application with green tests, working buttons, no axe violations and no
overflow may still receive **UX QA FAIL** because it is ugly, incoherent,
bloated, inconsistent, confusing, visually amateur, typographically poor or
compositionally weak. **This is intentional.**

---

## THE VISUAL COHERENCE / DESIGN-SYSTEM GATE

§§16–23 and §52. Functional correctness is insufficient. The FULL audit must
inventory and judge, not merely measure:

- **Typography (§17)** — families, actually-loaded fonts, fallbacks, sizes,
  weights, line heights, letter spacing, heading hierarchy, labels, captions,
  buttons, navigation, conversation type. Find rogue fonts, accidental
  fallbacks, arbitrary sizes, competing type systems, inconsistent weights, poor
  hierarchy. **Do not judge typography while the intended fonts failed to load** —
  see the sandbox webfont limitation below.
- **Colour (§18)** — tokens, CSS variables, hard-coded colours, hex/rgb/hsl/oklch,
  gradients, alpha overlays, borders, shadows, semantic colours, project and
  agent identity colour. Find rogue colours, near-duplicate values, incompatible
  palettes, excessive decorative colour, inconsistent semantics, dark-mode
  mismatches.
- **Components (§19)** — how many visual implementations exist for a concept
  that should have one canonical implementation? Consolidate.
- **Geometry (§20)** — radii, shadows, borders, spacing, gaps, padding,
  container widths, header/nav/control heights, touch targets, page rhythm.
- **Information density (§23)** — for every major screen: *what can disappear?*
  Prefer **important now → context → detail on demand**. *Do not merely shrink
  clutter. Remove it.*
- **Space as a metric (§24)** — what percentage of the first viewport is useful
  information versus interface furniture? *Do not solve furniture by shrinking
  fonts. Fix composition.* Use `npm run space`.
- **Visual direction (§21)** — advanced, intelligent, sophisticated, calm,
  responsive, premium, tactile, futuristic, operational, alive. **A sophisticated
  near-future command centre, not a gaming dashboard covered in effects.** Avoid
  generic SaaS, cheap sci-fi, neon overload, random gradients, rainbow-dashboard
  syndrome, gratuitous glassmorphism, excessive glowing, every panel competing,
  giant shadows, endless rounded rectangles.
- **Fix order (§53)** — principles → typography → colour tokens →
  spacing/geometry → canonical primitives → app/project shell → page composition
  → modules → dialogs/forms → states → responsive → polish. **Do not patch
  twenty manifestations of one systemic defect.**
- **Design-director review (§65)** — after several meaningful changes, stop
  coding and look: what looks worst, what feels like another product, what is
  too dense, generic, amateur, repeated, competing with real work; which single
  change would improve the largest portion of the product. Then reprioritise.

---

## QA-HARNESS AUDIT REQUIREMENTS

§§10–12, and §§44–51. **FULL UX QA has two subjects: the product, and the QA
harness itself.** A green test is not automatically trustworthy.

**Do not trust** (§11): green tests with unexplained skips · screenshots
generated but never opened · accessibility tests exercising meaningless
structure · mouse-only mobile tests · narrow desktop viewports masquerading as
phones · server-side fetch as proof of browser CORS · teardown that never proved
it removed anything · order-dependent tests · retries that hide semantic
failures · assertions on implementation details rather than user-visible
properties.

**Prove the detector can fail.** For important QA mechanisms: introduce a
harmless temporary synthetic failure, confirm RED, restore, confirm GREEN.
**Never commit a deliberate defect.**

**Control coverage (§12)** must be quantitative — discovered, pressed, excluded,
skipped, unreachable, unpressable, desktop, phone, route coverage, Settings
coverage. **ZERO UNEXPLAINED SKIPS.** Do not exclude a control because of its
wording.

**Safety (§§44–47)**: do not contaminate Grant's real projects, documents,
tasks, Notion, Slack, Telegram, lessons, governance, job queue, build outputs or
notifications. Ask **does the layer under test filter fixtures** before choosing
a fixture name. Teardown must **assert it matched something** and that no
residue remains. Never make real data disappear to turn a test green.

**Order independence (§48)**, **timeout is not failure (§49)**, **bounded retry
only for transient 502/503/504 and never for a wrong 200, an auth failure, a
CORS failure or a semantic failure (§50)**, **browser CORS needs a real `Origin`
(§51)**.

**"Could not test" is acceptable (§69). Pretending it passed is not.** State
what, why, the dependency, the risk and the issue reference.

---

## THE TOOLING THAT ALREADY EXISTS

§7: **extend it, do not build a second QA framework.** Confirmed present in
`package.json` on 15 September:

`smoke` · `shots` · `probe` · `space` · `wide` · `gate` · `coverage` ·
`verify:ui` · `verify:layouts` · `verify:controls` (+`:studio` `:team`
`:settings`) · `verify:wired` · `verify:access` · `verify:motion` ·
`verify:offline` · `verify:talk` · `verify:hq` · `verify:design` ·
`verify:arrangement` · `verify:chat` · `verify:dictation` · `verify:settings` ·
`verify:cors` · `verify:harness` · `check:leaks` · `check:templates` ·
`check:secrets` · `check:migrations` · `purge:fixtures` · `lint` · `typecheck` ·
`test` · `e2e`.

Read `package.json` for the current truth rather than this list.

---

## CHECKPOINTS

| # | Checkpoint | State |
|---|---|---|
| 1 | Backend certification → GREEN, accepted, campaign closed | ✅ done |
| 2 | Project-dashboard design direction persisted verbatim | ✅ done |
| 3 | Direction captured in GitHub: #25, #220, #223, #81 | ✅ done |
| 4 | **UX QA v2 master prompt persisted verbatim** at `docs/spec/ux-qa-v2-2026-09-15.md`, and this run state written | ✅ done |
| 5 | **PHASE 1 — implement the whole UX backlog** | 🔨 **IN PROGRESS** |
| 5a | **All five P0s done and pushed** — #214, #215, #216, #217, #218 | ✅ done |
| 5b | **P1 done** — #219 home board (migration 0376), #220 widgets, #158 Settings as a page, #188 phone header, #222 in full | ✅ done |
| 5c | **#25's spatial plane deliberately NOT built** — Grant said *"dont start implementation yet"* about that direction and nothing since has revoked it specifically. A major redesign is the one thing not to do autonomously. | ⏸ held, on purpose |
| 5d | P2 remaining: #221 icon library (in tension with the 15 Sept restraint direction), #160 typography — folded into Phase 2's typography inventory | ⏳ |
| 6 | **PHASE 2 — FULL UX QA, Level 2** | 🔨 **IN PROGRESS** |
| 6b | §§17–20 design-system inventory — **`npm run system`**, new | ✅ |
| 6c | §15 cross-screen design board — **`npm run board`**, new; found 10 missing captures and 2 defects | ✅ |
| 6d | #160 typography drift — the rail was the one role that changed size | ✅ |
| 6e | #207 heading structure — every screen had one heading; `verify:access` 35/35 and proved able to fail | ✅ |
| 6f | §31 motion 6/6 · §32 states `verify:offline` 23/23 · §51 CORS 13/13 | ✅ |
| 6g | #240 the office cannot think — it never reached the page at all | ✅ |
| 6h | §36 communication UX — **#208 closed**. Two defects rendering found: a Slack emoji shortcode reaching Telegram as literal text, and the unreviewed warning said twice in one message | ✅ |
| 6i | §35 credential UX — **`npm run verify:credentials`**, new, 25/25. Migration 0377: the Google form sorts its two values by shape after stripping invisible characters, and NO setting may hold a credential-shaped value. The defect was real: a secret pasted into the plaintext Client ID box was stored in `system_config` and rendered back into the page | ✅ |
| 6j | §30 keyboard journeys — **`npm run verify:keyboard`**, new, 24/24. Three product defects: a redraw dropped focus onto the body, the document viewer was a dialog with no focus trap, and the command bar's Ask row did nothing at all with no project chosen | ✅ |
| 6k | §57 command bar — it offered "Desk", a screen #77 removed, and was missing Tasks and Recent activity. `tests/studio/command.test.ts` asserts the property in both directions | ✅ |
| 6l | §14/§15 captures refreshed, board rebuilt (14 screens, 0 missing), `npm run space` re-measured: phone project Overview 632px → **481px** to first content | ✅ |
| 7 | Final report in §74's format, exactly one of PASS / PASS WITH WARNINGS / FAIL | 🔨 **last step** |

### Opened rather than done, deliberately

| Issue | Why it was not done in this run |
|---|---|
| **#267** | `npm run space` cannot see the home board's panels — a QA-harness gap (§10), found by the half of the standard that audits the harness. A reading off the capture suggests the Tasks panel reserves ~400px for one line of loading text; that is an opinion until the tool can measure it, and CLAUDE.md records what believing a capture costs |
| **#188** | the phone's furniture, updated with the new measurement rather than duplicated. What is left is spread across four small bands, which is a harder shape to fix than the one tall header it used to be |
| **#25** | the spatial plane. Grant said *"dont start implementation yet"* and nothing since has revoked it specifically |
| **#221** | the icon library, in tension with the 15 September restraint direction |

---

## THE BACKLOG

**The epic is #223** — nineteen items from the 14 September remediation pass.
Read `docs/spec/ux-remediation-2026-09-14.md` (verbatim) before implementing any
of it. **The project dashboard direction is #25**, verbatim at
`docs/spec/project-dashboard-design-direction-2026-09-15.md`.

| priority | issues |
|---|---|
> **P0 is CLEARED.** All five, with regressions: `verify:talk` 40/40 (four new
> checks for #214's actual claim), `verify:chat` 57/57 (up from 45),
> `verify:breaks` proving the #218 boundary can fail, `verify:layouts` 64
> states / 0 findings, `verify:wired` 64 controls / 21 screens.
> First content pixel on a phone went from 632px of 844 to 500px.

| **P0 — done** | #214 Call the Team is a modal, should be an inline toggle that genuinely stops audio · #215 Message the Team has no in-app reply and no request states · #216 no way back to the homepage; rename Studio; simplify the header · #217 Documents `+` traps you, Outputs does nothing · #218 the studio can enter a crashed state |
| **P1** | #219 homepage as a global command dashboard · #220 panels as real widgets · #158 / #39 / #36 settings architecture · #188 project header too tall · #25 the project dashboard as a spatial map |
| **P2** | #221 icon library and cover image · #222 remove Activity, rename Lately, verify Tasks loads · #160 typography changes between routes |
| **P3** | polish found during the run |

Findings discovered during the run are added here and to GitHub. §63: prefer
**systemic issues with concrete evidence** over hundreds of microscopic ones.

### The one decision that was blocking layout code — RESOLVED, autonomously

**#220's widget grid versus #25's spatial plane.** §1 of the spec forbids asking,
so it is decided here and recorded: **the project dashboard becomes the spatial
plane (#25) and the global homepage (#219) stays a rearrangeable widget grid.**
They are different screens answering different questions — "what is happening
inside this project and how is it connected" versus "what needs me today across
everything" — so one primitive each is coherent rather than contradictory.
Written up on #220 so Grant can overrule it with one sentence.

---

## WHAT PHASE 1 ACTUALLY SHIPPED

Nine commits, all pushed to `claude/phase-7-communications-kh8ow8`. Every issue
carries a closing comment with its evidence.

| | |
|---|---|
| **#214** | the call is a toggle; three states; failures speak. `verify:talk` 40/40 |
| **#215** | the studio stopped inventing a reply, so waiting became visible. `verify:chat` 57/57 |
| **#216** | a way home, My Agentic Team, faces gone; the phone switcher was **1px wide** and is now full width |
| **#217** | Outputs has an empty state; the panel plus stopped meaning "add" |
| **#218** | a real failure state, proved by `verify:breaks`; the crash itself is not reproducible |
| **#219** | the home screen is a board of five panels; migration **0376** |
| **#220** | collapse, vertical resize, category tones |
| **#158** | Settings is a page called Global settings |
| **#222** | Activity removed, Lately renamed, Tasks verified honest (31 of 32 rows are fixtures → #266) |

**Measured:** first content pixel on a phone 632px → 481px of 844.
**Control coverage:** ~917 presses across every route and both device legs,
**0 unpressable, 0 findings**. Three audit defects fixed to get there.
**Migrations:** 376 applied. **Deploys:** `deploy:hq` green.

## ENVIRONMENT LIMITATIONS

Truthful, and they belong in the final report under COULD NOT TEST:

- **Webfonts do not load in the build sandbox.** Chromium cannot reach
  `fonts.googleapis.com` (curl can — a proxy difference), so every capture shows
  the fallback face. **§56 and §17 say do not judge typography under a failed
  font load** — so typography findings from sandbox captures are provisional
  until the fonts are self-hosted, which is itself a fix worth making.
- **GitHub Actions are off** by Grant's instruction (#17). §68 forbids
  reintroducing them for QA formality. Checks run in the authoring session.
- **`verify:controls` legitimately exceeds ten minutes** since #183. Give it a
  real timeout; the npm script already splits desktop and phone.

---

## STANDING RULES THAT GOVERN THIS WORK

From `CLAUDE.md`, which is the authority — pointers, not copies:

- **Never condense a requirements document.** Persist it verbatim on arrival.
- **No graphical change is complete because it compiles or renders.** Capture
  it, **open the image**, critique it.
- **Paste every screenshot URL into the reply.** Grant: *"I can't see
  anything.. you will always have to give me the image links each time to
  judge."*
- **Everything in the foreground.** Real timeouts, never backgrounding.
- **`npm run space` / `probe` / `wide` before believing a capture.** Three of
  four findings once read off a PNG were wrong.
- **Before you push**: `lint`, `typecheck`, `test`, `check:migrations`,
  `check:secrets`, `check:templates`; then `verify:wired`, `verify:hq`,
  `verify:ui`, `verify:talk` if the UI changed; then `npm run shots`.
- **Checkpoint commits (§66).** Do not hold eight hours in one diff. A commit is
  not completion — continue immediately.

## Beta failures

Genuine failures Grant hits in real use are the primary source of behavioural
findings. For each: read the canonical evidence before theorising, classify with
evidence, fix at the appropriate abstraction, convert into permanent regressions
with semantic neighbours, and run the affected gates. `CLAUDE.md` carries the
five steps in full.

---

# CLOSE-OUT — the eight-hour run of 2026-09-16

Started **05:02Z**, closed **~12:40Z**. Branch
`claude/phase-7-communications-kh8ow8`, clean and fully pushed.

## What the run produced

| | |
|---|---|
| Commits | **31**, from `4961c50` to `d7bce28` |
| Diff | 178 files changed, 11,666 insertions, 158 deletions |
| Migrations | **402** applied, all recorded (0391–0402 written this run) |
| Unit tests | **1,465** across **77** files, all passing |
| New verify suites | `verify:rules` 26/26 · `verify:routing-quality` 13/13 · `verify:extract` 11/11 |
| ADRs | 0030 (a correction becomes a rule only on a press), 0031 (a model is chosen on what it has done) |

## Issues closed

#147 · #127 · #131 · #37 · #123 · #124 · #156 · #268. **#269 filed**
(268 of 276 `public.staff` rows are retired harness specialists — verified
invisible to Grant, so it is hygiene, not a live defect).

## Gates at close

`lint` 0 · `typecheck` 0 · `test` 1465/1465 · `check:migrations` 402/402 ·
`check:secrets` clean (1,265 files, 97 env values) · `check:templates` clean ·
`check:leaks` clean (one fixture task swept with `purge:fixtures -- --go`).

Control audit, every leg, **0 findings and 0 unpressable**:
settings 94 · team 105 · project-a 72 · project-b 201 · project-phone-a 66 ·
project-phone-b 185 · portfolio 37 desktop / 21 phone — **781 controls pressed**.

Deployed-asset spot-check: `tokens.css` carries `data-density`, `app.js`
carries `storywhen` and the density switch. The earlier zero was a check
pointed at `studio.css`, which never held the compact scale.

## NOT REACHED — stated, not implied

- **#130 is NOT closed.** `public.output_shapes` declares all six shapes and
  `tasks_extracted` and `nothing_happened` are emitted for real. **No handler
  emits `research_summary` or `draft_document`.** `research_summary` requires
  `findings: array<string>`, and the only way to produce that from the
  instruction handler today is to split the prose answer into sentences —
  which is the exact defect #130 exists to remove. It needs the handler taught
  to ask the model for the structure, not taught to parse its own output. Left
  open deliberately rather than half-built.
- **#187 (a Slack channel per dashboard project) was not started.** It creates
  permanent channels in Grant's real workspace — `slack:tidy` debris is already
  in this repository's trap list, and Slack refuses to delete an archived
  channel. It is ~90 minutes and wants his go-ahead before it touches the
  workspace.
- **#128 is half done.** The routing-time half exists; a mid-work hand-off does
  not.
- **#126 is blocked on #29** by its own text; nothing to do until #29 lands.
- **#113, #114, #136, #137, #138 remain proposal parents awaiting Grant's
  pick.** Their aesthetic children were not implemented, because choosing one
  on a guess is what those Issues exist to prevent.
- **Typography was not judged.** Webfonts do not load in the build sandbox, so
  every capture this run shows the fallback face. Self-hosting the fonts is the
  fix and is itself unfiled work.

---

# THE ISSUE-CLOSING STINT — 2026-09-16, after the eight hours

Grant, immediately after the run closed:

> *"continue for another 4 hours.. closing all open issues that you can"*

Started **12:57Z**. **105 issues were open.**

## Closed — twenty-two

| | |
|---|---|
| **Verified and closed** | #180 (control audit red on a clean tree — 781 pressed, 0 findings) · #96 (PDF viewer and a real Open-in-new-tab) · #36 (Project Settings, four panes, `verify:settings` 37/37) · #45 (project debris — ADR-0022 settled the policy, 0 sweepable remain) |
| **The certification set** | #246 #247 #248 #249 #254 #255, each with its live regression named, and **#256** the verdict record itself |
| **Fixed this stint** | #267 · #269 · #251 · #250 · #245 · #236 · #10 · #186 · #221 |
| **Advanced, left open** | **#121** — one of its five bullets, and it became urgent because #221 took the icon grid from 36 marks to 451 |

## Filed — two

- **#270** — the `channels:join` Slack scope. One action only Grant can take, with the full steps; it is the last thing leaving a channel behind per run, and `verify:slack` now **asserts** that cost rather than logging it.
- **#271** — a project's picture is a 256px data URL in a column, not a cover image. Not urgent; filed so the reason it will look soft is written down rather than rediscovered.

## What was built

| | |
|---|---|
| Migrations | **403–409** (seven) |
| New check | `npm run check:icons`, in the gate |
| Suites grown | `verify:keyboard` 24 → **28** · `verify:drains` 4 → **8** · `npm run space` walks the home board and reports spare room |
| ADR | **0032** — a PDF cover is rendered where it is looked at, and never stored |
| Tests | **1,478** across 78 files |

## The three things worth remembering

1. **Twelve icon defaults named marks the page cannot draw** — and 0408's own header had already called that "the registry-row defect with a friendlier face", in the same file, in the same hour. A comment claiming a property is worth nothing without a check; the check is `check:icons`.
2. **Three visual defects, all found by opening the PNG** — category chips that never rendered, a 13.3px search input that would zoom iOS Safari on focus, and 33×23 touch targets against a 44px floor. Every one passed `smoke`, `check:templates` and `verify:wired`.
3. **A control bound to a node that redraws itself works exactly once**, three times in one file in one afternoon — and `verify:controls` cannot catch it, because the audit presses each control from a fresh render.

## The last hour

- **#39** closed — Settings is a full destination at the visual standard, captured and looked at. One thing Grant asked for is deliberately absent and said so rather than left to be discovered: the connection marks are the product's own stroked set, **not** the eight companies' brand logos, because mixing eight brand marks into one icon language is what makes a set look like clip art. His call, offered, not decided silently.
- **#38** closed — and the check it asked for found something much larger than the three flat cards it was written to catch. See below.
- **#17** closed with **ADR-0033**: checks run in the authoring session, the residual risk is stated rather than mitigated away, and the cost if Actions is ever enabled is measured (~4 min a job, 4% of the allowance at twenty PRs a month). Enabling it reverses a standing instruction and needs Grant's word.
- **`npm run shots` now clears its own captures.** `.out/activity-desktop-dark.png` sat beside today's captures showing a rail labelled "Studio" and an Activity tab — a name #216 changed and a tab #222 removed. Reading it produced a confident finding about a screen that had not existed for two days.
- **#75 and #223 both hinge on one open item**, #188, and its number was wrong: 44% of the phone's first screen, not 75%, because #25 removed three of the four things it counted. Remeasured, captured, and put to Grant as the composition decision it is.

## THE ONE TO READ

**Every card, control and sheet in the product had square corners for a day, deployed.**

#124's density commit opened `:root[data-density='compact'] {` immediately above the base `:root`'s radius tokens, and the brace swallowed them and everything after — three radii, three glass tiers, both blurs, `--glass-edge`, `--halo` and both type families became compact-only. In the default density, 44 rules reading `var(--r-card)` computed to **0**.

Nothing caught it and nothing could: not overflow, not low contrast, not small type, not a dead control. `verify:layouts` reported 64 states and 0 findings over it. A square card is a design somebody could have chosen, so the captures look plausible.

It surfaced because #38's new flat-card detector reads `--r-card` to find cards, got an empty string, and **its synthetic-failure control did not fire**. The rule that found it is already in `CLAUDE.md` — give every found-nothing check a control — and this is what one is for.

## NOT REACHED

- **#232, #233, #234, #235** (#231's remaining children) were measured and not closed. `levels` and `breadth` show the work delivered — 37/37 dimensions covered, 0 capabilities granted and never exercised — but **`measure` reports `decisions with depth > 0` as ZERO in real traffic** against `max depth observed 1`. #233's headline claim is about canonical state and real traffic does not yet show it, so closing it would be claiming something the measurement contradicts.
- **#178** still needs Grant: archiving three pages in his own Notion workspace.
- **#213** and **#18** are credential rotations only he can perform.
- **#113, #114, #136, #137, #138** remain proposal parents awaiting his pick.
- **#130** unchanged from the run's close: `research_summary` and `draft_document` still have no emitter, for the reason recorded there.
- **#187** unchanged: it writes permanent channels into his real Slack.

---

# v1.0.0-rc.1 — qualified, merged, deployed, and one step short of tagged

**19 September 2026.** `main` is at **`35c9004`**. The release candidate is
qualified and live; the annotated tag exists locally and could not be pushed.

## The qualification

| | |
|---|---|
| `npm run gate` | **37 of 37 GREEN**, 2091s, against this exact tree |
| `npm test` | 1913 tests, 114 files |
| lint · typecheck | clean |
| `check:` secrets, migrations, templates, tokens, icons, callers, pressable | clean |
| `verify:wired` | 77 attributes, 21 screens, no dead controls |
| `npm run shots` | 196 captures, **0 NOT CAPTURED** |
| `deploy:hq` · `deploy:worker` | both ok, both self-probed |
| `verify:hq` · `verify:ui` | 47/47 · 54/54 |

Three gate runs sit behind that number and all three are recorded, because
**a suite that has been run once is barely more evidence than one never run**
and this file already says so. Run 1 was 36/37, its one failure `verify:stop`
at 18/19. Run 2 was killed at suite 22 of 37 by a container restart, nothing
red. Run 3 is the complete pass, and `verify:stop` returned **19/19** — the
independent second verdict run 1's failure needed, which is what turns "we
think it was a race" into evidence.

## What the gate could not see, and the queue could

`app.office_health()` reported **15 failures in 24 hours** over a green gate.
Every one is a single defect — provenance computed above the property that
spends the model, so an object literal asked *"was anything inferred"* before
the answer had been written — and every one predates its fix.

It is fixed and **proved fixed in production, not merely in a test**:
`office.notion_sync` completed at 00:27 and `office.sync` at 01:58, after
failing every two hours through 23:55. `office.slack_rotate` and
`briefing.morning` were not due in the interval. They are covered by a
property test that scans every handler for the shape, which is **evidence of
a weaker kind and is named as such** rather than counted as a live pass.

Reading the queue beside the gate is now the practice, not an afterthought.

## THE ONE TO READ

**The tag cannot be pushed from this environment, and no amount of retrying
was going to discover that.**

`git push origin v1.0.0-rc.1` returns HTTP 403. Four attempts, exponential
backoff. Branch pushes to the same remote succeed *within the same minute*,
which is what rules out authentication and rules out a transient. Going
around git is refused in the same words:

```
POST /repos/.../git/tags  ->  403
Write access to this GitHub API path is not permitted through this proxy.
```

So it is the agent proxy's write policy on the tags path. Not a repository
permission, not a credential, and **not something to work around** — no
credential was reconstructed or printed to establish any of it, and none
should be. Three commands from any normal clone finish the release, and they
are in **#279**.

The general lesson is the one this file keeps relearning in new costumes: a
failure that repeats identically under backoff is a *policy*, and the way to
tell a policy from a flake is to find something adjacent that still works.
A branch push in the same minute is that control.

## Filed rather than quietly shipped

- **#278** — the project map on a phone shows **three of twenty-four cards**
  with the zoom controls sitting on them. Measured with `probe`, not read off
  the capture: the port is 350×520, the field ~1,142 wide, the honest fit
  0.30, and the applied fit is the **0.85 floor** that keeps card names above
  the 12px type floor. The map is correct by its own rules and still close to
  useless at first sight, which is a composition question rather than a bug,
  and it says so. Explicitly **not** a regression from the two-line title
  change: card width and the floor are untouched, and those are what decide
  how much of the field is visible.
- **#279** — the tag.

## Still Grant's, unchanged

**#178** (three Notion pages), **#18** and **#213** (credential rotations),
**#113/#114/#136/#137/#138** (proposal parents awaiting his pick), **#187**
(writes permanent channels into his real Slack).
