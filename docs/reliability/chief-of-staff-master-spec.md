# Chief of Staff Reliability — Master Specification (source record)

> **Source status — read first.** This file holds the **execution-control specification** exactly as supplied in the
> session that started this mission (verbatim, below the line). The brief also referred to a *consolidated master prompt*
> and an *original Telegram incident transcript*. **Neither was present in the supplied material**, and neither is in
> `main` or any other branch. They have NOT been reconstructed here. They are recorded as a blocker in
> `chief-of-staff-decisions.md` (DEC-002) and in the epic. When they are committed, add them as
> `chief-of-staff-master-spec-consolidated.md` and `chief-of-staff-incident.md` and update DEC-002.
>
> Canonical requirement list: `chief-of-staff-requirements.md`. Where this file and the register disagree, the register
> records the topic and this file is the source text.

---

## Verbatim source: execution-control specification

MANDATORY EXECUTION CONTROL — PERSISTENT REQUIREMENTS, TRAFFIC-LIGHT TRACKING & FULL AUTONOMY

1. NON-NEGOTIABLE INSTRUCTION

You have full authorisation to investigate, plan, implement, refactor, test, create or update GitHub issues, create branches, commit, push development branches, run safe development and staging verification, and perform all other necessary non-production engineering work to complete this mission.

You must NOT:

1. Merge any branch or pull request.
2. Push directly to the production branch.
3. Deploy to production.
4. Execute production database migrations.
5. Modify live production configuration, secrets, or feature flags.
6. Carry out destructive production operations.

These are the only project-level execution restrictions imposed by this instruction. Continue to respect security controls, third-party authorisation requirements, data privacy, and spending constraints. Do not interpret broad engineering authorisation as permission to bypass them.

Do not request routine confirmation, technical decisions, agent assignments, prioritisation, or permission to continue.

Make sound engineering decisions autonomously and document them.

If a genuinely prohibited operation is required, record it as blocked and continue every independent activity.

The objective is complete, tested, reviewable engineering work—not another plan requiring user management.

⸻

2. PERMANENT SOURCE OF TRUTH

Before implementation, create a persistent GitHub epic containing the complete original master prompt, the original Telegram incident transcript, the autonomous delegation addition, and this execution-control specification.

This epic is the authoritative mission specification.

Do not summarise away requirements.

Do not rely on the current Claude conversation, temporary memory, scratchpad, or compaction summaries to preserve requirements.

The original requirements must survive:

* Context compaction
* Claude session restarts
* Worker or agent restarts
* Model changes
* Agent delegation
* Branch changes
* Long autonomous execution
* Handoffs between specialists

Create a version-controlled requirements register in the repository, for example:

docs/reliability/chief-of-staff-requirements.md

Also create:

docs/reliability/chief-of-staff-progress.md

docs/reliability/chief-of-staff-test-matrix.md

docs/reliability/chief-of-staff-decisions.md

Use repository conventions if equivalent files already exist.

The GitHub epic and repository files must reference each other.

Do not create conflicting independent sources of truth. Treat the numbered requirements register as canonical and maintain mirrored status records consistently.

⸻

3. EXHAUSTIVE REQUIREMENT ENUMERATION

Extract every individual requirement from the full master prompt and subsequent additions.

Assign each requirement a permanent ID.

Use hierarchical numbering:

* COS-001 — Objective intake and persistence
* COS-002 — Voice transcription and traceability
* COS-003 — Objective decomposition
* COS-004 — Durable agent ownership
* COS-005 — Automatic specialist assignment
* COS-006 — Automatic reassignment and recovery
* COS-007 — Approval identity and persistence
* COS-008 — Approval callback processing
* COS-009 — Duplicate approval suppression
* COS-010 — Backup-model approval compatibility

Continue until every requirement is individually represented.

The examples above are not the complete list.

You must enumerate all requirements covering:

1. Telegram ingress and voice transcription
2. Objective creation and persistence
3. Decomposition and planning
4. Automatic internal agent assignment
5. Chief of Staff accountability
6. Human versus agent task ownership
7. Specialist delegation and collaboration
8. Agent workload and capability routing
9. Failed assignment recovery
10. Approval state machines
11. Telegram approval callbacks
12. Duplicate approval prevention
13. Approval persistence across restarts
14. Approval-to-execution continuation
15. Backup-model trust policies
16. User autonomy settings
17. Action-level risk classification
18. Safe autonomous execution
19. Objective lifecycle states
20. Worker heartbeats and leases
21. Stalled-job detection
22. Retry and idempotency
23. Duplicate objective detection
24. Existing-run continuation
25. Natural-language Gmail discovery
26. Sent and received thread matching
27. Gmail pagination and deduplication
28. Email fact extraction
29. Source provenance
30. Missing data and uncertainty
31. Notion workspace discovery
32. Default project destinations
33. Artifact creation and persistence
34. Artifact verification
35. Accommodation comparison documents
36. Contact correspondence summaries
37. Prices and currency handling
38. Confirmed versus unknown availability
39. Automatic follow-up task creation
40. Draft reply preparation
41. External action authorisation
42. Partial results and recovery
43. Truthful execution status
44. Progress-report accuracy
45. Human-friction minimisation
46. Recovery from repeated approval requests
47. Chief of Staff escalation behavior
48. Unified Activity Ledger integration
49. Security and least privilege
50. Regression testing
51. End-to-end incident simulation
52. Model failover testing
53. Operational observability
54. Production safety
55. GitHub issue tracking
56. Documentation and handoffs
57. Release readiness
58. Final verification

Then continue to enumerate any additional subrequirements, edge cases, acceptance criteria or safeguards from the source prompt.

Do not collapse several independently testable requirements into one broad requirement.

Every requirement must have:

* Permanent ID
* Exact requirement
* Source section
* Priority
* Owner
* Current traffic-light status
* Evidence or implementation reference
* Verification method
* Test reference
* Outstanding blocker, if any

A requirement cannot disappear from the register because implementation is inconvenient or because Claude decides it is out of scope.

If something is genuinely inapplicable, explicitly record the reason and supporting evidence.

⸻

4. TRAFFIC-LIGHT STATUS SYSTEM

Use the following statuses consistently.

🟢 GREEN — Verified complete

Implementation exists, appropriate tests have passed, and supporting evidence is recorded.

🟡 AMBER — In progress or incomplete

Investigation, implementation or testing remains outstanding. Work may have started or be partially verified.

🔴 RED — Failed or blocked

A known defect, failing acceptance test, unresolved critical dependency, or blocker prevents completion.

⚪ GREY — Not started

Requirement is registered but work has not begun.

A requirement cannot become GREEN because an agent claims it has finished.

GREEN requires verifiable evidence.

If regression tests subsequently fail, automatically downgrade the requirement.

Production deployment is not required for GREEN when the defined acceptance criterion concerns local or staging verification. Record production verification separately as pending.

⸻

5. COMPLETE TRACKING IN EVERY PROGRESS REPORT

At every progress checkpoint:

1. Re-read the canonical requirements register.
2. Reconcile all requirement IDs.
3. Confirm none have disappeared.
4. Update status for every requirement.
5. Record test and implementation evidence.
6. Identify regressions.
7. Update the persistent progress file.
8. Update the GitHub epic or linked tracking records.
9. Commit and push persistent progress changes to the development branch.
10. Only then publish a concise user-facing status.

Every progress report must account for every requirement ID.

To keep output minimal, store the full requirement-by-requirement status in the persistent GitHub and repository records. Do not print the entire register to the terminal on every update.

Each report must include a link or file reference to the full current register and a compact numerical reconciliation.

The sum of GREEN, AMBER, RED and GREY must equal the total number of registered requirements.

No missing, duplicated or orphaned IDs are permitted.

Implement an automated checker that validates this reconciliation.

⸻

6. MINIMAL CLAUDE OUTPUT

Keep conversational and terminal output extremely brief.

Do not produce long commentary, repetitive explanations, or intermediate essays.

Use this format:

Chief of Staff Reliability — Progress

🟢 34 | 🟡 17 | 🔴 3 | ⚪ 42 — Total 96/96 tracked

Completed: Approval persistence; duplicate callback handling.

Working: Automatic delegation; worker recovery.

Blocked: 3 requirements, details in register.

Next: Integration tests and Canary scenario.

Record: GitHub epic / commit SHA.

The numbers above are illustrative.

Only report actual counts.

Output a progress report when:

* A meaningful implementation milestone completes
* A major blocker appears
* A significant regression is discovered
* A test phase completes
* The final deliverable is ready

Do not emit a status message after every file read, tool call or small code edit.

Do not ask "shall I continue?"

Continue automatically.

⸻

7. AUTONOMOUS WORK CONTINUATION

After every completed action, select the next highest-priority unblocked requirement.

Continue until all requirements are GREEN or the remaining requirements are genuinely blocked by restrictions that cannot be resolved autonomously.

If an individual approach fails:

1. Diagnose the failure.
2. Try an appropriate safe alternative.
3. Add a regression test where applicable.
4. Preserve evidence.
5. Update the requirement status.
6. Continue.

Do not repeatedly execute the same failing action without new evidence or a changed recovery strategy.

Do not abandon the mission because one agent, tool, test or integration is unavailable.

Delegate specialist work automatically.

Do not ask Grant which agent should perform ordinary engineering work.

Do not assign technical coordination responsibilities back to Grant.

Use GitHub as the durable continuation mechanism.

Before any new session or after context compaction, reload:

1. The epic.
2. The requirements register.
3. The progress register.
4. The decision log.
5. The test matrix.
6. The current branch and Git status.

Resume from persisted evidence, not reconstructed conversational memory.

⸻

8. AUTOMATED COMPLETENESS AUDIT

Create a script or equivalent automated validation that checks:

* Every source requirement has a stable ID.
* Every ID has exactly one current status.
* Every ID has an owner.
* Every GREEN item has evidence.
* Every GREEN item has an appropriate passing verification reference.
* Every RED item has a documented failure or blocker.
* Every status change has an auditable basis.
* No requirement was silently deleted.
* No item was marked inapplicable without justification.
* Parent requirements cannot be considered complete while mandatory children remain incomplete.
* The progress totals reconcile exactly.

Run this validator at every major milestone and before final reporting.

A failing completeness audit blocks any claim of overall completion.

⸻

9. FINAL ACCEPTANCE GATE

Before reporting the engineering work complete:

1. Re-read the original incident transcript.
2. Re-read the complete master prompt.
3. Re-read the autonomous assignment addition.
4. Re-read this execution-control specification.
5. Verify the register covers all requirements.
6. Run the completeness audit.
7. Run the required regression and integration tests.
8. Verify the Canary Coworking incident simulation.
9. Verify approval-loop recovery.
10. Verify automatic task delegation.
11. Verify truthful Chief of Staff progress reporting.
12. Verify artifact creation and persistence.
13. Verify security and autonomy boundaries.
14. Confirm the development branch is pushed.
15. Confirm no merge occurred.
16. Confirm no production deployment or migration occurred.

Produce the final report in the same concise traffic-light format.

Include links to:

* GitHub epic
* Requirements register
* Test evidence
* Pull request, if created
* Final development commit

Any unfinished requirement must remain visibly AMBER or RED.

Do not report the project as complete while mandatory items remain unverified.

⸻

10. ULTIMATE DIRECTIVE

Operate as an autonomous engineering organisation with persistent requirements, not as a conversational assistant that forgets its assignment.

Every requirement must be:

Captured → Numbered → Assigned → Implemented → Tested → Verified → Persisted → Reported

No requirement may silently disappear.

No completed requirement may become unverifiable.

No agent may hand ordinary coordination work back to the user.

No repeated permission-seeking for already-authorised work.

No fabricated completion.

No untracked failures.

No merge or production push/deployment.

Continue autonomously until the entire authorised engineering mission is implemented, verified, and ready for final human review.
