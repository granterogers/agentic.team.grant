# ADR-0078: Below 1100px the Team HQ arrangement stands in one column, and a visible Fit appears when it runs off the edge

**Status:** Accepted (release 0.117.6; live proof on the sample office and the local prototype)

**Date:** 25 November 2026

## Context

The Team HQ project page is a free arrangement: modules are dragged and resized on a canvas, and the canvas zooms.
On a tablet or a narrow laptop (861 to 1099px) that arrangement cannot be read at a legible size, and a module
dragged past the right edge cannot be reached, because the page does not scroll sideways. Fit existed only in the
plus menu, so a person who had moved something off screen had no visible way back.

## Decision

1. **Below 1100px the modules stand in one column,** in reading order, at full width, with no zoom. The phone already
   did this at 860px and below. The breakpoint is one constant, `STACK` in `web/studio/bc/stage.js`, and the stacked
   layout is keyed to the `bcpanes--stack` class in `web/studio/bc/ux-quick.css`.
2. **In that column, drag and resize are off** (the handlers already return when the stack applies).
3. **At 1100px and wider a visible "Fit to screen" button** appears when any module or note runs past the left or
   right edge of the window. It changes the view only and never the saved arrangement. It hides once everything is
   back in view.
4. **The three-column note strip stays at 200px.** The starter note is 176px wide with a 12px gap either side, so
   a strip of 160px would clip it. The top band stays at 12px, and the stacked column leaves 44px above the first
   module so the arrange "+" does not cover its controls.

## Consequences

- A person on a 1000px window arranges nothing; they read the modules top to bottom. That is the trade for legibility.
- Changing the breakpoint means changing `STACK` and the `@media (min-width: 761px) and (max-width: 1099px)` block
  in `ux-quick.css` together.
- Verified by measurement: at 1000px the modules sit at one x position; a header drag leaves the module where it was;
  at 1440px the same drag moves it. Fit appears when a module is off the left edge and returns it into view.
