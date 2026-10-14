# Current mission

**This is the only active mission record.** Its machine state is `docs/agent/EXECUTION-STATE.json`. If the two disagree,
the JSON is what the stop gate and the supervisor read, and this page must be corrected to match it. Older missions are in
`docs/agent/history/`.

## Identity

| Field | Value |
|---|---|
| Mission ID | `P0-CONTINUITY-2026-10-14` |
| Title | Autonomous development continuity repair |
| Owner | Grant Rogers |
| Started | 14 October 2026, 08:14 UTC |
| Authorised duration | eight hours |
| Deadline | 14 October 2026, 16:14 UTC (recorded in the JSON; the gate and the supervisor enforce it) |
| Branch | `claude/continuity-repair-2026-10-14`, cut from `origin/main` at `65bc7b0` |
| Pull request | draft, opened when the branch is pushed (see the JSON `issues` and the final report) |
| Last checkpoint | see the JSON `lastCheckpoint` |

The mission applies only on its own branch. The stop gate and the supervisor both check the branch, so a merge of this
ledger into `main` does not hold sessions on `main`.

## Scope

Stop premature endings of autonomous development sessions. The work covers repository instructions, a durable execution
ledger, a stop gate, a supervisor, tests, and an operator runbook. Nothing else.

## Authorised actions

- Create and push `claude/continuity-repair-2026-10-14`, and open or update a **draft** pull request for it.
- Edit repository instructions, scripts, tests and documentation on that branch.
- Create one GitHub issue for this repair.

## Prohibited actions

- Merging into `main`, or into any branch other than the mission branch.
- Deploying, running migrations, or changing production data.
- Starting a model-consuming session (`claude -p`, routines, scheduled triggers, or the supervisor with `--launch`)
  without Grant's explicit approval. A live continuity trial is one of these.
- Creating or enabling a scheduled trigger or routine.
- Changing `feature/auth-storage-portability-ui` or pull request #465.
- Reading or printing secret values.

## Requirements

Status words: `done`, `in_progress`, `todo`, `blocked`. The JSON is authoritative.

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| R1 | Establish termination evidence from transcripts, hooks and configuration | done | `docs/agent/history/TERMINATION-EVIDENCE-2026-10-14.md` |
| R2 | Precedence model, concise `CLAUDE.md`, current mission, history archive | done | `CLAUDE.md` (496 lines, was 4,929); `docs/agent/history/` |
| R3 | Durable execution ledger with atomic writes, compare and swap, stale-lock recovery | done | `scripts/agent/lib/state.mjs`; `tests/agent/ledger.test.ts` (15, including a six-process race) |
| R4 | Stop gate registered as a project Stop hook, branch-scoped | done | `.claude/settings.json`; `scripts/agent/stop-gate.mjs`; `tests/agent/gate.test.ts` (26) |
| R5 | Supervisor: restart, backoff, crash loop, budgets, duplicate prevention, graceful stop | done | `scripts/agent/supervise.mjs`; `tests/agent/supervisor.test.ts` (real child process) |
| R6 | Regression tests against real processes and sabotage checks | done | the three suites above; `tests/agent/mission.test.ts` (8); sabotage checks recorded in the ledger |
| R7 | Live continuity trial across real session restarts | done, for one controlled trial | `docs/agent/history/LIVE-RESTART-TRIAL-2026-10-14.md`: two sessions, one restart, PASS; not an eight-hour run |
| R8 | Operator runbook: start, monitor, stop and resume an eight-hour run | done | `docs/agent/CONTINUITY.md`; `scripts/agent/mission.mjs` |
| R9 | Push branch, open or update the draft pull request, record verification | todo | the final report |
| R9 | Push branch, open or update the draft pull request, record verification | todo | the final report |

## Blocked

- None. R7 was run once under explicit authorisation (see the history record). A longer or realistic live run needs a
  separate authorisation, because it uses model usage.

## Integration with parallel work (documented, not performed)

Another session is developing UX changes on parallel branches. Nothing here merges into `main`, rebases, or touches those
branches. Merging is an explicit, separate authorisation from the owner.

**Overlap, measured read-only against `origin/main` at `65bc7b0`:**

- The continuity branch changes 25 files. Its code and tests (`scripts/agent/`, `tests/agent/`, `.claude/settings.json`)
  share **no** files with any UX branch checked (`claude/team-hq-ux-overnight`, `claude/ux-closure-guard`,
  `claude/ux-overnight-docs`, `integration/team-hq-ux-on-p4`, `integration/team-hq-ux-v2`).
- Four files are changed by both sides, so a merge will conflict textually:
  - `CLAUDE.md`: this branch replaces the file with the concise version. Any UX edit to the full file must be carried into
    `docs/agent/history/CLAUDE-2026-10-14-full.md`, not dropped.
  - `docs/AUTONOMOUS-RUN.md`: this branch turns it into a pointer and archives the full log. A UX edit to that log must go
    into `docs/agent/history/AUTONOMOUS-RUN-2026-10-14-full.md`.
  - `package.json`: this branch adds five `agent:*` scripts. Additive, so either order keeps both.
  - `.gitignore`: this branch adds `docs/agent/STOP`. Additive.

**Proposed sequence, for the owner to authorise:**

1. The UX work lands on `main` first, by its own review, because it is the work already in flight.
2. Recheck the overlap against the new `main`: `git diff --name-only origin/main origin/claude/continuity-repair-2026-10-14`.
3. Bring this branch up to the new `main` with a merge commit. Never rebase a branch that is already pushed.
4. Resolve the four shared files as above. Keep every UX sentence that appears in a file this branch replaces, by moving
   it into the archive copy. Run `npm run check:deployment-state`, `npx vitest run tests/agent tests/docs`, and the full
   suite with `npm run test`.
5. Only then mark the draft pull request ready, and only on the owner's merge decision.

Until step 1 is the owner's decision, this branch is deliberately unmerged.

## Tracking issue

GitHub issue #474 holds the requirement backlog for this repair. The ledger references it and does not copy it.

## Next action

R9: run the verification gates, commit, push the branch, open the draft pull request, and record the results in the JSON.

## Completion conditions

The mission is complete when every requirement is `done` or the only remaining one is `blocked` on an owner, and the
verification in the final report is recorded. `complete` is then written to the JSON, and the gate lets the session end.

## Stop conditions

The run ends, and no new session starts, when any of these is true:

- The deadline passes.
- Grant creates `docs/agent/STOP`, or runs `node scripts/agent/mission.mjs stop`.
- Nothing actionable remains.
- A budget is spent: 500 held stops for the mission, 25 consecutive held stops in one session, 5 restarts, or 12
  sessions.
- Three failed sessions occur within ten minutes (a crash loop).
- The checkout is on a branch other than the mission's.

A checkpoint is not a stop. A blocked requirement is not a stop while other work remains.

## Last checkpoint

Evidence gathered and recorded (R1). Stop gate, ledger, supervisor and owner controls written and tested (R3 to R6, R8).
Instruction archive and concise `CLAUDE.md` in place (R2). Not yet committed. Verification figures are in the final
report, not repeated here.
