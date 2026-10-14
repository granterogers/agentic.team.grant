# Continuity: how an autonomous run continues, stops and resumes

Read this when you start, resume or check on an autonomous run. The mission is in `docs/agent/CURRENT-MISSION.md`, and its
state is in `docs/agent/EXECUTION-STATE.json`.

## What exists, and what each part can and cannot do

| Part | File | What it does | What it cannot do |
|---|---|---|---|
| Execution ledger | `scripts/agent/lib/state.mjs` | Holds the mission and its sessions. Writes atomically, refuses a write based on a stale revision, takes over a lock left by a dead process. | Coordinate two machines. The ledger is committed, so two machines produce a git conflict, which is reported. |
| Stop decision | `scripts/agent/lib/gate.mjs` | Decides whether a session may end: holds it while work remains, lets it end when the work is finished, blocked, cancelled or past the deadline. | Keep a session alive by itself. It only answers the question when the model tries to stop. |
| Stop hook | `.claude/settings.json` runs `scripts/agent/stop-gate.mjs` | Applies the decision at each stop. It holds the turn with `decision: block`, and the reason names what remains. | Hold a session beyond the platform's cap. Claude Code overrides a block after **eight consecutive** stops with no tool call; any tool call resets the count. |
| Supervisor | `scripts/agent/supervise.mjs` | Starts a session, watches it, restarts it after an unexpected end with backoff, stops on a crash loop or a budget, refuses a second supervisor, and shuts down cleanly on a signal. | Start anything by default. It launches only with `--launch`, and each launch uses model usage. |
| Owner controls | `scripts/agent/mission.mjs` | `status`, `stop`, `resume`. | Change the mission's scope or deadline. A new deadline is written into the mission record by a person. |

## What launches the next session

Two mechanisms, with different reach.

1. **Inside a live session.** The stop hook holds the model at the moment it tries to end a turn, and the model keeps
   going. This works only while the process is alive, and it is capped at eight consecutive text-only stops.
2. **After a session has ended.** Nothing in this repository starts a new session on its own. The supervisor does, when
   an owner runs it with `--launch`: it starts `claude -p` (or the command in `AGENT_LAUNCHER`) with a resume prompt built
   from the ledger, and waits for it to end. A session started this way is charged to model usage, which is why nothing
   starts it without an owner's command.

A scheduled routine could run the supervisor on a timer. That would be a new, billable, externally configured process, and
it needs Grant's approval before anyone creates it. It is not set up.

## Commands, run from the repository root

Plan only. Starts nothing and costs nothing:

    node scripts/agent/supervise.mjs

Start the run. Costs model usage. Requires Grant's approval for this mission:

    node scripts/agent/supervise.mjs --launch

Check where the run is:

    node scripts/agent/mission.mjs status

Stop the run. The next stop ends it and no new session starts. A session already running finishes its turn:

    node scripts/agent/mission.mjs stop

Stop it at once. Interrupt the supervisor (Ctrl-C, or `kill -TERM` on its process). The child session is signalled and the
mission is recorded as paused:

    kill -TERM <supervisor pid>

Resume a paused, blocked, cancelled or expired mission. Refused while the STOP file exists, and refused after the
deadline:

    node scripts/agent/mission.mjs resume

Clear a stop, deliberately, before resuming:

    rm docs/agent/STOP

## Limits, and where they are set

| Limit | Value | Where |
|---|---|---|
| Held stops per session in a row | 25 | `scripts/agent/lib/gate.mjs` (`maxConsecutiveBlocksPerSession`) |
| Held stops per mission | 500 | `scripts/agent/lib/gate.mjs` (`maxBlocksPerMission`) |
| Restarts after an unexpected end | 5 | `scripts/agent/supervise.mjs` (`POLICY.maxRestarts`) |
| Sessions in total | 12 | `scripts/agent/supervise.mjs` (`POLICY.maxSessions`) |
| Backoff after a failure | 10 s, doubling, capped at 10 min | `POLICY.baseBackoffMs`, `maxBackoffMs` |
| Crash loop | 3 failures within 10 min | `POLICY.crashLimit`, `crashWindowMs` |
| Stale lock | 60 s, or owner process gone | `scripts/agent/lib/state.mjs` (`STALE_LOCK_MS`) |

The platform's own cap on consecutive stop-hook continuations (eight) is not configurable here.

## Recovery after an interruption

- **The ledger is the memory.** A new session is given the resume prompt built from `EXECUTION-STATE.json` (mission, deadline,
  branch, done and open requirements, next action). It does not depend on what the previous session remembered.
- **A session that ended is recorded.** Its end, and why it ended (`exit 0`, `exit 1`, `signal SIGTERM`), is written to
  the ledger. A new supervisor links its first session to the last one recorded.
- **An interrupted write leaves the previous document intact.** Writes go to a temporary file and are renamed into place.
  A leftover temporary file is ignored and removed by the next writer.
- **A corrupt ledger is never overwritten.** The gate fails open (lets the session end) and reports the error; a person
  restores the file from git.
- **Concurrent writers are serialised by a lock, and a stale lock is taken over and reported.**

## Checkpoint and stop, defined

A **checkpoint** records progress and the session continues: a commit is pushed, a test suite passes, a pull request is
updated, a requirement is finished, the context is compacted, or one requirement is blocked. The model writes the
checkpoint into `EXECUTION-STATE.json` and carries on.

A **stop** ends the authorised execution: the deadline passes, Grant stops the run, nothing actionable remains, a budget is
spent, a crash loop occurs, or the checkout is on another branch. Blocking on one owner decision does not stop the other
work.

## What is verified, and what is not

- **Verified by tests against real processes:** the stop decision through the hook process; ledger atomicity, compare and
  swap, the cross-process race (six processes, sixty writes, none lost), stale-lock takeover; the supervisor against a
  stub child process (restarts, backoff, crash loop, budgets, deadline, STOP file, duplicate supervisor, SIGTERM, resume
  after interruption, branch guard); the owner controls. Sabotage checks showed each suite turns red when its rule is
  broken.
- **Not verified:** a live restart of a Claude Code session. A session costs model usage, and the owner has not approved
  one. The Stop hook's behaviour in a cloud session follows the documentation (a committed `.claude/settings.json`
  applies to a single-repository cloud session), which was not tested live.
