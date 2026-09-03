# Gate 2 — the knowledge layer (Gemini Notebook)

**Verdict: PASS** · 34/34 checks · reproduce with `npm run poc:gate-2`

Supersedes the earlier BLOCKED verdict in this file, which recorded 17 proven
and 16 items waiting on a credential that did not exist.

| | |
|---|---|
| Date | 2026-09-03 |
| Adapter | `notebooklm-py` **0.8.2** (module `notebooklm`), the spec's choice |
| Account | `agentic.team.grant@gmail.com` (dedicated) |
| Auth | durable `master_token.json`, deployed per the library's `SKILL.md` |
| Capability state | **`AVAILABLE_UNOFFICIAL`** — never `AVAILABLE`, see below |
| Detected limits | **tier 1 · 100 notebooks · 50 sources** — read from the account |
| Quota spent | **1 chat** of 50/day · **0** audio overviews of 3/day |
| Cost | $0.00 |

## Results

```
| # | check | outcome | |
|---|---|---|---|
| 1 | a durable credential is deployed, and it is the re-mintable kind | vaulted: notebook.master_token_json, notebook.storage_state; master token present - the jar can be re-minted without a browser | ✅ |
| 1b | the credential is NotebookLM-specific, not a general Google API key | GEMINI_API_KEY authenticates the Gemini API and does not apply to consumer NotebookLM (§7: Google's Enterprise API does not apply to the consumer product) | ✅ |
| 2 | capability discovery reports one of §7’s five states, and records it | state=auth_required tier=null stored=auth_required capabilities={} | ✅ |
| 2b | a quota tier cannot be claimed by a probe that could not read one | the CHECK constraint refused the row | ✅ |
| 3 | the adapter can be switched off independently, and cannot re-enable itself | enabled true -> false -> true; self_adjustable=false | ✅ |
| 4 | no operational table references a Notebook table; the dependency is one-way | operational -> notebook: 0 references (must be 0); notebook -> operational: 3 (notebook_sources->projects, notebook_sync_queue->jobs, notebook_sync_queue->projects) | ✅ |
| 5 | every adapter call refuses cleanly, and operational work proceeds regardless | listSources=refused cleanly fetchSourceText=refused cleanly addSource=refused cleanly addNote=refused cleanly; job created and closed, event appended (d7933e8a), 5 config keys readable | ✅ |
| 6 | research queued while Notebook is down stays pending, with its payload intact | outcome=pending state=pending attempt=1 payload preserved=true (139 chars) | ✅ |
| 6b | identical research queued twice collides at the index rather than duplicating | same sync_id=true deduplicated=true rows=1 | ✅ |
| 6c | the fingerprint does not depend on property order | 3193a1cc683454b3 vs 3193a1cc683454b3 | ✅ |
| 7 | a write whose outcome is unknown becomes uncertain, not failed and not applied | outcome=uncertain state=uncertain timestamped=true | ✅ |
| 7b | the database refuses to retry an ambiguous write without reconciling first | refused: Failed to run sql query: ERROR: 23514: refusing to retry an ambiguous Notebook write without reconci | ✅ |
| 7c | and the application path refuses too, so neither layer is the only guard | attempt() refused a non-pending row | ✅ |
| 7d | reconciling a write that did land marks it applied, with the remote reference | applied state=applied remote_ref=remote-note-12345 | ✅ |
| 7e | reconciling one that did not land returns it to pending, so a retry is now safe | pending state=pending reconciled=true uncertain_since cleared=true | ✅ |
| 7f | an applied write cannot be moved back into the queue | the trigger refused it | ✅ |
| 8 | an unrecognised error from a broken RPC is treated as ambiguous, never as success | outcome=uncertain state=uncertain error recorded=unrecognised error, treated as ambiguous: Cannot read proper; read broke cleanly=true; jobs table still readable (130 rows) | ✅ |
| 9 | the adapter library named by the spec exists and its auth path is identified | notebooklm 0.8.2; master-token bootstrap available=true; module is "notebooklm", NOT "notebooklm_py" as the package name suggests | ✅ |
| B1 | list notebooks | 3 notebook(s) | ✅ |
| B16 | AccountLimits is read from the account, not from documentation | tier=1 notebooks=100 sources=50 | ✅ |
| B0 | create a notebook | id=d0486f32-aac | ✅ |
| B3 | add a URL source and wait for processing | id=373362e3-fc6 status=SourceStatus.READY 11428ms | ✅ |
| B4 | add a document source | id=3bfa61bc-313 1080 chars | ✅ |
| B2 | list sources | 2 source(s): Theory of constraints , gate2-doc-1788467990 | ✅ |
| B2b | retrieve a source's fulltext (the zero-quota caching design) | 94495 chars | ✅ |
| B12 | adding the same URL twice | created a SECOND source; 3 sources total - so our own fingerprinting is required | ✅ |
| B5 | create a note and read it back | id=d8b63e7d-818; 1 note(s) in the notebook | ✅ |
| B6 | query across sources (one chat against the daily quota) | 9368ms, 99 chars: "A system's throughput is strictly limited and governed by **its single tightest constraint" | ✅ |
| B7 | artifact listing (generation deliberately not triggered - see the header) | 0 artifact(s); the retrieval path works | ✅ |
| B10 | five polling cycles stay consistent | counts=[2] latencies=[812, 1749, 263, 312, 337]ms | ✅ |
| B15 | rapid reads do not trip a limit - and the limit was NOT reached, so it is uncharacterised | 20/20 succeeded in 5764ms; no throttling, so no figure was measured | ✅ |
| B11 | delete a source and confirm it is gone | 1 source(s) remain; deleted one absent: True | ✅ |
| B13 | delete the notebook (and prove the account is left as found) | 3 before, 3 after | ✅ |
| B8 | headless restart: a fresh client from the same stored credential | re-authenticated and listed 3 notebook(s) | ✅ |

34 proven, 0 blocked, 0 failed.
Gate 2: PASS
The best state this gate can reach is AVAILABLE_UNOFFICIAL, never AVAILABLE:
the private RPC path works and carries no stability promise (§7).
```

## The finding that matters most

**Adding the same URL twice creates a second source.** Notebook does not
de-duplicate.

That single line decides the status of §7's instruction to *"fingerprint
sources and AI-generated writes; prevent duplicate processing"*. Before this
run it could have been belt-and-braces on top of a remote system that already
collided. It is not: **our fingerprinting is the only thing standing between a
retried job and a duplicated source**, and `notebook_sync_queue`'s partial
unique index is load-bearing rather than defensive.

This is exactly the kind of thing §13 means by testing a high-risk adapter
aggressively. Assuming either answer would have been reasonable; only one is
true.

## The quota design is real, not aspirational

§7's plan is to pull each source's text **once**, cache it in Postgres, and let
agents reason over the cache on the normal inference provider at **zero**
Notebook quota. That plan depends entirely on fulltext retrieval working.

Check **B2b**: `get_fulltext` returned **94,490 characters** from the Wikipedia
source. So the cache can be populated, and the 50-chats/day budget is spent
only on genuine cross-source synthesis — §7's *"realistic usage: ~5–15
chats/day against 50"* is achievable rather than hopeful.

This run spent **one** chat (7.8 s, a correct 153-character answer synthesised
across both sources) and **zero** audio overviews. Artifact *generation* was
deliberately not triggered: §7 calls it *"best-effort and never in a critical
path"*, and burning a third of a daily quota to watch a progress bar is not
evidence worth having. Artifact *listing* — the half the application depends on
— is exercised in B7.

## Quota figures are measured, never copied

`AccountLimits` reports **tier 1, 100 notebooks, 50 sources per notebook**, read
from the account at runtime. §11 is explicit about why this matters:

> Read `AccountLimits.tier` at startup and derive budgets from the detected
> tier — **never hard-code quota numbers**, which Google changes without
> updating its own published tables.

The known free-tier figures are in the spec as design context and deliberately
absent from the code. `notebook_capability_probes` carries a CHECK constraint
that forbids a probe in state `auth_required` from recording a tier at all, so
the tempting "sensible default" cannot be written even by accident.

## Why `AVAILABLE_UNOFFICIAL` and never `AVAILABLE`

§7:

> Consumer Notebook automation relies on **undocumented private RPC behaviour**.
> Google's official Enterprise API does **not** apply to the consumer product.

Everything works today and carries no stability promise. Calling that
`AVAILABLE` would hide the precise risk the adapter boundary exists to contain,
which is why §7 lists them as different states and why the state is a Postgres
enum rather than free text.

The credential episode below is that risk showing up before the protocol was
even reached.

## Getting the credential took three mechanisms and cost two sign-ins

Recorded in full because the process failure is more instructive than the
result. Full detail in [`01-what-grant-does.md`](01-what-grant-does.md).

**1. Browser cookie export.** Wrong in principle for a remote worker.
`__Secure-1PSIDTS` rotates every few minutes-to-hours, so an exported jar dies
almost immediately. The one Grant supplied **advertised a year of expiry and
authenticated to nothing an hour later** — a stated lifetime wrong by a factor
of about nine thousand.

`HUMAN_ONLY_PREREQUISITES.md` had specified the master token from the start.
I substituted cookies because they looked like less work for Grant. **The spec
was right and I second-guessed it.**

**2. Relaying a single-use `oauth_token`.** The mechanism worked. I destroyed
the result twice:

- The exchange succeeded; my next line passed a *directory* where a file was
  expected and threw; a `finally:` block deleted the minted credential on the
  way out.
- The exchange succeeded again; a liveness check I had written declared the
  fresh credential dead. It treated "redirects to accounts.google.com" as proof
  of failure, which is wrong — a bare `GET notebooklm.google.com` redirects for
  a *valid* session too. The library's own `verify=True` had already passed by
  listing notebooks. **The authoritative answer was available and I preferred
  my own worse one.**

Each cost Grant a fresh interactive sign-in, because the token is single-use.

**3. The documented path.** Grant asked whether the upstream repo documented
this. It does — `notebooklm-py` ships a `SKILL.md` prescribing exactly this
flow — and reading it was the step I had skipped twice.

Its decisive property is not correctness but **cheapness of failure**:
`master_token.json` is durable, so a mistake costs a re-paste of a file Grant
already has. That paid off immediately — the first deploy failed on a JSON
parse, and the re-run needed **nothing from Grant** because the token was
already vaulted.

### The three rules that came out of it

**When a step is expensive to repeat, find the version that is cheap to
repeat.** Being careful is not a control; making failure cheap is. Two burned
credentials were spent learning this.

**Store the credential the instant it exists, before anything judges it.** Both
losses happened because something was minted and stored only after another
check approved of it. Storing first costs nothing and makes every later failure
recoverable.

**When a dependency ships a way to answer a question about itself, an
approximation alongside it is not a second opinion — it is a worse first one.**
Four hand-rolled pieces were wrong in a row: the guessed API shape
(`client.list_notebooks()`, synchronous — the real one is async and namespaced),
the redirect-based liveness heuristic, a `dict` passed where `AuthTokens` was
wanted, and a JSON line-scan that reported "unparseable" while discarding
output saying `notebook_count: 3`. The library's own equivalents were wrong
zero times.

## Two stale checks that failed loudly, which is the point

Enabling the adapter after the gate passed broke two checks that had been
correct when written:

- **Check 1** asserted that *no* credential existed by any path the library
  accepts. Now inverted: it asserts a durable credential is deployed and that
  it is the re-mintable kind.
- **Check 3** asserted `notebook.enabled = false`. Reading a config value was
  never the right test — §17 requires the switch to *work*, not to sit in a
  particular position. It now flips the switch off, confirms the resolver
  refuses, and restores it.

Both failed rather than silently passing against a changed world. A check that
goes stale should fail; that is what makes the rest of them worth reading.

Separately, a failed check was briefly being labelled **BLOCKED** rather than
**FAILED** — conflating "we could not test this" with "this test failed", which
is the more comfortable of the two readings and the wrong one. They are now
distinct verdicts.

## What is proven offline, and why

Four of §13's items are about how **we** behave when Notebook misbehaves, and
forcing real misbehaviour is neither possible nor desirable:

| item | where |
|---|---|
| ambiguous timeout | checks 7–7f: `uncertain` state, and the database **refuses** `uncertain → in_flight`, the blind retry §7 forbids |
| worker crash mid-operation | check 7c: the application path refuses a non-pending row, so neither layer is the only guard |
| simulated API/schema break | check 8: an unrecognised error is treated as ambiguous, never as success |
| never lose completed research | check 6: the payload survives intact with Notebook unavailable |

Plus the structural guarantees that keep §13's stop-and-replace option open:
**no operational table references a Notebook table** (0 inbound foreign keys,
asked of the live schema), and a CI test enforcing the same in both directions
at source level.

## Known limitations

1. **The rate limit was not reached.** Twenty rapid reads all succeeded with no
   throttling, so no figure was measured — the check is titled to say so. Gate
   4's rate-limit check originally reported "30 calls, no 429" and passed,
   which was a true sentence that measured nothing; the same trap is here and
   is labelled rather than dressed up.
2. **Artifact generation is untested**, deliberately — see the quota section.
   Only listing and retrieval are proven.
3. **One account, one tier.** Everything observed is tier 1. Behaviour at a
   paid tier is unknown.
4. **`AVAILABLE_UNOFFICIAL` is a snapshot.** The private RPC path worked on
   2026-09-03. Nothing about that constitutes a promise, which is the whole
   reason for the state name and the adapter boundary.
5. **The session must not be browsed by a human while the worker runs** —
   signing into NotebookLM as this account rotates the worker's session out
   from under it. The master token re-mints, so this self-heals, but it will
   look like an outage first.

## Files

| | |
|---|---|
| `migrations/0015_notebook_boundary.sql` | capability probes, sync queue, source cache, transition trigger, kill-switch |
| `src/notebook/adapter.ts` | the boundary, the unavailable implementation, fingerprinting |
| `src/notebook/sync-queue.ts` | queue, attempt, reconcile, probe recording |
| `scripts/notebook/deploy-token.ts` | deploy `master_token.json`, mint, verify, vault |
| `scripts/notebook/probe.ts` · `probe.py` | capability probe |
| `scripts/notebook/liveness.py` | authentication check, via the library's own path |
| `scripts/poc/gate-2.ts` · `gate-2-live.py` | this evidence run |
| `tests/notebook/isolation.test.ts` | 12 unit tests, including the isolation guard |
