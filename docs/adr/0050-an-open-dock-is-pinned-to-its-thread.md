# ADR-0050 — An open dock is pinned to the thread it was opened on

**Status:** accepted · **Date:** 29 September 2026 · **Issue:** #376

## Context

The dock took its project from the page every time it repainted. The two
experiences repaint it at different moments. The default dashboard repaints
on every render, so the dock followed the page. Basecamp did not repaint it on
navigation. A dock opened on B and left open on the way to the portfolio went
on showing B's thread until Send repainted it from the page.

So the message was filed under B, which was correct because B's thread was on
screen. Then the dock redrew onto Unnamed, and the message Grant had just sent
disappeared from view. The voice note in the same dock read its project from
the dock, so after a navigation it could disagree with the typed composer.

## Decision

An open dock is **pinned** to the project it was opened on
(`localStorage['studio.dock.project']`), in both experiences.

- Opening a shut dock pins it to the page's project, or to Unnamed from the
  portfolio (#149).
- Navigating does not move it. The header says **"Filed under ..."** whenever
  the page behind it is somewhere else, and Basecamp repaints the dock on
  navigation so that line is current.
- Closing it forgets the pin. Opening it again on another project is the
  deliberate change of context.
- A caller that files somewhere on purpose passes the slug. The command bar's
  "ask with no project" pins Unnamed.
- The typed composer, the voice note and Try again all take the project from
  the dock's own `p`, so they cannot disagree with what it shows.

## Rejected

**Following the page on every route change.** It would also have fixed the
vanishing message, but it moves a conversation out from under the person
having it. A question half-typed on B would be sent to wherever he last
clicked. Continuity is the reason to leave a dock open while moving around.

## Consequences

- On the default dashboard, the dock no longer follows the page once opened.
  It says where it files instead.
- The invariant is `npm run verify:basecamp-project-turn` sections 8 to 10:
  the thread before Send is the thread after it, and the message stays visible.
  Ignoring the pin turns 12 of its 35 checks red.
