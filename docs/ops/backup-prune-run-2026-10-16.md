# Backup retention run, 16 October 2026

Approved by the owner after a dry run showed the exact list (27 backups, 341.4 MB). Command:
`ALLOW_PRODUCTION_CHECKS=1 ALLOW_PRODUCTION_WRITES=1 npm run backup:prune -- --attended`.

## Result

- Before: 39 items. After: 12 items (11 kept, 294.1 MB; 1 incomplete, never deleted).
- Deleted 27 backups. Every name matched the approved list (checked name by name against the dry run).
- Final dry run: `remove 0 run(s)`.

## What went wrong on the way

- The first attended run hit the ten-minute foreground limit during deletion. It deleted 21 of the 27 backups, then was killed.
- `run-ac06313e-f898-4b22-8dc4-7b2d0a4f0741` was left partly deleted: its size fell from 19.0 MB to 18.0 MB, and its manifest
  was still present, so it still read as complete. The deletion removes a folder's data objects first and its manifest last,
  so an interrupted folder is normally marked incomplete, which is safe. This one was not marked incomplete.
- A second attended run finished the other six (1,598 objects in total). That run re-verified the remaining backups first.

## What this means for the next run

- A deletion killed midway can leave a folder that still looks complete. Do not rely on the manifest alone.
- Deletion needs to run in its own foreground call with no verification in front of it, or the script needs to be
  resumable and to re-check each folder before it removes anything from it.
- The restore rehearsal (docs/ops/RESTORE-RUNBOOK.md) was run on the newest kept backup only. It was not run on any
  deleted backup, and it was not run on the partly deleted folder.
