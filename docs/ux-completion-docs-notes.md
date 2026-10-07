# External documents, Import and cached previews - completion notes (HQ-DOC-025 .. 031)

> **Migration numbering (6 Oct 2026).** Written when the documents migration was 0900; it is now **0907** (the Public Sample Office applied its own 0900 to production first). Read "0900" below as 0907.

Branch `claude/ux-overnight-docs` (from `claude/team-hq-ux-overnight`). Migration **0960 is UNAPPLIED to production**; it was proved only on the local replica `cand_docs2` (clean base `pbase` + this branch's unapplied migrations 0897-0950 + 0960). Nothing was deployed and nothing touched production. The ledger is deliberately not edited; this file says what is now true per row.

## What was built

1. **The Import press now starts the fetch** (0960 + `src/handlers/drive-read.ts` + `src/google/drive.ts`).
   - `app.hq_document_import` (spliced from the live definition), when it records a pending request for a Drive file that has a folder and a file id, calls the new `app.document_import_enqueue_fetch`, which inserts ONE root job `drive.read_file` (`requested_by 'hq'`, `announce false`, idempotency key `import-fetch:<document>` so a second press while it is live makes no second job and a press after it ended is a retry). The reply says "Team HQ is fetching the file from Drive now" and carries `fetch_job_id`.
   - The job reuses the existing `drive.read_file` handler: Google Doc/Sheet exported to text, a binary downloaded and stored in the `files` bucket, then `app.document_import_fulfil` makes the copy. Reading is autonomous (`reach: reads`); writing the copy is the person's recorded press: `fulfil` still does nothing without the request row, so a read can never import a document nobody asked for (proved with a control).
   - A recorded Drive row has no mime type, so the handler now asks Drive for `id,name,mimeType` first (`fileMeta`, new; it does not request a thumbnail link) when the job carries none.
   - `app.internal_root_ok` is spliced to recognise exactly `(requested_by 'hq', kind 'drive.read_file')` for a document that has a recorded import request, so the job has origin `internal` instead of `unknown`.
   - A failed fetch is no longer silent: `app.document_import_note_failure` writes `attempts`, `last_error`, `last_attempt_at` on the request (new columns), `hq_project_documents` returns it as `import_error`, and the viewer says "The office could not fetch this file yet: ..." with "Try the import again" (the same press).
2. **Cached preview excerpt as the thumbnail for external files** (0960 + web).
   - `public.documents.preview_excerpt`: a GENERATED stored column, first ~320 characters of the extracted text with whitespace collapsed (cannot be written, follows the text, no second copy).
   - `hq_project_documents` returns `thumbnail: {available, previewable_from_file, kind ('image'|'pdf'|'excerpt'|null), excerpt, derived_from}`; `available` is now true when an excerpt exists.
   - The wall tile (`web/studio/bc/miniatures.js`, `drawnPage`) shows the first words instead of invented lines (text only, escaped; list-row thumbnails keep drawn lines; CSS classes `bcxpage`, `bcxpagetext`, `bcximporterr`; phone-safe, appended at the end of `compose.css`).

## Per row

| Row | What is now true | Evidence | What remains |
|---|---|---|---|
| HQ-DOC-025 not copied into Supabase | A Drive file is a reference row (no bytes, no copy) until someone presses Import; pressing Import is the only thing that stores a durable copy. Honest nuance: files Grant approves through the Drive-watch question ("add them to the project") are already read and stored by `drive.read_file` (existing, #96); that is a stored copy by his explicit approval, not a silent import. | `import-fetch.ts` section 4 controls: an unrequested read imports nothing; no silent import path was added. | Stays PARTIAL only because of the thumbnail bullet in 029. |
| HQ-DOC-026 searchable by agents | Unchanged: text read from a file is indexed (`documents.content`, `document_chunks`); a reference that was never read is findable by title only. The import fetch now also brings text in on demand, so an imported Google Doc becomes fully searchable. | `import-fetch.ts` section 1 (exported text lands in the copy). | A never-read, never-imported reference has no body to search. Reading every Drive file would be the silent bulk import the requirement forbids. |
| HQ-DOC-027 readable on demand | Agents/jobs can read a named Drive file on demand (`drive.read_file`, now also started by the Import press). | Handler vitest + replica proof with a fake Drive. | The in-app viewer does not stream a never-read file through the office to show it: a reference-only document still says "There is nothing to preview here". A view-without-copy "read now" job was not built. |
| HQ-DOC-028 previewable while source connected | Held text/PDF/image previews work as before; tiles now show a real text excerpt where text is held. | `docs-ui.ts` (47 checks incl. 390px), screenshots `.out/ux-docs-wall-excerpt-1440.png` / `-390.png`. | A reference with no held text/file has no preview. Rendered first-page images of PDFs, and Drive `thumbnailLink` images, are NOT built. |
| HQ-DOC-029 cache lightweight derived data | Cached now: metadata, extracted text/search index, and (new) a preview excerpt. | `import-fetch.ts` section 6 (excerpt, generated, follows the text, null for whitespace/no text). | **Bitmap thumbnails and rendered preview pages are not built.** Drive's `thumbnailLink` is not listed by the client and fetching it needs a live account to learn its auth/expiry behaviour; deliberately not invented. Row stays PARTIAL. |
| HQ-DOC-030 explicit Import creating a durable copy | The press now starts the fetch itself: pending -> job -> bytes/text -> copy, end to end through the real handler, with a retry and a visible failure reason. | `scripts/isolated/import-fetch.ts` 40+ checks; sabotage controls below. | Verified only against a FAKE Drive (token, metadata, export/media and storage stubbed). Never run against live Google. **Needs a live Google account to close.** Non-Drive references (NotebookLM/Notion/web) are still recorded as pending without a fetch job (unchanged). |
| HQ-DOC-031 import survives the original disappearing | Proved on the replica: after the original is marked missing the copy is the listed item with its file; the object stays in the bucket (shared path by design; no code path removes storage objects). | `import-fetch.ts` section 3. | Same live-Google caveat as 030. |

## Tests run (all with SUPABASE_* unset, local replica only)

- `npx tsx scripts/isolated/import-fetch.ts cand_docs2`: ALL PASSED (new proof). Sabotage controls: (a) removing the `internal_root_ok` splice turned "the job has an origin and may act" red; (b) disabling the pending-request guard in `document_import_enqueue_fetch` turned "enqueue refuses a document with no recorded request" red; (c) disabling the failure note in the handler turned 3 checks red; all restored and green. (An earlier combined sabotage had not applied - caught because each sabotage prints whether it landed - and was redone one at a time.)
- `npx tsx scripts/isolated/project-documents.ts cand_docs2`: all passed (85 checks, unchanged). `npx tsx scripts/isolated/ux-be/05-artifacts.ts cand_docs2`: ALL PASSED.
- `npx tsx scripts/verify/docs-ui.ts`: 47 passed, 0 failed (new checks: excerpt tile, excerpt shown as text not markup, no-excerpt control, failed import shows reason and retry press, phone 390 no sideways scroll). Sabotage: removing `esc` on the excerpt turned the markup control red; restored.
- vitest: `tests/handlers/drive-read-fetch.test.ts` (6), `tests/google/drive-meta.test.ts` (2), existing drive-read tests; plus `tests/handlers tests/google tests/jobs tests/migrations tests/architecture tests/bc tests/gateway`: 68 files, 594 tests passed.
- `npx tsc --noEmit` 0; `npx biome ci .` 0; `npm run check:templates` clean; `npm run check:migrations` passed (0960 pending); `npm run check:branding` clean.
- Not run (need production or fail identically on the base): `check:callers`, `check:consumed`, `check:gateway-wrappers`, `check:anon-exposure`. `check:office-raw-sql` reports 2 failures in `artifact.ts`/`web-research.ts`, files this branch does not touch.

## Unapplied / production order

0960 is unapplied. Deploy the **worker first** (handler change: mime lookup and failure note), then apply 0960 (`npm run migrate`), then deploy the web page. Applying 0960 before the worker would start import jobs that an old worker would read as an octet-stream and fail on a Google Doc. `documents` gains a generated stored column (table rewrite, as `documents.search` already is) so apply it in a quiet moment. 0960 depends on 0900 (and splices its functions): it must go after 0900.

## Files

`migrations/0960_an_import_press_fetches_the_file_and_a_document_has_a_cached_preview.sql`, `src/handlers/drive-read.ts`, `src/google/drive.ts`, `web/studio/bc/{miniatures,docsources,shell}.js`, `web/studio/bc/compose.css`, `scripts/isolated/import-fetch.ts`, `scripts/verify/docs-ui.ts`, `tests/handlers/drive-read-fetch.test.ts`, `tests/google/drive-meta.test.ts`.
