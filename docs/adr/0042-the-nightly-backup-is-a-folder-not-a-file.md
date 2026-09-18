# ADR-0042 — the nightly backup is a folder, not a file

**Status:** accepted, 18 September 2026
**Supersedes:** the single-archive shape `src/backup/portable.ts` was written with
**Related:** §16 of `docs/account-continuity.md`, #17 (Actions off), ADR-0011 (no build step)

## What forced it

`office.backup` failed on 17 September 2026 and said nothing. Its transition
log is the whole diagnosis:

```
queued  -> running    dequeued by edge-4ad731f3
running -> retrying   recovery: worker edge-4ad731f3 died holding this in running
… five times …
        -> failed     recovery: 5 attempts exhausted while in running
```

Measured rather than inferred: `buildArchive` reads all 119 tables into
memory, gzips one 52 MB JSON and uploads it — **148 seconds**, 107,193 rows,
on a machine with a fast link and no function limit. A Supabase edge function
does not get that long.

**The last backup that completed was 16 September**, and the archive grows
every night. It was not a flake and it was never going to recover on its own.

## The decision

One gzipped object per table, plus a manifest, under a prefix per run. Each
table is a checkpointed `runSteps` step (#263), so a tick that is killed has
banked everything before it and the next attempt resumes at the next table.
No tick holds more than one table in memory.

## The three details that have an obvious wrong answer

**The prefix comes from the JOB, never the clock.** A timestamped prefix gives
a resumed tick a different folder from the one it was half way through, so
every interruption orphans its work and nothing ever completes — this defect
reintroduced one layer down. `run-<jobId>`.

**The effect is `local`, not `external`.** `external` means *"a resume cannot
tell whether this committed, so park"*, which is right for a message that may
have been sent twice. Here the key is deterministic and the upload is an
upsert, so repeating a step overwrites the same object with the same bytes.
Declaring `external` would park the job on the first interruption and defeat
the change entirely.

**The manifest is written LAST.** Its presence is what makes a folder a
complete backup. A folder with 80 of 119 tables and no manifest is visibly
interrupted, where a truncated single file is not — and a restore that loaded
three quarters of an office while reporting success is the most dangerous
thing this module could do. `newestFolder` skips any folder without one.

## What is NOT changing, and why

**Nothing is excluded from the backup.** Dropping
`job_state_transitions` (53,457 rows, half the total) would have halved the
time in one line, and it is telemetry rather than knowledge. It is also
Grant's data, and a backup that quietly stops covering tables is invisible
until somebody needs one back. The structural fix keeps everything.

**`buildArchive` stays.** `scripts/backup/export-portable.ts` runs on a real
machine with no timeout and is how a one-file copy is taken by hand. Removing
it to make the two paths symmetrical would delete a working capability to tidy
up.

**The legacy single files stay readable.** `backup:rehearse` prefers a folder
and falls back to them. They are real backups of a real office and the
rehearsal is what says they can be restored; the fallback goes when they age
out, not before.

## What a future agent must not do

- Do not make the prefix time-based. See above; it looks tidier and it breaks
  resumption.
- Do not promote the effect to `external` "to be safe". It is the unsafe
  choice here, for the reason stated.
- Do not write the manifest first, or alongside. Its lastness is the only
  signal that distinguishes a backup from an interruption.
- Do not restore from a folder without checking the per-object checksums.
  `readFolder` does; anything else written later must too.

## Evidence this was the right call

Exercised against the deployed worker on 18 September:

- attempt 1 banked **111 of 120 steps** before the function was killed;
- the lease expired, `app.recover_stalled_jobs` moved it to `retrying`;
- **attempt 2 finished all 120** — 107,255 rows across 119 tables, 9.6 MB;
- `npm run backup:rehearse` then restored **107,255 of 107,255 rows** into a
  scratch schema with 120 objects checksum-clean and every table's count
  matching the manifest.

The first backup to complete since 16 September, and the first restore
rehearsed from one.

## Cost

Unchanged in storage terms (9.6 MB compressed per night, same data). The
restore reads 240 objects where it used to read two, so `readFolder` batches
eight at a time: the first sequential run took over fifteen minutes printing
nothing, in a script that is in the `verify:db` gate.
