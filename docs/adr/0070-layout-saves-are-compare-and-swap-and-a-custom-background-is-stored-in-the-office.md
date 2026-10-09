# ADR-0070: A project's arrangement is saved by compare-and-swap on a revision, and a custom background picture is stored in the office under a per-office key

Status: accepted and DEPLOYED, 9 October 2026 (migrations `1040` and `1041`, written as 1023 and 1024 and renumbered before applying; hq-api v899; page `dpl_6zXt…`). Acceptance on production: `docs/ux/deploy-442-445.md`.
Tracked by #442 (revisioned layout saves) and #445 (custom background storage), under #439, ADR-0068 and ADR-0069.
Deployment steps, rollback and the exact approvals required: `docs/ux/deploy-442-445.md`.

## Context

ADR-0068/0069 left two honest gaps. The arrangement of a project (modules, Post-its, view, background reference) is ONE
last-writer-wins row per (person, project, surface); the page merged notes before and after every save so two devices could not erase
each other's notes, but two devices could still interleave a read, a merge and a write, and the loser was repaired only by a later
check. And a person's own background picture lived only in that browser's IndexedDB, so it never reached a second device.

## Decisions

### #442

1. **The row carries a revision from ONE sequence, assigned by a trigger** (`public.dashboard_layouts.rev`, `public.dashboard_layouts_rev_seq`,
   migration 1040), on every insert and update, whoever writes (the gateway function, an undo, anything added later). A per-row counter
   was rejected: a reset deletes the row, a counter would restart, and a stale device that remembered "1" would match a different row
   (the ABA case). A row that does not exist is revision 0.
2. **`hq_dashboard_layout_set` gains an optional `p_expected_rev`.** Null is the old behaviour exactly (last writer wins), so every
   existing caller keeps working. A number is compare-and-swap: the save happens only if the stored revision is that number; otherwise
   nothing is written and the answer is `{ conflict: true, rev, panels, now }`. Saves of one (person, project, surface) are serialised by
   an advisory transaction lock, because a row that does not exist yet cannot be locked with `FOR UPDATE` and two first saves would
   otherwise both succeed. An empty layout is still a reset (ADR-0021) and is itself compare-and-swap.
3. **A new gateway section `layout` (`hq_dashboard_layout_get`)** returns one project's `{ panels, rev, now }`, so the page no longer reads
   the whole studio payload to learn either, and `now` is the database clock in milliseconds.
4. **The page merges and retries, boundedly.** `layout.js` reads the office's copy and revision, folds it into this device's (the same note
   merge as before), and saves naming that revision. A refusal hands back the office's current copy, which is folded in and the save is
   tried again, up to six times per round, then kept and tried again later with exponential backoff (1.5 s to 60 s). A save is never dropped.
5. **Wrong clocks:** the page stamps notes in office time (`stamp()` = device clock moved by the last difference to `now`), ignoring an
   office clock more than five years from the device's. Revisions, not clocks, decide whether a save may happen; the stamps only decide
   which of two notes is newer once they are being merged.
6. **Backward compatibility is two-way.** An older page sends no `p_expected_rev` and behaves exactly as before. A newer page against a
   gateway or database that lacks the section or the argument detects "unknown section" / "could not find the function" on first use and
   falls back to the merge-and-check loop of ADR-0068 for the rest of the session. Deployment order is migration, gateway, page, but
   every other order degrades rather than fails.

### #445

7. **One object per project in the private `files` bucket, under `<office_id>/backgrounds/<project_id>.<ext>`.** The key is built by the
   gateway from the office the session proved and the project the DATABASE resolved from the slug inside that office; nothing in the
   request is trusted (office, owner and project id sent by a client are discarded). Migration 1041 lets `hq_upload_target` take
   `project_background` and an optional `p_slug`; a foreign project and a missing one are the same refusal, before any byte is written.
8. **The gateway validates the bytes, not the claim.** The type comes from the header (jpeg, png, webp, avif; SVG, XML and HTML refused),
   at most 3 MB, 4096 pixels a side and 16 megapixels, base64 must decode. At most twelve pictures per office (replacing one is not a
   thirteenth). Guests (Sample visitors) and the machine key are refused by the existing rules (`sample_readonly`, `person_required`).
9. **Reads mint a signed link (one hour) only after the same in-office question**, and answer `null` for a foreign, missing or
   picture-less project (no existence oracle). The reference in the arrangement is a short `rev` (the object's last-written time in base
   36), never bytes and never a link. The browser's IndexedDB is a cache keyed by `rev`: a device that holds the named revision asks the
   office for nothing; one that does not fetches it once.
10. **Abandoned objects:** the gateway has no project-delete (the operator deletes in SQL), so every put and delete first sweeps the
    office's prefix and removes pictures whose project no longer exists in that office. The sweep fails safe: if the project check cannot
    be answered, nothing is removed. A picture left by a deleted project in an office that never writes again remains (at most 3 MB per
    project); the operator can sweep with any put/delete by that office, or by listing the prefix.
11. **The page keeps the picture in this browser first, at once**, and the office's copy second with a bounded wait (15 s). If the office
    would not take it, the picture still works here and the picker says plainly that another device will show the default.

## Consequences

- Both are live. The fallback to the previous merge-and-check loop remains for any gateway or database that lacks the feature (a rollback, a stand-in office).
  Verified: with the new page against the pre-release gateway the section was unknown and the plain save path ran.
- A project's custom picture is one per project server side: two devices uploading different pictures at once settle by whichever
  object was written last, and by the newer reference (`at`) in the arrangement; the two normally agree because the reference is saved
  after the upload.
- Compare-and-swap protects the arrangement document as a whole; it does not make concurrent edits of one Post-it conflict-free (the
  note merge still decides, newest copy wins, deletions are tombstoned).
- The storage cost is at most 12 x 3 MB per office, inside the free tier; no paid service is added.

## What would change this

A real second device, a real office, and the live gateway. Until then `verify:canvas-background` proves the page side against a stand-in
office and `scripts/isolated/background-storage.ts` / `layout-cas.ts` prove the gateway and database on the replica.
