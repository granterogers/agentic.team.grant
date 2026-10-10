# ADR-0072: The background material is one layer, fixed to the window

Status: Accepted (10 October 2026, branch `claude/lucid-mendel-ubvlk4`, not merged). Amends decision 3 of ADR-0069.

## Context

ADR-0069 decision 3 anchored a tiling material to the WORLD: the board painted the tile from the same `--bc-gx --bc-gy --bc-gz` as the
dots, so it panned and zoomed with the modules. The page chrome (top bar, prototype strip, margins) was painted separately, and from 9
October a copy of the chosen material was mirrored onto the page (`#root[data-bg-page]`, `backdrop.js`) so the whole window changed when a
background was chosen. That left the same material in two places with two different anchors:

- on a pan or a zoom the board's grain moved and the page's did not, so the texture stepped at the board's edge (most visible with wood);
- a mode that is window-anchored (cover, fit, centre) was drawn twice at two different sizes, once over the board and once over the page;
- the material scaled with the zoom, so zoomed out far the grain became fine noise and zoomed in it became coarse, while the type did not.

ADR-0069's reasons for world anchoring were that a tile "cannot drift from the dots" and that a 2x2 mirrored tile has no seam. Neither
needs the material to move: the dots are their own canvas layer, and the mirrored tile is seamless wherever it is placed.

## Decision

1. **The material is painted once, on the page, and is fixed to the window.** `#root.shell[data-bg-page]` (polish.css) paints the image at its
   own tile size from the window's origin. It does not move or change size when the board pans or zooms.
2. **The board is transparent over it.** `.bcpanes[data-bg]` keeps only the person's two flat layers, Shade and Opacity (a veil of the canvas
   colour), over the page material, and no image and no background colour of its own (refine.css). The material is therefore continuous across
   the top bar, the strip, the board and the margins, in every mode, with nothing to align.
3. **The grid, the modules and every saved position are unchanged.** The dots are drawn on the board's canvas from the view origin and zoom as
   before; module rectangles are in board coordinates as before; the background reference stored in the workspace document (`bg`) is unchanged,
   so no saved data and no other device is affected, and `bg: null` still draws the microcement default.
4. **Text that sits straight on the window gets a face of its own.** With a light or patterned material under it, the prototype strip was
   unreadable; it now has a frosted face (`#root[data-bg-page] .bcnotlive`).

## What is given up

The material no longer "belongs to the canvas": panning does not feel like sliding a sheet of wood under the modules, and zooming does not scale
the grain. The brief for this change preferred one coherent window material with the grid independently aligned, and the cost of the old behaviour
(an edge where two anchors disagree) was visible, while the benefit (grain that follows the pan) was a taste. If world-following grain is wanted
back it should be a separate, optional setting, and it needs the page layer to follow the board's offset, which this decision deliberately avoids.

## Verified

`scripts/verify/canvas-background.ts` (86 checks) now asserts, in a real browser: the material at the page is at the page origin at its own size
through eight zooms and pans; the grid moved during them (so the two are independent); the board paints no image of its own and has a transparent
colour; a patch of bare board, dots hidden, is byte-identical as a screenshot after a pan and a zoom. The last two were shown red by putting the old
rule back. `scripts/verify/bg-shots.ts` captures walnut, linen, paper, slate and leather at 1x and 2x, at rest and after a pan and a zoom (`.out/bg/`).
