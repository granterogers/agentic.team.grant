# Archive size: the bounded mechanism, and the scalable design (14 October 2026, #471)

## What the archive does today

- One ZIP per project, built in memory, capped at **8 MB** in total (`ARCHIVE_LIMITS.maxBytes`).
- Each original document file is stored once, named by its SHA-256, and listed in the manifest.
- Restore accepts one ZIP of at most 8 MB, reads it into memory, and writes its originals under the restoring office.

## The defect this batch found and fixed

Before this batch, an export read **every** stored original into memory and only then compared the total with the cap. A
project with a large amount of originals was loaded in full before it was refused, so the memory a refusal cost was the
project's size and not the cap's.

**Fixed (14 October 2026, `src/portability/originals.ts`, `gatherOriginals`):** the cap is checked against the sizes the
database already records (`documents.byte_size`, carried as `original.bytes`) before any file is read. A project over the
cap is refused with 413 and **zero reads** from storage. Proved by a test that counts reads, and by disabling the check:
the test goes red. The sum is the naive total, which can only overstate what the archive would hold, so a refusal is
never a false one; a project whose duplicate files would fit once de-duplicated is still refused, which is the stated
cost of checking before reading.

## What is bounded now

| Path | Memory bound | Limit |
|---|---|---|
| Export, refusal | Zero file bytes (checked from recorded sizes) | 413 above 8 MB of originals |
| Export, success | At most 8 MB of files plus the package and the ZIP | 8 MB |
| Restore | The request body (at most 8 MB, checked against Content-Length and actual size) | 8 MB |

## The scalable design (not implemented here)

Realistic projects can exceed 8 MB of originals. The right answer is a **multi-part backup**, and it needs three things
this batch did not build: a gateway that returns several parts, an interface that downloads and names them, and a restore
that accepts a set.

1. **Parts.** The export is split into a sequence of archives, each at most 8 MB, plus a first part that holds the
   package, the manifest, and an index listing every part with its name, size and SHA-256.
2. **Download.** One request per part (`project_archive?part=N`), so the browser never holds more than one part in
   memory at a time. The page saves each part as it arrives.
3. **Restore.** The page sends the parts as a set. The gateway checks each part against the index, refuses a missing or
   duplicated part by name, and only then writes the originals. The same copy-verify-remove rule applies across the set.
4. **Key.** The restore idempotency key becomes the SHA-256 of the index, which names the whole set.

**Recommendation:** build the multi-part form when a real project needs it. Until then the 8 MB cap is honest: it refuses
with the reason, before reading anything.

## Owner decision

- Keep the 8 MB cap until a project needs more, or ask for the multi-part backup now (the build is larger than this batch).
