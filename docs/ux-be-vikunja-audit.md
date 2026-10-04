# Notes / task provider audit (HQ-VIC-001..009)

**Premise.** There is no integration called "Vicuña" or "Vacunia" in this repository. The only notes/to-do provider is
**Vikunja** (`src/tasks/provider.ts` port, `vikunja.ts` adapter, `sync.ts` engine, `handlers/tasks-sync.ts` duty,
migrations 0513-0522, 0640, 0641, 0670, 0742, 0803; ADR-0059 / `docs/policy/FINAL-POLICY-IMPLEMENTATION.md` Decision 1).
The Post-its in `web/studio/bc/compose.js:592` are browser/office workspace JSON, are not tasks and are not synced, by
design. This audit is of the Vikunja seam.

Everything below was driven against an in-memory Vikunja (`tests/tasks/fake-vikunja.ts`, HTTP-shaped, injected `fetch`)
and the real round (`syncOnce`) over the real database functions on a local replica (`cand_vik`, cloned from
`cand_final`). No network, no production, no live Vikunja.

## Findings

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Canonical source | **Supabase `public.tasks`.** Vikunja is a projection; `public.task_links(task_id, provider, external_id, synced_revision, sync_state, sync_error)` maps them, `task_tombstones` holds deletions owed. Only `assigned_to_human`, non-harness tasks are pushed. | `provider.ts` header; `app.tasks_to_push` (live def, filter `t.assigned_to_human`, `app.harness_task`) |
| 1a | Direction, per field | **Push (office to Vikunja):** title (cut to 250), detail (as description, plus a `[agentic:<uuid>]` mark), done, due date (midnight UTC), priority (10/20/50/100 to 4/3/2/1). **Pull (Vikunja to office):** title, detail, done, due date (UTC date part), priority (0 = "nobody said", never overwrites). Not synced either way: labels, reminders, parent/subtasks, project, repeat, assignee. `tasks_to_push` emits labels, parent, remind_at but the adapter ignores them. | `vikunja.ts` `upsert` body; `task_pulled` field list |
| 1b | Order and conflict rule | Round: push deletes, push upserts, then pull. Canonical wins. A pull for a task whose canonical revision is past `synced_revision` is a conflict (copy here kept, `sync_state='conflict'`). | `sync.ts` header; `task_pulled` |
| 1c | Does the note (detail) round-trip? | **Before this audit: no.** A two-line note was flattened to one line on its first round trip and written back flattened; `<`...`>` text was deleted as if it were a tag; HTML entities from Vikunja's editor showed literally. **After: yes** for plain text; editor HTML becomes plain text with line breaks. Still lossy by design: HTML formatting, a title over 250 chars, a due *time*. | `vikunja.ts plainText`; tests `vikunja-roundtrip` "note" block, e2e "multi-line note" |
| 2 | Create/update/pull/delete end to end | Proved: create pushes once, is marked and linked, 2nd round makes no write; edit here is an UPDATE by external id (no new remote task); edit in Vikunja is pulled and not pushed back; a task made in Vikunja arrives once and re-rounds do not duplicate; delete here removes the remote, clears the tombstone, and nothing is resurrected; a held delete is not re-imported; outage mid-round changes nothing and the next round catches up. | `tests/tasks/vikunja-e2e.test.ts` (21 tests, real DB) |
| 3 | Duplicate prevention | Keyed on external id (`task_links`) and the office's mark, never the title. Same-title tasks stay two tasks both ways (tested). A lost create record is adopted by the push (`alreadyMine`). **Defect found:** when the push did not reach the task (write held, past the 200 limit) the *pull* imported the marked remote copy as a second task here; and a marked remote task whose canonical task was already deleted was re-imported. **Fixed** (0950). | e2e "lost create record is adopted even when the push never gets to it", "marked remote task whose canonical task was deleted" (both red before) |
| 4 | Failure behaviour | See table below. Watermark (`synced_revision`) is only moved by `task_pushed` / a clean `task_pulled`; `task_push_failed` never moves it (tested: 503 leaves no link, next round pushes). `list()` is fully collected before any pull is applied, so a failing page 2 pulls nothing. | e2e "failure behaviour" |
| 5 | Defects fixed | D1-D6 below. | commit on `claude/ux-overnight-vik` |
| 6 | Not verifiable here | Last section. | |

### Failure table (what the code now does)

| Condition | Class | Effect on the round | What Grant is told |
|---|---|---|---|
| network error, timeout (new: 20 s `AbortSignal`), 429, 5xx | `ProviderDownError` | round ends, nothing further touched, nothing marked | announcement: "Vikunja could not be reached (<detail>). Nothing was changed here." (deduped by `app.say_once`, 0584) |
| 401 / 403 (new) | `ProviderAuthError` (extends the above) | same | "Vikunja turned the connection down (the token was refused (http 401)). Nothing was changed here. Connect it again with a new token in Settings, under Your tasks in another app." Before: one failed task per task, or the whole round throwing on a delete. |
| 400/404/409... on one create/update | plain `Error` | recorded on that task (`task_push_failed`), others continue | Settings panel lists it ("N to look at", the `why`), and the announcement says "could not send N" |
| 4xx on one delete (new) | plain `Error` | counted as `failed`, tombstone kept, others continue. Before: threw out of `syncOnce`, stopping the whole round | "could not send N" |
| 404 on list (project gone) | plain `Error` | throws; the job fails and is retried; surfaced by the generic job-failure path, not by a task sync sentence | job failure path only (not verified live) |
| list over 5000 tasks (new) | `Error` | refuses to read part of a project | job failure path |

## Defects found and fixed

| ID | Defect | Fix | Proof (red first) |
|---|---|---|---|
| D1 | Placeholder `pending:<task>` link (written by `task_push_failed`) was offered by `tasks_to_push` as a real external id, so a refused first create became an UPDATE of `/tasks/pending:...` every round, for ever (http 400), and the task never reached Vikunja. | 0950 `tasks_to_push` returns null for a placeholder (the DB invented the sentinel, so the DB reads it). | e2e "created on a later round, not updated at an id that never existed" |
| D2 | Deleting such a task put `pending:...` in the tombstone and `provider.remove` of it threw, **stopping every later round**. | 0950 drops placeholder links from tombstone output; `sync.ts` clears a tombstone that has nothing at the provider without asking; a refused remote delete is now one task's failure, not the round's. | e2e "does not wedge every later round"; `sync-failures` |
| D3 | Pull ignored the office's own mark: lost-create copies were imported as duplicates when the push did not reach them; a marked copy of a deleted task came back. | 0950 `task_pulled` takes `canonical_id`; adopts when the canonical task exists with no link, returns `deleted:true` (so the remote delete goes through approval) when it is gone; `sync.ts` passes the mark. | two e2e tests |
| D4 | Note flattened / `<` text eaten / entities literal (see 1c). | `plainText()` in `vikunja.ts`. | `vikunja-roundtrip` x3 |
| D5 | List stopped at the first page that had fewer than 50 rows, so a server capping `per_page` (`service.maxitemsperpage`) silently lost the rest of the board; at the 20-page cap it truncated silently. | server's `x-pagination-total-pages` is authoritative (short-page rule only as a fallback); a truncated list now throws. | `vikunja-roundtrip` "listing" block |
| D6 | No request timeout (a server that accepts and never answers held the duty forever); 401/403 reported as per-task failures with "http 401" text. | `AbortSignal.timeout`; `ProviderAuthError` and its own sentence. | `vikunja-roundtrip` "failure classes"; `sync-failures` |

## Found, NOT fixed (decisions for Grant, or out of scope)

1. **Both sides edited: Vikunja's edit is silently overwritten.** Push runs before pull, so a Vikunja edit made since the
   last round is replaced by the canonical copy and the round reports `conflicts: 0`. The `conflict` state only arises when
   the push is held or fails. Policy (canonical wins) is respected, but "kept the copy here for N that changed in both
   places" is therefore almost never said. Detecting it needs the listing before the push. Pinned by a test.
2. **A task deleted in Vikunja is not deleted here**, and editing it here then fails with http 404 on every round
   ("vikunja refused: http 404"). Whether a Vikunja-side delete should delete, recreate or be ignored is policy
   (ADR-0059 covers only the office-to-Vikunja direction). Pinned by a test.
3. **Title over 250 characters** is cut at Vikunja's limit and the cut copy is then pulled back over the original.
   Needs a provider-neutral "my limit" in the port. Pinned by a test.
4. **An outage is not visible in Settings.** `task_sync_panel` returns `last_synced` and the per-task trouble list, but an
   unreachable or token-refused Vikunja shows green "In step" in Settings; the only place the outage appears is the
   (deduped) announcement. Needs stored provider state plus UI work (Level 1B QA); not done.
5. `scripts/isolated/policy-vikunja.ts` fails before any check on a current schema (`jobs.office_id` is null in
   `dutyJob`): a harness defect that predates this change (reproduced on an untouched clone of `cand_final`).
6. Overlapping rounds (two `tasks.sync` jobs at once) can still double-create; the mark only helps once the first create
   has landed. A Vikunja "duplicate task" copies the mark; a copy is only adopted if its original has no link.
7. Labels, reminders, parents/subtasks and repeats are not sent to Vikunja.

## Not verifiable without a live Vikunja

- That the real server returns `x-pagination-total-pages` on `GET /projects/:id/tasks` with an API token (the code
  falls back to the old short-page rule if it does not). `scripts/verify/vikunja.ts` is the suite that would settle it.
- That the real API returns done tasks in the default project listing, and returns `description` byte-for-byte as sent
  (the fake assumes both; the earlier real-server suite exercised the round trip only for short single-line text).
- Real 401 vs 403 vs 404 bodies and whether an expired token is 401; real `Retry-After` on 429 (not honoured; the
  round just ends).
- Vikunja's own handling of `<`, `&` and newlines when the *UI* renders a plain-text description pushed by the office
  (the office pushes plain text, the editor expects HTML; reading is now correct, how it looks in the Vikunja UI is not
  checked).
- The Settings panel and Telegram/Slack wording as rendered (no UI change made).
- Migration 0950 has been applied only to the local replica `cand_vik`; not to any shared database.

## How to re-run

```
VIK_REPLICA_DB=cand_vik npx vitest run tests/tasks      # real DB legs run only when this names a marked local replica
npx vitest run tests/tasks                               # without it the 21 DB-backed tests skip
```
