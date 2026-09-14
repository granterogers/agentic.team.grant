# Agentic Team — Pre-Human Backend Acceptance & Full-System Stress Test

> **Verbatim.** Grant supplied this on 14 September 2026 as
> `agentic_team_pre_human_backend_acceptance.html`. The markup is converted;
> **every word is kept**, per CLAUDE.md's rule about requirements documents and
> per the specification's own *PERSIST THIS SPECIFICATION BEFORE IMPLEMENTATION*
> section, which asks for exactly this before any other work.
>
> **This is the canonical backend acceptance standard.** Its counterpart for the
> front end is `docs/spec/ux-qa-governance-2026-09-14.md`. Backend readiness
> comes first: the document's closing lines are *"BACKEND READINESS FIRST.
> HUMAN TESTING SECOND."*
>
> Nothing below has been acted on yet. The specification requires a
> repository-grounded mapping — what exists, what partially exists, which Issue
> already covers each requirement, what is genuinely new — to be produced and
> presented **before** substantial backend implementation begins. That mapping
> is the next piece of work, and it is not in this file.

---

AGENTIC TEAM — PRE-HUMAN BACKEND ACCEPTANCE & FULL-SYSTEM STRESS TEST

PRIMARY OBJECTIVE

Before Grant begins substantial human testing of the Agentic Team, perform the deepest practical automated and agent-driven verification of the BACKEND and canonical system behaviour.

This is primarily a PRE-HUMAN BACKEND ACCEPTANCE programme, not a request to invent another QA framework.

The aim is to systematically exercise every meaningful existing backend capability through its real canonical path, create realistic fixture projects/tasks/messages/assets/workflows, independently verify resulting state, deliberately induce failures and edge cases, clean up all fixtures, and identify what must be fixed before Grant begins human testing.

Reuse and extend the existing verification infrastructure rather than duplicating it.

The purpose of this work is:

Exercise virtually everything the Agentic Team claims it can do, through the real execution paths, deliberately try to make it fail, independently verify the resulting state, and identify anything that should be fixed before human testing begins.

This is broader than adversarial prompt testing. It is a full pre-human acceptance test of the Agentic Team as a functioning system.

Success does NOT mean merely:
- unit tests pass;
- functions exist;
- handlers are registered;
- schemas look correct;
- mocks render;
- a tool reports itself as available;
- an isolated RPC returns successfully.

A capability should be considered genuinely verified only when, where safely possible:

exercise real operation → observe canonical execution → read resulting state back independently → test edge/failure cases → verify cleanup

PERSIST THIS SPECIFICATION BEFORE IMPLEMENTATION

This specification is intended to survive conversation compaction and future development sessions.

Before doing anything else:

1. Persist this entire specification VERBATIM in an appropriate durable repository document under docs/spec/ or the repository's existing equivalent. Preserve every substantive requirement. Do not condense it into a summary.
2. Commit and push that specification on its own before beginning implementation work, so it cannot be lost through conversation compaction.
3. Re-read the repository instructions, current handover, architecture, current branch/worktree, schema, tests, existing issues and active work.
4. Compare this specification against what already exists.
5. Produce a repository-grounded mapping showing what already exists, what partially exists, which existing issue covers each requirement, what genuinely new work remains, dependencies, sequencing, risks, and what should explicitly be deferred.
6. Consolidate into existing GitHub Issues wherever they already cover the underlying requirement. Do not create duplicates merely because this specification uses different wording.
7. Present the proposed epic/children/update mapping before beginning substantial backend implementation.

No broad backend rewrite should begin merely because this specification was supplied. The repository and its current working architecture remain the source of truth.

ESTABLISH THE ACTUAL CURRENT REPOSITORY STATE FIRST

Do not rely on counts, assumptions or descriptions from this conversation.

The repository has evolved quickly and different branches may contain substantially different verification infrastructure.

Before planning:
- identify the current branch/worktree;
- inspect main and relevant active development branches where appropriate;
- read CLAUDE.md;
- read HANDOVER/HANDOFF documentation;
- inspect package.json;
- inspect migrations;
- inspect scripts/verify;
- inspect existing test directories;
- inspect existing evaluation infrastructure;
- inspect current open Issues and epics;
- inspect recently resolved QA defects;
- inspect current active development dependencies.

Establish exactly what testing infrastructure exists NOW. Do not assume an approximate number of verify:* suites is accurate. Do not accidentally design work against an older main branch if the active development branch already contains newer verification infrastructure.

DO NOT BUILD ANOTHER TESTING ARCHITECTURE

The repository already contains extensive verification infrastructure. Before making changes, inspect and reuse what exists.

In particular inspect where present:
- Issue #41;
- Issue #169;
- Issue #171;
- Issue #201;
- scripts/e2e.ts;
- existing verify:* suites;
- npm run eval;
- verify:cross-interface;
- verify:equivalence;
- verify:chaos;
- verify:boundary;
- verify:corpus;
- verify:failures;
- verify:tasks;
- verify:assets;
- verify:delegation;
- verify:knows;
- verify:capability;
- verify:history;
- verify:transport;
- verify:channels;
- verify:search;
- verify:graph;
- verify:portfolio;
- fixture and cleanup mechanisms;
- job traces and routing decisions;
- eval cases/runs/scores;
- failure signatures;
- existing telemetry and provenance.

Extend existing mechanisms.

Do NOT create another evaluator, capability registry, job system, test transport, telemetry layer, skill/tool model, or parallel persistence model.

Before introducing any new abstraction named Skill, Capability, Tool, Plugin, Action, Integration, Agent, Workflow, Task, Evaluator, Harness, Registry or similar, determine whether the repository already has an equivalent concept. Prefer extending the existing coherent model. Do not create an ontology project.

PHASE 1 — BUILD A BACKEND CAPABILITY COVERAGE MATRIX

First determine what the current system actually claims to support. Derive this from the repository rather than from assumptions.

Inspect handlers, jobs, tools, skills, staff capabilities, integrations, public RPCs, project operations, task operations, asset/document operations, search, graph relations, communications, conversation history, permissions, approvals, undo, recurring duties, external connectors, generation capabilities, routing, delegation, learning, capability proposals, recovery mechanisms, and user-facing controls whose behaviour ultimately depends on backend state.

Build or update a durable capability-coverage record. For every capability record:
- Capability — what the system claims it can do
- Existing test(s) — which suites currently exercise it
- Execution path — real canonical route
- Persistence/result — what should change if successful
- Independent verification — how success is read back
- Failure tests — what should go wrong safely
- Cleanup — how fixture state is removed/retired
- Coverage — Full / Partial / Superficial / None
- Human-only — whether genuine automation is impossible

Do not create a second capability architecture merely to hold this information. Use existing repository/backlog/test documentation mechanisms wherever possible. The purpose of the matrix is to expose untested behaviour, not to create bureaucracy.

CORE ACCEPTANCE RULE — PROVE THE CAPABILITY BY USING IT

Where safe, do not test merely by calling the lowest-level function. Perform the actual operation through the closest practical equivalent of the path Grant will ultimately depend on.

If testing project creation: request/create a fixture project through the real supported path; confirm canonical rows; confirm aliases/dependent state; resolve it again; rename it; verify old/new-name behaviour; attempt duplicate and near-match creation; test archive behaviour; verify cleanup.

If testing tasks: create a fixture task through the supported write path; read it through the same reader the application uses; modify it; assign it; move it through valid states; attempt invalid transitions; confirm portfolio/project aggregation; verify dates/provenance; clean it up.

If testing agent work: inject a realistic instruction; observe the job; inspect routing; inspect recipient agent; inspect consultations/handoffs; inspect tools invoked; inspect resulting output; verify provenance; verify conversation result; verify the office did not claim anything it did not actually do.

General rule: Test the behaviour Grant will depend upon, not merely the mechanism implementing it.

For every declared capability in the system, prove it by exercising the real user-facing or canonical execution path, then verify the resulting state independently. A capability is not considered tested merely because its function exists, its handler can be called, or a unit test passes.

Where safe, tests should perform the actual operation: create the project, create the task, send the simulated message, invoke the tool, generate the asset, change the state, retrieve it again, and verify the outcome.

PHASE 2 — EXERCISE EVERY MAJOR BACKEND DOMAIN

Systematically cover every meaningful current backend domain discovered during the inventory, including but not limited to the following.

PROJECTS: creation; required confirmation; exact/near duplicates; aliases; natural-language resolution; rename; archive; switching; similar names; isolation; references; attached integrations; fixtures; cleanup.

TASKS: create; edit; assignment to Grant/agent; states; waiting/blocked; completion; due dates; priority/dependencies where supported; invalid transitions; job/project relationships; portfolio/project aggregation; fixture isolation; duplicates; stale/overdue behaviour.

DOCUMENTS / ASSETS: create/upload fixture asset; source-origin and agent-generated assets; provenance; tags; categories; collections; multiple collections without duplication; relationships; review states; approval/import; archive; retrieval; searchability; invalid relationships; duplicate imports; malformed/empty files where safely practical. Verify graph from both directions.

PROJECT GRAPH: exercise Task→Document, Task→Agent, Task→Contact, Document→Agent, Document→Source, Agent→Job, Job→Input, Job→Output and other supported relations. Create actual fixture relationships and query them back from both sides.

SEARCH: plant known fixtures; query exact wording, partial wording, natural language, misspellings, project-scoped, cross-project, related-agent/contact/source, ambiguous names. Verify relevance and isolation.

CONVERSATION: new conversation; follow-up; pronouns; corrections; changed mind; long/multi-clause messages; voice-transcript-style input; project switching; agent addressing; selected agents; whole team; multi-turn persistence; ordering; history; cross-project isolation. Use realistic Grant-style stream-of-consciousness transcripts.

ROUTING & DELEGATION: verify actual routing decision, recipient, reason, handoff, consultation, specialist selection, unnecessary-agent avoidance, output provenance, Chief of Staff coordination, only-chief-speaks where relevant. Test obvious specialist, multi-specialist, no-specialist, handoff, disagreement, poor specialist output. Do not accept output attribution as proof of delegation.

CAPABILITY SELF-KNOWLEDGE: ask agents what they can/cannot do. Test available, unavailable, permission-gated, temporarily unavailable, delegated, partially available capabilities. “I can't” when it can and “I can” when it cannot are both failures.

GITHUB: safe retrieval/search/file/issue and supported workflow operations; limitations; permissions; missing/revoked credentials. Never destructively test unrelated repositories.

GMAIL / MAIL: exercise what currently exists; reader; project relevance where supported; search/retrieval; safe messages; no-result; missing/expired permissions; evidence claims. Never claim Gmail was searched unless it was.

GOOGLE DRIVE: supported retrieval/search; project association; missing file; revoked permission; conflicting results; isolation.

NOTEBOOKLM / GOOGLE NOTEBOOK: use actual existing capability probing, not marketing assumptions. For every supported programmatic action execute safely, verify, record limitations, test unsupported actions and credential/provider failure. Map actual source discovery/retrieval/search/grounded Q&A/citations/cross-document synthesis/summaries/briefs/FAQs/reports/artifacts/source types/exports/content recovery/project linkage where supported. Browser-only functionality is not programmatic capability.

NOTION: safe read/write fixtures; page/block creation where supported; updates; source/project linkage; idempotency; cleanup/archive; malformed states; permissions; API assumptions.

SLACK: separate canonical behaviour from real transport. Simulate for volume; keep smaller real E2E set. Test inbound→canonical, canonical→outbound, project/channel mapping, threading, identity, duplicates, retries, loop prevention, failures, malformed events, cleanup. Leave no junk channels.

TELEGRAM: separate canonical simulation from limited real transport. Test inbound/outbound, identity, bot/chat scoping, only-Chief-speaks, duplicates, callbacks/buttons, transport failure, registration, malformed input, retries. Do not flood Grant's real Telegram.

VOICE / DICTATION: test everything safe without a human microphone: transcript→canonical instruction, editable dictation where implemented, transcript imperfections, long spoken requests, failure paths, typed equivalence. Clearly identify genuinely human-only microphone/session checks.

APPROVALS / PERMISSIONS / DESTRUCTIVE ACTIONS: attempt actions requiring confirmation/refusal and cases with missing permission/credentials, invalid state, wrong agent, stale/reused approval, destructive consequences. Refusals must occur for the correct reason; use positive/negative controls.

UNDO / RECOVERY: perform, verify, undo, verify restoration, repeat undo, stale/invalid undo. Verify honest statements for irreversible actions.

LEARNING / SKILLS / PROPOSALS: lesson creation/retrieval/scoping/retraction; fixture exclusion; skill availability; impediments; repeated impediments; proposal creation/deduplication; decline persistence; approval boundaries. Test learning must not leak into Grant's real governance view.

RECURRING DUTIES: test callable execution path where practical; due detection; execution; success/failure record; retry; duplicate prevention; disabled duties; stale detection. Do not re-enable GitHub Actions merely for this programme.

OTHER DISCOVERED CAPABILITIES: Phase 1 inventory is authoritative. If the repository exposes another meaningful backend capability, include it. Do not leave something untested merely because this prompt did not name it.

PHASE 3 — ADVERSARIAL INTELLIGENCE TESTING

Once normal capability paths have baseline coverage, actively try to break the intelligence using vague/contradictory instructions, typos, speech-to-text corruption, incomplete thoughts, long rambling instructions, multiple unrelated asks, similar project names, stale references, conflicting evidence, impossible asks, unavailable capabilities/models, missing credentials, corrections, agent disagreement, incorrect specialist output, misleading context, and requests designed to tempt bluffing.

HISTORICAL FAILURES MUST SEED THE CORPUS

Mine Issues, commits, CLAUDE.md traps and previous reports. Use real failure classes: fabricated claims of source/database access; silently dropped clauses; context loss; false capability denial/claims; nominal delegation; wrong project resolution; fixture contamination; duplicate ingestion; cross-interface duplication; transport retries; CORS tests hitting wrong request shape; green suites looking at wrong layer; dead controls; stale expectations; invisible fixtures; worker/test collisions; fixed source offsets/literal wording; order-dependence; cleanup reporting success without proof.

For each historical defect, generate nearby variations. Test the underlying invariant, not only the original wording.

BUILD AN ADVERSARIAL CONVERSATION CORPUS

Create realistic interactions: normal, vague, contradictory, incomplete, corrected midway, speech-to-text errors, typos, rambling voice notes, multiple asks, implicit references (“that”, “it”, “the other one”), project changes, prior-conversation references, multi-agent/tool tasks, cases requiring clarification, cases where clarification is unnecessary, impossible asks, unavailable capabilities, capability exists but agent may not know, mid-tool failure, conflicting sources, incorrect agent output, simultaneous projects. A significant proportion should resemble natural speech rather than benchmark prose.

TEST DIVERSE REAL-WORLD WORK

Attack the team across software, business, marketing, research, project management, connected knowledge and creation. Examples include repository analysis, bug diagnosis, architecture/feasibility, monetisation/pricing/customers/competitors/GTM, audience/positioning/campaigns/social critique, scientific investigation/source comparison/uncertainty, prioritisation/dependencies/blocked work/coordination, Notebook/project docs/email/Drive/GitHub synthesis, and supported report/document/image/website/project-asset creation. Test transfer across domains rather than rehearsed repo tasks.

CRITICAL ANTI-HALLUCINATION PROPERTY

Repeatedly try to induce claims such as “I checked/searched/read/queried/opened/found/created/sent/updated/confirmed” without corresponding action. Every such claim must correspond to recorded evidence. Missing evidence is a serious failure. Test database, GitHub, Gmail, Drive, Notebook, Notion, Slack, Telegram, web/research, project documents, tasks and assets.

Invariant: The office must never claim to have observed or performed something it did not actually observe or perform.

MULTI-CLAUSE ACCOUNTING

For long instructions identify each substantive clause. Every clause must end executed, explicitly planned, explicitly deferred, explicitly blocked, explicitly refused, or explicitly clarified. Nothing important may silently disappear. Generate realistic voice-note examples with 5–10 clauses.

MUTATION TESTING FOR INTELLIGENCE

Generate nearby variants of strong benchmark cases, especially project resolution, agent addressing, capability questions, multi-step instructions, memory, retrieval and delegation. Robust capability should survive reasonable wording variation.

FAILURE INJECTION

Deliberately inject/simulate timeout, 429, 401/403, 404, 500/502/503, malformed JSON, empty/partial response, unavailable model, invalid/revoked token, database refusal, conflicting state, duplicate webhook, process interruption, worker collision, stale state, clock/timing anomalies, rate limiting and tool-response corruption.

Verify failure recording, preservation of primary user input, bounded retries, deduplication, isolation of independent surfaces, no false success, recovery where intended, and honest failure otherwise.

TESTS MUST TEST THE RIGHT LAYER

For every important verification ask: “If the actual feature were removed or broken, would this test definitely fail?” If not, improve it.

Browser behaviour must be tested as browser behaviour including Origin/CORS. Public RPC behaviour must exercise the public route when clients do. Relevant controls must actually be pressed. Project operations should use canonical operation. Conversation tests should use canonical inbound command path. Transport equivalence is not delivery. Fixtures must be visible to the tested system. Cleanup must verify absence. Delegation tests must prove delegation occurred.

Where useful and safe, prove a test by temporarily reintroducing/simulating the defect and ensuring the test goes red. Do not change production behaviour merely to satisfy a bad test. Validate the test before changing production code.

FIXTURE HYGIENE IS PART OF THE TEST

For creating/destructive suites: identify prior debris; clean/retire safely; create uniquely attributable fixtures; execute; verify fixture marking where appropriate; clean/retire; independently verify cleanup.

Do not allow fixture projects, jobs, lessons, Slack channels, assets, tasks, conversations, contacts, proposals or notifications to pollute Grant's real views. Cleanup matching nothing is not automatically success. Harness-generated failures must not be reported as real office failures. Test traffic must remain distinguishable from production/user traffic.

BUILD TWO LEVELS OF BACKEND ACCEPTANCE

FAST READINESS GATE: a reasonably short repeated suite covering highest-value backend paths, severe regressions, persistence, isolation, routing/delegation, capability honesty, task/project operations, critical cheap integrations, fixture cleanup. Keep it fast enough to run routinely.

DEEP ACCEPTANCE SWEEP: use/extend existing resumable full-system E2E infrastructure. Dynamically enumerate actual suites where appropriate; batch; persist progress; survive interruption; report timeout/error/could-not-test separately; preserve failure evidence; avoid silently retrying red into green; protect later suites from timeout debris; expose order-dependence/flakiness/unrun suites. “Could not be tested” is never pass.

BEHAVIOURAL EVALUATION

Use the existing evaluator; do not create another judge. Expand its corpus with successful instructions, historical failures, multi-clause instructions, capability questions, project resolution, delegation, evidence claims, ambiguity and stream-of-consciousness requests. Keep deterministic verification separate from behavioural grading. A model score never substitutes for objective state assertions. Calibrate/test the evaluator and record model provenance.

SCORE BEHAVIOUR, NOT WORDING

Avoid brittle literal-string assertions. Prefer properties: correct project/agent, required tool actually called, unsupported action not claimed, all clauses accounted for, evidence corresponds to access, persistence occurred, no leakage/duplicate/loop, failure recorded, correct recovery, cleanup verified.

FAILURE TRIAGE

Classify meaningful failures: comprehension, planning, memory, project resolution, delegation, capability knowledge, missing skill/tool, retrieval, hallucination, grounding, permission, transport, model, infrastructure, persistence, isolation, cleanup, test defect, flaky/order-dependent test. Record reproducible evidence.

REGRESSION RULE

Every genuine defect discovered should eventually become a permanent regression test. Fix the underlying property, not merely the example:

historical failure → adversarial variants → discovered defect → root-cause fix → permanent regression case

GITHUB DEFECT MANAGEMENT

Do not create hundreds of issues. Validate the test, reproduce, determine root cause, search existing Issues, attach evidence to existing Issue where appropriate, create a new Issue only for genuinely distinct root cause, and add permanent regression coverage after repair. Group variants by cause. Issues must stand alone without this conversation. The repository remains durable project memory.

DO NOT IMMEDIATELY REBUILD THE PRODUCT

Distinguish:
DEFECT — existing behaviour broken/invariant violated: fix incrementally.
COVERAGE GAP — exists but insufficiently tested: improve verification.
CAPABILITY GAP — genuinely cannot do useful work: record/propose via existing mechanisms/backlog.
FUTURE FEATURE — useful but not needed for backend readiness: capture and defer.

Backend readiness must not become uncontrolled feature expansion.

DEVELOPMENT SAFETY

Evolve, do not replace. No broad rewrites, unnecessary dependencies, destructive DB migrations merely for QA, removal of working functionality without necessity, weakened security/permissions, secrets, competing abstractions, giant unrelated commits, or architecture replacement for style.

For significant changes: inspect → understand invariant → smallest useful change → test → verify → commit → document → continue.

Keep active development/dependency chain in view. Do not derail unrelated work. Use fixture scoping/isolated modules/feature flags where appropriate. Redesign any test that could damage real data/services/channels before running it.

COST AND RUNTIME

Preserve low/approximately-zero-cost operation. Do not enable paid/recurring infrastructure merely for QA. Prefer deterministic local checks, existing free-model routing, fixture simulation, limited real transport E2E, resumable deep runs, small fast gates and existing telemetry. Measure wall time, inference/model use, external API use where practical and flaky rate. Avoid hundreds of expensive model cases after every tiny change.

BACKEND READINESS REPORT

At the end of the deep acceptance pass produce one concise durable report.

OVERALL STATUS: GREEN / ORANGE / RED.
GREEN: no known severe backend defect remains in exercised core capabilities; human testing reasonable.
ORANGE: core mostly works but meaningful defects/untested areas remain; human testing possible with known limitations.
RED: severe correctness, persistence, isolation, hallucination, security, delegation or reliability defects remain; fix before human testing.

COVERAGE: total meaningful capabilities; fully exercised; partially exercised; superficial; not tested; human-only.

TEST EXECUTION: suites discovered/attempted/passed/failed/timed out/could-not-run/not-attempted; behavioural/adversarial/mutation cases; wall time; approximate inference/cost where measurable.

FINDINGS: severe defects; ordinary defects; flaky/non-deterministic behaviour; test-suite defects; coverage gaps; capability gaps; external/provider limitations; human-only verification.

HUMAN-TESTING HANDOFF

Explicitly list only what genuinely cannot be proven automatically and therefore needs Grant, such as subjective voice quality, real microphone UX, conversational naturalness, visual taste/usability, notification feel and subjective latency tolerance. Do not push mechanically testable backend verification onto Grant.

MOST IMPORTANT QUESTION

Finish by answering plainly:

“Is the backend sufficiently trustworthy to begin human testing, and what are the remaining reasons not to trust it?”

Do not answer yes merely because existing suites are green. Base the answer on what was genuinely exercised.

CONTINUOUS IDEA / BACKLOG PRESERVATION

If this work reveals useful future ideas not necessary for backend readiness: understand; inspect overlap; consolidate rather than duplicate; capture durably; connect to relevant epic/issue; defer where appropriate; preserve context; do not derail readiness work. Grant should be able to supply ideas without worrying about compaction, but idea capture must not become uncontrolled implementation.

FINAL PRINCIPLE

DO NOT MERELY INSPECT THE AGENTIC TEAM. USE IT.

Create the fixture project.
Create the task.
Update the task.
Assign it.
Send the message.
Send the rambling message.
Switch the project.
Switch to a similarly named project.
Delegate the work.
Verify the delegation actually happened.
Invoke the integration.
Search the source.
Create the asset.
Link the asset.
Retrieve it again.
Break the API.
Remove the credential in a safe simulated/fixture context.
Return malformed data.
Retry it.
Undo it.
Read the state back.
Try the wrong permission.
Try the duplicate.
Try the ambiguous request.
Try the contradictory request.
Try the long voice transcript.
Try to make it hallucinate.
Try to make it claim work it never performed.
Try to make two agents disagree.
Try to make it select the wrong project.
Try to make it forget what was said earlier.
Try to make it silently drop the fourth instruction in a six-part request.
Try to make it confuse test traffic with real office traffic.
Then clean everything up and prove the cleanup worked.

A suite that exists but has never been run is not evidence.
A test that passes against the wrong layer is not evidence.
A cleanup command that exits zero without proving removal is not evidence.
A model saying an answer looks good is not evidence when canonical state can be inspected.
A claimed action without recorded execution is a failure.

The purpose is to discover as much as possible BEFORE Grant becomes the test harness.

BACKEND READINESS FIRST.
HUMAN TESTING SECOND.
