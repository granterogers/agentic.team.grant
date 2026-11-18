# ADR-0077: The nightly backup verifies its own run once, and prunes expired backups when the owner switched it on

**Status:** Accepted (code and replica proof; the worker deploy, the switch and the marker backfill each need the owner's approval)

**Date:** 18 November 2026

**Issue:** #503

## Context

Backups were never deleted automatically. The rule was Grant's: *"you should always check before making any destructive
action with me."* By 18 November they had filled the 1 GB File Storage allowance (1,203.8 MB of 1,281.7 MB), and Supabase
warned of restriction from 18 December. Pruning them by hand cleared the warning. Asked whether the nightly backup should
also delete expired backups so it cannot happen again, Grant chose **"Auto-prune nightly"** on 18 November, and on the
same day asked for it to be built.

His retention policy (7 October 2026) keeps the newest 7 daily VERIFIED backups plus the newest verified backup of each of
the previous 8 ISO weeks. "Verified" means every object read back and matched its recorded checksum. The attended
`backup:prune` verifies by reading every run. Doing that every night would read about 466 MB a night, roughly 14 GB a
month of egress against the free 5 GB.

## Decision

1. **Verify once, when written.** After the manifest, the nightly job reads back every object of the run it just wrote,
   one checkpointed step per object (no step holds more than one object), and compares each sha256 with the one
   recorded when it was written. About 45 MB of egress a night. If all match, it writes `run-<id>/verified.json`, the
   verify-once marker. A mismatch is recorded and announced, not retried.
2. **The nightly prune trusts the marker.** A run counts as verified only with BOTH its manifest and its marker. An
   unmarked run is reported and never counted or deleted. Interrupted runs are reported and left for
   `backup:prune -- --interrupted`.
3. **It runs only when the owner switched it on:** `system_config` key `backup.auto_prune` = `true`, with
   `self_adjustable = false`. Absent, anything else, or a self-adjustable row all read as OFF. The table defines
   `self_adjustable = false` as the boundary for destructive-action policy, so the office's own adaptation cannot turn it on.
4. **Its own limits**, checked at the moment of deletion, in place of a person's `--attended` and the production-write
   flags (`applyScheduledRetention`):
   - nothing unless tonight's run verified;
   - never tonight's run;
   - only run folders this system made, never anything unverified or unfinished;
   - **at most 3 a night, and a longer plan is refused whole and announced.** Steady state is one a night, and more
     means something is wrong, so it becomes a person's decision;
   - each run is listed again before deletion, and one that has lost its manifest or marker is skipped.
5. **The marker goes first** when a run is emptied, with the manifest, so a half-deleted run never reads as verified.
   The marker is left out of a run's date, so a marker written days later (a backfill) cannot move the run's day or
   ISO week.
6. **Backfill:** `backup:prune -- --attended` writes the marker on every kept run it has just read back and found whole.
7. Checkpoint version `office.backup@3`.

## Proof

`scripts/isolated/backup-restore-typed.ts`, 88/88, with the real handler and the Storage emulator:
- tonight's run is read back and marked;
- with the switch off, a full night deletes nothing and says so;
- with the switch on, the run deletes exactly what the policy names, computed independently from the same listing (3);
- an unmarked backup, an interrupted run and tonight's run are untouched;
- a self-adjustable switch reads as off.

`tests/backup/auto-prune.test.ts` (11) covers the guards: off is an answer, more than 3 is refused whole, never tonight's
run, never unverified, unfinished or foreign, a run that lost its marker is skipped, a refused plan deletes nothing, and
the marker leads deletion without moving the run's date.

## Consequences

- About 1.4 GB a month of egress for the nightly read-back, within the free 5 GB (0.01 GB used on 18 November).
- A marker records a verification at one moment. Corruption after that moment is caught by the attended prune, the
  restore rehearsal and verification before any restore, not by the nightly prune.
- After a long outage, or the first night after the switch goes on with a backlog, the plan can name more than 3, and the
  nightly refuses and announces it. The attended prune clears the backlog.

## Rejected

- **Re-verify every kept backup nightly.** It is the strongest check, but costs about 14 GB a month of egress.
- **Compare Storage's eTag with an MD5 recorded at write time.** No egress, but it proves only that Storage holds the
  bytes, not that they read back, and the eTag's meaning is Storage's to change.
- **Cap with the planner (delete the oldest 3 of a longer list).** A wrong policy would then quietly delete 3 a night for
  ever. Refusing whole makes it visible.
