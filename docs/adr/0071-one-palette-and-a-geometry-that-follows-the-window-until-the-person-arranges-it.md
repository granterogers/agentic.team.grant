# ADR-0071: One palette, and a board geometry that follows the window until the person arranges it

Status: Accepted (9 October 2026, branch `claude/lucid-mendel-ubvlk4`, not merged)

## Context

Two things were wrong, found by rendering the product and by driving it, not by reading it.

1. **Colour was three systems.** The studio's tokens (`--ground`, `--surface`, `--accent`, five palettes in `skins.css`) painted the chat,
   buttons and menus; Team HQ's `--bc-*` tokens painted the board; Settings carried a hard-coded dark navy set (`--st-*`). A person who
   chose the Coral accent got terracotta buttons on teal surfaces and a blue Settings page; light scheme left Settings dark; about two
   hundred literals (black shadows, `#f0907e`, `#e8a04a`) were tuned for dark only.
2. **A press froze the board.** `raise()` (which every press inside a module calls) stored every module's rectangle at the window width of
   that moment. The arrangement was then "customised", so opening the chat or resizing no longer re-fitted the modules and a Post-it
   ended up over a panel. A press is not an arrangement.

## Decision

**Colour.** `--bc-*` (bc/tokens.css) is the one source. Inside Team HQ the studio's names are aliases of it (selector repeated to outrank
`skins.css`), Settings' `--st-*` derive from it, and the studio's per-control texture is off (the board's microcement is the one
material). Shadows are one scale (`--bc-sh-1/2/3/pop`, built from `--bc-shadow-ink` and a per-scheme strength), every dialog backdrop is
`--bc-scrim`, roles that were dark-only literals are tokens (`--bc-warn`, `--bc-amber`, `--bc-info`), selection is a tint of the accent.
A palette choice changes the accent only (as `settings-copy.js` already said); a scheme choice (Light, Dark, Device) is in Settings >
Appearance, which until now said "no light version" while the default had been light since 8 October.

**Layout.** Each stored module carries `placed`. `true`: the person arranged the board (move, resize, tidy, preset, loaded layout) and the
rectangles are theirs to the pixel. `false`: the rectangles are a snapshot of the default, which is recomputed from the window; a raise or
a tint stores z-order and colour and leaves geometry following the window. Documents stored before the flag have neither value: they are
kept exactly as they were, except that one that is entirely the default arrangement for the window it is first read in is recognised as a
snapshot and follows the window again; that verdict is made once and remembered, so it cannot flip when the window changes later.
Nothing is migrated in storage; "Reset view" remains the way back for a legacy arrangement saved at another width.

**Background.** The chosen material is mirrored from the board to the shell root as still wallpaper under the bar and heading rows, so a
choice changes the window and not a strip of it. The board keeps its own, world-anchored layer (ADR-0069).

## Rejected

- Freezing nothing at all: a drag must persist exactly.
- Migrating legacy documents by rewriting them: we cannot tell a deliberate arrangement from a snapshot saved at another width, and a wrong
  guess destroys somebody's layout.
- Making the studio palettes full surface families again: that is the three-systems state.
- Moving the background fully to the viewport and dropping the board layer: loses the zoom/pan-anchored texture ADR-0069 chose.

## What would reverse it

A decision that Team HQ should offer several surface families (not just accents). That needs a new ADR and the aliases in tokens.css
turned into per-family blocks, still defined once.

## Checks that hold this

`tests/web/one-palette.test.ts` (aliases, scrim, shadow scale, literals), `tests/studio/layout.test.ts` ("a press is not an arrangement"),
`scripts/verify/aesthetic-qa.ts` (layout, background, schedule, burger, maximise, grid, settings, contrast, tokens, phone). The layout checks
were shown red by putting the defect back (`raise` freezing geometry).
