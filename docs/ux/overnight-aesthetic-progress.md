# Aesthetic refinement sprint: progress (10-hour programme, started 9 October 2026)

Branch `claude/lucid-mendel-ubvlk4`. Never merged, never deployed, no production contact. The interface is enhanced, not redesigned:
every change below is a token, a refinement of an existing surface, or an optional control that defaults to today's look.

Start point: `c5846918` (clean tree). Re-read this file first after a compaction, then `git log`, then continue at "Next".

## Done

1. **Surface lab** (`scripts/verify/surface-lab.ts`): opens every reachable surface in Chromium (pages, burger menu, new-project form,
   command bar, background picker, every Settings tab, record sheets, every maximised module, chat dock) per device x scheme x palette,
   captures it, and measures page overflow, clipped text, spill past the edge, touch targets, type under 12px and hues that are
   neither the accent nor a state role. Writes `.out/surface-lab/matrix.{json,md}`; a surface that cannot be reached is `blocked` with a
   reason, never counted as verified.
   - Its first run flagged the product's own accent as "unrelated blue" (the default accent is blue): the detector was wrong, not the
     product. Corrected to compare against the accent and the role tokens.
2. **Looks** (`appearance.js`, `bc/refine.css`): four coordinated surface families, Original (default, unchanged), Slate & Silver,
   Forest & Brass, Warm Graphite, in dark, light and device-follow. The accent stays the person's separate choice.
3. **Frosted menus and depth**: `data-glass` (Solid / Soft / Rich) and `data-depth` (Flat / Soft / Deep). Depth multiplies the one shadow
   scale. Glass applies only to floating surfaces; module faces and maximised views stay opaque.
   - Found by looking: with Rich glass the menu showed unblurred board text through it. A backdrop filter only sees what is painted inside
     the nearest ancestor that has one, and the frosted top bar is that ancestor. While a menu is open the bar drops its own filter.
4. **Settings > Appearance**: Look cards, Accent colour, Colour scheme, Materials (frosted menus, depth). All persist (localStorage, and to the
   office through the existing appearance writer; it accepts any object).
5. Command bar: label no longer sits on the input's top edge. Picker section labels were 11px; now 12px.

## Next (in order)

- Surface-lab runs: phone 390 and 360, light scheme, every look; read the screenshots, not just the matrix.
- Unit tests for looks/glass/depth (persist, validate, default) and contrast of each look's text on its surface.
- Maximised modules one by one; chat states; calendar compact sizes; icon alignment audit; typography audit.
- Component gallery (`/gallery` dev page) and its browser checks; inspection matrix in `docs/ux/`.
- Legacy layout: an explicit non-destructive "fit saved arrangement to this window" action.
- Re-run the gates: lint, tsc, tests/web + tests/studio, check:branding, aesthetic-qa, canvas-* suites.

## Process notes

- Edits go through Edit/Write. (Slip: `web/studio/index.html` link added with a python one-liner at the start; read back. Disclosed.)
