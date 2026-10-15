# Chief of Staff Reliability — Requirements Register (CANONICAL)

**Epic:** https://github.com/granterogers/agentic.team.grant/issues/476
**Source:** `docs/reliability/chief-of-staff-master-spec.md` (execution-control specification, verbatim)
**Mirrors:** `chief-of-staff-progress.md` (totals), `chief-of-staff-test-matrix.md`, `chief-of-staff-decisions.md`

This is the only canonical status list. Progress totals and the epic must match it. Check with `npm run check:reliability`.

**Source gap (DEC-002):** the consolidated master prompt and the original Telegram incident transcript were not supplied.
The COS rows are topic-level seeds from the execution-control specification §3. They are NOT the full enumeration.
Each COS row needs its exact text and sub-requirements added once those documents are committed. Until then, no COS row
may be GREEN.

**Numbering (DEC-004):** COS-001 to COS-010 are the specification's ten named examples. COS-011 to COS-068 are the
specification's §3 topics 1 to 58, in order (COS-(10+n) = topic n). Nothing is skipped.

Status values: `🟢 GREEN`, `🟡 AMBER`, `🔴 RED`, `⚪ GREY`. Only these are valid.

## A. Execution-control rules (ECS)

| ID | Requirement | Source | Priority | Owner | Status | Evidence / reference | Verification | Test ref | Blocker |
|---|---|---|---|---|---|---|---|---|---|
| ECS-001 | Do not merge any branch or pull request | Spec §1 item 1 | P0 | Lead (Claude) | 🟡 AMBER | Work on `claude/chief-of-staff-reliability`; no merge performed | Process; `git log main` unchanged | TM-010 | Needs a repository guard; none yet |
| ECS-002 | Do not push directly to the production branch | Spec §1 item 2 | P0 | Lead (Claude) | 🟡 AMBER | Branch created from `main`; `main` not modified | Process; push targets only the development branch | TM-010 | Needs a repository guard; none yet |
| ECS-003 | Do not deploy to production | Spec §1 item 3 | P0 | Lead (Claude) | 🟡 AMBER | No deploy command run | Process | TM-010 | Needs a repository guard; none yet |
| ECS-004 | Do not execute production database migrations | Spec §1 item 4 | P0 | Lead (Claude) | 🟡 AMBER | No `npm run migrate` run | Process | TM-010 | Needs a repository guard; none yet |
| ECS-005 | Do not modify live production configuration, secrets or feature flags | Spec §1 item 5 | P0 | Lead (Claude) | 🟡 AMBER | None modified | Process | TM-010 | Needs a repository guard; none yet |
| ECS-006 | Do not carry out destructive production operations | Spec §1 item 6 | P0 | Lead (Claude) | 🟡 AMBER | None run | Process | TM-010 | Needs a repository guard; none yet |
| ECS-007 | A blocked prohibited operation is recorded as blocked while independent work continues | Spec §1 | P0 | Lead (Claude) | 🟡 AMBER | DEC-002 records the source blocker and work continues | Review of the decisions log | TM-011 | — |
| ECS-008 | A persistent GitHub epic containing the source documents exists before implementation | Spec §2 | P0 | Lead (Claude) | 🟡 AMBER | Epic https://github.com/granterogers/agentic.team.grant/issues/476 created; source documents incomplete (DEC-002) | Epic body reviewed; `check:reliability` checks the epic link | TM-004 | Consolidated prompt and incident transcript missing |
| ECS-009 | Repository register, progress, test matrix and decisions files reference the epic and each other | Spec §2 | P0 | Lead (Claude) | 🟡 AMBER | Cross-references in each file header | `check:reliability` checks headers | TM-004 | — |
| ECS-010 | One canonical register; mirrored status records stay consistent | Spec §2 | P0 | Lead (Claude) | 🟢 GREEN | Validator reconciles progress totals against the register | `npm run check:reliability` exits 0 | TM-001, TM-002 | — |
| ECS-011 | Only the four traffic-light statuses are used | Spec §4 | P0 | Lead (Claude) | 🟢 GREEN | Validator rejects any other status value | `npm run check:reliability` | TM-002, TM-003 | — |
| ECS-012 | A GREEN item is automatically downgraded when a regression test fails | Spec §4 | P0 | Lead (Claude) | 🟡 AMBER | Process only; no automatic downgrade yet | Requires a test-to-requirement mapping | TM-012 | Mapping not built yet |
| ECS-013 | Production verification is recorded separately as pending and does not block GREEN for local or staging acceptance | Spec §4 | P1 | Lead (Claude) | 🟡 AMBER | Progress file has a production-pending section | Review | TM-013 | — |
| ECS-014 | Each checkpoint: re-read register, reconcile IDs, update status, record evidence, update progress, update epic, commit and push, then report | Spec §5 | P0 | Lead (Claude) | 🟡 AMBER | Followed for this checkpoint (see progress file) | Review of commit sequence | TM-014 | — |
| ECS-015 | Terminal output is minimal and uses the specified progress format | Spec §6 | P1 | Lead (Claude) | 🟡 AMBER | Progress format used in reports | Review of reports | TM-014 | — |
| ECS-016 | An automated checker validates the register and progress reconciliation | Spec §5 | P0 | Lead (Claude) | 🟢 GREEN | `scripts/reliability/check-register.mjs`, run as `npm run check:reliability` | Self-test plus live run | TM-001, TM-003 | — |
| ECS-017 | After compaction or restart, reload the epic, register, progress, decisions, test matrix and git state before continuing | Spec §7 | P0 | Lead (Claude) | 🟡 AMBER | Reload order is written into the progress file | Review | TM-015 | — |
| ECS-018 | Completeness audit covers ID stability, owners, GREEN evidence, RED blockers, justified inapplicability, totals and parent/child rules | Spec §8 | P0 | Lead (Claude) | 🟡 AMBER | Validator covers IDs, owners, GREEN evidence, RED blockers, totals and deletions; parent/child rules await COS children | `npm run check:reliability` | TM-001 to TM-003 | Parent/child rules need COS children |
| ECS-019 | Final acceptance gate: re-read all sources, run the completeness audit, the regression and integration suites, the Canary simulation and the boundary checks, then report | Spec §9 | P0 | Lead (Claude) | ⚪ GREY | Not started | Final gate | TM-016 | Depends on COS rows and the source texts |
| ECS-020 | A parent requirement cannot be complete while a mandatory child remains incomplete | Spec §8 | P0 | Lead (Claude) | 🟡 AMBER | Validator rule is planned; there are no children yet | Validator rule to be added with the children | TM-003 | Children not yet extracted (DEC-002) |

## B. Topic requirements (COS)

All COS rows are GREY or AMBER. Each needs its exact requirement text, sub-requirements, owner, implementation
reference and test reference before it can move. The title is the topic name from the specification; it is not the
requirement text.

| ID | Requirement (topic) | Source | Priority | Owner | Status | Evidence / reference | Verification | Test ref | Blocker |
|---|---|---|---|---|---|---|---|---|---|
| COS-001 | Objective intake and persistence | Spec §3 example | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-002 | Voice transcription and traceability | Spec §3 example | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-003 | Objective decomposition | Spec §3 example | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-004 | Durable agent ownership | Spec §3 example | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-005 | Automatic specialist assignment | Spec §3 example | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-006 | Automatic reassignment and recovery | Spec §3 example | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-007 | Approval identity and persistence | Spec §3 example | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-008 | Approval callback processing | Spec §3 example | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-009 | Duplicate approval suppression | Spec §3 example | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-010 | Backup-model approval compatibility | Spec §3 example | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-011 | Telegram ingress and voice transcription | Spec §3 topic 1 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-012 | Objective creation and persistence | Spec §3 topic 2 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-013 | Decomposition and planning | Spec §3 topic 3 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-014 | Automatic internal agent assignment | Spec §3 topic 4 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-015 | Chief of Staff accountability | Spec §3 topic 5 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-016 | Human versus agent task ownership | Spec §3 topic 6 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-017 | Specialist delegation and collaboration | Spec §3 topic 7 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-018 | Agent workload and capability routing | Spec §3 topic 8 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-019 | Failed assignment recovery | Spec §3 topic 9 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-020 | Approval state machines | Spec §3 topic 10 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-021 | Telegram approval callbacks | Spec §3 topic 11 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-022 | Duplicate approval prevention | Spec §3 topic 12 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-023 | Approval persistence across restarts | Spec §3 topic 13 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-024 | Approval-to-execution continuation | Spec §3 topic 14 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-025 | Backup-model trust policies | Spec §3 topic 15 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-026 | User autonomy settings | Spec §3 topic 16 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-027 | Action-level risk classification | Spec §3 topic 17 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-028 | Safe autonomous execution | Spec §3 topic 18 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-029 | Objective lifecycle states | Spec §3 topic 19 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-030 | Worker heartbeats and leases | Spec §3 topic 20 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-031 | Stalled-job detection | Spec §3 topic 21 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-032 | Retry and idempotency | Spec §3 topic 22 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-033 | Duplicate objective detection | Spec §3 topic 23 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-034 | Existing-run continuation | Spec §3 topic 24 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-035 | Natural-language Gmail discovery | Spec §3 topic 25 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-036 | Sent and received thread matching | Spec §3 topic 26 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-037 | Gmail pagination and deduplication | Spec §3 topic 27 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-038 | Email fact extraction | Spec §3 topic 28 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-039 | Source provenance | Spec §3 topic 29 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-040 | Missing data and uncertainty | Spec §3 topic 30 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-041 | Notion workspace discovery | Spec §3 topic 31 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-042 | Default project destinations | Spec §3 topic 32 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-043 | Artifact creation and persistence | Spec §3 topic 33 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-044 | Artifact verification | Spec §3 topic 34 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-045 | Accommodation comparison documents | Spec §3 topic 35 | P2 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-046 | Contact correspondence summaries | Spec §3 topic 36 | P2 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-047 | Prices and currency handling | Spec §3 topic 37 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-048 | Confirmed versus unknown availability | Spec §3 topic 38 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-049 | Automatic follow-up task creation | Spec §3 topic 39 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-050 | Draft reply preparation | Spec §3 topic 40 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-051 | External action authorisation | Spec §3 topic 41 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-052 | Partial results and recovery | Spec §3 topic 42 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-053 | Truthful execution status | Spec §3 topic 43 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-054 | Progress-report accuracy | Spec §3 topic 44 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-055 | Human-friction minimisation | Spec §3 topic 45 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-056 | Recovery from repeated approval requests | Spec §3 topic 46 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-057 | Chief of Staff escalation behavior | Spec §3 topic 47 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-058 | Unified Activity Ledger integration | Spec §3 topic 48 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-059 | Security and least privilege | Spec §3 topic 49 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-060 | Regression testing | Spec §3 topic 50 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-061 | End-to-end incident simulation | Spec §3 topic 51 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-062 | Model failover testing | Spec §3 topic 52 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-063 | Operational observability | Spec §3 topic 53 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-064 | Production safety | Spec §3 topic 54 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Source text pending (DEC-002) |
| COS-065 | GitHub issue tracking | Spec §3 topic 55 | P1 | Lead (Claude) | 🟡 AMBER | Epic https://github.com/granterogers/agentic.team.grant/issues/476; this register | Epic reviewed | TM-004 | Full issue set not yet created |
| COS-066 | Documentation and handoffs | Spec §3 topic 56 | P1 | Lead (Claude) | 🟡 AMBER | `docs/reliability/` records | Review | TM-004 | Handoff procedure not yet exercised |
| COS-067 | Release readiness | Spec §3 topic 57 | P1 | Lead (Claude) | ⚪ GREY | — | — | — | Depends on all other rows |
| COS-068 | Final verification | Spec §3 topic 58 | P0 | Lead (Claude) | ⚪ GREY | — | — | — | Depends on all other rows |

Every COS row is a seed. Splitting a seed into its sub-requirements (from the consolidated prompt) adds new IDs above COS-068 and
never renumbers existing ones.
