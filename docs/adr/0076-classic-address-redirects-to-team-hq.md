# ADR-0076 — The /classic address reads as Team HQ

**Status:** accepted · **Date:** 20 November 2026 · **Supersedes in part:** ADR-0051, item 3 ("the older studio is kept at `/classic`")

## Context

ADR-0051 kept the older studio at `/classic`, unlinked, "for as long as it is useful". Nothing links to it, and the
owner asked for it to be removed when that was safe. Assessed on 20 November 2026:

- The older studio is not a separate app. `/classic` selects a different renderer (`state.experience = 'default'`) in the
  same `web/studio/app.js`. Team HQ still uses that file for parts of its screens (the Settings tabs, the chat dock and
  others), so the legacy renderer cannot be deleted in one step.
- About 19 legacy verification scripts in `scripts/verify/` open `/classic` as a live address. They test the retired
  renderer, and their expectations are not Team HQ's.

## Decision

1. **Step one, taken now.** `/classic` is read the same way `/basecamp` and `/studio` already are: the prefix is removed,
   the experience is Team HQ, and the first paint writes the canonical address. An old bookmark or a link in a message
   lands on the Team HQ page it names. The legacy renderer is no longer reachable from any address.
2. **Not taken now.** Deleting the legacy renderer's code, and retiring or rewriting the legacy verification scripts.
   Both need the owner's agreement, because retiring a suite is a decision and not a fix. Until then the code stays,
   as dead code behind an unreachable branch.
3. **Gate status at the decision.** `verify:ui`, `verify:wired`, `verify:talk` and `check:branding` pass. The journey
   check (`verify:team-hq-journey`) fails the same two sign-in steps and times out on the same press before and after
   this change; those failures predate it.

## Consequences

- Anyone who opens `/classic/...` now gets Team HQ. That is the intended effect.
- The legacy verification scripts that navigate to `/classic` now test Team HQ at that address and will fail on their
  legacy expectations. They are left in place so that the owner can decide whether each one is retired or rewritten.
- A future agent who wants the older studio back must not restore the prefix as a route to the legacy renderer without
  this ADR being revisited; the code path is still there, but it is not reachable.
