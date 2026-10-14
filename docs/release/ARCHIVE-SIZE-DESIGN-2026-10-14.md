# Archive size: the bounded mechanism, and the multi-part set (14 October 2026, #471 item 5)

## What the archive does today

- A project that fits one archive is one ZIP, built in memory, capped at **8 MB** (`ARCHIVE_LIMITS.maxBytes`). Unchanged.
- A project that does not fit is carried as a **set** of parts (see below). Each part is an ordinary ZIP of at most 8 MB.
- Each original document file is stored once, named by its SHA-256, and listed in the manifest (single archive) or in the
  set's index (set).

## The defect found and fixed earlier (14 October 2026)

An export used to read **every** stored original into memory and only then compared the total with the cap. A refusal
therefore cost the project's size, not the cap's.

**Fixed:** the cap is checked against the sizes the database already records (`documents.byte_size`) before any file is
read. A project over the cap is refused with 413 and **zero reads**. Proved by a test that counts reads; disabling the
check turns it red.

## Limits, named in code and asserted by tests

| Limit | Value | Where | What happens above it |
|---|---|---|---|
| One archive | 8 MiB | `ARCHIVE_LIMITS.maxBytes` | the single download answers 413 with `use_set: true` |
| File bytes per part | 5.5 MiB (8 MiB less 512 KiB overhead and 2 MiB for the package) | `SET_LIMITS.fileBytesPerPart` | a larger single original is refused by name: it cannot yet be carried |
| Parts per set | 32 | `SET_LIMITS.maxParts` | refused before any file is read |
| Whole set | 176 MiB (parts × file bytes per part) | `SET_MAX_FILE_BYTES` | refused before any file is read |
| Package (text, documents, tasks) | 2 MiB | `SET_LIMITS.packageBytes` | refused: the project itself is too large |
| Restore request body | 8 MiB | `ARCHIVE_LIMITS.maxBytes`, checked against Content-Length and the actual size | 413 before the body is read |

Memory per request is bounded by one part: the gateway holds at most one part's files, the package and the ZIP it builds.

## The set (built)

1. **Index.** `GET project_archive?set=index` reads each original once, keeps its SHA-256, and assigns it to a part
   (first-fit, in document order). It returns the set key (the SHA-256 of the index bytes), the part count and each part's
   size. The index, the package and the plan are cached under `exports/<office>/<cache id>/`, so every part of one
   download reads the same set even if the project changes in between.
2. **Parts.** `GET project_archive?set=<key>&cache=<id>&part=N` builds one part from the cache, reading only that part's
   files. Part 1 also carries the package (`project.json`). Each part names the set (`set.json`) and its number
   (`part.json`). The download is named `<slug>-set-<key>-part-N-of-M.zip`, so the page can group parts without opening them.
3. **Restore, part by part.** `POST project_restore?set=<key>&part=N` (one part per request). The part is opened and checked
   against the index: the set key, the part number, exactly the files the index assigns to it, each file's size and
   SHA-256. Its originals are written under `restores/<office>/<key>/`, read back and compared (the existing write rule),
   and a marker records what was written **before** each write. Part 1 also stores the index and the package.
4. **Commit.** `POST project_restore?set=<key>&commit=1`. Refused unless every part is present. The package is handed to the
   database with each original's stored path set. If the database refuses, everything the set wrote is removed, and the
   markers are removed too, so a sent-again part is written again rather than believed.
5. **Abandon.** `POST project_restore?set=<key>&abandon=1` discards an uncommitted set. A committed set is refused, because
   its files now belong to a project.

The page: the download button asks for the single archive, and on `use_set` it fetches the index and saves each part as it
arrives. The restore control accepts several files; they must be every part of one complete set, or the page says which
part is missing before any byte is sent.

## Proof

- `tests/portability/parts.test.ts` (17): planning and its refusals by reason, the index's stable bytes, a part round trip,
  and each way a part is refused (altered file, wrong number, extra file, package on the wrong part, not a set).
- `tests/portability/set-store.test.ts` (13, one a regression): export, restore, one commit, and rollback at every step,
  including a refused commit followed by a resent part.
- `tests/gateway/project-set.test.ts` (12): the same through the real gateway handler, with the storage and database faked.
  Includes a cross-office check: a part cannot be read through another office's export.
- `scripts/verify/archive-browser-local.ts` (S1–S4, desktop and phone): the browser downloads every part, named for the set;
  the page restores each part in order and commits once; a committed set opens the project; half a set is refused in words
  and no part is sent.
- **Failure injection, run on purpose:** the missing-part check disabled → the commit tests go red; the marker cleanup on a
  refused commit removed → the gateway rollback test goes red; the stale-marker guard and the cleanup removed together → the
  set-level regression test goes red. Each restored, and the gate green again.

## Not built, and open

- **Files larger than one part.** A single original over 5.5 MiB cannot be carried in a set yet. The restriction is named
  to the user at download. Splitting one file across parts is the next step if a real project needs it.
- **Storage left by an export.** Each set download leaves its cache (index, package, plan) under `exports/`. Nothing sweeps
  it yet. Size per export is at most about 2 MiB (the package) plus the plan. A sweep, by age and by office, is needed
  before this runs at scale on the free storage tier.
- **Storage left by an abandoned restore.** A browser that closes mid-restore never sends abandon. Its parts remain under
  `restores/<office>/<key>/` until a sweep removes them. The set cannot create a project in that state.
- **Gateway deploy.** The new gateway modules (`parts.ts`, `set-store.ts`) are listed in the deploy file list and the deploy
  script, and the closure test passes. They are not deployed (no production writes in this work).

## Owner decision

- Keep the single 8 MB archive as the default, with sets offered only when a project needs them (as built).
- Approve the sweep for `exports/` and abandoned `restores/` (age and office rules) before the set path is used on
  production storage.
