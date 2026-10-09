# Team HQ aesthetic pass, 9 October 2026

Grant's brief (verbatim intent): the colours look dreadful; the burger menu needs animation and shading; the previous
colour scheme was fine and he only wanted a subtle texture; the chat window colours are terrible; there must be one
unified palette; the maximised modules had a white wash; changing the background does not work and the grid points are
not shown properly; the minimised schedule should choose Day / Week / Month; Settings is blue. Not pushed to `main`.

## What was wrong (found by rendering, not by reading)

- **Two colour systems painted one screen.** The studio's tokens (`--ground`, `--surface`, `--accent`, five palettes in
  `skins.css`) drove the chat dock, buttons and menus; Team HQ's `--bc-*` tokens drove the board; Settings carried a
  third, hard-coded dark navy set (`--st-*`) that ignored the scheme. So the chat bubble was terracotta, green or violet
  by palette, Settings was always navy, and headings were peach on one page and gold on another.
- **The maximised scrim was the canvas colour at 78%.** Dark on the dark scheme; on the light scheme a pale veil, which is
  the white wash. A scrim is shadow, not canvas.
- **A background looked like it did nothing** because it only filled the board, which panels cover and the page's own stone
  frames. It was applied, stored, and survived a reload (driven in a browser); it just did not read as the page.
- **The dot grid was a tiled radial gradient at a fractional step** (24px at 64% is 15.36px), so dots landed on fractions
  of a pixel and looked uneven.
- **Native sliders and ticks used the browser's blue.**

## What changed

- `bc/tokens.css`: inside Team HQ the studio colour names are aliases of the `--bc-*` tokens (one place decides every
  colour); a warn token and a shadow-ink token; light-scheme steps for each accent; section headings share the module
  gold. The studio's per-control texture is off, so the board's microcement is the one material.
- `settings-ui.css`: every `--st-*` role derives from `--bc-*` (fallbacks keep the old values), so Settings follows the
  scheme and the person's accent. `accent-color` on Team HQ takes the accent.
- `bc/polish.css` (new, last in the chain): burger button morphs to a cross, the project menu enters with a scale and
  staggered rows, gets layered shading, a notch and an accent-marked current project; the chat dock, bubbles and composer
  read from the one palette; the maximised view has an opaque face and a shadow scrim; the board is full-bleed; the top
  bar is frosted; the picker tiles are one width.
- `bc/stage.js`, `bc/compose.js`: the dot grid is drawn on a canvas, snapped to device pixels, density stepping by powers
  of two, every fourth dot a little stronger.
- `bc/backdrop.js`: the chosen material is mirrored to the page as still wallpaper, so the whole window changes.
- `bc/calendar.js`: the small and medium schedule module have Day / Week / Month beside previous / next / New; the choice
  is the same stored one the maximised view uses.
- `scripts/verify/canvas-background.ts`: updated for the new layering (shade, veil, material; dots on a canvas).
  `tests/web/one-palette.test.ts` pins the aliasing; its first assertion was shown red by a deliberate sabotage.
- `scripts/verify/aesthetic-shots.ts`: the capture harness for this pass (`SCHEMES`, `PHONE=1`).

## Verified

`canvas-background` 81/83 (2 n/a, as before the change), `canvas-extremes` 21/21, `canvas-local` green, `vitest tests/web`
48/48, `typecheck` clean, `check:templates` clean, `check:secrets` clean, `smoke` clean. `canvas-devices` (4/7) and
`basecamp-look` (16/19) are red identically on the tree before this change (they need the office / a token).
`npm run lint` and `check:branding` are red on the base commit too (other files; `app.js:14241` names `basecamp` in a
string that can reach a person) and are not touched here.

## Known and left alone

- Any press inside a module raises it (`stage.js` `front` -> `layout.js` `commit`) and that stores the whole arrangement
  at the current window width, so after one press the modules no longer re-fit when the chat dock opens. Pre-existing; the
  schedule now has more buttons to press, so it will be met more often. Worth its own issue.
- The deployed page could not be inspected from here; everything above was judged on renders of the working tree
  (`.out/aesthetic-*`), in both schemes, three accents, desktop and a 390px phone.

## Process slips, disclosed

Four edits went through `python3` heredocs instead of the Edit tool (`settings-ui.css` token block, `calendar.js` compact
view, `canvas-background.ts` expectations, two lines of the capture script); each was read back, linted or run.
