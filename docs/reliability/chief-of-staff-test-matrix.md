# Chief of Staff Reliability — Test Matrix (mirror)

**Canonical register:** `docs/reliability/chief-of-staff-requirements.md` · **Epic:** https://github.com/granterogers/agentic.team.grant/issues/476

Each row is a verification that exists or is planned. A requirement may be GREEN only when a row it cites is PASS with
evidence recorded here. Run with `npm run check:reliability`.

| Test ID | Verifies | Method | Command / location | Status | Last result |
|---|---|---|---|---|---|
| TM-001 | Register reconciles with progress totals; IDs unique, none missing or orphaned; owners present; GREEN has evidence and test ref; RED has blocker | Automated validator, live files | `npm run check:reliability` | Built | Pending first run (see progress file) |
| TM-002 | Validator rejects an invalid status and a total drift | Sabotage inside self-test | `npm run check:reliability -- --self-test` | Built | Pending first run |
| TM-003 | Validator detects duplicate, deleted and GREEN-without-evidence rows; passes an unmodified control | Sabotage plus control inside self-test | `npm run check:reliability -- --self-test` | Built | Pending first run |
| TM-004 | Epic exists and links the source documents and the register | Manual review of epic; validator checks the epic URL | Epic https://github.com/granterogers/agentic.team.grant/issues/476 | Built (validator), epic pending | Pending |
| TM-010 | No merge, no push to `main`, no deploy, no migration, no production change | Process check: `git log main` unchanged; no deploy or migrate command run | `git log --oneline main -1` | Manual | Pass at this checkpoint (main at f23af36) |
| TM-011 | Blocked prohibited operation recorded while work continues | Review of decisions log | `chief-of-staff-decisions.md` DEC-002 | Manual | Pass |
| TM-012 | Regression downgrades GREEN automatically | Not built: needs a test-to-requirement mapping | — | Not built | — |
| TM-013 | Production verification recorded separately as pending | Review of progress file | progress file, production section | Manual | Pass |
| TM-014 | Checkpoint procedure and minimal output followed | Review of commit sequence and reports | git log on development branch | Manual | Pending |
| TM-015 | Reload order is written and usable after compaction | Review | progress file, reload section | Manual | Pass (documented) |
| TM-016 | Final acceptance gate | Not run | — | Not started | — |
| TM-017 | No secret or private correspondence printed; no security weakening or broad test skip | Review of diffs and reports; grep for skips in changed test files | `git diff` review | Manual | Pending |
| TM-018 | Missing source requirement detected: each consolidated §7 item and §25 item maps to exactly one register ID; hashes match files; transcript has eight entries; historical topics present | Automated, with 11 sabotages in self-test | `npm run check:reliability` and `-- --self-test` | Built | Pending first run on this checkpoint |
| TM-019 | Parent/child completion rule (ECS-020) | Not built | — | Not built | — |
| TM-021 | An unchanged plan step's question is open once per job and action; the database refuses a second open one written around the writer; an answered question may be followed by a new one | Isolated replica proof against a real job (`realParent`) and the real `raiseBlocker` | `npx tsx scripts/isolated/approval-asked-once.ts post` | Built | Before the fix: 1/5 ok. After migration 1073 and the writer change: 5/5 ok |
| TM-022 | Approval identity is the material scope: a renumbered or reworded-id step keeps its identity; a different capability, project, specialist, audience, input or reason is a different identity | Behavioural unit tests on the real functions | `npx vitest run tests/reliability/step-approval.test.ts` | Built | 12/12 |
| TM-023 | A plan task is stored with its specialist as owner, or the Chief of Staff's; an unknown owner is refused, not stored | Isolated replica proof through the writer `app.task_add` on a real job's project | `npx tsx scripts/isolated/task-owner-writes.ts post` | Built | 3/3 |
| TM-024 | Routing: a project task never has Grant as owner; his list only for `audience: grant` or with no project | Behavioural unit tests on `taskHome` | `npx vitest run tests/reliability/task-home.test.ts` | Built | 6/6 |
| TM-025 | Whole unit suite green after the change, including the wiring tests that pin R45 and the multi-user inline-SQL rule | Vitest | `npx vitest run` | Run | 7390 passed, 0 failed |
| TM-026 | Existing approval and blocker proofs still pass on the migrated replica | Isolated proofs | `approval-binding`, `approval-execution`, `ask-unasked-loop`, `blocker-failure` against `post` | Run | 30/30, 15/15, 20/20, 7/7 |
| TM-020 | Forensic timeline assembled from authorised records; each finding classified | Review of `docs/reliability/` timeline once written | Not yet written | Not started | — |

## Not yet tested (blocked by the missing source documents)
- Telegram ingress and voice transcription, approval state machines, callbacks, duplicate suppression, approval-to-execution continuation, worker leases, stalled-job detection, Gmail and Notion discovery, artifacts, the Canary Coworking incident simulation, approval-loop recovery and model failover. Each becomes a row here once its requirement text is extracted (DEC-002).
