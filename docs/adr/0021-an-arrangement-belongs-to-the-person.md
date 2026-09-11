# ADR-0021 — An arrangement belongs to the person, not to the browser

**Date:** 2026-09-11 · **Status:** accepted · **Issue:** [#81](https://github.com/granterogers/agentic.team.grant/issues/81)

## The decision

Where a customisable interface stores what the person customised: **in
Supabase, keyed by owner and dashboard project, served in the payload the page
already fetches.** `localStorage` is a cache in front of it and never the
record.

This ADR exists because the opposite choice is the obvious one, it is much less
work, and everything about it looks correct right up until you open the same
page on a second machine. A future agent adding the next customisable thing —
a saved filter, a column order, a pinned document — will be tempted the same
way, and will not have this conversation to read.

## The ask

Grant, 11 September, in the review item itself:

> *"Layout is **per person, per dashboard project**, and persists. Not
> `localStorage`: he uses more than one device and the whole point of arranging
> it is that it stays arranged. A table, and it belongs under his own subtree,
> not shared."*

He specified the storage before anyone had written the feature. That is unusual
and it is the part worth honouring exactly.

## What it looks like

`public.dashboard_layouts` — `(owner, project_id)` primary key, `panels` as
`jsonb`, `updated_at`. `app.hq_dashboard_layout_set` and `_reset`, with public
wrappers because PostgREST only exposes `public`. `hq_studio()` carries the
stored arrangement on each project, so the page needs no extra call.

Three consequences, each of which was a bug before it was a rule:

1. **The office is read first, then the browser, then the default.** In that
   order. Anything else and the machine you last touched wins over the machine
   you are on.
2. **An empty layout is a reset, never a stored value.** `[]` is
   indistinguishable from a layout that failed to load, so removing the last
   panel deletes the row and the default comes back. Enforced in the RPC, not
   only in the page.
3. **This session's own change outranks all three, until the next load.**
   Preferring the office's copy meant the redraw immediately after a drop read
   the arrangement as it was before the drop and snapped the panel back — the
   save had worked and the screen disagreed with it. The alternative is
   re-fetching the payload between letting go of a panel and seeing it land,
   which is a network round trip inside a gesture.

## `owner` is a column, not an auth system

CLAUDE.md is unambiguous: one bearer token, no new authentication. `owner` is
`text not null default 'grant'` and nothing checks it. It is not pretending to
identify anybody.

It is there because adding a key column to an existing primary key is a
migration involving a table rewrite and every function that touches it, and
because the day there is a second person is the day it is needed. The cost of
carrying it now is one word per query.

## What this does NOT mean

Not everything a browser remembers belongs in the database. The line:

- **The office** — anything the person composed and would be annoyed to lose:
  an arrangement, a saved view, a written note, a preference about how the work
  is shown.
- **`localStorage`** — anything about *this* browsing session that is
  meaningless elsewhere: which tab was open, whether the rail is collapsed,
  whether the dock is showing, a half-typed draft, and a cache of the above so
  the interface is instant.

The test is Grant's own: would he be surprised to find it reset on the other
device? If yes, it is a table.

## The check

`npm run verify:arrangement`. It exists because this failure is invisible to
every other suite — a page that saves only to `localStorage` drags, snaps,
survives a reload and captures perfectly, and is wrong only on a second device,
which no capture run has. So it asserts what *leaves* the page: a planted
layout must be the one drawn, a change must go out as
`dashboard_layout_set` carrying the new value, the screen must then agree with
what was saved, and emptying the board must ask for a reset.

Proven by restoring the `localStorage`-only behaviour: 1/6.

## Consequences

- Any new customisable surface should add a column or a table, not a key in
  `localStorage`, and should extend `verify:arrangement` rather than inventing
  a parallel check.
- One more round trip on every change to an arrangement. It is fire-and-forget:
  the screen never waits for it, and a failure leaves the change on screen and
  in this browser, so the failure mode is "the other device is behind", not
  "your work vanished".
- One more thing in the `hq_studio()` payload. It is a small `jsonb` per
  project and it removes a fetch, so this is a saving.
