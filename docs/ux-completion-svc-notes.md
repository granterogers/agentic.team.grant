# UX completion (svc): what is now true

Branch `claude/ux-overnight-svc`, cut from `claude/team-hq-ux-overnight`. Three independent items. Everything was built and
proved on the local replica (`cand_svc2`, `pbase` plus the branch's unapplied migrations plus 0980 and 0981) with the
Supabase variables unset. **Nothing was applied to, deployed to or run against production.** The ledger
(`docs/ux-product-requirements-ledger.md`) was not edited.

New migrations, both UNAPPLIED: `0980_a_calendar_conflict_is_resolved_and_written_down.sql`,
`0981_a_vikunja_outage_is_shown_in_settings.sql`. One existing unapplied migration was edited, as permitted: `0897` gained
one key (`external_updated_at`) in `app.project_events_sync_work`.

---

## 1. Web research: the DuckDuckGo parser against the REAL service (HQ-WEB-002 / 004 / 007)

### What was fetched

Public searches of a public service through the sandbox proxy (CA bundle verified, TLS verification never disabled), with the
office's own honest user agent. Four answers were kept whole under `tests/browser/fixtures/ddg-live/`:

| Fixture | Query | What the service answered |
|---|---|---|
| `results-wikipedia.html` | `wikipedia` | http 200, a real results page |
| `results-rust-book-with-ads.html` | `rust programming language book` | http 200, a real results page **with sponsored results** |
| `challenge-202-node.html` | `node.js release schedule` | **http 202, the bot challenge page** (`anomaly-modal`, `anomaly.js?cc=botnet`) |
| `challenge-202-nonsense-query.html` | a nonsense query | http 202, the same challenge |

The service rate-limits a datacentre address after a handful of requests: the first request in a burst was answered, later ones
got the challenge, and the proxy reset several more. A later run of the opt-in script (below), from Node with the project's own
`DuckDuckGoHtmlSearch`, also got the 202. **A real "no results" page was never obtained** (the nonsense query was challenged),
so that branch is still proved only by a hand-written page, and says so in the test header.

### A real defect the real markup exposed (fixed)

A sponsored result is wrapped in the **same redirector as an organic one**
(`//duckduckgo.com/l/?uddg=<encoded https://duckduckgo.com/y.js?ad_provider=...>`). `unwrapResultUrl` unwrapped it once and
returned the engine's own ad-click address as the first "result" of a real page. The hand-written fixtures had the ad as a bare
`/y.js` link, which is why nothing had caught it. Two independent fixes in `src/browser/search.ts`:

1. an unwrapped target that is itself a `duckduckgo.com` address is never a result;
2. an anchor inside a `result--ad` container is skipped.

Everything else the real page carried parsed correctly with no change: titles, snippets (markup and entities stripped), the
`uddg` unwrapping for organic results, ranking, de-duplication, the private-address filter. The challenge page is detected
(`looksLikeAChallenge`) and, at the real status 202 and at 200, `DuckDuckGoHtmlSearch.search` returns `ok: false` with
"slow down" / "challenge", never an empty success.

### Tests

* `tests/browser/search-live-fixtures.test.ts` (7 tests, fixtures only, no network). Control: the ads really are in the page and
  the first anchor on it is the ad, so the filter had something to refuse; a real results page is not mistaken for a challenge.
* **Sabotage:** reverting both fixes turned the two ad tests red; restored, green.
* `scripts/verify/web-live.ts` is the **opt-in live check, in no default gate**. Needs no secret and no database. Run it as
  `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=<the proxy CA bundle named in the environment> npx tsx scripts/verify/web-live.ts`. Run once, 7 of 7:
  the search answered with the honest 202 "slow down" (accepted as the honest-failure branch, not a failure); a real page
  (`iana.org/help/example-domains`, 1,515 chars, 26 links) was read through `FetchedBrowser`; `chooseLinks` followed at most 2,
  both public https; a private address (`169.254.169.254`) was refused before any request; an HTML page offered as a
  download was refused (`text/html is not a type the office keeps`); a small public PDF
  (`w3.org/.../dummy.pdf`, 13,264 bytes) was downloaded with a matching magic number and the right type.

### What stays PARTIAL, and why

HQ-WEB-002/004/007 stay **PARTIAL**. The parser is now verified against real results markup and the honest-failure branch
against the real challenge page, and the download allow-list and link bounds were exercised on real public pages. What cannot be
claimed: (a) the service answers a datacentre address with a challenge after a few requests, so a live search from the office's
runtime may well be refused most of the time (honestly, as "search unavailable"), which is a property of the free keyless
provider and not a parser defect; (b) a genuine zero-results page was never captured; (c) the Cloudflare runtime and Supabase
Storage are still unexercised. If search must be dependable, implement another `SearchProvider`.

---

## 2. Google Calendar sync uses ETags (HQ-CAL-013 / 016 / 017 / 018)

### What changed

The adapter (`src/google/calendar-events.ts`) already supported `If-Match`; the duty never passed it, and the work list never
carried Google's last `updated` stamp. Now:

* `app.project_events_sync_work` returns `external_updated_at` (0897, one key). `external_etag` was already recorded by every
  successful push (`sync_done` stores `coalesce(p_etag, external_etag)`), so **no column was needed for the etag**.
* `syncProjectEvents` sends `If-Match: <stored etag>` on every update and delete of a linked event. A row with no stored etag
  (linked before etags were kept, or adopted) is sent without the header and falls back to the pull's old rule.
* `readEvent` (new, adapter) reads one event back as a typed value: gone, or content + etag + `updated` + whether it carries our
  tag.
* On a **412** the handler reads the event back and applies ONE rule (the same rule `app.project_events_pull` already applies to
  a change the pull finds, now enforced at write time):

  **The later writer wins, and the override is written down. A remote change is never overwritten unseen, and a re-send happens
  at most once.** Compared: Google's `updated` against this row's `updated_at` (content only; a sync never moves it).

| Case | What happens |
|---|---|
| etag merely stale (Google has nothing newer than `external_updated_at`, e.g. the pull already absorbed it) | re-send once with the fresh etag; no conflict recorded |
| update, local edit later | re-sent **once** with the fresh etag; `sync_error` = `conflict: a newer change in Google was overridden by this later edit`; Activity (`google_sync`, winner `team_hq`) |
| update, Google later | Google's content (title, notes, place, time) applied here; the local edit is dropped; `conflict: a pending edit here was overridden by a newer change in Google`; Activity winner `google`. **Nothing is sent** |
| update, second 412 while resolving | left pending and retryable; nothing overwritten; no loop |
| delete, the delete later | re-sent once with the fresh etag; the event goes |
| delete, Google edited it after the delete | **the delete is not sent**; the tombstone is lifted and Google's content is back, `conflict: ... so it is back and the delete was not sent` (the one silent loss this refuses) |
| Google deleted it meanwhile (404 / cancelled) | Google's deletion wins, as before (`project_event_gone`) |
| person edits again after the work was read | `take_remote` returns `raced`; that newer edit stays pending |

There is **no field-level merge**: nothing records the common ancestor, so which fields "each side changed" cannot be known. The
whole event goes to the later writer. Notes are applied from Google only when Google wins a conflict (the pull still does not
pull notes: the cache keeps a 300-character excerpt).

**Conflict marker for the calendar UI:** no payload change was needed. `public.hq_project_calendar` already returns `sync` and
`sync_error` for every native event, so the marker is the `sync_error` sentence beginning `conflict:` on a row that is
`synced`. The two new functions (0980) write it: `app.project_event_take_remote` (Google wins, optimistic against the
`updated_at` the work was read at) and `app.project_event_conflict_note` (local won). Both are owner-only (`revoke all`).
A stale etag after a pull is self-healing (one extra round trip, no conflict text): the cache does not store etags, so the pull
does not refresh the stored one.

### Tests (all green)

* `tests/handlers/calendar-events-etag.test.ts` (12) over a **stateful fake Google that models etags, `updated`, If-Match and
  412** (`tests/helpers/fake-google-calendar.ts`): normal edit (If-Match = stored etag, new etag recorded); no-etag fallback;
  concurrent edit Google-later / local-later; stale etag; second 412; Google deleted meanwhile; delete with a stale etag both
  ways; delete with the current etag; idempotent create (adopt, no duplicate); re-running an update with a spent etag does not
  overwrite a newer Google change.
* `scripts/isolated/project-calendar-conflict.ts cand_svc2`: the real `syncProjectEvents` and the real SQL on the replica
  against the same fake, 22 checks, rolled back: etag round trip, both conflict directions with the Activity winner, stale etag,
  delete losing and winning, Google deleting, a mid-sync edit staying pending, idle pass sends nothing, `anon` refused.
* **Sabotage, both red then restored:** (a) `If-Match` removed from the duty (9 vitest failures; 8 SQL checks); (b) the rule
  forced to "local always wins" (3 vitest failures; 6 SQL checks).
* Existing, still green: `tests/handlers/calendar-events.test.ts`, `tests/google/calendar-events.test.ts`,
  `scripts/isolated/project-calendar.ts cand_svc2` (ALL CHECKS PASSED), `scripts/isolated/ux-be/05-mcp-calendar.sql`
  (PASS).

### What stays PARTIAL

HQ-CAL-013/016/017/018 stay **PARTIAL for one reason only: a live Google was not exercised.** The fake models the API as
documented (`etag`, `updated`, 412 on a mismatched `If-Match` for PATCH and DELETE); real etag format, whether Google returns
`updated` identical to the value later seen in the cache, clock skew between Google's `updated` and this database's `updated_at`
(the later-writer comparison trusts both clocks), and real 412 bodies are unverified.

---

## 3. A Vikunja outage is shown in Settings (HQ-VIC-007)

### What was wrong

The sync's watermark was already right (a failed round marks nothing, moves no revision). A 401/403 said "the token was
refused". But an unreachable or refusing Vikunja left Settings on a green "In step" over a copy that had stopped moving; the
outage existed only in a deduplicated announcement.

### What is now true

* `src/tasks/health.ts` records every round's outcome through `app.vikunja_health_record` (0981) into the **existing**
  `public.connection_health` (service `Vikunja`, credential `API token`). The decision is made from what the round reported, not
  from text: refused (provider turned the token down), unreachable (anything else that ended the round), failed (the round
  threw: the server answered and refused it, e.g. project gone), ok (the round finished, even when single tasks failed: those
  stay per-task "to look at"). The handler records, then re-throws a throwing round so the job-failure path is unchanged.
  Recording failing (a database without 0981) never fails the round; it returns the problem as a value.
* 0981 adds two nullable columns to `connection_health`: `last_ok_at` (kept across failures, so "last in step" is a fact) and
  `fault_kind` (stored, never parsed back out of the sentence). `app.task_sync_panel` (spliced from its live definition) returns a
  new `health` key (null until a round has run); `hq_set_vikunja` and `hq_forget_vikunja` (spliced) call
  `app.vikunja_health_clear`, so connecting anew starts clean and a disconnect leaves no dead row and no open chore.
* **The existing credential pass reads this row**: a refused token / failed round has an action, so `app.chores_for_credentials`
  raises one "Reconnect Vikunja - API token" chore (once, not per pass) and the recording itself finishes it on recovery. An
  unreachable outage has **no** action, so it raises nothing (there is nothing a person can do) and clears itself.
* Settings card (`web/studio/app.js`, `settings.js`): the chip reads **Token refused / Refused the last round / Not answering**
  in the `bad` tone, a "Why it stopped" row carries the error sentence and what to do, and the first row says "Last in step 5
  hours ago". With no reading, or an ok reading, the card is exactly as before ("In step") and says nothing it does not know.

### Tests

* `tests/tasks/vikunja-health.test.ts` (9): the real duty and the real `VikunjaProvider` over the in-memory Vikunja with
  injected faults: ok, 503 -> unreachable (nothing marked pushed or pulled), 401 -> refused, recovery ok after down, a throwing
  round -> failed and still throws, not configured records nothing, recording failure does not fail the round, quote escaping.
  **Sabotage:** removing the record call turned 4 red; mapping every outage to `unreachable` turned 2 red.
* `scripts/isolated/vikunja-health.ts cand_svc2` (SQL, rolled back, 24 checks): reading shapes, last good time kept (given a
  distinct past value because a transaction freezes `now()`), the panel key, chore raised once for refused and not for
  unreachable, finished by recovery and by refused-then-unreachable, credential-shaped sentence withheld not stored, bad kind
  refused by message, long reason cut, `hq_forget_vikunja` and `hq_set_vikunja` clearing. **Sabotage:** `last_ok_at` preservation
  removed in a scratch copy turned 2 red.
* `scripts/verify/vikunja-health-ui.ts` (real Chromium, stubbed gateway, every non-local request aborted so nothing can reach
  production), four states at 1440x900 and 390x844, screenshots `.out/ux-vikunja-<width>-<state>.png`.

### What stays open

* Not run against a live Vikunja (still needs `scripts/verify/vikunja.ts`); the 401/403/429 behaviour is the fake's.
* An unrelated `app.record_connection_health` batch of five or more rows deletes rows it did not refresh within a minute, which
  would drop this row until the next round (15 minutes); `last_ok_at` is then lost and the panel simply has no reading.
* The three spliced functions were taken from the replica built from migrations; compare them with production's
  `pg_get_functiondef` before applying 0981.
* Also still true from the audit and untouched: Vikunja-side edits overwritten by a push, Vikunja-side deletes not mirrored,
  title length, labels/reminders not synced.
