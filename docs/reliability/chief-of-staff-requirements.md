# Chief of Staff Reliability — Requirements Register (CANONICAL)

**Epic:** https://github.com/granterogers/agentic.team.grant/issues/476
**Authoritative source:** `docs/reliability/chief-of-staff-master-spec-consolidated.md` (supplied 15 October 2026, resume instruction)
**Original incident evidence:** `docs/reliability/chief-of-staff-incident.md`
**Historical source:** `docs/reliability/chief-of-staff-master-spec.md` (execution-control specification, retained as evidence)
**Mirrors:** `chief-of-staff-progress.md` (totals), `chief-of-staff-test-matrix.md`, `chief-of-staff-decisions.md`
**Baseline:** `b0b006f6` on `claude/chief-of-staff-reliability`

Consolidated specification SHA-256: 361400a828f41dbd38bb1db3a53767558c4db7e532745248c0a4d5d861fce87f
Incident transcript SHA-256: 7316aa801fba01227da8453bdb92f9ae0e0fdbe26fffcb1ebb6cbd2d4b29f0b8
Historical execution-control specification SHA-256: 18a98bd9a967ae52763fcfb58aa79b6ddb3cc9d4f0d846f691cecbda3fdd55b7

This is the only canonical status list. Progress totals and the epic must match it. Check with `npm run check:reliability`.

Status values: `🟢 GREEN`, `🟡 AMBER`, `🔴 RED`, `⚪ GREY`. Only these are valid.

**Numbering rules (DEC-004):** IDs are permanent. No ID is renumbered. A withdrawn requirement stays with status and reason.
ECS = execution-control rules; COS = Chief of Staff requirements; REG = mandatory regression tests (§25).

**Remapping recorded (DEC-006):** the first draft registered the execution-control spec §3 topics as COS-011 to COS-068. Those IDs are kept unchanged. The consolidated specification adds COS-069 to COS-146 and ECS-021 to ECS-038, and REG-001 to REG-045. No earlier ID changed meaning.

## A. Execution-control rules (ECS)

| ID | Requirement | Source | Priority | Owner | Status | Evidence / reference | Verification | Test ref | Blocker |
|---|---|---|---|---|---|---|---|---|---|
| ECS-001 | Do not merge any branch or pull request | Consolidated §5 restrictions 1; historical §1.1 | P0 | Lead (Claude) | 🟡 AMBER | Work on `claude/chief-of-staff-reliability`; no merge performed | Process; `git log main` unchanged | TM-010 | Needs a repository guard |
| ECS-002 | Do not push directly to `main` or any production branch | Consolidated §5 restrictions 2; historical §1.2 | P0 | Lead (Claude) | 🟡 AMBER | Branch created from `main`; `main` not modified | Process; pushes target only the development branch | TM-010 | Needs a repository guard |
| ECS-003 | Do not deploy to production | Consolidated §5 restrictions 3; historical §1.3 | P0 | Lead (Claude) | 🟡 AMBER | No deploy command run | Process | TM-010 | Needs a repository guard |
| ECS-004 | Do not apply production database migrations | Consolidated §5 restrictions 4; historical §1.4 | P0 | Lead (Claude) | 🟡 AMBER | No migrate command run | Process | TM-010 | Needs a repository guard |
| ECS-005 | Do not change live production configuration, secrets or feature flags | Consolidated §5 restrictions 5; historical §1.5 | P0 | Lead (Claude) | 🟡 AMBER | None changed | Process | TM-010 | Needs a repository guard |
| ECS-006 | Do not perform destructive production operations | Consolidated §5 restrictions 6; historical §1.6 | P0 | Lead (Claude) | 🟡 AMBER | None run | Process | TM-010 | Needs a repository guard |
| ECS-007 | A blocked prohibited operation is recorded as blocked while independent work continues | Historical §1; consolidated §5 | P0 | Lead (Claude) | 🟡 AMBER | DEC-002 and DEC-005 record blocks; work continues | Review of decisions log | TM-011 | — |
| ECS-008 | A persistent GitHub epic containing the source documents exists before implementation | Historical §2; consolidated §6 | P0 | Lead (Claude) | 🟡 AMBER | Epic #476 links the sources | `check:reliability` checks the epic link | TM-004 | Epic body must be updated to link the consolidated spec and incident file |
| ECS-009 | Register, progress, test matrix and decisions files reference the epic and each other | Historical §2 | P0 | Lead (Claude) | 🟡 AMBER | Cross-references in each file header | Review | TM-004 | — |
| ECS-010 | One canonical register; mirrored status records stay consistent | Historical §2; consolidated §8 | P0 | Lead (Claude) | 🟢 GREEN | Validator reconciles progress totals against the register | `npm run check:reliability` | TM-001, TM-002 | — |
| ECS-011 | Only the four traffic-light statuses are used | Historical §4; consolidated §8 | P0 | Lead (Claude) | 🟢 GREEN | Validator rejects any other status | `npm run check:reliability` | TM-002, TM-003 | — |
| ECS-012 | A GREEN item is downgraded automatically when a regression test fails | Historical §4; consolidated §8 | P0 | Lead (Claude) | 🟡 AMBER | Process only | Needs a test-to-requirement mapping | TM-012 | Mapping not built |
| ECS-013 | Production verification is recorded separately as pending and does not block local GREEN | Historical §4; consolidated §8 | P1 | Lead (Claude) | 🟡 AMBER | Progress file production section | Review | TM-013 | — |
| ECS-014 | Checkpoint order: re-read register, reconcile, update status, record evidence, update progress and epic, commit and push, then report | Historical §5; consolidated §30 | P0 | Lead (Claude) | 🟡 AMBER | Followed at this checkpoint | Review of commit sequence | TM-014 | — |
| ECS-015 | Terminal output is minimal and uses the specified progress format | Historical §6; consolidated §9 | P1 | Lead (Claude) | 🟡 AMBER | Progress format in reports | Review | TM-014 | — |
| ECS-016 | Automated checker validates register and progress reconciliation | Historical §5; consolidated §28 | P0 | Lead (Claude) | 🟢 GREEN | `scripts/reliability/check-register.mjs` via `npm run check:reliability` | Self-test plus live run | TM-001, TM-003 | Source-inventory checks to be added (see ECS-039) |
| ECS-017 | After compaction or restart, reload epic, register, progress, decisions, test matrix and git state before acting | Historical §7; consolidated §6 | P0 | Lead (Claude) | 🟡 AMBER | Reload order written in progress file | Review | TM-015 | — |
| ECS-018 | Completeness audit covers IDs, owners, GREEN evidence, RED blockers, justified inapplicability, totals and parent/child rules | Historical §8; consolidated §28 | P0 | Lead (Claude) | 🟡 AMBER | Validator covers IDs, owners, GREEN evidence, RED blockers, totals | `npm run check:reliability` | TM-001 to TM-003 | Parent/child rule and inapplicability checks not built |
| ECS-019 | Final acceptance gate run before any completion claim | Historical §9; consolidated §32 | P0 | Lead (Claude) | ⚪ GREY | Not started | Final gate | TM-016 | Requires COS work to complete |
| ECS-020 | A parent requirement cannot be complete while a mandatory child is incomplete | Historical §8; consolidated §8 | P0 | Lead (Claude) | 🟡 AMBER | Parent rows COS-135 and REG children defined; rule not yet enforced | Validator rule to add | TM-003 | Rule not yet implemented |
| ECS-021 | Production may be inspected only through authorised, non-destructive, resource-bounded access | Consolidated §5 | P0 | Lead (Claude) | 🟡 AMBER | No production read performed in this checkpoint | Process; log of any read | TM-010 | — |
| ECS-022 | Do not purchase services, use prohibited paid models, send external emails in tests, create real bookings or bypass approvals | Consolidated §5 | P0 | Lead (Claude) | 🟡 AMBER | None performed | Process; test fixtures use fakes | TM-010 | — |
| ECS-023 | The GitHub epic contains or links the unabridged master specification and original incident transcript | Consolidated §6 | P0 | Lead (Claude) | 🟡 AMBER | Epic links both files; epic body must be refreshed | Review of epic | TM-004 | Epic body refresh pending |
| ECS-024 | Single source of truth: no contradictory independent tracking systems | Consolidated §6 | P0 | Lead (Claude) | 🟡 AMBER | Register is canonical; mirrors cross-reference it | Review | TM-004 | — |
| ECS-025 | Every register entry carries all 11 required fields | Consolidated §7 | P0 | Lead (Claude) | 🟡 AMBER | Table has 10 columns, source in Source column; blocker in last column | Validator checks column count | TM-003 | Owner, priority and source checks to tighten |
| ECS-026 | Compound requirements are broken into individually verifiable requirements | Consolidated §7 | P0 | Lead (Claude) | 🟡 AMBER | COS-069 to COS-146 and REG-001 to REG-045 split the inventory | Review of traceability map | TM-001 | Coverage of the historical list still partial |
| ECS-027 | No requirement silently deleted, downgraded or forgotten; inapplicable items justified | Consolidated §7, §8 | P0 | Lead (Claude) | 🟡 AMBER | Traceability map covers all 76 inventory items and 45 regression items | Validator checks the map | TM-001 | — |
| ECS-028 | Do not print secrets, credentials or private email contents in reports or logs | Consolidated §27 | P0 | Lead (Claude) | 🟡 AMBER | Reports use IDs and counts | Review | TM-017 | — |
| ECS-029 | Do not weaken security, add broad test skips or erase historical data to make tests pass | Consolidated §27 | P0 | Lead (Claude) | 🟡 AMBER | Process | Review of diffs | TM-017 | — |
| ECS-030 | Validator runs at each milestone; failure blocks any completion claim | Consolidated §28 | P0 | Lead (Claude) | 🟡 AMBER | Run at this checkpoint | `npm run check:reliability` | TM-001 | — |
| ECS-031 | GitHub child issues carry requirement IDs, evidence, root cause, acceptance criteria, tests and status | Consolidated §31 | P1 | Lead (Claude) | ⚪ GREY | No child issues yet | Review | TM-004 | Child issues not yet created |
| ECS-032 | A pull request is created when ready and is not merged | Consolidated §31, §5 | P0 | Lead (Claude) | ⚪ GREY | No PR yet | `gh`-equivalent GitHub check | TM-010 | Implementation not ready |
| ECS-033 | Final acceptance criteria (§32) are recorded and each checked | Consolidated §32 | P0 | Lead (Claude) | ⚪ GREY | Listed in §32 | Final gate | TM-016 | Not started |
| ECS-034 | Final deliverables A to J produced in the repository, with a concise chat summary | Consolidated §33 | P0 | Lead (Claude) | ⚪ GREY | Not started | Review | TM-016 | Not started |
| ECS-035 | Bounded execution with checkpoint persistence; never assume an unbounded session | Consolidated §29 | P1 | Lead (Claude) | 🟡 AMBER | Checkpoints committed to branch | Review of commits | TM-015 | — |
| ECS-036 | Engineering work is delegated internally; Grant is never assigned ordinary engineering work | Consolidated §29, §5 | P0 | Lead (Claude) | 🟡 AMBER | Process; no assignments to Grant | Review | TM-014 | — |
| ECS-037 | Each requirement moves Captured → Numbered → Assigned → Implemented → Tested → Verified → Persisted → Reported | Consolidated §34 | P0 | Lead (Claude) | 🟡 AMBER | Lifecycle defined; applied to this register | Review | TM-014 | — |
| ECS-038 | Consolidated spec, historical spec and incident transcript are preserved unabridged in the repository | Consolidated §6 | P0 | Lead (Claude) | 🟡 AMBER | Three files on the development branch | Validator checks SHA-256 of each | TM-004 | Committed with this checkpoint |
| ECS-039 | Checker detects missing source requirements, not only missing statuses | Consolidated §28 (resume instruction 7) | P0 | Lead (Claude) | 🟡 AMBER | `check-register.mjs` checks inventory mapping and source hashes | `npm run check:reliability` and self-test | TM-018 | — |

## B. Chief of Staff requirements (COS)

Titles are short. Exact text is the cited source item (Consolidated §7 numbering is `CONS-7.nn` in the traceability map; `§n` is the consolidated section; `HIST-3.nn` is the historical execution spec §3 topic).

| ID | Requirement | Source | Priority | Owner | Status | Evidence / reference | Verification | Test ref | Blocker |
|---|---|---|---|---|---|---|---|---|---|
| COS-001 | Objective intake and persistence | Historical §3 example | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-002 | Voice transcription and traceability | Historical §3 example | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-003 | Objective decomposition | Historical §3 example | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-004 | Durable agent ownership | Historical §3 example | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-005 | Automatic specialist assignment | Historical §3 example | P0 | Lead (Claude) | 🟡 AMBER | Plan tasks take the step's specialist as owner (`task-home.ts`, `perform.ts`) | Writer proof and unit tests; not run through the planner end to end | TM-023, TM-024 | End-to-end delegation run not done |
| COS-006 | Automatic reassignment and recovery | Historical §3 example | P0 | Lead (Claude) | 🟡 AMBER | A specialist hand-off that fails for good goes once to the Chief of Staff: migration 1075, `app.reassign_failed_specialist`, called by the worker's failure path (`worker.ts`). Proofs `specialist-reassign` 6/6 and `specialist-reassign-worker` 3/3 (TM-030) | Failure reassignment verified; unavailable (not failed) specialist not handled | TM-030 | Unavailable-specialist path not built |
| COS-007 | Approval identity and persistence | Historical §3 example | P0 | Lead (Claude) | 🟡 AMBER | Identity is the material scope (`step-approval.ts`), stable under a renumbered plan (DEC-011) | Unit tests green; persistence across restart not tested | TM-022 | Restart persistence not tested |
| COS-008 | Approval callback processing | Historical §3 example | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-009 | Duplicate approval suppression | Historical §3 example | P0 | Lead (Claude) | 🟡 AMBER | `raiseBlocker` returns the open question instead of a second one; migration 1073 unique index `blockers_one_open_per_job_action`. Proof: `scripts/isolated/approval-asked-once.ts` (5/5) | Replica proof green; production duplicates not yet inspected | TM-021 | Production evidence pending (DEC-009) |
| COS-010 | Backup-model approval compatibility | Historical §3 example | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-011 | Telegram ingress and voice transcription | Historical §3 topic 1; CONS-7.01 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-012 | Objective creation and persistence | Historical §3 topic 2; CONS-7.04 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-013 | Decomposition and planning | Historical §3 topic 3; CONS-7.06 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-014 | Automatic internal agent assignment | Historical §3 topic 4 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-015 | Chief of Staff accountability | Historical §3 topic 5; CONS-7.10 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-016 | Human versus agent task ownership | Historical §3 topic 6; CONS-7.11 | P0 | Lead (Claude) | 🟡 AMBER | Human-owned (his list) only for `audience: grant` (`task-home.ts`) | Unit tests green | TM-024 | Human-decision steps not separately typed |
| COS-017 | Specialist delegation and collaboration | Historical §3 topic 7; CONS-7.07; CONS-7.59 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-018 | Agent workload and capability routing | Historical §3 topic 8; CONS-7.08 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-019 | Failed assignment recovery | Historical §3 topic 9; CONS-7.60 | P0 | Lead (Claude) | 🟡 AMBER | Same mechanism as COS-006 (TM-030): the replacement is recorded on the parent with `reassigned_from`; a repeat failure does not add a second | Verified at the worker and the function; the parent's synthesis reading the replacement not yet tested | TM-030 | Fan-in over a replacement not tested |
| COS-020 | Approval state machines | Historical §3 topic 10; CONS-7.16 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-021 | Telegram approval callbacks | Historical §3 topic 11 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-022 | Duplicate approval prevention (parent of COS-074 and COS-009) | Historical §3 topic 12 | P0 | Lead (Claude) | 🟡 AMBER | COS-009 done at the writer and database (TM-021). COS-074 not yet verified | Children incomplete (COS-074) | TM-021 | COS-074 open |
| COS-023 | Approval persistence across restarts | Historical §3 topic 13; CONS-7.15 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-024 | Approval-to-execution continuation | Historical §3 topic 14; CONS-7.20 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-025 | Backup-model trust policies | Historical §3 topic 15; CONS-7.21 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-026 | User autonomy settings | Historical §3 topic 16; CONS-7.24 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-027 | Action-level risk classification | Historical §3 topic 17; CONS-7.23 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-028 | Safe autonomous execution | Historical §3 topic 18 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-029 | Objective lifecycle states | Historical §3 topic 19; CONS-7.26 | P0 | Lead (Claude) | 🟢 GREEN | Job states move only along legal transitions; exhausted attempts fail with a reason (`job-lifecycle`, 21 assertions; TM-031) | Critical gate 70/70 on fresh clones (TM-031) | TM-031 | — |
| COS-030 | Worker heartbeats and leases | Historical §3 topic 20; CONS-7.27 | P0 | Lead (Claude) | 🟢 GREEN | One claim per job; a stale or lapsed claim is fenced and can neither complete nor write (`job-fence`, 18 assertions; TM-031) | Critical gate 70/70 on fresh clones (TM-031) | TM-031 | — |
| COS-031 | Stalled-job detection | Historical §3 topic 21; CONS-7.28 | P0 | Lead (Claude) | 🟢 GREEN | Every stallable job state is recovered or failed; a malformed row is contained (`recovery-matrix`, 27 assertions; TM-031) | Critical gate 70/70 on fresh clones (TM-031) | TM-031 | — |
| COS-032 | Retry and idempotency | Historical §3 topic 22; CONS-7.29 | P0 | Lead (Claude) | 🟢 GREEN | Handler failures retry with the reason recorded and never spend an attempt twice; a duplicate webhook, job or child produces one of each (`worker-failure-paths` 11 assertions; `exactly-once` 5; TM-031) | Critical gate 70/70 on fresh clones (TM-031) | TM-031 | — |
| COS-033 | Duplicate objective detection | Historical §3 topic 23; CONS-7.31 | P0 | Lead (Claude) | 🟡 AMBER | Only work for the SAME project can be a repeat (`sameProjectWork`, `already.ts`; migration 1076 makes the conversation's work carry its project). Tests `already-pursuing.test.ts` 12/12 (TM-034); proof `work-carries-its-project` 2/2 | Project scoping verified; the model's judgement within a project is not verified | TM-034 | Model judgement not verified |
| COS-034 | Existing-run continuation | Historical §3 topic 24; CONS-7.32 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-035 | Natural-language Gmail discovery | Historical §3 topic 25; CONS-7.33 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-036 | Sent and received thread matching | Historical §3 topic 26; CONS-7.36 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-037 | Gmail pagination and search expansion | Historical §3 topic 27; CONS-7.37 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-038 | Email fact extraction | Historical §3 topic 28; CONS-7.39 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-039 | Source provenance | Historical §3 topic 29; CONS-7.40 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-040 | Missing data and uncertainty | Historical §3 topic 30; CONS-7.41 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-041 | Notion workspace discovery and selection | Historical §3 topic 31; CONS-7.43 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-042 | Default project destinations | Historical §3 topic 32; CONS-7.44 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-043 | Artifact generation | Historical §3 topic 33; CONS-7.45 | P1 | Lead (Claude) | 🟢 GREEN | The PDF renderer and report artifacts build a complete, structurally valid document from the office's content (`tests/artifacts/pdf.test.ts`, `cover*.test.ts`, `design.test.ts`, `image.test.ts`, 204 artifact tests green; TM-033) | `npx vitest run tests/artifacts` 204/204 (TM-033) | TM-033 | — |
| COS-044 | Artifact verification | Historical §3 topic 34; CONS-7.47 | P1 | Lead (Claude) | 🟢 GREEN | A structurally valid PDF with an intro printed over the title is refused by the layout check, not stored or sent; the fixed path is green; controls prove the check discriminates (`tests/artifacts/qa.test.ts`; TM-033) | `npx vitest run tests/artifacts/qa.test.ts` (TM-033) | TM-033 | — |
| COS-045 | Accommodation comparison documents | Historical §3 topic 35; CONS-7.49 | P2 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-046 | Contact correspondence summaries | Historical §3 topic 36; CONS-7.48 | P2 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-047 | Prices and currency handling | Historical §3 topic 37; CONS-7.50 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-048 | Confirmed versus unknown availability | Historical §3 topic 38; CONS-7.51 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-049 | Automatic follow-up task creation | Historical §3 topic 39; CONS-7.52 | P1 | Lead (Claude) | 🟡 AMBER | Tasks created through the real doors (`e2e-tasks`, 70 assertions, critical gate TM-031); the planner's task step writes a task with its owner (`task-owner-writes` 3/3, TM-023) | Task creation verified; automatic follow-up from an email reply not built or tested | TM-031, TM-023 | Follow-up derivation from a reply not built |
| COS-050 | Draft reply preparation | Historical §3 topic 40; CONS-7.53 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-051 | External action authorisation | Historical §3 topic 41; CONS-7.54 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-052 | Partial results and recovery | Historical §3 topic 42; CONS-7.55 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-053 | Truthful execution status | Historical §3 topic 43; CONS-7.56 | P0 | Lead (Claude) | 🟡 AMBER | Status is read from the jobs table (`app.conversation_work`: in-flight and finished counts), not inferred from conversation (the duplicate guard path, forensics C1). Claim checks exist in the unit suite | Read path verified by reading the definition; no end-to-end status answer test | TM-032 | End-to-end status answer not tested |
| COS-054 | Progress-report accuracy | Historical §3 topic 44 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-055 | Human-friction minimisation | Historical §3 topic 45; CONS-7.58 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-056 | Recovery from repeated approval requests | Historical §3 topic 46; CONS-7.57 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-057 | Chief of Staff escalation behaviour | Historical §3 topic 47 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-058 | Unified Activity Ledger integration | Historical §3 topic 48; CONS-7.61 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-059 | Security and least privilege | Historical §3 topic 49; CONS-7.62 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-060 | Regression testing | Historical §3 topic 50 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-061 | End-to-end incident simulation | Historical §3 topic 51; CONS-7.70 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-062 | Model failover testing | Historical §3 topic 52; CONS-7.68 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-063 | Operational observability | Historical §3 topic 53 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-064 | Production safety | Historical §3 topic 54 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-065 | GitHub issue tracking | Historical §3 topic 55; CONS-7.72 | P1 | Lead (Claude) | 🟡 AMBER | Epic #476 and register | Epic reviewed | TM-004 | Child issues not created |
| COS-066 | Documentation and handoffs | Historical §3 topic 56; CONS-7.73 | P1 | Lead (Claude) | 🟡 AMBER | `docs/reliability/` records | Review | TM-004 | Handoff not yet exercised |
| COS-067 | Release readiness | Historical §3 topic 57 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Depends on other rows |
| COS-068 | Final verification | Historical §3 topic 58; CONS-7.76 (with ECS-019) | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Depends on other rows |
| COS-069 | Telegram acknowledgement of receipt | CONS-7.03 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-070 | Objective traceability to its source message and voice transcript | CONS-7.05 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-071 | Workload-aware assignment | CONS-7.09 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-072 | Approval callback authentication | CONS-7.14 | P0 | Lead (Claude) | 🟡 AMBER | The Telegram webhook refuses a request whose secret header does not match, compared in constant time (`telegram-webhook`, `secretMatches`; `tests/channels/telegram.test.ts`). Undo offers expire (`callbacks.ts`) | Partial: approvals themselves have no expiry; the webhook proof is a unit test, not a live request | TM-036 | Approval expiry not defined in the spec |
| COS-073 | Approval consumption | CONS-7.17 | P0 | Lead (Claude) | 🟡 AMBER | `app.hq_answer_blocker` locks the question row and answers once: a repeat or conflicting press returns `already`, the recorded answer does not change, an option never offered is refused (`approval-consumed-once.ts`, 4/4, TM-036) | Partial: continuation after the consumed answer is proved in TM-021 and TM-028, not re-proved here | TM-036 | — |
| COS-074 | Duplicate callback idempotency | CONS-7.18 | P0 | Lead (Claude) | 🟡 AMBER | Code: `telegram.ts` 223–270 (dedupe per callback id, F2); `callbacks.ts` ~584 (idempotent answer claimed in a comment). See `chief-of-staff-forensics-code.md` | Unverified: answer idempotency not yet proven by a test | REG-001 (planned) | Repeat press not yet tested against `hq_answer_blocker` |
| COS-075 | Primary and fallback model execution parity | CONS-7.22 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-076 | Safe independent work during blocked steps | CONS-7.25 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-077 | Recovery after process interruption | CONS-7.30 | P0 | Lead (Claude) | 🟢 GREEN | A job stranded by an interrupted process is reclaimed and recovered or failed (`recovery-matrix`; TM-031) | Critical gate 70/70 on fresh clones (TM-031) | TM-031 | — |
| COS-078 | Sent-email discovery | CONS-7.34 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-079 | Inbound-reply discovery | CONS-7.35 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-080 | Email deduplication | CONS-7.38 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-081 | Connected-tool discovery | CONS-7.42 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-082 | Artifact persistence | CONS-7.46; §20 | P0 | Lead (Claude) | 🟡 AMBER | Documents are ingested and retrieved, project- and office-scoped (`e2e-documents`, 48 assertions, critical gate TM-031). Generated artifacts are not yet the subject of this proof | Persistence of ingested documents verified; generated-artifact persistence not verified | TM-031 | Generated-artifact persistence not verified |
| COS-083 | Status answered from authoritative execution state | CONS-7.56; §13 invariant 10; §21 | P0 | Lead (Claude) | 🟡 AMBER | `app.conversation_work` reads `jobs` (state, kind, finished) for the conversation's work; the duplicate guard's status sentences are built from it (forensics C1, C1b) | Source of the status verified by reading the definition; the answer to a status question not yet tested end to end | TM-032 | End-to-end status answer not tested |
| COS-084 | Authentication and tenant isolation | CONS-7.63 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-085 | System-level provenance and auditability | CONS-7.64 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-086 | Unit tests | CONS-7.65 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-087 | Integration tests | CONS-7.66 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-088 | Concurrency tests | CONS-7.67 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-089 | Telegram callback tests | CONS-7.69 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-090 | Staging and release verification | CONS-7.71 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-091 | Forensic incident timeline with classified findings | §10 | P0 | Lead (Claude) | 🟡 AMBER | Transcript preserved; no historical records yet inspected | Timeline in `docs/reliability/` | TM-020 | Production telemetry not yet read; needs authorised read access |
| COS-092 | Planner regeneration does not recreate equivalent approvals | §11 item 6; §11 examine list | P0 | Lead (Claude) | 🟡 AMBER | Transcript 09:36, 09:53, 10:59 show one stop message three times (forensics F4, supported hypothesis) | Production blocker rows needed | REG-006 (planned) | Blocker and delivery rows not yet inspected |
| COS-093 | Re-approval only when scope materially changes | §11 item 10 | P0 | Lead (Claude) | 🟡 AMBER | Material identity in `src/agents/step-approval.ts`: step id never bound (DEC-011); reason bound only for outside or Grant-facing work (DEC-014). Tests: `tests/reliability/step-approval.test.ts` | Unit tests green; end-to-end re-plan not yet run | TM-022 | Outside-facing rewording still re-asks, by design |
| COS-094 | Approval state transitions are atomic where required | §11 item 11 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-095 | Approval records and job state remain reconcilable | §11 item 12 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-096 | No duplicate task assignments | §12 item 6 | P0 | Lead (Claude) | 🟡 AMBER | One owner per plan task: `src/agents/task-home.ts`, used by the `task.create` executor (`perform.ts`). Writer proof: `scripts/isolated/task-owner-writes.ts` (3/3) | Single-owner property holds at the writer; duplicate-task across re-plans not tested | TM-023, TM-024 | Re-plan duplicate tasks not tested |
| COS-097 | No assignment to agents lacking the necessary tool permissions | §12 item 7 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-098 | Chief of Staff keeps ownership when no specialist can execute | §12 item 12 | P0 | Lead (Claude) | 🟡 AMBER | A step naming no specialist is owned by the Chief of Staff (`taskHome`; writer proof case 2) | Unit and writer proof green; "specialist cannot execute" path not tested | TM-024, TM-023 | Unavailable-specialist path not built |
| COS-099 | Grant is never made fallback owner because internal routing failed | §12 item 13 | P0 | Lead (Claude) | 🟡 AMBER | Before: every plan task went to Grant's list (`perform.ts` `task.create`). After: `taskHome` gives a project task to the specialist or Chief of Staff; Grant's list only for `audience: grant` or no project. Tests: `tests/reliability/task-home.test.ts` (6) | Unit tests green; "Grant is never the owner of a project task" asserted across inputs | TM-024 | — |
| COS-100 | Task ownership is separate from permission for consequential actions | §12 item 14 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-101 | Drafts and tasks prepared before any approval-gated action | §12 item 15 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-102 | Task context preserved across agent handoffs | §12 item 9 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-103 | A planned step is not treated as completed | §13 invariant 3 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-104 | A queued step is not treated as running; a tool request is not a successful side effect | §13 invariants 4 and 5 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-105 | A document-generation instruction is not a verified artifact | §13 invariant 6 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-106 | A stalled job is not reported as making progress | §13 invariant 7 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-107 | Completed work is retained through later failures | §13 invariant 8 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-108 | A duplicate request classifies the existing run's actual state | §14 | P0 | Lead (Claude) | 🟡 AMBER | Matcher is a model judgement over conversation-scoped candidates, shown 240 characters each (forensics C1b); parser and inputs pinned by `tests/agents/already-pursuing.test.ts` (TM-027, 8/8). The 120-character text is display only | Matcher contract tested; the model's real decisions and state classification not verified | TM-027; REG-009 to REG-011 (planned) | Production job and model decisions not inspected |
| COS-109 | A follow-up is not abandoned because a matching objective exists | §14 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-110 | "Just do it" never bypasses security controls or approvals | §14; §22 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-111 | Dead-letter processing for exhausted work | §15 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-112 | Completion acknowledgement is idempotent | §15 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-113 | No duplicate external side effects on retry or recovery | §15 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-114 | Interruption before and after a side effect or state transition is tested | §15 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-115 | No repeated approval for an unchanged permission after fallback | §16 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-116 | Zero-paid-model policy preserved where configured | §16 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-117 | A less-trusted model's plan is validated without repeated approval prompts | §16 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-118 | Gmail search expands adaptively from discovered organisations | §17 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-119 | Pagination is bounded; no full-mailbox extraction | §17 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-120 | Uncertainties are recorded and no facts are invented | §17 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-121 | A missing optional detail does not block unrelated steps | §18 | P0 | Lead (Claude) | 🟡 AMBER | Registry rows for Gmail search, Gmail read and Notion write now say the office finds its own query and destination (migration 1074, TM-029). The Canary question "I need a precise Gmail search term" came from the model reading those rows | Registry text verified on replica; the answer behaviour under a live model not run | TM-029 | Model behaviour not re-run end to end |
| COS-122 | No invented workspace, task owner or external recipient; no unauthorised destination | §18 | P0 | Lead (Claude) | 🟡 AMBER | Notion write names only the project's attached database and says so when none is attached (migration 1074, TM-029). Projectless task owners go to the Chief of Staff (task-home.ts, earlier checkpoint) | Registry text verified on replica; no invented-recipient test yet | TM-029, TM-024 | External-recipient rule not tested |
| COS-123 | Ask one precise question only when genuinely necessary | §18 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-124 | Correspondence summary contains the §19A fields for every contact | §19A | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-125 | Accommodation comparison contains the §19B fields | §19B | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-126 | Availability is classified; no reply does not mean unavailable; historical availability is qualified | §19B | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-127 | Follow-up tasks carry the §19C fields; no invented due dates; no external send without permission | §19C | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-128 | Each artifact records the §20 metadata set | §20 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-129 | Partial failure preserves already-extracted facts | §20 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-130 | Status distinguishes received, planned, queued, running, waiting, blocked, partial and verified | §21 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-131 | No progress or creation claim unsupported by records | §21 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-132 | Repeated-approval investigation and redundant-prompt suppression | §22 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-133 | Diagnostic records carry correlation identifiers and no secrets or private correspondence | §23 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-134 | Reuse the Unified Activity Ledger; do not create a competing ledger | §23 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-135 | Mandatory regression test set (parent of REG-001 to REG-045) | §25 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Children not started |
| COS-136 | End-to-end Canary simulation covers the seven §26 fixture scenarios | §26 | P0 | Lead (Claude) | 🟡 AMBER | Canary readers: a clarification does not stop a Canary request; "create a summary document" and "tasks" are recognised as requests; control phrasings are not (TM-035) | Partial: the seven §26 scenarios are not run end to end through the real planner and worker | TM-035 | Full scenario run needs a live model; not run |
| COS-137 | Simulation sends no real email, spends no money and changes no production state | §26 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-138 | Generated documents reconcile with fixture data | §26 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-139 | Security boundaries preserved; no weakened tests or broad skips | §27 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-140 | Sensitive email content is not copied unnecessarily | §20; §27 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-141 | No unsafe substitute is used when a tool is unavailable | §27 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-142 | Existing state models are reused; no redundant infrastructure | §13 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-143 | Ordinary internal work is delegated without asking Grant for an assignee | §12 acceptance test; §4 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |
| COS-144 | Approval callback encoding, scope and expiry behaviour are verified | §11 examine list | P0 | Lead (Claude) | 🟡 AMBER | A press resolves through the delivery's own stored `blocker_id` (`app.approval_for_delivery`; forensics C3). Replica proof `approval-delivery.ts` 9/9 (TM-028). Button carries the correlation, not the question, so the question is identified by its message | Question→delivery→blocker correlation verified on replica; expiry not tested | TM-028 | Expiry and production press rows not inspected |
| COS-145 | Root-cause hypotheses are tested; no single cause assumed | §11 | P0 | Lead (Claude) | 🟡 AMBER | Five code-level findings F1–F5 recorded as hypotheses in `chief-of-staff-forensics-code.md`; none tested against production | Each hypothesis needs a test or a record | REG-001 to REG-006 (planned) | Production evidence pending (DEC-009) |
| COS-146 | Each forensic finding is classified as confirmed, supported, unverified or ruled out, with evidence | §10 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Not started |

## C. Mandatory regression tests (REG, §25)

| ID | Requirement | Source | Priority | Owner | Status | Evidence / reference | Verification | Test ref | Blocker |
|---|---|---|---|---|---|---|---|---|---|
| REG-001 | Duplicate approval button clicks | §25.1 | P0 | QA (Claude) | 🟡 AMBER | Repeated and conflicting presses are answered once; the recorded answer does not change (TM-036, 4/4) | Partial: sequential presses only; concurrent simultaneous presses (REG-002) not run | TM-036 | Concurrent presses not driven |
| REG-002 | Approval callbacks arriving concurrently | §25.2 | P0 | QA (Claude) | 🟡 AMBER | Two connections press the same question together, 5 rounds: exactly one answers, the other is refused as already answered, and the recorded answer is the winner's (TM-037, 2/2) | Partial: the proof has no sabotage control yet, so it has not been shown able to fail | TM-037 | Sabotage control not built |
| REG-003 | Approval persisting across restart | §25.3 | P0 | QA (Claude) | 🟡 AMBER | `approval-execution` (critical gate): an answer decided two days later still applies, and a worker that dies after the answer is recovered with the approval intact | Partial: a process restart is simulated by a worker death and recovery, not a full service restart | TM-031 | Full service restart not driven |
| REG-004 | Job continuation after approval | §25.4 | P0 | QA (Claude) | 🟡 AMBER | `approval-execution` (critical gate): a YES performs the step exactly once and the pursuit completes; a NO ends it without re-planning into a question | Partial: continuation is proved for a task step, not for every step kind | TM-031 | Other step kinds not driven |
| REG-005 | Continuation failure followed by safe retry | §25.5 | P0 | QA (Claude) | 🟡 AMBER | `approval-execution` (critical gate): a worker that dies after the answer is recovered and the step is performed once, not twice | Partial: a continuation that FAILS inside its handler and is retried is not driven; only a dead worker is | TM-031 | Handler-failure retry after approval not driven |
| REG-006 | Planner regeneration after approval | §25.6 | P0 | QA (Claude) | 🟡 AMBER | Duplicate question per job and action refused (TM-021); identity stable under renumbering (TM-022) | Partial; reworded reason re-asks once (DEC-011) | TM-021, TM-022 | End-to-end regenerated plan not run |
| REG-007 | Backup-model planning | §25.7 | P0 | QA (Claude) | ⚪ GREY | — | — | — | Not started |
| REG-008 | Restrictive project autonomy | §25.8 | P0 | QA (Claude) | ⚪ GREY | — | — | — | Not started |
| REG-009 | Duplicate user objective while running | §25.9 | P0 | QA (Claude) | 🟡 AMBER | An identical repeat starts nothing and says so; a paraphrase the matcher calls the same starts nothing; the control (matcher says different) starts a job (TM-038, 3/3) | Partial: the matcher's answer is scripted, so it proves the handler acts on the answer, not that the real model judges well | TM-038 | Real model judgement not run |
| REG-010 | Duplicate objective while stalled | §25.10 | P0 | QA (Claude) | 🟡 AMBER | A repeat while the first attempt's lease has lapsed starts no second piece; the control starts one (TM-040, 2/2) | Partial: the reply calls the stalled piece "running now", which is not true of a lapsed lease. Open on COS-053 and COS-083 and the status wording; recovery itself is in the critical gate (TM-031) | TM-040 | Stalled-status wording not fixed |
| REG-011 | Duplicate objective after completion | §25.11 | P0 | QA (Claude) | 🟡 AMBER | A completed piece of work is driven through the legal transitions and its output written; a repeat the matcher calls the same is answered with that result and starts nothing; the control starts a job (TM-039, 2/2) | Partial: the matcher's answer is scripted; the completion path is set up through the trigger's legal transitions, not through the worker | TM-039 | Real worker completion not used |
| REG-012 | Worker interruption | §25.12 | P0 | QA (Claude) | 🟡 AMBER | `worker-failure-paths` (critical gate, 11/11): a short database blip is recorded as retrying with the reason, never left running; a refused statement is not retried | Partial: the interruption is a simulated blip, not a killed worker process | TM-031 | Process kill not driven |
| REG-013 | Worker lease expiry | §25.13 | P0 | QA (Claude) | 🟡 AMBER | `job-fence` (critical gate, 23/23): a stale claim, after its lease has lapsed, can neither complete nor write. `recovery-matrix` (27/27): a job whose lease lapsed is recovered | Partial: no real clock-driven lease expiry on a live worker | TM-031 | Live lease timing not driven |
| REG-014 | Safe job reclamation | §25.14 | P0 | QA (Claude) | 🟡 AMBER | `recovery-matrix` (critical gate, 27/27): every stallable job state is recovered or failed, and a malformed row is contained rather than reclaimed blindly | Partial: the matrix covers the states the sweep knows; a state added later is not covered until added to the matrix | TM-031 | — |
| REG-015 | Duplicate side-effect prevention | §25.15 | P0 | QA (Claude) | 🟡 AMBER | `exactly-once` (critical gate, 6/6): a duplicate webhook, job or child produces one of each. Duplicate repeats of work are covered by TM-038 to TM-040 | Partial: duplicate DELIVERY of an outbound message is not in this proof | TM-031 | Duplicate delivery not driven |
| REG-016 | Automatic specialist assignment | §25.16 | P0 | QA (Claude) | 🟡 AMBER | `task-home.ts` and writer proof (TM-023, TM-024) | Partial: writer and rule, not the planner | TM-023, TM-024 | Planner-level run not done |
| REG-017 | Ambiguous agent routing | §25.17 | P0 | QA (Claude) | ⚪ GREY | — | — | — | Not started |
| REG-018 | Unavailable assigned specialist | §25.18 | P0 | QA (Claude) | 🟡 AMBER | A specialist hand-off that failed is reassigned to the Chief of Staff (TM-030). "Unavailable" is treated as failure here | Failure path verified; an inactive specialist before any attempt is not handled | TM-030 | Pre-attempt unavailability not built |
| REG-019 | Automatic reassignment | §25.19 | P0 | QA (Claude) | 🟡 AMBER | Worker runs `reassign_failed_specialist` on terminal failure (TM-030): 3/3 at the worker, 6/6 at the function | Verified for failed hand-offs; no planner-level run yet | TM-030 | Planner-level run not done |
| REG-020 | User not assigned ordinary internal work | §25.20 | P0 | QA (Claude) | 🟡 AMBER | `taskHome` never returns Grant as owner of a project task (TM-024) | Partial: rule and writer, not the planner | TM-024 | Planner-level run not done |
| REG-021 | Human approval required for a consequential action | §25.21 | P0 | QA (Claude) | 🟡 AMBER | `approval-binding` and `approval-execution` (critical gate): an approval applies to exactly what it approved, and a consequential step is asked before it runs | Partial: the consequence classes covered are the ones those two proofs drive, not the full policy matrix | TM-031 | Full policy matrix not driven here |
| REG-022 | Gmail search strategy generation | §25.22 | P1 | QA (Claude) | 🟡 AMBER | The Gmail search and read descriptions tell the office to find its own query and never ask Grant for one (migration 1074; `registry-never-asks`, 4/4; TM-035) | Partial: the office's generated query is not run against a live Gmail; the registry proof checks the instruction, not the search quality | TM-035 | Live query quality not measured |
| REG-023 | Sent and received email matching | §25.23 | P1 | QA (Claude) | ⚪ GREY | — | — | — | Not started |
| REG-024 | Email thread pagination | §25.24 | P1 | QA (Claude) | ⚪ GREY | — | — | — | Not started |
| REG-025 | Duplicate email handling | §25.25 | P1 | QA (Claude) | ⚪ GREY | — | — | — | Not started |
| REG-026 | Missing price information | §25.26 | P1 | QA (Claude) | ⚪ GREY | — | — | — | Not started |
| REG-027 | Conflicting updated availability | §25.27 | P1 | QA (Claude) | ⚪ GREY | — | — | — | Not started |
| REG-028 | Unanswered inquiries | §25.28 | P1 | QA (Claude) | ⚪ GREY | — | — | — | Not started |
| REG-029 | Follow-up task creation | §25.29 | P1 | QA (Claude) | ⚪ GREY | — | — | — | Not started |
| REG-030 | Artifact creation failure | §25.30 | P0 | QA (Claude) | ⚪ GREY | — | — | — | Not started |
| REG-031 | Artifact verification | §25.31 | P0 | QA (Claude) | 🟢 GREEN | Layout-collision and structural checks on generated PDFs, with red and green controls (`qa.test.ts`; TM-033) | `npx vitest run tests/artifacts` (TM-033) | TM-033 | — |
| REG-032 | Partial-result preservation | §25.32 | P0 | QA (Claude) | ⚪ GREY | — | — | — | Not started |
| REG-033 | Missing Notion workspace | §25.33 | P1 | QA (Claude) | 🟡 AMBER | The Notion write description says never to ask Grant which workspace, and to say so and carry on when none is attached (migration 1074; `registry-never-asks`, 4/4; TM-035) | Partial: the carry-on behaviour is an instruction to the model; not run against a model | TM-035 | Live behaviour without a workspace not run |
| REG-034 | Missing optional task owner | §25.34 | P1 | QA (Claude) | 🟡 AMBER | A task with no named owner goes to the Chief of Staff, never to Grant's list by default (`task-home`, 6/6; `task-owner-writes`, 3/3; TM-023, TM-024) | Partial: the owner routing is proved at the writer; the plan's own choice of owner is a model judgement | TM-023, TM-024 | — |
| REG-035 | Status request during execution | §25.35 | P0 | QA (Claude) | ⚪ GREY | — | — | — | Not started |
| REG-036 | Status request during blocking | §25.36 | P0 | QA (Claude) | ⚪ GREY | — | — | — | Not started |
| REG-037 | Status request after verified completion | §25.37 | P0 | QA (Claude) | ⚪ GREY | — | — | — | Not started |
| REG-038 | Repeated approval-frustration recovery | §25.38 | P0 | QA (Claude) | ⚪ GREY | — | — | — | Not started |
| REG-039 | Objective state consistency | §25.39 | P0 | QA (Claude) | ⚪ GREY | — | — | — | Not started |
| REG-040 | Requirements-register reconciliation | §25.40 | P0 | QA (Claude) | 🟡 AMBER | `npm run check:reliability` passes on the current register | Validator | TM-001 | Extend to inventory checks |
| REG-041 | Context-compaction recovery | §25.41 | P0 | QA (Claude) | ⚪ GREY | — | — | — | Not started |
| REG-042 | Model failover without approval duplication | §25.42 | P0 | QA (Claude) | ⚪ GREY | — | — | — | Not started |
| REG-043 | Security and authorisation boundaries | §25.43 | P0 | QA (Claude) | ⚪ GREY | — | — | — | Not started |
| REG-044 | No unauthorised external communication | §25.44 | P0 | QA (Claude) | ⚪ GREY | — | — | — | Not started |
| REG-045 | End-to-end Canary Coworking simulation | §25.45 | P0 | QA (Claude) | ⚪ GREY | — | — | — | Not started |

## D. Source traceability map (checked by `check:reliability`)

Every consolidated §7 inventory item (CONS-7.nn) and every §25 regression item (CONS-25.nn) maps to exactly one register ID. Every historical §3 topic and example is recorded in the Source column of its row.

| Source item | Item | Register ID |
|---|---|---|
| CONS-7.01 | Voice-message receipt | COS-011 |
| CONS-7.02 | Transcription accuracy and persistence | COS-002 |
| CONS-7.03 | Telegram ingress and acknowledgement | COS-069 |
| CONS-7.04 | Objective creation | COS-012 |
| CONS-7.05 | Objective traceability | COS-070 |
| CONS-7.06 | Planning and decomposition | COS-013 |
| CONS-7.07 | Automatic internal delegation | COS-005 |
| CONS-7.08 | Specialist capability routing | COS-018 |
| CONS-7.09 | Workload-aware assignment | COS-071 |
| CONS-7.10 | Chief of Staff accountability | COS-015 |
| CONS-7.11 | Human versus agent ownership | COS-016 |
| CONS-7.12 | Automatic reassignment | COS-006 |
| CONS-7.13 | Approval identity | COS-007 |
| CONS-7.14 | Approval callback authentication | COS-072 |
| CONS-7.15 | Approval persistence | COS-023 |
| CONS-7.16 | Approval state transitions | COS-020 |
| CONS-7.17 | Approval consumption | COS-073 |
| CONS-7.18 | Duplicate callback idempotency | COS-074 |
| CONS-7.19 | Duplicate approval-notification suppression | COS-009 |
| CONS-7.20 | Approved-job continuation | COS-024 |
| CONS-7.21 | Backup-model trust boundaries | COS-025 |
| CONS-7.22 | Primary-model and fallback-model behaviour | COS-075 |
| CONS-7.23 | Action-level risk classification | COS-027 |
| CONS-7.24 | Existing user autonomy settings | COS-026 |
| CONS-7.25 | Safe independent work during blocked steps | COS-076 |
| CONS-7.26 | Objective lifecycle state | COS-029 |
| CONS-7.27 | Worker leasing and heartbeats | COS-030 |
| CONS-7.28 | Stalled-job detection | COS-031 |
| CONS-7.29 | Safe retries | COS-032 |
| CONS-7.30 | Recovery after process interruption | COS-077 |
| CONS-7.31 | Duplicate objective detection | COS-033 |
| CONS-7.32 | Existing-run continuation | COS-034 |
| CONS-7.33 | Gmail natural-language search formulation | COS-035 |
| CONS-7.34 | Sent-email discovery | COS-078 |
| CONS-7.35 | Inbound-reply discovery | COS-079 |
| CONS-7.36 | Thread association | COS-036 |
| CONS-7.37 | Search expansion and pagination | COS-037 |
| CONS-7.38 | Email deduplication | COS-080 |
| CONS-7.39 | Accurate fact extraction | COS-038 |
| CONS-7.40 | Source provenance | COS-039 |
| CONS-7.41 | Handling unknown information | COS-040 |
| CONS-7.42 | Connected-tool discovery | COS-081 |
| CONS-7.43 | Notion workspace selection | COS-041 |
| CONS-7.44 | Default project destinations | COS-042 |
| CONS-7.45 | Artifact generation | COS-043 |
| CONS-7.46 | Artifact persistence | COS-082 |
| CONS-7.47 | Artifact verification | COS-044 |
| CONS-7.48 | Contact summaries | COS-046 |
| CONS-7.49 | Accommodation comparisons | COS-045 |
| CONS-7.50 | Price and currency extraction | COS-047 |
| CONS-7.51 | Availability classification | COS-048 |
| CONS-7.52 | Follow-up task creation | COS-049 |
| CONS-7.53 | Draft response preparation | COS-050 |
| CONS-7.54 | Human approval for consequential actions | COS-051 |
| CONS-7.55 | Partial-result preservation | COS-052 |
| CONS-7.56 | Accurate status reporting | COS-053 |
| CONS-7.57 | Repeated approval-frustration recovery | COS-056 |
| CONS-7.58 | Minimal necessary user clarification | COS-055 |
| CONS-7.59 | Specialist collaboration | COS-017 |
| CONS-7.60 | Agent failure recovery | COS-019 |
| CONS-7.61 | Unified Activity Ledger support | COS-058 |
| CONS-7.62 | Security and least privilege | COS-059 |
| CONS-7.63 | Authentication and tenant isolation | COS-084 |
| CONS-7.64 | Provenance and auditability | COS-085 |
| CONS-7.65 | Unit tests | COS-086 |
| CONS-7.66 | Integration tests | COS-087 |
| CONS-7.67 | Concurrency tests | COS-088 |
| CONS-7.68 | Model-failover tests | COS-062 |
| CONS-7.69 | Telegram callback tests | COS-089 |
| CONS-7.70 | End-to-end incident simulation | COS-061 |
| CONS-7.71 | Staging and release verification | COS-090 |
| CONS-7.72 | GitHub tracking | COS-065 |
| CONS-7.73 | Documentation completeness | COS-066 |
| CONS-7.74 | Traffic-light reconciliation | ECS-010 |
| CONS-7.75 | Context-compaction recovery | ECS-017 |
| CONS-7.76 | Final release readiness | ECS-019 |
| CONS-25.01 | Duplicate approval button clicks | REG-001 |
| CONS-25.02 | Approval callbacks arriving concurrently | REG-002 |
| CONS-25.03 | Approval persisting across restart | REG-003 |
| CONS-25.04 | Job continuation after approval | REG-004 |
| CONS-25.05 | Continuation failure followed by safe retry | REG-005 |
| CONS-25.06 | Planner regeneration after approval | REG-006 |
| CONS-25.07 | Backup-model planning | REG-007 |
| CONS-25.08 | Restrictive project autonomy | REG-008 |
| CONS-25.09 | Duplicate user objective while running | REG-009 |
| CONS-25.10 | Duplicate objective while stalled | REG-010 |
| CONS-25.11 | Duplicate objective after completion | REG-011 |
| CONS-25.12 | Worker interruption | REG-012 |
| CONS-25.13 | Worker lease expiry | REG-013 |
| CONS-25.14 | Safe job reclamation | REG-014 |
| CONS-25.15 | Duplicate side-effect prevention | REG-015 |
| CONS-25.16 | Automatic specialist assignment | REG-016 |
| CONS-25.17 | Ambiguous agent routing | REG-017 |
| CONS-25.18 | Unavailable assigned specialist | REG-018 |
| CONS-25.19 | Automatic reassignment | REG-019 |
| CONS-25.20 | User not assigned ordinary internal work | REG-020 |
| CONS-25.21 | Human approval for a consequential action | REG-021 |
| CONS-25.22 | Gmail search strategy generation | REG-022 |
| CONS-25.23 | Sent and received email matching | REG-023 |
| CONS-25.24 | Email thread pagination | REG-024 |
| CONS-25.25 | Duplicate email handling | REG-025 |
| CONS-25.26 | Missing price information | REG-026 |
| CONS-25.27 | Conflicting updated availability | REG-027 |
| CONS-25.28 | Unanswered inquiries | REG-028 |
| CONS-25.29 | Follow-up task creation | REG-029 |
| CONS-25.30 | Artifact creation failure | REG-030 |
| CONS-25.31 | Artifact verification | REG-031 |
| CONS-25.32 | Partial-result preservation | REG-032 |
| CONS-25.33 | Missing Notion workspace | REG-033 |
| CONS-25.34 | Missing optional task owner | REG-034 |
| CONS-25.35 | Status request during execution | REG-035 |
| CONS-25.36 | Status request during blocking | REG-036 |
| CONS-25.37 | Status request after verified completion | REG-037 |
| CONS-25.38 | Repeated approval-frustration recovery | REG-038 |
| CONS-25.39 | Objective state consistency | REG-039 |
| CONS-25.40 | Requirements-register reconciliation | REG-040 |
| CONS-25.41 | Context-compaction recovery | REG-041 |
| CONS-25.42 | Model failover without approval duplication | REG-042 |
| CONS-25.43 | Security and authorisation boundaries | REG-043 |
| CONS-25.44 | No unauthorised external communication | REG-044 |
| CONS-25.45 | End-to-end Canary Coworking simulation | REG-045 |

## E. Remapping and change log

- DEC-006: no existing ID changed meaning. New IDs are appended. Existing COS-011 to COS-068 keep their historical topic numbers in the Source column.
- The consolidated §7 inventory is a minimum. Sub-items beyond it are carried by rows COS-091 to COS-146 and ECS-021 to ECS-038.
