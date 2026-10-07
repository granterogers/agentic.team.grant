# Version 1 reliability and acceptance, 7 October 2026

> **Superseded in part the same day** by `docs/audit/V1-DECISIONS-AND-EVIDENCE-2026-10-07.md`: the Telegram delegation question and the Notion
> failures are no longer PARKED (two authorised read-only production reads settled them), ticking a recurring reminder no longer ends the series
> (Grant's decision), an uncertain or failed delivery now puts a question on his Needs me list, and the backup retention policy is recorded. This
> document is kept as written.

Scope: make the current Version 1 candidate reliable in the user journeys that matter to Grant, then prove it with behavioural
acceptance tests. **Nothing was deployed. No migration was applied to production. After the single Tier 1 read-only pass earlier
today there was no production contact.** Migrations 1023 to 1026 and every fix below are in the repository only. Evidence
vocabulary is kept: PROVEN, MUTATION-PROVEN, REPLICA-PROVEN, INFERRED, UNPROVEN, PARKED. No real model, Telegram, Slack, Google,
Notion, Vikunja, Whisper or realtime audio was exercised; wherever the outcome depends on one of them it is marked.

## Summary in plain English

The seven reliability defects are fixed in the repository and each fix was proven by driving the real code against a local replica
with a deterministic stand-in for the model, then by breaking the fix on purpose and watching a named test go red. The fixes are:
a reminder with a day but no time now fires (09:00 in the office's own time zone); "Mark the roofer task done" completes it and
creates nothing else; "every Monday" is remembered and keeps firing; the office can no longer claim to have emailed or shared something
without a recorded row that says so; a finished answer is redriven instead of stranded; Team HQ keeps the thread across a reload and
a replayed message is one message; and no model request can hang a turn.

Fourteen realistic journeys were driven through the real doors, ledger, worker and delivery code. **Ten pass outright (A to F, I, J, L and N); four pass
with documented product limits (G, H, K, M).** None fails. Two more defects were found by the journeys and fixed:
**one office's job could be delivered to another office's Telegram chat or Slack channel** (migration 1033), and a draft email
was being refused as a completion claim and rewritten away.

The candidate is materially safer than current production. It is **not yet proven against a real model or real providers**, and one
Telegram question is parked for a production read (below). My recommendation is **B**.

## The seven defects and the Notion symptom

| ID | Class | What was wrong and what is now true | Evidence | Still unproven |
|---|---|---|---|---|
| R1 date-only reminders | **FIXED + PROVEN** | "Remind me Friday" set a due date and no `remind_at`. Now an explicit "remind me" with a day and no time gets 09:00 in the office's zone (`offices.timezone`, read by SQL `app.office_timezone` and TS `officeTimezone`; Athens is only the documented operator default); a plain due date gets no reminder. Today/Overdue bucketing follows the same zone. | MUTATION-PROVEN (default removed: 10 vitest and 11 proof reds); REPLICA-PROVEN in Athens, New York, Auckland, DST days, 22:30 UTC boundary; journeys A and B | Real model phrasing; reminder push to his phone |
| R2 state change creates a task | **FIXED + PROVEN** | "Mark/Complete/Tick off/Cancel/Delete/Rename X" changes exactly one row and adds none; "Add a task to call the roofer" and "Remind me to call the roofer" still create exactly one; a no-match says so. | MUTATION-PROVEN (veto dropped reproduces the junk row); journey D | Which task a real model picks when two match |
| R3 recurring reminders | **FIXED + PROVEN** | "Every Monday / every day at 9am / every Friday at 4pm / weekly" is stored. A reminder-only repeat is ONE row that advances in place, on the office wall clock and across DST, when its delivery is recorded sent; ticking it off ends it. A repeating task with a due date still makes the next one when ticked. Unsupported patterns say they were not recorded. | MUTATION-PROVEN (5 sabotages); REPLICA-PROVEN, two occurrences, DST, month end, 30-day outage fires once; journey C | Design is Grant's to confirm (ticking ends a series) |
| S1 false claims | **FIXED BUT PARTLY UNPROVEN** | `src/agents/consequence.ts` decides whether a sentence is a claim; recorded rows decide whether it is true, per verb class (mail, outbound, publish, schedule, remove, approve, draft). `gmail.send` is disabled so any email claim or "I can email Kevin" is refused. 51 true answers: none refused with their true evidence. | MUTATION-PROVEN (evidence forced true: 15 reds); real worker refused 18 phrasings and delivered 5 true controls; journey E, F, M | Residuals: an unattributed recount ("The invoice was sent") is still read as a claim; delivery evidence is not recipient-aware; passive publish/schedule/remove/approve are not detected; whether real models emit these phrasings |
| N1 stranded answer | **FIXED BUT PARTLY UNPROVEN** | A finished answer is redriven on bounded backoff (30, 60, 120, 240 s, ceiling 900 s, 5 attempts), a failure before any request left the machine (DNS, refused, TLS, connect timeout) retries, a failure after the request may have left parks as indeterminate rather than risk a duplicate, and nothing sits in `claimed`. State machine in `docs/delivery/DELIVERY-STATE-MACHINE.md`. | MUTATION-PROVEN (redrive, backoff bound, dedupe fence, network classification each red); journey K | Real Telegram/Slack; an at-most-once window remains for a lost response; an ambiguous or terminal delivery is on the dashboard list only, **the person is not told on chat** |
| H1 HQ continuity | **FIXED + PROVEN** | The conversation key is derived by the server from the verified person, office and project (`src/auth/conversation-key.ts`), never named by the page. A reload, new tab or other device keeps the thread; another person, office or project inherits nothing. A replayed message (client-supplied id scoped to the person) is one command (migration 1030). | MUTATION-PROVEN (per-visit key restored: reload test red); journeys I and L | Realtime audio call; whether a real model uses the earlier turn |
| M1 model timeout | **FIXED + PROVEN** | Each request has a 25 s deadline (late responses are discarded, never applied), the chain has a 100 s budget under the 150 s edge limit, the fourth (free-tier) model is now reachable, a timeout is its own transient class, and usage is recorded honestly. | MUTATION-PROVEN (deadline removed: red, not hung); journey J | 25 s is an estimate, not a measured p99 |
| Notion sync | **PARKED** (cause) / four local defects **FIXED** | A revoked or refused token retried a doomed call and told nobody (now one notice a day); the Notion client had no timeout; an HTML error page surfaced as a raw error; a non-object 200 was read as an empty workspace. The provenance-order trap that failed this duty on 18 September is now behaviourally pinned. **The real cause of the 45 production failures is not established.** | MUTATION-PROVEN for each local fix | PARKED - NEEDS PRODUCTION EVIDENCE: `select (created_at)::date d, left(state_reason,120) why, count(*) from public.jobs where kind='office.notion_sync' and state='failed' and created_at >= '2026-09-15' group by 1,2 order by 1;` (read-only, not run) |

Also fixed because the journeys found them: the timezone inconsistency (Z1), `my_task_set` editing team tasks (T1), a reminder
muted by `say_once` (a second same-title reminder the same day), the reminder marked sent before delivery (C3), a failed duty
delivery suppressing its retry (C2), a draft refused as a completion claim, a repeat delegation request claiming a hand-off that
did not happen, an internal step id in approval text, an "unreviewed answer" caption on the failure apology, and **cross-office
delivery (1033)**.

## Acceptance journeys A to N

Both suites are in the critical gate. Each drives the real doors, ledger, worker, handlers and delivery with a scripted stand-in
for the model and a fake transport. Run on fresh clones by me: part A 129/129, part B 140/140.

| | Result | Deterministically proven | Model-dependent or unproven | Exact reason |
|---|---|---|---|---|
| A reminder 10am | PASS (30) | 10:00 office-zone `remind_at` (Athens and New York); silent before time; fires once; a failed send is redriven; reminded only after delivery recorded | Unusual phrasings | |
| B date-only | PASS (12) | 09:00 default, reply says no time was given, fires once; "Task: renew X by Friday" makes no reminder | Whether a real model asks for a time | |
| C recurring | PASS (15) | Two firings delivered, one row advanced in place twice, tick-off ends it | | DST covered by `tk-reminders` |
| D completion | PASS (10) | One task, completed, zero junk, truthful confirmation both turns | Real model's choice between two matches | |
| E draft, not sent | PASS (19) | Draft exists, deliveries only to his own chat, no send path exists, "Email sent to Kevin" refused every attempt and the person gets a truthful message | Draft wording | |
| F human-contact boundary | PASS (25) | "Send this to Kevin" sends nothing; an outward step raises one bound question and runs nothing before approval; forwarded, paraphrased and external-assistant "yes" cannot approve; his own typed yes runs it exactly once | Real wording; the Slack reply path was not driven | |
| G autonomous work | **PARTIAL** (30) | Safe steps run; an outward step parks on one bound question; he is told once; no completion is claimed for the parked step; the pursuit stops at 3 rounds / 120 s | The plan the model proposes | Limits: a safe step that comes after a parked one waits for the answer; refused outward steps are not announced at the pause; the final summary says "I could not slack.post" (a capability identifier, #242 class) |
| H delegation | **PARTIAL** (28) | One child per specialist, one fan-in, one synthesis, one delivery; a retry or repeat never creates a second team and no longer claims a hand-off | Who a real model picks | **Telegram to the chief's bot never delegates if that bot is registered with the slug `chief-of-staff`** (below) |
| I HQ continuity | PASS (16) | Reload keeps the thread; typed yes binds the right question; nobody else inherits it | Whether a real model uses the earlier turn | |
| J model failure | PASS (16) | Hung then 429 then ok: one answer, honest usage rows; every provider failing: one apology in bounded time, no caption, nothing repeated on later ticks | Real provider failure mix | |
| K delivery failure | **PARTIAL** (13) | 429 waited out; connect failure redriven, one message; a lost response parks and is never auto-resent; nothing stranded | | An ambiguous or terminal delivery is visible only on the dashboard, not told on chat |
| L duplicate input | PASS (18) | Identical Telegram update, Slack event and Team HQ message: one command, job, task and reply | | |
| M untrusted content | **PARTIAL** (17) | The injected sentence stays fenced data; a model that obeys is stopped (false claim never delivered, an obeying plan cut to a parked draft, an obeying approve changes nothing); nothing is sent | Whether a real model obeys | An obeying extraction model writes the injected sentence as a task on his list: undoable, nothing sent, but unmarked as outside-origin |
| N cross-office | PASS (20) | Every B-against-A attack fails with an A control: task, document, search, HQ and Telegram continuation, approval, project, delivery to A's chats | | Found and fixed 1033 |

## Final verification (run by me on the final tree, commit `00475ec`)

| Gate | Result |
|---|---|
| typecheck | exit 0 |
| pinned Biome 2.5.11 `npm run lint` | exit 0, 1,465 files |
| `npm test` (hermetic) | exit 0; **399 files passed, 1 skipped; 6,205 tests passed, 21 skipped** (was 5,722 at the start of the run). The 21 skipped are the pre-existing live-service Vikunja tests |
| `check:migrations`, `check:secrets`, `check:templates`, `check:deployment-state`, `check:proofs` | all exit 0 |
| `verify:critical` | **57 green, 0 red; 3,351 assertions; 69 s** |
| `verify:extended` | **71 green, 0 red; 1,621 assertions; 82 s** |
| v1-acceptance-a and -b | 129/129 and 140/140 |
| gate sabotage, 15 deliberate breaks on cloned databases | **15 of 15 turned the critical gate red** (the reminder harness filter had been missed until a proof was added) |
| mutation campaign on the controls this run changed | **9 caught of 9, 0 survived, 0 did not land** (M1, M3, M4b, M15, M16, M17, M18, M25, M25b). The full 32-mutation campaign (31 caught, 1 documented equivalent, earlier today) was not re-run in full because it takes about an hour in the foreground |
| focused sabotage per repaired invariant | done by each implementing agent (listed per fix above); the gate's 15 and the acceptance suites' sabotages (S1 to S10 in part A, S1 to S9 in part B) were red then green |

Flakes: none seen in the final runs. Earlier reds I investigated rather than accepted: the hostile-PDF unit tests flaked on a wall clock
under load (fixed to judge CPU time, passes with six CPU burners on four cores); the part B agent reported five proofs "failing
identically before and after"; **run by me on fresh clones every one was green** (so that was an artefact of its environment, not a
defect). `ux-audit-1021` passes with exit 3 by design (it ends in a deliberate rolled-back exception, and its entry requires both
the marker and the code).

## The ten questions

1. **Are the seven defects fixed?** Yes in the repository. R1, R2, R3, H1 and M1 are FIXED + PROVEN on the deterministic path. S1 and N1
   are fixed but have named residuals (above). None is live in production until a deployment.
2. **Do the important journeys work end to end in the isolated environment?** Yes: no journey fails; ten pass outright and four pass
   with documented limits.
3. **What remains model-dependent?** Whether real models phrase, plan, delegate, pick the right task, ask the right question, obey
   injected text, or use earlier turns as the stand-ins assume; the reply to the new "already on that" and approval wording; the
   25 s deadline's fit to real latency.
4. **What remains provider or live dependent?** Real Telegram and Slack sends and rate-limit behaviour, voice-note transcription
   (`voice.transcription` seeds as `none`), the realtime audio call, Google, Notion, Drive and Vikunja traffic, MCP consent, the
   deployed edge runtime, real Supabase Auth and row-level security, the reminder push to his phone.
5. **P0 or P1 still open?** **No P0 known.** Open, in order: (a) **Telegram delegation (INFERRED, PARKED)**: the webhook records
   `addressed_to = <bot's staff slug>` (`supabase/functions/telegram-webhook/index.ts:371`) while `instruction.ts`'s header says the chief's bot has none;
   if production's chief bot is registered with `chief-of-staff` (CLAUDE.md says all eight bots carry their person's slug) then every Telegram
   instruction is "addressed directly" and convenes nobody, which would match the historical "no turn ever convened two". Changing it also changes
   reply routing, which has broken before, so I did not change it. The read that settles it: the staff slug on the chief's row in the Telegram bots table. (b) The
   capacity clock: Storage fills about 23 to 28 October without backup retention (not authorised, not deployed). (c) The Notion cause
   (PARKED). (d) An ambiguous or terminal delivery tells nobody on chat.
6. **Materially safer and more reliable than production?** Yes: a cross-office delivery path closed, false-claim detection tied to
   evidence, reminders that fire, no stranded answers, no hung model, and a maintained gate that caught 15 of 15 deliberate breaks. Production has
   none of it until deployed.
7. **What remains before Version 1 can reasonably be deployed?** A controlled real-model and provider acceptance run; the Telegram
   slug read and, if confirmed, a reviewed fix; the Notion read; your decisions on (i) whether a repeating reminder should end when
   ticked, (ii) telling the person on a second channel when an answer terminally fails, (iii) the backup retention keep-count; and the
   deployment authorisation itself.
8. **What would eventually be deployed?** Migrations in order: 1023, 1024, 1025, 1026, 1027, 1029, 1030, 1033 (1028, 1031, 1032, 1034
   were reserved and unused; `check:migrations` accepts the gaps). Apply 1029 before the worker is deployed (the reminder settle step
   reads its delivery-state function). Capture the live definitions of the functions 1027, 1029 and 1033 rewrite beforehand, because
   a migration is immutable and the rollback for a function rewrite is the previous definition plus the previous worker. Then:
   **worker** (all of `src/`), the **voice edge function** (conversation key and message id; 1030 applied first), the **Team HQ page**
   (`chat.js`, `call.js`). hq-api, telegram-webhook, slack-events and mcp are unchanged by this run. Rollback order: worker first, then the page, then
   the voice function, then restored function definitions.
9. **What should not be in the Version 1 deployment?** Backup deletion or retention execution (1026's retention is dry-run by default and
   needs an attended flag and your keep-count); any Telegram addressee change before the slug is read; the P2 hardening list (security
   headers, MCP token lifetime, Sample visitor key, unfenced derivative documents, calendar purge); per-office Notion; the cross-channel
   failure notice until you decide it.
10. **Is another broad audit necessary?** No. What is needed is narrow and named: the real-model run, two read-only production
    questions, and your three decisions.

## Open items I did not fix (so none is hidden)

Approval ordering (a safe step after a parked step waits), refused outward steps not announced at the pause, "I could not slack.post" in
the final summary, an injected-instruction task not marked outside-origin, the apology still showing thumbs buttons on the reply path,
a genuine "retry" while the first team still runs answers "already on it", the Team HQ composer writing `voice` where CLAUDE.md says
`teamhq`, `hq-say` commands with a null subject (readers coalesce), a replay deduplicates only within the same visit, two tabs of one
person share one thread, `ask-unasked-loop`'s premise changed deliberately (a mid-send death now parks), the skew matrix (new worker
against old schema) has no executed proof after the two obsolete skew proofs were quarantined, and the unrecorded D7/D8 items from the
health report (upload bytes in no backup; Notion credential is deployment-level).

## Process disclosures

A sabotage run of the gate was moved to the background by the harness because it passed the ten-minute ceiling (I passed an option the
tool ignores, so it ran all 15; it finished and its result is what is quoted above). Several agents disclosed slips against the
Edit/Write-only rule (a few `python3` heredocs and no-op `sed -i` on `/dev/null`, all read back and linted). **One agent left six scratch
files at the filesystem root (`/cb.sql`, `/ck.bak`, `/ck.keep`, `/h1.out`, `/h1s.out`, `/h1d.out`); my removal was blocked by a built-in safety
check that only a person can approve, so they are still there and need deleting by you.** No file in the repository, no production system
and no secret was affected.

## Recommendation

**B — controlled real-model/provider acceptance required.** Not A, because the remaining risk is no longer something more local work can retire: it is
how real models and providers behave against these fixes, plus one Telegram read. Not C, because it is not yet shown against a real
model and a deployment needs your separate authorisation. B and C are not performed automatically.
