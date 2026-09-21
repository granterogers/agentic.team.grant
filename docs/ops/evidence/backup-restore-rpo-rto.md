# Evidence — backup reality, and the first proven restore

21 September 2026, branch `claude/production-reliability`.

## What performs unattended backups

Not GitHub Actions. Every one of the nine workflows is `workflow_dispatch`
only — read from each `on:` block, not from the prose — so `backup.yml`'s
dump-and-rehearse pipeline has nothing invoking it.

What actually runs is a **duty**: `nightly-backup` → `office.backup` →
`src/handlers/backup.ts` → per-table gzip plus sha256 into the private
`backups` bucket, dispatched by the worker, which is itself kicked by the one
`pg_cron` entry (`worker-heartbeat`, `* * * * *`, 19,381 runs / 19,381
succeeded).

It is real:

| | |
|---|---|
| newest | `run-5264258d…`, 21 Sept 12:34, **246 objects, 12.5 MB** |
| cadence | daily; 18/19/20/21 Sept in the current per-table format |
| integrity | **123 of 123 objects checksum-clean** |
| coverage | **122 of 122 tables**, none skipped |
| retention | nothing ever deleted (deliberate); 26 runs held |
| location | **the same Supabase project it protects — no offsite copy** |
| observed gap | **17 Sept is missing entirely** |

## The first proven restore

`npm run backup:rehearse` had never recorded a result. It has now run to
completion:

```
✅ there is a backup to restore from — folder run-5264258d…, 122 table object(s)
✅ every object in it is the one that was written, byte for byte — 123 object(s) checksum clean
✅ it decompresses into something with tables in it — 122 table(s), at migration 0533
✅ the next backup would contain every table in the database — 122 table(s), none skipped
✅ and the stored copy is either current or honestly behind — current — all 122 tables present
✅ the rows load back into a database — 153259 of 153259 row(s) restored
✅ and every table came back with the number of rows the archive claims — 100 table(s), every count matched
✅ no append-only table has lost rows since the archive was taken — 15 append-only table(s), none shorter

8/8 checks passed
Recorded as a backup.rehearsed event: passed.
```

**153,259 of 153,259 rows.** Recorded in `public.events` as
`backup.rehearsed`, so `app.backup_health()` can now answer the question that
had no answer.

## RPO and RTO, measured rather than estimated

| | |
|---|---|
| **RPO, by design** | ~24 h (daily duty) |
| **RPO, observed worst case** | **48 h** — the 17 Sept gap |
| **RTO, data round trip** | **9 min 46 s** for 153,259 rows / 122 tables / 12.5 MB, end to end including download, checksum, decompress, load and verify |
| **RTO, before that** | plus applying migrations from git: the archive carries rows and a column list, **not DDL** |
| **RTO, the dominant unmeasured term** | **plus every credential re-entered by hand.** The dump excludes the `vault` schema, correctly. `vault-export` is a duty and it is **disabled and has never run**, so a restore today yields a working database with an empty vault. |

The first attempt at the rehearsal **timed out at ten minutes**, and it had
already finished restoring — it ran out of time *checking* the restore it had
just done, in two loops of 122 sequential `count(*)` calls over HTTPS. Those
are one `union all` each now: 244 round trips became 2, and the whole
rehearsal finishes inside the foreground ceiling Grant's standing instruction
requires.

## Defects found and fixed in this block

**The reading could not see the backup.** `app.office_health()` had no backup
age and no restore age. On 17 Sept it read `failed: 1` for 24 hours in a
window nobody watches; the next day it read clean with the 17th missing for
ever. `app.backup_health()` and `app.last_progress()` now exist and 0538
splices both into `office_health` — spliced from the live definition, with the
migration RAISING if its anchor is absent rather than applying a no-op that
looks like success, because three sessions share this database.

**Nothing knew whether a restore had ever worked.** `backup:rehearse` printed
and exited. It records both outcomes now — a rehearsal that *failed* is the
most important thing it can discover, and a ledger holding only successes
cannot tell "the last one failed" from "nobody ran one".

**An interrupted rehearsal leaked a schema into production.** Reproduced:
killed at nine minutes, left `restore_rehearsal` holding 82 scratch tables in
the live database. A timeout, a cancelled CI job and an OOM all do this, and
no handler catches SIGKILL — so the sweep moved to the **start** of the run,
where it covers every way the process can die. Signal handlers were added as
the polite half.

**The progress reading was about to cost four seconds.** Measured before
committing to it: each of `last_progress()`'s three `max(occurred_at)` by
`to_state` was a **1,227 ms sequential scan**, 78,535 rows removed by filter,
on a table growing ~6,000 rows a day. With
`job_transitions_state_time_idx`: **2.1 ms**, index-only. A reading that takes
four seconds is one people stop consulting.

## How Grant finds out

A **chore**, not a message — the same mechanism 0484 built for dead
credentials, for the reason it states: the chore lands on My Tasks where he
reads a list of things to do, and `chore_key` with `on conflict do nothing`
means one row rather than one message an hour. That is invariant 18 —
persistent incidents dedupe rather than alert-storm — satisfied by
construction rather than by a cooldown somebody has to tune. It clears in the
same pass that raises it.

Wired into `office.chores`, which already runs hourly, rather than getting a
schedule of its own: a second clock is a second thing that can silently stop.

| Control | Result |
|---|---|
| condition true → chore raised | **1** |
| second pass while still true | **0 raised, still 1 open** |
| condition cleared → chore cleared | **1 cleared** |
| chores left behind by the drive | **0** |
| threshold restored afterwards | **192** |

`npm run verify:backups`, in the gate. 10/10. It **prints** the ages rather
than asserting them: `backup_overdue` going true is a real finding and the
chore is what should carry it, and a check that cries wolf is one somebody
starts overriding.
