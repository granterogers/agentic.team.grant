# Live restart trial (14 October 2026): result

**Verdict: PASS for one controlled restart.** One real Claude Code session was started, completed its first requirement, exited, and was restarted once by the supervisor. The resumed session finished the remaining requirements, and the supervisor recognised completion. This is one short trial with three harmless file writes. It is not evidence of eight-hour reliability.

Requirement R7 of mission `P0-CONTINUITY-2026-10-14` (issue #474). Authorised by Grant on 14 October 2026 under the terms in the request: at most two model sessions, one restart, fifteen minutes, US$1.00.

## What was run

- **Trial mission:** `M-TRIAL-LIVE-20261014`, three requirements: write `alpha`, `beta` and `gamma` into three files in a disposable workspace outside the repository.
- **Driver:** a local script (not committed) calling the committed `scripts/agent/supervise.mjs` with `--launch`, a per-launch instruction, a session-id flag, a spend budget, and a wall-clock limit of nine minutes (inside the fifteen-minute ceiling, and inside one foreground call).
- **Launcher, exact:** `claude -p --model claude-haiku-5-5 --output-format json --permission-mode acceptEdits --permission-prompts none --max-budget-usd 0.40 --allowedTools=Read,Write,Edit --disallowedTools=Bash,WebFetch,WebSearch --strict-mcp-config --mcp-config=<empty file>`, with the resume prompt appended.
- **Isolation:** the session's working directory was the disposable workspace, outside the repository, so the repository's Stop hook and mission did not apply. No shell, web or MCP tools were available. Nothing could reach git, a pull request, a deployment, or production.

## Evidence

| Field | Value |
|---|---|
| Supervisor start | 14 October 2026, 08:57:07 UTC (session 1 start; the first supervisor log line) |
| Supervisor stop | 14 October 2026, 08:57:49 UTC |
| Actual wall-clock duration | about 43 seconds (the supervisor's own clock; the limit was nine minutes) |
| Model sessions launched | 2 (the maximum was 2) |
| Automatic restarts | 1 (the maximum was 1) |
| Session 1 | id `9dbe6fa8-…`, started 08:57:07, exit 0 at 08:57:24, 7 turns, 13.6 s |
| Session 2 (resumed) | id `d58b40bc-…`, started 08:57:29, exit 0 at 08:57:49, 11 turns, 17.9 s |
| Session 2 parent | session 1 (recorded in the ledger) |
| Session ids | the supervisor passed each id with `--session-id`; the CLI's own result reported the same id in both sessions |
| Exit reasons | `exit 0`, `exit 0`; neither was a crash or an interruption |
| Supervisor transitions | start 1 → end 1 → resume after 5 s → start 2 → end 2 → mission complete → stop |

### Checkpoint and state persistence

- After session 1, the ledger's requirement R1 was `done` with a checkpoint summary, and `tasks/one.txt` contained `alpha`. Session 1 was instructed to stop after R1. Its file write (08:57:13) came before its exit (08:57:24).
- The supervisor wrote its own records under a lock, and the ledger held both sessions with the parent link.
- After session 2, all three requirements were `done`, and the mission status was `complete`.

### Completed work was not repeated

- `tasks/one.txt` was last modified at 08:57:13, before session 2 started (08:57:29). Session 2 did not rewrite it.
- Session 2 wrote `tasks/two.txt` (08:57:33) and `tasks/three.txt` (08:57:35), the two remaining requirements.
- This is consistent with the resumed session reading the saved state, and it is inferred from the outcome. The transcript of the session was not examined.

### Completion recognition

The supervisor stopped with `mission complete after session d58b40bc-…`, and its outcome was `complete`. It started no third session.

### Cost

| | Value |
|---|---|
| Session 1, reported by the CLI | US$0.010642 |
| Session 2, reported by the CLI | US$0.007606 |
| Total reported | US$0.018248 (the supervisor recorded 0.0182) |
| Authorised ceiling | US$1.00 total; US$0.40 per session |

**Discrepancy to note:** these are the CLI's own `total_cost_usd` values, printed in each result. They are not a billing record, and I have not compared them with the provider's invoice. Whatever is billed should be checked there. If a session's cost had been unreadable, the supervisor would have counted it at the full US$0.40, so the figure above is not a lower bound on what the run could cost.

**Ledger revision:** the ledger recorded revision 6. My trace of the supervisor's writes accounts for five: two session starts, two session ends, and the final completion write. I did not identify the sixth. The sessions, parent links, statuses and file outcomes are all correct, so the extra write does not change the result, but I have not explained it.

## Safeguards, as they held during the trial

- **Session count:** two launches, enforced by the supervisor's session budget before each start.
- **Restart count:** one, enforced by the restart budget.
- **Wall-clock:** the run ended in about 43 seconds, far inside the nine-minute limit. The watchdog that enforces the limit during a session was not triggered in this run; it is covered by the local tests below.
- **Spend:** the budget check before the second start used the first session's reported cost. The launcher's own `--max-budget-usd` flag capped each session.
- **Mission identity:** the run was pinned to the trial mission id, and the trial workspace is separate from the repository ledger. The repository's own mission was not read or changed.
- **Process cleanup:** no `claude` child remained after the run.
- **Lock release:** the supervisor and ledger locks were both released.

## Local tests, no model calls

These were run before the trial, and the trial did not depend on them to pass.

- The watchdog tests (wall-clock, deadline, STOP during a session, SIGTERM then SIGKILL escalation) pass. Disabling the watchdog turned all four red, then green again when restored.
- Spend tests: the cost is read from the result; an unreadable cost counts at its cap.
- Mission-identity refusal writes nothing to the foreign ledger.
- Session ids and per-launch instructions are passed and recorded.
- A duplicate supervisor, stopped with SIGTERM, cleans up its child. A test originally stopped it with SIGKILL, which left its child running. That gap was found during this trial's cleanup check, fixed, and is covered by an assertion now.

## Defects found and fixed while preparing the trial

1. **Restart budget off by one.** `maxRestarts: 1` allowed no restart at all. Now it allows exactly one.
2. **No watchdog while a session ran.** A running child was never stopped at the deadline, the wall-clock limit or a STOP file. Now it is, with a SIGKILL escalation.
3. **No spend accounting or mission-identity guard.** Both were added.
4. **Crash loop slept through the backoff before stopping.** It now stops first.
5. **Orphaned child after a SIGKILLed supervisor.** The test harness caused it. Stubs now exit when their parent disappears, and the test stops the supervisor with SIGTERM.

## What this does not show

- **One trial.** It is not eight hours, and it is not a reliability measurement.
- **Three trivial tasks.** A real development session is longer, uses more tools, and can fail in ways this trial does not exercise.
- **Recovery from a real interruption.** The first session ended by its own clean exit, on the instruction to stop. The supervisor's restart after a crash, a signal or a deadline is covered by local tests, not by a live session.
- **The provider's billing.** Cost figures are the CLI's own reports.
- **The Stop hook in a cloud session.** Not exercised by this trial, which ran outside the repository.
- **The cause of the extra ledger write.** Not established.

## Next

No further live trial is authorised. A longer or more realistic trial needs a separate authorisation.
