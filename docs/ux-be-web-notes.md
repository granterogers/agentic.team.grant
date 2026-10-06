# UX overnight backend: web research (migration 0930)

Branch `claude/ux-overnight-be-web`. Everything here was built and proved on the local replica (`cand_web`) with every network behaviour injected. **Nothing has been applied, deployed or run against production or any live site.**

## What it adds

| Piece | Where |
|---|---|
| Provenance + reader + public wrapper + registry truth | `migrations/0930_a_page_the_office_read_says_where_it_came_from.sql` (UNAPPLIED) |
| Search port + one keyless provider (DuckDuckGo HTML) | `src/browser/search.ts` |
| Safe downloads (allow-list, 10 MB cap, magic-byte check, per-hop address guard) | `src/browser/download.ts` |
| Pure research decisions (which results, which links, passages, findings text) | `src/browser/research.ts` (+ `links.ts`, link extraction, already present) |
| Handler kind `web.research` | `src/handlers/web-research.ts`, registered in `src/office/pass.ts` |
| Door: a sentence that starts it | `researchRequest` in `src/agents/actions.ts`, `entitled.research`, one block in `src/handlers/instruction.ts` |
| Containment class | `src/jobs/containment.ts`: `'web.research': { reach: 'reads' }` |
| Evidence in reports | `citedSource` in `src/knowledge/retrieval.ts`, used at both source lists in `src/handlers/artifact.ts` |
| Gateway section | `web_sources` in `supabase/functions/hq-api/index.ts` |

### Facts NOT duplicated (CLAUDE.md 0310)
A saved page is a `documents` row (origin `source`, connector `browser`) written by the existing `app.record_browser_page`. url = `external_ref`; title; retrieved_at = `fetched_at` (a file has none, so `updated_at`); project; job = `produced_by_job`; agent = that job's `recipient_agent`, else the `by` in its `pinned_config`; research task = the `web.research` job (or its parent) and the question in its `pinned_config`; indexed = `content is not null` (`documents.search` is generated from it); screenshot = latest ok `shot` row in `browser_actions`; citations = outputs whose `sources` hold `browser:<document_id> ...`.
The one new fact is **how a page was reached** (search query + rank, or the page whose link led to it): `browser_actions.found_via jsonb`, on the ledger row that recorded the read.

## Gateway contract

`GET hq-api?section=web_sources&project=<slug>[&limit=<1..500, default 100>]` (also `p_slug=`). Office-scoped like every `office: true` section. Errors come back as `{ "error": "no project called '<slug>'" }` (unknown slug, or another office's) and `{ "error": "limit must be a whole number" }`.

```json
{
  "project": { "slug": "legacy-coaching", "name": "Legacy Coaching" },
  "count": 2,
  "pages": [
    {
      "document_id": "uuid",
      "ref": "browser:<document_id>",            // the citation string outputs carry
      "url": "https://example.org/widgets",
      "title": "Widget prices",
      "kind": "page",                           // or "file" (a download)
      "retrieved_at": "2026-10-04T22:03:43Z",
      "project": { "slug": "legacy-coaching", "name": "Legacy Coaching" },
      "agent": { "slug": "chief-of-staff", "name": "Claire" },   // null when unknown
      "job_id": "uuid",                         // the job that fetched it
      "research_task": { "job_id": "uuid", "label": "what do widgets cost for small shops" }, // null if not from web.research
      "found_via": { "how": "search", "query": "...", "rank": 2 },  // or {"how":"link","from":"https://...","depth":1}; null if a person named the address
      "indexed": true,
      "has_excerpt": true,
      "excerpt": "first 280 chars, whitespace collapsed",           // null for a file
      "content_chars": 67,
      "file": null,                             // for kind=file: { "mime_type": "application/pdf", "bytes": 4096, "storage_path": "..." }
      "screenshot": { "available": true, "path": "<project>/browser/<job>-research.png", "taken_at": "..." },
      "citations": { "count": 1, "evidence": [ { "output_id": "uuid", "job_id": "uuid", "kind": "artifact.report", "at": "..." } ] }  // at most 5 newest
    }
  ]
}
```
Newest first. Harness/fixture pages and harness outputs are excluded by the reader (`app.harness_browsing`, `app.harness_job`), a fixture project lists nothing. `screenshot.path` and `file.storage_path` are paths in the private `files` bucket; the page needs the existing signed-URL route to show one (not built here).

How a conversation starts it: a sentence with a research verb AND an explicit web word ("search the web for...", "look this up online", "google..."), no link (a link is `browser.gather`'s), not negated/advice/reported. Enqueued as child job `web.research` with `{question, by, origin_channel, command_id}`; optional payload keys `max_results` (<=6), `max_pages` (<=8), `follow` (<=3, one hop only), `max_downloads` (<=1), `screenshot` (false to skip).

## What is autonomous and what is not
Autonomous (no question asked): search, read, one-hop link following (only relevant links; an address or link text naming an act, a query asking the site to do something, or a private address is never followed), extract, screenshot, safe download. `authorize_effect` says `proceed` for `web.search` and `web.read` (proved in SQL).
Not reachable from this tier at all: send, post, publish, email, contacting a human, form submission, purchase, booking, upload. Three independent places (adapter has no acting method; `browser_actions.verb` CHECK refuses an acting word; the handler composes only `open/read/shot/download`) plus the link filter. If an agent asks for such an act it can only be a plan step, asked through `mayAct` / `app.authorize_effect`; `slack.post` asks, `gmail.send`, `spend.money`, `github.write`, `db.delete` and any unknown tool (`form.submit`, `booking.make`, `upload.external`) are never `proceed` (proved in SQL). No parallel approval path was added.
Harness/fixture jobs are refused before the search engine or any page (`app.harness_browsing`, asked first and read as contained on any non-`false` answer).

## Proofs run (all local, nothing outbound)
- `scripts/isolated/ux-be/05-web-sources.sql` (rolled back): reader fields, tenant and project isolation, harness and fixture exclusion, limit, wrapper equality, file allow-list/cap refusals with reasons, acting-verb CHECK on ten verbs (constraint name asserted), `found_via` shape, registry truth, authorize_effect. Sabotaged twice (wrong count; harness attribution made real) and went red both times.
- `scripts/isolated/web-research.ts` (rolled back): the real handler end to end with fake search, a fake web served through the real `FetchedBrowser` (real link extraction and address guard), fake storage and download. 30 checks including resume-does-not-repeat, one-hop, budget ceilings, failed search, harness and fixture containment, exhausted browser-minutes. Sabotaged (acting-link filter removed) and went red.
- vitest: `tests/browser/{search,download,research}.test.ts`, `tests/handlers/web-research-boundary.test.ts`, `tests/handlers/web-evidence-is-retained.test.ts`, `tests/agents/research-request.test.ts`; two existing tests updated (`a-repeat-starts-nothing` known kinds, `a-citation-names-where-it-came-from` now asserts `citedSource` twice).

## NOT verified (needs a live run, by a person)
1. **The DuckDuckGo markup against the real service.** The parser is tested only against fixtures written from the documented shape. A datacentre address may get a challenge page; that is reported honestly (`ok:false`), never as "no results". Expect to adjust `parseDuckDuckGoHtml`. Swap provider by implementing `SearchProvider`.
2. The Cloudflare runtime's screenshot and link extraction (`links` on `GatherResult`) and `FetchedBrowser` against real sites. The fetched runtime takes no screenshot: the run then says "No screenshot was possible on this runtime".
3. Supabase Storage accepting the screenshot/download bytes (`putFile` was injected). Content-types/paths follow `src/files/store.ts`.
4. The prompt brief ceiling: computed on the local replica at 3960 characters against the 4000 that `verify:capability` asserts (40 spare). Production credentials/connection state can differ; `npm run verify:capability` was NOT run (needs the production database).
5. `check:capabilities`, `check:callers`, `check:gateway-wrappers` refuse without a production token and were not run. By reading: `web.research` is started from `instruction.ts` via `app.enqueue_child` and named by the enabled `web.search` and `web.read` rows' `delivered_by`; `public.hq_project_sources_web` exists and is what the gateway section calls; no new table. `check:pressable` passes with `section:web_sources` baselined (reason: awaiting the Sources page).
6. `tests/sessions/weather-is-not-a-failure.test.ts` fails in this sandbox only because it exits when `SUPABASE_ACCESS_TOKEN` is unset (by design); unrelated.
7. The browser budget (10 free minutes/day) is shared with `browser.gather`; a research run reads up to ~8 pages, so a busy day can exhaust it, which the handler reports instead of opening anything. Search requests themselves are not counted against the budget by `ms` (the search call records 0 ms).
8. No UI, no signed-URL route for screenshots/files, no authenticated-site research (public pages only; signed-in sites stay a `browser.gather` of one named address).

## Unapplied migrations / merge notes
- Apply `0930` only. It adds one nullable column + CHECK to `browser_actions`, five functions (`browser_note_via`, `web_file_refusal`, `record_web_file`, `hq_project_sources_web` + public wrapper), redefines `app.browser_note` (same signature, now delegates; no overload), and flips `web.search` to enabled / updates `web.read` verbs. **Deploy order: migration first, then worker** (the worker calls `browser_note_via`/`record_web_file`; an old worker is unaffected), then `hq-api`.
- Branch conflict risks: `src/handlers/instruction.ts` (one block before `const reading`, `reading` now falls through to `researching`), `src/agents/entitled.ts` (new `research` key in both objects), `src/browser/{adapter,cloudflare,fetched}.ts` (the `links` work already uncommitted on this worktree: `cloudflare.ts` needed two missing imports, added), `supabase/functions/hq-api/index.ts` (one section), `docs/testing/pressable-baseline.json`.
- Migration numbers: only 0930 used.
