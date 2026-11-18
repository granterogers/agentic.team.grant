# ADR-0076: A large table is backed up in parts, one checkpointed step each

**Status:** Accepted (code and replica proof; the worker deploy needs the owner's approval)

**Date:** 18 November 2026

**Issue:** #503

## Context

No nightly backup finished from 9 to 17 November 2026. Every `office.backup` job ended `failed: recovery: 5 attempts
exhausted while in running`, each folder stopping at the same table, `public.job_state_transitions` (280,782 rows, 72 MB).

The production step records (`public.job_steps`, read-only, 18 November) show why. On 8 November, the last success, the run
took four attempts, and each died after writing about 13 to 16 MB of compressed output, whatever the time:

| Attempt | Steps | Seconds | MB written |
|---|---|---|---|
| 1 | 66 | 31 | 15.5 |
| 2 | 1 (`job_state_transitions` alone) | 12.6 | 16.1 |
| 3 | 62 | 30 | 13.1 |
| 4 | 29 | 10 | 0.4, then the manifest |

The job queue already lets a long job continue: an attempt that finishes at least one checkpoint earns another slice
rather than spending an attempt (migration 0536, ceiling `jobs.max_dequeues` = 60). That rule only helps if every step
fits inside one attempt. By 9 November `job_state_transitions` alone was larger than an attempt can hold. So every
attempt began on it, died inside it, finished nothing, and spent an attempt. Five attempts later the job failed. The
table grows every day, so this would not recover.

## Decision

1. **A large table is written as several key-range parts, each its own checkpointed step** (`src/backup/parts.ts`). A
   part is read with the same keyset pages as a whole table, bounded above as well as below (`pageSql`'s `through`).
2. **The parts are chosen once, in the run's first step (`plan:parts`), and checkpointed.** Every later attempt reads the
   plan back from that checkpoint, so step names and ranges are identical however many attempts the run takes. The last
   range is open-ended, so a row added after planning is still read.
3. **Which tables, and how big a part:** a table of at least 8 MB on disk, with a usable key, at 16 MB of JSON a part
   (about 2 to 4 MB compressed here). The average row width is measured on a 10% sample. On production data on
   18 November this splits `job_state_transitions` into 5 parts, `jobs` into 4, and `events` and `outputs` into 2 each;
   the largest remaining single step is about 5.5 MB. A table with no key (read by `ctid`) is never split.
4. **The format:** a part is `run-<id>/<schema>.<table>.part-NNNN.json.gz`, holding `{"table":…,"part":n,"rows":[…]}`.
   The manifest gains `parts: { table: [keys…] }` and says `format: "folder/2"` only when a table was split, so a backup
   with no split table is byte-for-byte the old layout. A whole table keeps the name every earlier backup uses.
5. **Every reader asks one function** (`objectKeys` in `manifest.ts`) which objects hold a table, so verification and
   restore cannot disagree. `verifyArchive` requires every part present with its recorded checksum. The typed restore
   loads all parts and checks the total against the manifest's count and the table's fingerprint. Fingerprints are sums
   mod 2^64, so the parts' fingerprints add up to the table's exactly. `readFolder` (verification and `backup:rehearse`)
   appends parts.
6. **The checkpoint version moves to `office.backup@2`.** A run begun under `@1` is refused its old checkpoints by
   `app.step_begin` rather than mixing two layouts in one folder.

## Proof

`scripts/isolated/backup-restore-typed.ts` (83 assertions, green). At the production thresholds, the 120,000-row probe
table with a composite `(bigint, uuid)` key is written in 4 parts. The parts hold every row exactly once. The typed restore
and the independent fingerprints match. A missing part fails verification, naming the part. **The production failure
itself is reproduced:** the worker is made to die as part 3 begins. The plan and parts 1 to 2 are banked and there is no
manifest. The next attempt reuses the same plan, does not redo the banked parts, finishes, and verifies.
`tests/backup/parts.test.ts` covers the pure pieces.

## Consequences

- A backup is still not one snapshot (it never was, table by table: `docs/ops/restore-procedure.md`). A split table is
  now read part by part, possibly minutes apart. A row inserted into an already-read range during the run is not in that
  backup. The manifest records what was written, and verification and restore hold it to that.
- More steps, so a few more database round trips a run, and the `plan:parts` step adds about 25 small catalog and
  sample queries.

## Rejected

- **Bigger pages for the one table.** Fewer round trips, but an attempt dies on bytes written, not on round trips, and it
  only delays the failure while the table grows.
- **Trimming `job_state_transitions`.** It would help the 500 MB database too, but it deletes audit history and is the
  owner's decision. It remains an option, not this fix.
- **Parts decided afresh on each attempt.** Row counts move between attempts, so the step names and ranges would move with
  them, and a banked part could no longer be trusted to be the same range.
