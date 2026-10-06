# Artifacts: "find the latest customer research report and turn it into a beautiful PDF" (branch claude/ux-overnight-be-art)

Migration `0940_a_made_report_keeps_how_it_was_made_and_a_revision_is_a_new_version.sql` is **unapplied to production**. It was applied only to the local replica `cand_art`. Nothing was deployed and no model or network call was made.

## The chain, and who decides what

| Step | Where | Decided by |
|---|---|---|
| Resolve the source document | `src/artifacts/source.ts` (`sourcePhrase`, `resolveSourceDocument`) over `app.hq_project_documents` (logical items) | rule |
| Ask which, if unclear | `askWhich` in `handlers/artifact.ts` (no model call, no file) | rule |
| Read the source / decide what leads, tables, charts | the draft step (existing), now handed the resolved document first | model (editorial only) |
| Choose title page / density / charts | `src/artifacts/design.ts` `designBrief` | rule: house style, then a *validated* proposal, then the shape of the content |
| Render | `renderReport(report, effectiveStyle)` - structured blocks to bytes | deterministic, no model |
| QA | `src/artifacts/qa.ts` `layoutCollisions` (inside `layout()`), then `validatePdf` | rule |
| Save + provenance + version | `storeArtifact` -> `app.record_file_document`; `app.document_provenance_record`; `app.document_revise_made` | rule |
| Send | unchanged: `attachFile` on the answer to the asking channel only | existing delivery + approval gate |

## 1. Source resolution
Ranking: each content word of the phrase found in the title (3) or a tag (2); a document matching no content word is never a candidate (recency alone never picks); readable kinds +1, audio/video/image -1; a title carrying the type word ("report") +1 each; the office's own earlier PDF -0.5 as a *source*. Two within `MARGIN` (0.75) are tied; "latest/newest/most recent" lets recency separate a tie only if one is >= 1 hour newer; otherwise `ambiguous` (candidates returned, the job asks). Nothing matched -> `none` with up to five readable documents offered. A source with no held text -> asks and says it holds no text (it does not pretend to read it). Negative controls (driven against real `hq_project_documents` rows): another project's newer report, an archived one, an unapproved draft and a superseded version never appear; the head of a versioned document does.
`sourcePhrase` only treats a phrase as a source when it carries a document noun or "latest"; "a PDF report on where the course has got to" is a topic and keeps the ordinary retrieve path.

## 2. Revision = new version
`app.made_head_for_revision` finds the latest made PDF head in the project; `revisesEarlier` (revise/redo/rework/redesign/regenerate/remake/another version) triggers it. First creation is v1 (no link). A revision with no source named reuses the sources v1 cited (`document_provenance.sources`). `app.document_revise_made(office, head, new, note)`:
* head **approved** -> delegates to `app.hq_document_new_version(..., p_approve => true)`; the new version is the approved head, the old one archived and still listed under versions, rollback works (proved: rollback creates v4).
* head still **draft** (what the office makes by default, #28's review gate) -> `hq_document_new_version` refuses drafts, so the same `document_version_link` is used and the new version **stays a draft**.
* idempotent (`already`), stale head refused with `current_id`, only office-made documents, same project, no forks.
`app.document_adopt_version` is still uncalled (baseline reason rewritten to say why).

## 3. Style recorded
`document_provenance` (one row per made document, written once): job id, `style_hash` (12 hex of the canonical resolved profile; `default` for none), `style_updated_at` (`app.style_stamp`), `design` (choice + reasons), `sources`. Job/author/time are not duplicated (already on `documents`). Test + proof: change the style, revise -> colour and faces in the bytes change and the hash changes.

## 4. Design brief
Supported set: title page `standard|band`, density `comfortable|compact`, charts kept/dropped. Style wins, then a supported model proposal (the BRIEF now invites an optional `"design"` key), then content shape (band for >= 14 blocks or any table/chart; compact above 2,200 words; charts dropped unless one compares >= 3 things). Unsupported values are listed in `rejected` and never used. `compact` is new in the renderer (`resolveTheme`: tighter leading); default bytes are unchanged (hash-pinned test still green).

## 5. QA
`layoutCollisions` (pre-existing, untracked in this worktree when I started, wired into `layout()` problems; I added the tests). The synthetic first-PDF defect (intro over title) is structurally valid, RED under the check, GREEN on the fixed path. The check immediately found two real defects, both fixed: a three-line cover title had the date printed over its last line (now: a third line is set at 25pt instead of 30pt, date under the last line), and a long title in the running foot ran under the page number (foot title cut at a word with an ellipsis). Rendered three samples (default/band/Times-green/compact-long-title), rasterised with pdftoppm at 50 dpi, looked at them.

## 6. Approval
Generating, saving and versioning takes no approval and raised no blocker/delivery/job (proof). The path imports nothing that can send, calls no approval/blocker/enqueue function, and the file leaves only as `attachFile` on the answer to the turn that asked (unit test, comments stripped). Outward effects keep the existing gate: in the proof `authorize_effect` returns proceed for `document.create` at office audience, ask for the same tool at `outside` audience, and refuse/ask for `gmail.send`/`slack.post`.

## 7. Door
`artifactRequest` now also recognises "turn X into a PDF", "convert", and revise/redo/rework/redesign/regenerate/remake. The handler resolves the source from the brief; no change was needed in `instruction.ts`.

## Proofs and commands
`npx tsx scripts/isolated/ux-be/05-artifacts.ts [cand_art]` - drives the real handler (real `runSteps`, retrieval, storage-record, version functions) against the replica, fake router, stubbed storage fetch, rolled back; 4 consecutive runs all passed. Sabotage controls: removing the "must match a word" rule turned 2 proof checks and 1 unit test red; hashing `null` instead of the style turned 3 red; restored.

## NOT verified / decisions for the owner
* Production: nothing applied. `check:callers`, `check:consumed`, `check:gateway-wrappers`, `check:anon-exposure` need a production token and were not run. `check-ownership --replica` (against cand_art) shows only the three unclassified tables from other branches (calendar_event_projects, project_events, style_profiles); `document_provenance` is classified.
* **Auto-approval decision**: for an approved head, the new version is made approved (so it stays visible and the history stays one item). The 0907 (written as 0900) note said an agent adopting a version "must never approve anything". Revision of something a person already approved, reversible by rollback, seemed within "agents may generate versions autonomously", but this is a policy call; the alternative is to leave it draft (the logical item then drops out of the project list until reviewed).
* A revision re-drafts from the cited sources with the new instruction through the model; it does not reuse v1's block structure (that lives only in the earlier job's checkpoint). A pure design change ("band title") therefore re-asks the model for editorial content.
* The model only edits when asked; v1's text of the PDF is not stored (made documents have no `content`), so a source whose only copy is a PDF with no text cannot be resolved-and-read: it asks.
* The cover is still two-thirds empty by design (existing); logo image still not drawable.
* No live worker run, no real model, no Telegram/Slack delivery. `updated_at` of a style cannot be shown to change inside the single proof transaction; the hash change is what is asserted.
* `tests/sessions/weather-is-not-a-failure.test.ts` fails in the full vitest run because it requires `SUPABASE_ACCESS_TOKEN` (refuses, by design); everything else passed (4630 tests).
