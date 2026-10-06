# Documents module - backend notes (branch claude/ux-overnight-be-docs)

Migration `0907_documents_are_logical_items_with_versions_and_an_explicit_import.sql` (written as 0900; renumbered 6 Oct 2026 because the Sample applied 0900 to production first) is **unapplied to production**. It was applied only to the local replica `cand_docs`. Nothing here was deployed.

## What it does

1. **Versions** are derived, not stored: `app.document_lineage` walks `documents.superseded_by` (X superseded_by Y means Y is the next version). `app.hq_document_versions` reports v1..vN. `app.hq_document_new_version` and `app.hq_document_rollback` write the chain; nothing is ever deleted (the old head is archived, as `hq_document_supersede` already did). Rollback writes the old content as a **new** version (revert, not rewind), so a rollback can itself be rolled back and no undo verb has to be taught to `hq_undo`. `hq_document_restore` is unchanged and remains the undo of a supersede *link* (it unlinks; the proof states this). `hq_document_supersede` now refuses to write a cycle (spliced from the live definition).
2. **Unified list** `app.hq_project_documents`: one item per logical document. Collapse rules (all on certain identity, none on a name; reasons in the migration header): superseded_by lineage to its head; same (connector, external_ref); mirror steps aside when its original is visible; import copy steps aside while its original is present (and the copy becomes the item when the original is `missing_since` or disconnected, 0896); identical sha-256 + identical size + >= 40 chars, never for a document with version history. Absorbed rows are returned in `duplicates`, so nothing is hidden unlisted.
3. **Import** `app.hq_document_import`: only an explicit press. Origin `yours`, connector null (0896's "Team HQ-held, durable" class; no new vocabulary), linked by the new column `documents.imported_from_document_id` (opposite direction to `mirrors_document_id`; unique per original). If the text/bytes are held it copies now; otherwise it records a request (`document_import_requests`, one per original) and returns `pending`. `app.document_import_fulfil` completes it; `src/handlers/drive-read.ts` calls it after a Drive read records the file (does nothing unless a person's request exists for that exact document).
4. **Safety**: no code path deletes a document (proved, see below).

## Gateway contract (`supabase/functions/hq-api/index.ts`)

Read sections (GET `?section=...`):

| section | params | returns |
|---|---|---|
| `project_documents` | `slug` (project slug, required) | `{project_slug, project_name, documents:[Item], counts:{items, rows_collapsed}}` or `{error}` |
| `document_versions` | `id` (any version's uuid) | `{logical_title, current_id, version_count, versions:[Version]}` or `{error}` |

`Item`: `id, title, source ('drive'|'notebook'|'upload'|'generated'|'web'|'notion'|'other'), connector, origin, mime, kind ('audio'|'video'|'image'|'pdf'|'google-doc'|...|'doc'), size_bytes, content_chars, words, added_at, modified_at, project_slug, external_ref, external_url (null when not certainly derivable), imported, import_available, import_state ('none'|'pending'|'imported'), import_document_id, imported_from_document_id, indexed, has_preview, has_file, connected, missing, version_count, current_version, also_in:[source], duplicates:[{id,title,source,why: 'mirror'|'imported_copy'|'original_gone'|'same_source_file'|'identical_content'}], thumbnail:{available:false, previewable_from_file, kind}, pinned, tags, produced_by, state`. Only approved documents are listed; disconnected sources are omitted (the function takes `p_include_disconnected`, not exposed by the gateway section). No thumbnails are generated: `thumbnail.available` is always false and the UI should preview from the file/text.

`Version`: `document_id, version, title, created_at, fetched_at, updated_at, size_bytes, content_chars, words, produced_by, produced_by_job, origin, connector, state, is_current, can_roll_back_to, note, how ('new_version'|'adopted'|'rolled_back'), channel, created_by, previous_document_id, rolled_back_to`.

Actions (POST `{action, args}`; person session only - none is on `SERVICE_MAY`, so the office key is refused with 403):

| action | args | result |
|---|---|---|
| `document_new_version` | `p_document_id` (required), exactly one of `p_content` / `p_by_document_id`, optional `p_note`, `p_channel`, `p_approve` | `{ok, document_id, previous_id, version, current_id}`; `{ok:true, already:true,...}` when repeated; `{ok:false, error, current_id?}` |
| `document_rollback` | `p_document_id` (the version to return to), optional `p_note`, `p_channel` | `{ok, document_id, previous_id, rolled_back_to, version, current_id}` or `{ok:false,error}` |
| `document_import` | `p_document_id`, optional `p_channel` | `{ok, state:'imported', already, copy_id}` or `{ok, state:'pending', request_id, needs, note}` or `{ok:false,error}` |

Rules a UI should know: only the **head** can be versioned (a stale head returns the `current_id`); only an approved document can be versioned; adopting a draft needs `p_approve: true` (approving is the person's act); a document in another project cannot be adopted; Team HQ-held documents (origin yours/made) cannot be imported (`import_available` is false for them).

## Proofs run (all on local replica `cand_docs`, inside a rolled-back transaction)

`npx tsx scripts/isolated/project-documents.ts cand_docs` - 85 checks, all passed (versions, carry-over of tags/pin/order/collections, idempotency, stale head, rollback of a rollback, cycle refusal, restore semantics, adopt incl. job helper, every dedupe rule with a negative control beside it, import now / pending / fulfilled / original-gone / disconnected, tenant, project and fixture-project isolation, no deletion path in SQL, TS, tool registry or the Drive client). Sabotage control: partitioning the identity merge by title turned 4 checks red; restored, all green.

Safety findings: no database function or TS source issues `DELETE FROM documents`; `discard_document` (the only user-facing removal) only sets `state = 'archived'` and is a person's press behind `authority_refusal`; no `tool_permissions` row is a document deletion (`db.delete` and `task.board.delete` are not document tools; `db.delete` is disabled); `src/notion/write.ts archivePage` exists with **no caller** (Notion trash); the Drive client is read-only. No gap needed fixing; the proof script keeps asserting it.

## Not verified / open

- **Production**: nothing applied or deployed. `check:gateway-wrappers`, `check:callers`, `check:consumed`, `check:anon-exposure`, `check:office-conversion`, `check:office-callers`, `check:office-gateway` need production (`SUPABASE_ACCESS_TOKEN`) and were not run against it deliberately; see the report for one accidental read-only catalogue query. Equivalent local evidence: wrapper presence for every gateway `fn:` checked against `cand_docs`; `check-ownership --replica` and `check-office-edges --replica` (the latter still reports one failing control, "put the compatibility bridge back on offices -> NOT CAUGHT", which fails identically on the untouched `post` replica).
- **Live Drive import of a binary**: the DB side and the fulfil hook exist, but nothing enqueues a `drive.read_file` job for an explicit press (a root job needs the #378 origin rules). A pending request is completed whenever drive.read_file next reads that file (e.g. `drive.watch` changes). Wiring an explicit "read this file now" job is the remaining step.
- A storage object is shared (same `storage_path`) between an original whose bytes Team HQ already holds and its imported copy and between versions made by rollback; no code path removes storage objects except teardown.
- `app.document_adopt_version` (artifact job revised report) has no TypeScript caller: `artifact.ts` has no notion of revising a document. Baselined with a reason in `callers-baseline.json`. The same step is the person's `document_new_version` with `p_by_document_id`.
- Collections: a new version is added to the head's collections and the old row stays; whether collection readers should hide archived versions was not checked.

## Merge notes

- Migration number 0900 (range 0900-0919 assigned). Renumber if a sibling took it; the file has no cross references to its own number except comments and the `0900:` splice message.
- `docs/testing/pressable-baseline.json`: 5 new entries (the sibling frontend calls them); remove each in the commit that names it in `web/`. `callers-baseline.json`: 1 entry (`app.document_adopt_version`). `docs/multi-user/ownership-manifest.json`: two tables + one cross edge.
- Production apply order: `npm run migrate` (0900), then `deploy:hq` (gateway), then `deploy:worker` (drive-read hook). The hook is silent on a database without 0900 (a missing-function error is not reported) and the read itself is unaffected.
