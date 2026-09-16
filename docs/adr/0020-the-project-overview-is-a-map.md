# ADR-0020 — the project Overview is a map, and the panel board stays behind one switch

**Date:** 2026-09-16 · **Status:** accepted

## Context

Grant sent a design direction for the project dashboard on 15 September,
persisted verbatim at `docs/spec/project-dashboard-design-direction-2026-09-15.md`:

> *"The dashboard should feel like a living, interactive map of the project,
> with clarity and space at its core."*

and, unambiguously about scope:

> *"This describes how the project dashboard itself should look and behave. It
> is not a request for a separate Canvas tab, additional view, or disconnected
> feature."*

Three days earlier he had asked for something else on the same screen, and it
had just been built as #219 and #220:

> *"this draggable area should be present within the project itself"*

The project Overview was that panel board. Two instructions, both his, both
about the same rectangle.

## Decision

**The Overview opens on the map.** It is not a tab of its own, it is not
reachable by a different route, and nothing has to be pressed to get to it —
which is what the direction asks for.

**The panel board remains, behind one segmented control, and the studio
remembers which was chosen.** It is not the default and it is not advertised.

## Why not simply delete the panels

The same issue carries Grant's own integration instruction, verbatim:

> *"Before implementing major architectural changes, inspect the existing
> application and data model and determine how this architecture can be
> integrated without unnecessarily rebuilding working functionality."*
>
> *"Treat this specification as the target product direction, while preserving
> existing functionality that remains compatible with it."*

The panel board is working functionality, it is three days old, he asked for it
in his own words, and nothing in the map brief says it was wrong. Removing it to
satisfy a brief that does not mention it would be reading "the dashboard should
be a map" as "the dashboard should be only a map", and paying for that reading
with a feature.

The cost of keeping it is one control and one remembered preference. The cost of
being wrong the other way is a deletion that cannot be undone from the
dashboard.

## What this is not

It is **not** a Canvas tab. There is no third place. The switch changes what the
Overview draws, in place, and the default is the map. If Grant says the panels
should go, they go — and that is a one-line change, which is the other reason
this is the cheap direction to be wrong in.

## Consequences

- `web/studio/plane.js` draws the map; `app.js` routes the Overview to it.
- `+ Add panel` and `Reset` are hidden in map mode. Two controls named Reset on
  one screen, doing different things, is worse than either missing — the map's
  own reset is in the corner controls where the reference puts it.
- `verify:map` presses the eight behaviours the direction names by number.
- The preference is `studio.overview` in browser storage: per viewer, per
  device, and correct when it comes back empty.

## Related

#25 (tracking) · #219 and #220 (the panel board) · #158 (Settings is a page, the
same shape of decision made the other way) · ADR-0019
