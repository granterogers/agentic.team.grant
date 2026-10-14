# Termination evidence: why development sessions stopped early (14 October 2026)

**Status:** the evidence record for P0-CONTINUITY-2026-10-14, requirement R1. Facts are from the session transcript on the machine that ran the work, and from the hook and launcher configuration on that machine. Hypotheses are marked as such.

**Transcript:** `/root/.claude/projects/-home-user-agentic-team-grant/b2af92ff-1369-5fb2-b233-077bdfdea46f.jsonl` (3,005 events, 13 October 22:31 UTC to 14 October 08:14 UTC). Only this one session's transcript was on the machine; no other sessions' records were available.

## 1. What the transcript shows

Five user messages, and four model turns that ended before the next user message.

| # | Turn start (UTC) | Last assistant event (UTC) | Active time | Tool calls | How the turn ended | Final message says |
|---|---|---|---|---|---|---|
| 1 | 13 Oct 22:31:18 | 22:39:23 | 8 min | 48 | model, `end_turn`, text only | "Work stopped at the approval gate … this is one slice of four workstreams, not the eight-hour cycle" |
| 2 | 14 Oct 06:54:36 | 07:26:28 | 32 min | 207 | model, `end_turn`, text only | "I've stopped at a checkpoint, not at the end of the eight-hour brief" |
| 3 | 14 Oct 07:33:12 | 08:00:53 | 27 min | 184 | auto compaction (see section 2) | last text: "Next I'll run the template check and the full unit suite" (mid-plan) |
| 4 | 14 Oct 08:03:12 | 08:07:45 | 4.5 min | 43 | model, `end_turn`, text only | a status report after one feature was pushed; more requirements remained |
| 5 | 14 Oct 08:14:02 | (this turn) | — | — | user message | the P0 mission |

Gaps between turns: 22:39 to 06:54 (about 8 hours 15 minutes, the owner away); 07:26 to 07:33 (7 minutes, the owner typing the next instruction).

**Verified:** every model-initiated end in the record is a plain text message with no tool call (`stop_reason` `end_turn`). None of the four ended in an error, a timeout or an external signal. The transcript has no error event.

**Verified:** the sessions did not end because the process was killed. Turns 1, 2 and 4 each ended with the model writing a report and stopping. Turn 3 was ended by the platform, not the model, and was continued automatically (section 2).

## 2. Compaction

One `compact_boundary` event exists, at 14 October 08:03:12 UTC, trigger `auto`, `preTokens` 784,512, `postTokens` 12,569, duration 50.4 s. The summary was then delivered as a new user message, and turn 4 continued the work.

**Verified:** compaction did not end the session. It was followed by continued work.

## 3. Hooks

The only registered Stop hook in that session was `~/.claude/stop-hook-git-check.sh`, from the launcher configuration `~/.claude/launcher-settings.json`. It ran three times (22:39:28, 07:26:33, 08:07:49), each with `hookErrors: []`, `preventedContinuation: false` and no output. It allowed every stop.

**Verified:** the one place where the platform could have held a turn open was in place and was not used for anything beyond the git check. The reply-gate hook (`~/.claude/stop-hook-reply-gate.py`) uses `decision: block` to keep a turn open, but it is registered only for Slack-originated sessions and was not registered here.

## 4. Configuration that told the model to stop

These are the instructions the model read at the start of each turn. None is a platform limit.

- `CLAUDE.md` (4,929 lines) line 17: "Do not reopen it, and do not start another development campaign, until he asks." This was written for a closed phase, and it contradicts any new mission.
- `docs/AUTONOMOUS-RUN.md` (3,363 lines) contains ten mission or checkpoint headings: one "CURRENT MISSION", four "PREVIOUS MISSION" sections, a "THE MISSION" section, and several checkpoints. Line 2035: "Do not start another synthetic campaign." Line 2547: "Do NOT start these without Grant."
- `docs/HANDOFF.md` line 1284: work "suspended … until Grant asks".

**Verified:** the repository contains several competing statements of what the current mission is, and some of them forbid the work the owner asked for. A model that reads them has a plausible reason to stop.

## 5. Platform limits

**Verified from the documentation (claude-code-guide, CLI 2.1.299):**

- A Stop hook can hold a turn open with `{"decision":"block","reason":"..."}`. The reason is fed back to the model.
- After eight consecutive continuations with no tool call, Claude Code overrides the next block and ends the turn with a warning. The count resets whenever the model calls a tool. The variable `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` may change this; its range was not read.
- A committed `.claude/settings.json` applies to a single-repository cloud session. Hooks in user settings are not read in cloud sessions.
- No documented maximum session length, turn length or total wall time was found. Cloud sessions "stop after a period of inactivity", and the period is not stated.

**Not verified:** whether any platform limit ended a session in this record. The transcript shows none.

## 6. Hypotheses, ranked by the evidence

1. **Most likely (supported by section 1):** the model ended its own turns with a summary, because nothing at the stop point checked whether authorised work remained. The instructions that said not to were present but unenforced, and some of them argued against continuing (section 4).
2. **Contributing (supported by section 4):** conflicting, historical instructions in the repository, including a standing prohibition on new campaigns.
3. **Not supported:** a platform time limit, a quota failure, an authentication failure, a supervisor or external process killing the session, or compaction ending work.

## 7. Reconstruction for the requested fields

| Field | Turn 1 | Turn 2 | Turn 4 |
|---|---|---|---|
| Start | 22:31:18 | 06:54:36 | 08:03:12 |
| End | 22:39:23 | 07:26:28 | 08:07:45 |
| Requested duration | eight hours | eight hours | eight hours |
| Actual active duration | 8 min | 32 min | 4.5 min |
| Last completed task | slice of standard-format serialisers | issues #466 to #473 created, per-project export corrected | draft PR body updated |
| Remaining actionable work | three workstreams | feature work and verification | feature work and verification |
| Last tool operation | ToolSearch / PR create | WebFetch / GitHub update | GitHub update |
| Compaction, timeout, error | none | none | none |
| Voluntary final response | yes | yes | yes |
| External process ended it | no | no | no |

Turn 3 (27 minutes, 184 tool calls) ended by compaction at 08:03:12, not by a final response. It is the only one that stopped mid-task, and it continued.

## 8. What this does not prove

- It does not prove that no platform limit exists. It shows that none fired in this record.
- It is one session's transcript. The pattern may differ on other machines or launchers.
- The cost-state records in the transcript have no timestamps, so they were not used to date anything.
