# Gate 2 — the knowledge layer (Gemini Notebook)

> ## Verdict: **NOT PASSED — BLOCKED**
>
> 17 checks proven · **16 items blocked on a credential that does not exist**
>
> Reproduce with `npm run poc:gate-2`. The script exits 0 when the provable
> half passes, and prints `Gate 2 is NOT passed` every time it runs.

| | |
|---|---|
| Date | 2026-09-03 |
| Adapter library | `notebooklm-py` **0.8.2** (the spec's choice), installed and inspected |
| Import name | **`notebooklm`**, not `notebooklm_py` |
| Auth paths the library offers | master token (`gpsoauth`), browser storage state (Playwright), extracted cookies |
| Credentials present | **none** |
| `notebook.enabled` | **`false`**, `self_adjustable = false` |
| Cost | $0.00 |

## What blocks it, precisely

Every one of §13's seventeen Gate 2 items needs a signed-in Google account.
There is none, and both steps that would produce one are human-only:

1. **A dedicated Google account.** Account creation cannot be automated, and
   `HUMAN_ONLY_PREREQUISITES.md` Phase 4 already lists it.
2. **One interactive Google sign-in to mint the master token.** The library's
   `auth.master_token_bootstrap` exists and works, but the flow it drives is an
   interactive Google login. Good for months afterwards.

§14 requires the question "can this be done by CLI, by API, or by inspecting
existing configuration?" to be answered before anything is handed to Grant, so
check 1 asks it mechanically rather than assuming the answer: every credential
path the library accepts is probed, including the vault.

**`GEMINI_API_KEY` is present and WORKING, and does not help.** It authenticates
the Gemini *API*; the adapter targets the *consumer NotebookLM product*, which
§7 notes has no official API — *"Google's official Enterprise API does not apply
to the consumer product."* Worth stating explicitly, because "we already have a
Google key" is the obvious wrong turn here and would have cost a round trip.

There is also a standing warning in the prerequisites worth repeating: **do not
browse Notebook signed in as that account while the worker runs.** It rotates
the worker's session out from under it.

## What is proven, and why it is not the leftovers

§13 attaches an unusual instruction to this gate:

> **If this gate proves too brittle, stop.** Do not build the rest of Team HQ
> around it. Research and test the simplest alternative knowledge layer first.

That instruction is only *available* if the rest of Team HQ has not already
grown a dependency on Notebook. So the requirements that can be proven without
a credential are precisely the ones that keep the stop-and-replace option open —
§7's protective rules:

- *"**Never** make operational state depend on Notebook."*
- *"A Notebook outage or breaking API change must degrade Notebook functionality
  **without corrupting or disabling the rest of Team HQ**."*
- *"**Never blindly retry an ambiguous Notebook write.**"*
- *"Never lose completed research because Notebook is down."*

Each of those is testable with no credential at all, because **the way to test
them is to have no credential.** The `UnavailableNotebookAdapter` is not a stub
standing in for real behaviour — with no credential it is the *correct*
implementation, and shipping it as the default means the degradation path is
exercised on every run rather than first discovered during an outage.

## Results

```
| # | check | outcome | |
|---|---|---|---|
| 1 | no Notebook credential exists, by any of the paths the library accepts | NOTEBOOK_MASTER_TOKEN=absent; NOTEBOOK_COOKIES=absent; vaulted notebook/google secrets=0; GEMINI_API_KEY=present, and not applicable - it authenticates the Gemini API, not consumer NotebookLM | ✅ |
| 2 | capability discovery reports one of §7’s five states, and records it | state=auth_required tier=null stored=auth_required capabilities={} | ✅ |
| 2b | a quota tier cannot be claimed by a probe that could not read one | the CHECK constraint refused the row | ✅ |
| 3 | the Notebook adapter is independently disabled, and cannot re-enable itself | enabled=false self_adjustable=false | ✅ |
| 4 | no operational table references a Notebook table; the dependency is one-way | operational -> notebook: 0 references (must be 0); notebook -> operational: 3 (notebook_sources->projects, notebook_sync_queue->jobs, notebook_sync_queue->projects) | ✅ |
| 5 | every adapter call refuses cleanly, and operational work proceeds regardless | listSources=refused cleanly fetchSourceText=refused cleanly addSource=refused cleanly addNote=refused cleanly; job created and closed, event appended (b32570d6), 5 config keys readable | ✅ |
| 6 | research queued while Notebook is down stays pending, with its payload intact | outcome=pending state=pending attempt=1 payload preserved=true (139 chars) | ✅ |
| 6b | identical research queued twice collides at the index rather than duplicating | same sync_id=true deduplicated=true rows=1 | ✅ |
| 6c | the fingerprint does not depend on property order | 521b72365d790ceb vs 521b72365d790ceb | ✅ |
| 7 | a write whose outcome is unknown becomes uncertain, not failed and not applied | outcome=uncertain state=uncertain timestamped=true | ✅ |
| 7b | the database refuses to retry an ambiguous write without reconciling first | refused: Failed to run sql query: ERROR: 23514: refusing to retry an ambiguous Notebook write without reconci | ✅ |
| 7c | and the application path refuses too, so neither layer is the only guard | attempt() refused a non-pending row | ✅ |
| 7d | reconciling a write that did land marks it applied, with the remote reference | applied state=applied remote_ref=remote-note-12345 | ✅ |
| 7e | reconciling one that did not land returns it to pending, so a retry is now safe | pending state=pending reconciled=true uncertain_since cleared=true | ✅ |
| 7f | an applied write cannot be moved back into the queue | the trigger refused it | ✅ |
| 8 | an unrecognised error from a broken RPC is treated as ambiguous, never as success | outcome=uncertain state=uncertain error recorded=unrecognised error, treated as ambiguous: Cannot read proper; read broke cleanly=true; jobs table still readable (124 rows) | ✅ |
| 9 | the adapter library named by the spec exists and its auth path is identified | notebooklm 0.8.2; master-token bootstrap available=true; module is "notebooklm", NOT "notebooklm_py" as the package name suggests | ✅ |
| B1 | list notebooks | needs a signed-in Google account and a minted master token | ⛔ |
| B2 | list sources | needs a signed-in Google account and a minted master token | ⛔ |
| B3 | add a URL source | needs a signed-in Google account and a minted master token | ⛔ |
| B4 | add a document source | needs a signed-in Google account and a minted master token | ⛔ |
| B5 | create a note | needs a signed-in Google account and a minted master token | ⛔ |
| B6 | query (chat) against sources | needs a signed-in Google account and a minted master token | ⛔ |
| B7 | artifact generation and retrieval | needs a signed-in Google account and a minted master token | ⛔ |
| B8 | auth refresh | needs a signed-in Google account and a minted master token | ⛔ |
| B9 | headless restart | needs a signed-in Google account and a minted master token | ⛔ |
| B10 | multiple polling cycles | needs a signed-in Google account and a minted master token | ⛔ |
| B11 | source deletion | needs a signed-in Google account and a minted master token | ⛔ |
| B12 | source duplication | needs a signed-in Google account and a minted master token | ⛔ |
| B13 | worker crash mid-operation against real Notebook state | needs a signed-in Google account and a minted master token | ⛔ |
| B14 | re-authentication | needs a signed-in Google account and a minted master token | ⛔ |
| B15 | rate limiting, measured | needs a signed-in Google account and a minted master token | ⛔ |
| B16 | reading AccountLimits.tier to derive quota budgets | needs a signed-in Google account and a minted master token | ⛔ |

17 proven, 16 blocked on a credential that does not exist.
Gate 2 is NOT passed, and this script does not claim it is.
```

## Isolation, checked two ways

Check 4 asks the **live schema**, not the source: are there any foreign keys
from an operational table into a Notebook table? Zero, in that direction; three
in the other (`notebook_sources → projects`, `notebook_sync_queue → jobs`,
`notebook_sync_queue → projects`). The dependency is one-way by construction.

A source-level check proves nobody wrote an import. A schema-level check proves
the database itself has no path from operational state to Notebook state, which
is the property that survives someone adding a column in a hurry.

`tests/notebook/isolation.test.ts` adds the source-level half, in CI: no module
in `src/{jobs,providers,db,channels,slack,migrations}` may import
`src/notebook/`, and nothing in `src/notebook/` may import the job engine or the
provider router. The second direction matters as much — a Notebook module that
transitions a job state has made Notebook operational even with no import
pointing the wrong way.

The test asserts it found **more than five** files before checking any of them.
A glob that silently matches nothing passes every assertion about its contents,
and this repository has already produced one check that passed for exactly that
kind of reason.

## The `uncertain` state, which is the point of the queue

§13 emphasises **ambiguous timeout** among Gate 2's cases, and §7 says why:

> **Never blindly retry an ambiguous Notebook write.** After a timeout or
> uncertain write, **reconcile actual Notebook state first.** Assume
> undocumented operations may not be cleanly idempotent.

Without a state for *"we do not know whether this landed"*, there are only two
options and both are wrong: retry, which may duplicate against an API with no
idempotency guarantee; or drop, which loses completed work.

So `notebook_sync_queue` has `uncertain`, and the transition
`uncertain → in_flight` — the blind retry itself — **is refused by a database
trigger**. Check 7b proves it at the database and 7c proves the application path
refuses too, so neither layer is the only guard. The way out is
`uncertain → reconciling`, which is a decision someone had to make.

Both reconciliation outcomes are proven: the write **did** land (7d — marked
applied, with the remote reference the CHECK constraint requires), or it **did
not** (7e — returned to pending, where a retry is now safe because it is a fact
rather than an assumption). And 7f proves an applied row cannot be moved back
into the queue, which is what stops a well-meaning cleanup from re-running work
that already succeeded.

### The two error types are deliberately unrelated

`NotebookUnavailableError` and `AmbiguousWriteError` share no supertype. An
outage means *wait*; an ambiguous write means *investigate*. A common base class
invites one `catch` to handle both, and the effect of that would be retrying
every timeout — the exact thing §7 forbids. A unit test asserts neither is an
instance of the other.

An **unrecognised** error is treated as ambiguous, not as a failure (check 8).
§7 says to assume undocumented operations may not be cleanly idempotent, so the
safe reading of an error nobody anticipated is that the write *might* have
landed. A breaking change in a private RPC does not arrive as a tidy error type
— it arrives as `Cannot read properties of undefined (reading 'wrb.fr')`, which
is what check 8 throws.

## Never losing completed research

The payload is stored **in full**, not as a reference to something that would be
regenerated later. It cannot always be regenerated: the inference that produced
it consumed quota, and the model may answer differently next time. Check 6
confirms the body is byte-identical after a failed write attempt.

Fingerprints are content-addressed and order-independent (6b, 6c): the same
research queued twice collides at a partial unique index rather than being
written twice. At the *index*, not in a de-duplicating check in application
code — two workers finishing the same research simultaneously would both find
nothing and both insert. The index is the only version that survives a crash
between the check and the write.

The index is partial, covering only live states, so re-queueing after
abandonment is allowed: that is a decision to try again, not a duplicate.

## Quota, and the temptation to hard-code it

§11 is specific: *"Read `AccountLimits.tier` at startup and derive budgets from
the detected tier — **never hard-code quota numbers**, which Google changes
without updating its own published tables."*

The tempting shortcut is a "sensible default" for the free tier when the tier
cannot be read. That is the same hard-coding, wearing a fallback's clothes, and
it is worse than no number because it looks measured. So
`notebook_capability_probes` has a CHECK constraint: a probe in state
`auth_required` **cannot record a tier at all**. Check 2b proves the database
refuses the row.

The known free-tier figures — 100 notebooks, 50 sources per notebook, 50
chats/day, 3 audio overviews/day, 10 Deep Research/month — are in the spec as
design context. They are deliberately **not** in the code.

`available_unofficial` deserves a note. It is the expected steady state for the
consumer product: the private RPC path works and carries no stability promise.
Calling that `available` would hide the exact risk the adapter boundary exists
to contain, which is why §7 lists it as a distinct state and why it is an enum
rather than free text.

## The library is real, and richer than the spec assumed

`notebooklm-py` 0.8.2 exports precisely the primitives §7's design calls for,
which is a good sign for Gate 2 when it can run:

| §7 requirement | library provides |
|---|---|
| read the tier, never hard-code quota | `AccountLimits(tier, notebook_limit, source_limit)` |
| never blindly retry an ambiguous write | `NonIdempotentRetryError` |
| pull each source's text once, cache it | `SourceFulltext`, `SourceGuide` |
| ambiguous research task handling | `AmbiguousResearchTaskError` |
| rate limiting | `RateLimitError`, with retry counts on the client |

One practical trap, recorded because it cost a few minutes: **the package is
`notebooklm-py` but the module is `notebooklm`.** `import notebooklm_py` fails
with `ModuleNotFoundError` on a correctly installed package.

## What Grant needs to do, exactly

Two things, in this order:

1. **Create a dedicated Google account** for the worker. Not a personal one —
   §7's session-rotation warning is the reason.
2. **Share one test Notebook to it**, then run one interactive sign-in so the
   master token can be minted. Good for months.

Nothing else about Gate 2 is Grant's. Once the token exists, the sixteen blocked
items are all automatable and `scripts/poc/gate-2.ts` is where they go.

## Files

| | |
|---|---|
| `migrations/0015_notebook_boundary.sql` | capability probes, the sync queue, the source cache, the transition trigger, the kill-switch |
| `src/notebook/adapter.ts` | the boundary, the unavailable implementation, fingerprinting |
| `src/notebook/sync-queue.ts` | queue, attempt, reconcile, probe recording |
| `tests/notebook/isolation.test.ts` | 12 unit tests, including the source-level isolation check |
| `scripts/poc/gate-2.ts` | this evidence run |
