# ADR-0051 — Team HQ is the product at every address

**Status:** accepted · **Date:** 29 September 2026 · **Issue:** #382 · **Brief:** `docs/spec/team-hq-canonical-cutover-2026-09-29.md`

## Context

`web/studio` has one router and two renderers. The newer project workspace was
built beside the older studio and selected by an address prefix, `/basecamp`,
so that it could be developed without disturbing the product. The prefix
outlived its purpose. The root and every plain link still rendered the older
studio, and manual testing landed Grant in the interface he had asked to
retire.

The prefix also carried the name of the product that inspired the design.
That product is not this one, and Grant asked for its name to leave everything
a person can see.

## Decision

1. **The plain addresses are Team HQ's:**
   - `/` is the portfolio;
   - `/p/<slug>` is a project workspace, and `/p/<slug>/<tool>` one of its tools;
   - `/tasks`, `/activity` and `/search` are the global views.

   The scheme is the router's existing one, so no parser changed shape.
   `/projects/…` was considered and rejected: it would have renamed every link
   for no gain, and broken the older studio's links rather than resolving them.
2. **Old addresses resolve.** `/basecamp/…` and `/studio/…` are read as the
   same address without the prefix, and the first paint rewrites them with
   `replaceState`, so no history entry is added. The older studio's own
   project links used the same `/p/…` scheme, so they land on the Team HQ
   equivalent unchanged. `vercel.json` no longer excludes `studio/` from the
   rewrite, so `/studio/p/…` is no longer a 404.
3. **The older studio is kept at `/classic`, unlinked.** Nothing in Team HQ
   links to it. Jump's "Current Team HQ" result, the last route out, was
   removed. It stays for as long as anything needs it, and every legacy suite
   is pointed there.
4. **"Basecamp" leaves the product.** The browser title is
   "Team HQ — Agentic Team", and no visible text, label or address carries the
   word. `npm run check:branding`, in the gate, scans every shipped web file,
   ignores comments and a short allow-list of internal tokens, and proves it
   can fail (`--control`). `npm run verify:team-hq-journey` asserts the same
   on every rendered screen.
5. **Internal names stay** (the brief: do not over-clean): the `bc/`
   directory, `state.experience === 'basecamp'`,
   `[data-experience='basecamp']`, the `verify:basecamp-*` suites,
   `dashboard_layouts.surface = 'basecamp'`, and the review deployment's
   function names. None is shown to anybody. Renaming them is a later cleanup
   with no user benefit and real regression risk.

## Parity

| Capability | Older studio | Team HQ | Action |
|---|---|---|---|
| Portfolio | board | Home (`/`) | none |
| Project overview | map / panels board | composed overview | none: the map is presentation only |
| Team, Docs, To-dos, Contacts, Sources | project tabs | own tools at the same addresses | none |
| Chat | Team tab, chat sub-tab | Chat tool + dock | none |
| Card Table, Schedule, Activity | — | own tools | — |
| My Tasks, Activity | `/tasks`, `/activity` | same addresses | none |
| Office settings: roster, hire, retire, tools, behaviour, governance, connections, channels, usage, appearance | settings sheet | the same sheet, from the top-right control | none |
| Project settings | settings sheet | Project Settings tool | none |
| Talk to the team | call button | voice control | none |
| Command bar | command bar | Jump | none |
| Voice note | — | Chat and dock | — |
| Map arrangement, look sheet | yes | no | stays in `/classic`; presentational, not operational |

`verify:basecamp-preservation` asserts that every older-studio section and
global destination is reachable from Team HQ: 26/26.

## Consequences

- A person meets Team HQ wherever they arrive: the root, a bookmark, a sign-in
  return (the link comes back to the address it was requested from), or an old
  link.
- The legacy suites test `/classic`, and the Team HQ suites that asserted the
  old isolation ("`/` is the older studio") now assert its inverse.
- The dock took its text colour from the page. Inside Team HQ that is Team HQ's
  light text, which all but vanished on the dock's light surface under the
  light scheme (1.1:1). The dock now sets its own ink (`studio.css`).
