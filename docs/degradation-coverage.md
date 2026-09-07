# §18 degradation tests — what is covered, and by what

**Purpose.** §18 names twenty degradation cases and one rule for all of them:

> In every case: **canonical state is preserved and duplicate substantive work
> is avoided.**

Twenty cases is more than anyone holds in their head, so "we have good coverage"
is a claim nobody can check and everybody makes. This is the map. Each row names
the suite and the check, so a gap is visible rather than remembered.

**Verified 2026-09-06** by running each suite and reading the check names, not
by grepping for keywords.

| | §18 case | Covered by |
|---|---|---|
| 1 | Notebook unavailable 24h | `verify:sync` — *an outage produces a recorded degraded cycle, and the rest of Team HQ carries on* |
| 2 | Notebook private API breaks | `verify:sync` — *an unrecognised adapter error is recorded, not swallowed and not crashed on* |
| 3 | Notebook auth expires | `verify:sync` — *expired auth yields no budget rather than a guessed one* |
| 4 | Slack disabled | `verify:chaos` — *Slack switched off (§17): the pager is untouched by the decision*, plus *nothing behind the surface was affected* |
| 5 | Telegram disabled | `verify:chaos` — *Telegram switched off (§17): the pager stops resolving*, and *Slack still delivers — the decision was about one surface*. The mirror of case 4, written because this map showed only one half existed |
| 6 | Voice budget exhausted | `verify:tts` — *one character past a full budget is refused*, with the concurrency guarantee beside it |
| 7 | Realtime unavailable | `verify:cross-interface` — *a voice turn redelivered after a dropped reply is discarded, not repeated*. Voice became a command source in 0102–0105; the failure that matters is the endpoint being unreachable mid-sentence, and what must survive it is §18's rule for every case: canonical state preserved, no duplicate work |
| 8 | OpenRouter exhausted | `verify:router` — *a rate-limited first model fails over to the next and still answers*; `verify:chaos` — *the breaker recorded the failure* |
| 9 | **Every** free provider unavailable | `verify:router` — *disabling a provider empties its allow-list*, and *the router refuses while it is disabled* (`NoUsableModelError`, so work queues rather than failing) |
| 10 | Google OAuth revoked | ⬜ **not applicable yet.** Phase 9 has no OAuth client in service |
| 11 | Invalid refresh token | `tests/slack/rotation.test.ts` — seven checks on `rotateAndPersist`, the sequence extracted from the script so it could be tested at all. The one that matters: **a refused rotation does not touch the access token**, so it keeps working until it expires |
| 12 | Expired watch subscription | ⬜ **not applicable yet.** No watch subscriptions exist |
| 13 | **Crash after commit, before notification** | `verify:chaos` — three checks: recovery resumes delivery, the outstanding delivery is picked up, and **the output is not duplicated**. This is the case that found a real defect (0058, 0059) |
| 14 | Crash during a Notebook write | ⬜ **not applicable.** Write-back was never built, and ADR-0013 retires the unattended client for good |
| 15 | Duplicate command | `verify:slack`, `verify:telegram` — the dedupe index, exercised through the deployed endpoints |
| 16 | Duplicate webhook | `verify:slack` — five simultaneous redeliveries, one stored; a 409 is treated as success |
| 17 | Same command twice | `verify:ledger`, `verify:worker` — idempotency keys at the job layer |
| 18 | **Semantically equivalent command through two interfaces near-simultaneously** | `verify:chaos` — *the same instruction through two interfaces at once: both recorded, one person, one text*; `verify:cross-interface` for the full equality |
| 19 | Stale Telegram Undo | `verify:undo` — *an undo requested after its window reports expired, and does not reverse* |
| 20 | Stale Slack action | `verify:slack` — *a stale Undo says there is nothing left to undo rather than silently succeeding* |
| 21 | Malformed provider output | `verify:agents`, `verify:worker` — the liar and incoherent fixtures, refused by the quality gate |
| 22 | Transaction failure mid-job | `verify:chaos` — *a transaction that fails part-way leaves NO half-state behind* |
| 23 | **Backup restore to a replacement database** | the nightly rehearsal, which restores into a scratch database and pages on failure. It had never passed until 2026-09-05 |

---

## The remaining work, plainly

**None left.** Case 7 was the last, carried for weeks as *"not testable until
voice is a command source"*. Grant settled §12's "optional premium" against
§22's completion criterion — **"Voice is required"** — and 0102–0105 made voice
a command source, at which point the case became real and was covered.

What it turned out to be worth testing is not the recogniser failing, which is
visible and recoverable, but the turn that was heard, sent, and whose reply
never arrived: the browser retries, and §18's rule is that the second delivery
must change nothing. It does — the `inbound_commands` dedupe index refuses it,
exactly as it refuses a redelivered Slack event.

Cases 5 and 11 were the two this map exposed on the day it was written, and both
are now closed. Case 11 is the better story: the rotation sequence lived only
inside a script, so the one property that protects us — **a refused rotation
must not destroy the credential it still holds** — could not be tested at all.
Extracting it into `rotateAndPersist` was the fix, and the extraction also moved
the post-rotation verification onto the token read back *out of the vault*
rather than the one still in memory, so a `store_secret` that silently wrote
nothing is caught immediately instead of twelve hours later.

**Two are not applicable** and are recorded as such rather than left blank:
Google OAuth and watch subscriptions belong to Phase 9, and Notebook write-back
was retired by ADR-0013. Case 10 becomes real the moment Grant creates an OAuth
client — the plumbing is built and waiting on that one human step.

---

## Why this file exists rather than a number

A coverage percentage would be one number over a list nobody re-reads, and it
would go up when a check was added whether or not the check discriminated. Case
13 is the argument: it was "covered" by a recovery function with a comment
explaining exactly the right behaviour, and the behaviour was wrong for the
state a worker actually spends its time in. The row is only worth what the check
behind it is worth, which is why each names the check and not just the suite.
