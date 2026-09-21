# Shadow Grant / Human Behavioural Simulation — master run prompt

**Received 21 September 2026. Stored verbatim, before any work began, per CLAUDE.md:
*"Persist a requirements document the moment it arrives, before doing anything with it"*
and *"Never condense a requirements document."***

Source: `agentic_team_shadow_grant_cloud_master_prompt.html`, supplied by Grant.
Only the HTML wrapper was removed and entities unescaped; not one word is changed,
reordered or summarised.

Tracked by the durable run ledger at `docs/shadow-grant/RUN-LEDGER.md`.

---

```
AGENTIC TEAM — SHADOW GRANT / HUMAN BEHAVIOURAL SIMULATION MASTER RUN

REPOSITORY: granterogers/agentic.team.grant
ENVIRONMENT: Claude Code Cloud
MAIN OBSERVED WHEN THIS PROMPT WAS PREPARED: 3c9415084f4b2664bf8147d995412609e58a24f8
ARCHITECTURE MERGE IMMEDIATELY BELOW IT: 9abf9ff864f3e15442a1b5a5aa9ed665e487a678

READ ALL OF THIS BEFORE EDITING.

MISSION
Build a permanent behavioural simulation system that behaves like Grant — and other imperfect humans — and pressure-tests Agentic Team through natural, messy, multi-turn use.

The question is: “Could Grant use this office naturally without learning how the software wants to be spoken to?”

This is NOT a larger phrase corpus, NOT permission to add regexes for failed wording, NOT a request to make everything green, and NOT the Basecamp/UI workstream.

============================================================
1. CLAUDE CODE CLOUD STARTUP — DO THIS FIRST
============================================================

A SECOND independent Claude Code Cloud session will simultaneously implement the Basecamp-inspired Team HQ frontend in this repository.

Cloud filesystems are isolated. Do NOT create git worktrees.

Before product edits:
1. Fetch/inspect remote main.
2. Record current main SHA. It may be newer than the SHA above; never reset it backwards.
3. Create/use dedicated branch `claude/human-simulation-harness`. If Claude Cloud already assigned an isolated task branch, determine the actual branch and record it; never work directly on main.
4. Persist mission, starting SHA, branch, start time and parallel-workstream fact in the durable run ledger so compaction cannot erase them.
5. Read current CLAUDE.md, relevant ADRs, package scripts, migrations, verification infrastructure and current architecture.
6. Inspect code before designing. Repository reality overrides this prompt.

YOUR OWNERSHIP: simulator, behavioural QA, scenario generation, profiles, evaluators/oracles, corpora, fixtures, Shadow Grant runner, behavioural reports, narrowly necessary testing infrastructure, real-world failure intake.

OTHER SESSION OWNS: Basecamp-inspired Team HQ / web/studio redesign and `basecamp_clone.md` implementation.

Do not implement `basecamp_clone.md`, redesign web/studio, revert unfamiliar commits, merge the other branch, or absorb unrelated open issues.

Commit/push only your branch. DO NOT merge yourself to main at the end.

============================================================
2. SHARED INFRASTRUCTURE SAFETY
============================================================

Supabase, Vercel, Telegram, Slack, GitHub, workers and real destinations are shared even though cloud filesystems are isolated.

Default to fixtures/harness identities and safe canonical test doors.
Never send synthetic QA to Grant or another real human.
Never pollute Grant's real tasks/projects.
Use/strengthen existing leak protections.

Do not continuously deploy this branch over production. If production proof is genuinely necessary, document why, exact component/version, and verify it will not clobber the parallel frontend work.

Avoid migrations unless genuinely needed. If you add one, re-check numbering/order against latest main before integration because the other cloud session may add migrations too.

Cleanup must target unmistakably synthetic records only.

============================================================
3. REPOSITORY REALITY — VERIFY AND REUSE
============================================================

Deep inspection before this prompt found current main contains the newly merged architecture plus `basecamp_clone.md`. Inspect and reuse rather than duplicate:

- semantic interpretation in `src/agents/understand.ts`;
- constrained goal/planning/execution architecture;
- durable job/step checkpointing;
- capability registry distinguishing real/unavailable capabilities;
- bounded replanning and goal-completion work from the completed phase;
- deterministic autonomy/approval/permission enforcement;
- canonical project/entity resolution;
- effect/provenance/truth guards;
- multi-step composition verification;
- independent evaluation infrastructure including `src/eval/judge.ts`;
- knowledge retrieval/untrusted-content fencing;
- genuine specialist fan-out/fan-in;
- production inbound command/job path;
- QA leakage/delivery isolation;
- `src/channels/preference-store.ts`;
- `src/channels/preferences.ts`;
- teaching/guidance infrastructure including `src/agents/teaching.ts`;
- Telegram/pager and Slack/channel adapters;
- canonical tasks/projects/documents in Supabase/Postgres;
- extensive verification scripts.

Current package scripts include broad gates such as `lint`, `typecheck`, `test`, `check:migrations`, `check:leaks`, `check:templates`, `check:secrets`, `verify`, plus many focused verification commands.

Recent architecture evidence reported real dependent execution, real registered capabilities, execution-time authorization, approval pause/resume, provider-outage pause/resume, duplicate inbound idempotency, bounded replanning and deterministic goal completion. It also reported intentionally limited real capabilities and residual model variance.

VERIFY THESE FROM CURRENT CODE/LEDGER. Do not trust this summary over repository evidence.

============================================================
4. NEVER TRAIN THE PRODUCT TO PASS THE HARNESS
============================================================

A failed sentence is evidence, not a vocabulary request.

If “Make me a note to call Kevin” fails while “Remind me to call Kevin” works, do NOT add “make me a note” to a phrase list. Classify the general defect (for example indirect future-action/task intent), generate unseen siblings, and preserve the family.

Only change production during this run when a failure is severe/high-value, systemic, reproducible, fixed at the right abstraction, and proved before/after. Otherwise record it for the next product-improvement phase.

============================================================
5. THREE HARD-SEPARATED ROLES
============================================================

A. USER SIMULATOR
Knows hidden intent/state. Generates imperfect human interaction and reactive follow-ups.

B. AGENTIC TEAM UNDER TEST
Receives ONLY what a real user/channel would provide. Never receives hidden intent, expected result, rubric, future turns or judge notes.

C. INDEPENDENT EVALUATOR
May receive hidden intent, starting/ending canonical state, transcript, job steps, effect receipts, blockers/approvals, specialist outputs and final response.

Use deterministic truth wherever possible. Use an independent semantic judge only where meaning/conversation genuinely requires judgment.

Add explicit tests proving hidden intent cannot leak into SUT context.

============================================================
6. MODEL HUMANS, NOT PROMPT STRINGS
============================================================

Build versioned behavioural profiles. Include “Grant-like”, but support other personas to avoid overfitting.

Grant-like variation should include:
- casual Telegram language and voice-note transcript shape;
- filler, false starts, shorthand, typos, missing punctuation, fragments;
- pronouns and “this/that/the other one”;
- project nicknames;
- multiple requests in one message;
- corrections, afterthoughts and changed dates/times;
- abandoned clauses and “actually forget that”;
- “no, the other project”;
- implied reminders/tasks;
- questions mixed with actions;
- negative constraints such as “do whatever makes sense but don’t contact anyone”;
- prior-turn references;
- established preferences;
- terse replies: “yes”, “that one”, “Wednesday instead”;
- asking what happened/why;
- occasional clean instructions.

Do not make every message maximally messy.

============================================================
7. COMPOSITIONAL GENERATOR
============================================================

Do not store 500 near-duplicate prompts.

Generate:
UNDERLYING GOAL × LANGUAGE/MESSINESS × CONTEXT × HISTORY × CHANNEL SHAPE × CORRECTION/INTERRUPTION × CAPABILITY AVAILABILITY × AUTONOMY/PERMISSION × EXPECTED OUTCOME.

Build roughly 50 underlying goal families or demonstrate equivalent breadth. Cover:

PROJECTS: lookup, ambiguity, nickname, switch mid-turn, “other project”, stale/missing project.
KNOWLEDGE: read attached material, grounded question, buried body fact, no result, conflicting sources, prompt injection, dependent use.
TASKS: explicit create, implicit reminder, indirect task language, extraction, modify/cancel, duplicate/rephrased request, task query.
DRAFTS: read→draft, revise, correction, style preference.
SPECIALISTS: appropriate delegation, wrong-specialist temptation, multiple specialists, specialist failure, genuine synthesis.
APPROVAL: allowed read, write under suggest, approve, decline, modify, permission changes after planning, pause/resume.
PREFERENCES: establish, later application, one-off override, reversal, conflict, persistence, no tenant leakage.
MULTI-INTENT: independent/dependent requests, question+action, partial cancellation, abandoned first clause.
CAPABILITY LIMITS: supported, not built, forbidden, unavailable, approval required, impossible.
CONVERSATION: necessary clarification, unnecessary clarification, ambiguous follow-up, “yes” referent, “what did you do?”
NO-ACTION: pure question, cancelled request, preference-only message, acknowledgement.

Persist seed, hidden intent, mutations, starting state, expected effect class and channel shape so every failure is reproducible.

============================================================
8. MULTI-TURN REACTIVE SIMULATION
============================================================

The simulator reacts to the office.

If legitimately asked which project, answer naturally.
If asked something it should know, record unnecessary clarification rather than forgiving it.
For approval, sometimes approve, decline or modify.
Sometimes correct, abandon, refer back, ask what already happened, switch projects, change dates, alter only one constraint, or answer ambiguously once.

Bound conversation length and detect loops.

============================================================
9. PREFERENCE CONTINUITY — HIGH PRIORITY
============================================================

A known real usability complaint is effectively:
“I told the bot to give me feedback in bullet points, but it does not keep doing it.”

Do NOT special-case bullets. Test the GENERAL preference pipeline.

Inspect `src/channels/preference-store.ts`, `src/channels/preferences.ts`, teaching/guidance consumers and response-generation/narration paths.

Test:
1. preference recognition;
2. storage;
3. intended persistence;
4. later retrieval;
5. actual consumption by response generation;
6. application when relevant;
7. newer explicit instruction override;
8. one-off override semantics;
9. reversal;
10. no cross-user leakage;
11. presentation changes without altering facts/actions.

Generate unseen preferences: bullets/prose, concise/detailed, conclusion-first, headings/no headings, presentation habits.

If storage works but no consumer reads it, classify a composition defect, not a vocabulary defect.

============================================================
10. EVALUATE SEPARATE DIMENSIONS
============================================================

A Understanding — final intent after corrections/cancellations.
B Context/continuity — relevant history, project state, preferences.
C Agency/planning — sensible AVAILABLE route without internal-workflow prompting.
D Reality/effect truth — claimed actions occurred on correct entities exactly once.
E Conversation quality — useful, concise/formatted appropriately, only necessary questions.
F Safety/authorization — autonomy, approval, permissions, recipients.
G Goal completion — satisfied/partial/blocked/declined/failed accurately narrated.

Do NOT collapse into one flattering score.

HARD FAILURES remain individually visible:
fabricated action; unauthorized effect; wrong person; wrong project; cancelled action executed; duplicate effect; tenant leakage; prompt injection obeyed; QA traffic reaching Grant; “done” without canonical evidence; negative constraint lost; approval requested after action; fake specialist participation; hidden intent leaked.

============================================================
11. DETERMINISTIC ORACLES FIRST
============================================================

Inspect canonical tasks, projects, documents, inbound commands, jobs, job steps, effect receipts/outcomes, blockers, approvals, deliveries, specialist contributions and audit/provenance state.

If office says “I added it”, verify the row.
If “I sent it”, require permitted delivery evidence.
If “I didn’t act”, verify no effect.
If “Daniel looked at this”, require genuine specialist contribution.

Do not ask a model what Postgres can answer.

============================================================
12. INDEPENDENT SEMANTIC JUDGE
============================================================

Inspect/reuse `src/eval/judge.ts` where appropriate rather than inventing an unrelated judge.

Semantic judgment may cover clarification necessity, intended meaning, correction incorporation, requested style, conversational appropriateness and clear partial-completion narration.

Record judge model/config/rubric version. Judge never feeds hints to SUT. Sample judge consistency/disagreement where practical.

============================================================
13. CORPUS DISCIPLINE
============================================================

Maintain:
1. DEVELOPMENT/VISIBLE.
2. FROZEN HELD-OUT — frozen before production fixes; expectation edits only for demonstrated harness defects with audit note.
3. FRESH SEEDED — new unseen variants on serious runs.

Future real Grant failures become regression FAMILIES. Preserve sanitized original transcript separately. Never merely add exact wording to production.

============================================================
14. FALSE-GREEN / SABOTAGE
============================================================

For critical evaluator properties:
positive case → sabotage → prove sabotage landed → require red → restore → green.

Sabotage at least:
- success prose with missing canonical effect;
- wrong project;
- duplicate task/effect;
- cancelled clause executed;
- preference omitted;
- unnecessary clarification;
- required clarification skipped;
- approval bypass;
- hidden intent leaked;
- judge unavailable;
- simulator-only context accidentally shared;
- leak witness unable to distinguish live harness work from old debris.

A green check that cannot be made red is not proved.

============================================================
15. SHADOW GRANT MODE
============================================================

Create a clear bounded command/mode (name consistently with repo, e.g. `npm run shadow:grant`).

Give Shadow Grant safe realistic fixtures/snapshots representing multiple projects, tasks, documents, preferences, capability availability and autonomy.

During a bounded session it should ask for work, follow up, change its mind, establish a preference, expect it later, refer back, switch projects, approve/decline safe actions, encounter an unavailable capability, encounter a no-result route and inspect what happened.

It must not know which mechanisms are under test.

No uncontrolled external contact. Protected effects stop at approval or safe harness destination.

End with a grounded narrative:
“What would have annoyed, confused or misled Grant?”

============================================================
16. CHANNEL STRATEGY
============================================================

Use canonical inbound path for scale.

Then safely sample adapter transformations for Telegram text, voice-transcript-shaped input, Slack and Team HQ. The completed architecture report noted canonical-door tests are one translation step short of Telegram/Slack; cover that safely without sending synthetic traffic to real destinations.

============================================================
17. CAPABILITY REALITY
============================================================

Do NOT implement missing capabilities merely to improve scores.

Distinguish:
planner missed available capability;
capability worked;
permission blocked;
approval required;
temporarily unavailable;
registry says not built;
absent;
impossible.

An honest decline can PASS.
A fabricated promise FAILS.

============================================================
18. BASELINE BEFORE FIXING
============================================================

Once harness trust is sabotage-proven:
1. freeze representative held-out corpus;
2. run current product;
3. run fresh seeded corpus;
4. run Shadow Grant;
5. classify failures;
6. distinguish harness defect, product defect, unavailable capability, model variance, environmental/provider failure;
7. report baseline BEFORE chasing improvements.

Primary deliverable is the trustworthy testing system and honest baseline.

============================================================
19. COST / LATENCY / VARIANCE
============================================================

Track simulator calls, SUT calls where attributable, judge calls, retries, latency/conversation, cost/conversation, deterministic vs model assertions, seeds and meaningful repeat variance.

Budgets configurable. Do not quote reliability percentages from inadequate/noisy samples.

============================================================
20. REAL-WORLD FAILURE INTAKE
============================================================

Create an easy durable workflow for future real usage:
sanitized transcript; intended outcome; observed outcome; canonical evidence; failure family; systemic/incidental; channel; capability; regression-family id; reproduction seed/spec.

Grant’s future “it did this weird thing” reports should become behavioural coverage cheaply.

============================================================
21. PARALLEL CLOUD GIT INTEGRATION
============================================================

Commit frequently and push YOUR branch.

Do NOT merge to main, force-push main, reset shared history, revert unknown Basecamp commits, or auto-resolve conflicts by choosing ours/theirs.

Do not merge main every few minutes. At a sensible checkpoint:
1. fetch latest main;
2. inspect commits since your start;
3. identify parallel Basecamp changes;
4. compare changed paths;
5. integrate current main deliberately;
6. resolve conflicts semantically;
7. inspect especially package/dependency files, CLAUDE.md/ledgers, shared config, API/router files, migrations and verification registries;
8. rerun focused and broad gates;
9. report overlap.

If main materially invalidates your work, integrate sooner.

AT COMPLETION DO NOT SELF-MERGE.

Fetch latest main, integrate it into your branch, resolve conflicts, run harness gates and broad repo gates, inspect migration/dependency/UI overlap, push final branch, then STOP.

Report:
Starting main SHA
Latest main SHA integrated
Shadow Grant branch
Final branch SHA
Commits
Migrations added
Production deployments performed
Shared files changed
Files overlapping Basecamp/UI work
Focused gates
Broad gates
Safe to merge: YES / NO / WITH CONDITIONS

Grant will decide merge order.

============================================================
22. DELIVERABLES
============================================================

Aim for:
1. permanent human-simulation harness;
2. versioned Grant-like profile;
3. extensible persona mechanism;
4. compositional generator;
5. ~50 goal families or equivalent breadth;
6. linguistic mutation;
7. multi-turn simulator;
8. deterministic canonical oracle;
9. independent semantic judge;
10. preference/continuity suite;
11. development corpus;
12. frozen held-out corpus;
13. fresh seeded generation;
14. Shadow Grant mode;
15. evaluator sabotage controls;
16. leak/cleanup protection;
17. real-world failure intake;
18. cost/latency instrumentation;
19. human-readable report;
20. honest baseline;
21. documented commands for continuous use.

============================================================
23. SUCCESS CRITERIA
============================================================

SUCCESS IS NOT “ALL GREEN”.

Success means varied human interactions; hidden intent cannot leak; exact wording is not the architecture; multi-turn corrections/cancellations work as tests; preference continuity is exercised end-to-end; voice-note messiness is exercised; canonical reality outranks prose; judging is independent; hard failures stay visible; sabotage proves discrimination; failures reproduce; unavailable capabilities can be honestly declined; baseline discovers weaknesses we did not hand-author; future capabilities can immediately face human-like pressure; and this branch remains safely integrable with simultaneous Basecamp work.

============================================================
24. AUTONOMOUS EXECUTION
============================================================

Persist this mission through compaction.

Do not stop after design, first generator, benchmark, green run, red run, progress update or commit.

Continue through repository-specific design → smallest trustworthy vertical simulator → deterministic oracles → judge separation → preference testing → multi-turn simulation → sabotage → held-out freeze → baseline → Shadow Grant → documentation → latest-main integration check → final branch-readiness report.

Progress updates to Grant should be plain English: what human behaviour is now simulated, what surprising thing failed, whether product or harness was wrong, whether anything dangerous/false happened, and what comes next. Then CONTINUE.

Do not ask Grant ordinary engineering questions.
Do not merge to main.
Do not deploy over the parallel Basecamp workstream.


============================================================
25. 11-HOUR UNATTENDED EXECUTION PROTOCOL
============================================================

Grant intends this to be an approximately ELEVEN-HOUR unattended autonomous run. Treat the time budget as permission to continue useful work, not as a requirement to waste time. Claude Code Cloud/platform limits may still terminate a task; within the running session, however, do not voluntarily hand control back merely because a milestone was reached.

DO NOT STOP for: progress reports; green gates; a commit; a deployment; completion of one phase; a surprising failure; an ordinary design choice; model variance; one unavailable provider; one missing credential; one blocked scenario; remote main advancing; or an item requiring human input when other independent work remains.

When a decision is ambiguous, choose the safest reversible option consistent with repository architecture, record it, and continue. Ask Grant only when an irreversible/high-impact decision truly cannot be made safely. Even then, mark that item HUMAN_BLOCKED with the exact question and continue all independent work. One blocked item must never block the whole mission.

Failure policy:
- Test failure: investigate, reproduce, classify, fix harness defects, and continue.
- Provider/model failure: bounded retry; permitted fallback if available; otherwise classify that path blocked and continue elsewhere.
- Missing credential: block only the affected integration proof; use safe local/canonical coverage where possible; continue.
- Missing production capability: record/verify honest decline; do not build it merely for score.
- Flaky/noisy test: characterize with bounded repetitions; preserve evidence; do not spend hours chasing statistical noise.
- Cost growth: enforce configurable budgets and shift toward deterministic/fresh seeded coverage rather than stopping.
- Production access unsafe: use fixtures/canonical paths; do not wait for Grant.
- Git conflict with parallel Basecamp work: resolve only when semantically safe; otherwise isolate/report the conflicting integration item and continue all non-conflicting work.

REMOTE MAIN POLICY:
Do not pause merely because `main` advances while the Basecamp Claude works. Do not repeatedly rebase/merge just to stay current. Continue from the established base unless a main change is actually required for this mission. At the final integration-readiness phase, fetch and inspect current main, understand the other workstream's changes, then integrate safely if appropriate. Grant's presence is not required merely because main moved.

ANTI-RABBIT-HOLE PACING GUIDE (approximate, not rigid):
- Hours 0–2: repository mapping, durable ledger, harness foundations, smallest trustworthy vertical simulation proof.
- Hours 2–4: compositional generator, linguistic mutation, multi-turn behaviour, preference continuity.
- Hours 4–6: deterministic canonical/effect oracles, independent semantic judge, hidden-intent isolation, sabotage/false-green proofs.
- Hours 6–8: development + frozen held-out + fresh seeded corpora, Shadow Grant mode, safe channel-shape coverage.
- Hours 8–9.5: honest behavioural baseline, failure-family clustering, real-world failure intake, only clearly systemic production fixes.
- Hours 9.5–10.5: fresh/adversarial/repeat runs, preference and correction stress, adapter transformations, variance/cost/latency analysis, hardening.
- Final ~30 minutes: fetch latest main, integration-readiness reconciliation, focused + broad gates, leak/secret/migration checks, documentation, final push of YOUR branch, concise final report.

If the planned implementation finishes early, DO NOT stop. Spend the remaining useful run budget on high-value fresh generated scenarios, new seeds, multi-turn Shadow Grant sessions, preference continuity, cancellation/correction cases, safe Telegram/Slack/Team-HQ adapter transformations, evaluator sabotage, false-promise detection, failure clustering, harness hardening, reproducibility, cost/latency characterization and documentation. Do not manufacture low-value work solely to consume time.

Progress updates are informational only. After sending one, continue immediately unless the Cloud execution environment itself ends the task.

A progress report is not completion. A green suite is not completion. A commit is not completion. A phase boundary is not completion. The autonomous run ends only when the useful 11-hour budget is nearly exhausted, the mission's Definition of Success is genuinely met with no higher-value independent work remaining, or the Cloud platform itself terminates execution.

At the end, DO NOT merge to main. Push the completed Shadow Grant branch and provide the integration-readiness report specified above.

BEGIN NOW.
```
