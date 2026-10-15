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
| TM-020 | Forensic timeline assembled from authorised records; each finding classified | Review of `docs/reliability/` timeline once written | Not yet written | Not started | — |

## Not yet tested (blocked by the missing source documents)
- Telegram ingress and voice transcription, approval state machines, callbacks, duplicate suppression, approval-to-execution continuation, worker leases, stalled-job detection, Gmail and Notion discovery, artifacts, the Canary Coworking incident simulation, approval-loop recovery and model failover. Each becomes a row here once its requirement text is extracted (DEC-002).
