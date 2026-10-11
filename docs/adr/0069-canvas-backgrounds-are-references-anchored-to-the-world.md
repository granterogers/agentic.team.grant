# ADR-0069: A project's canvas background is a reference, tiling materials are anchored to the world, and a person's own picture stays in their browser until the office has a store for it

Status: accepted, 9 October 2026. Decision 3 (tiles anchored to the world) is amended by [ADR-0072](0072-the-background-material-is-one-layer-fixed-to-the-window.md): the material is now one layer fixed to the window. Tracked by #445 (the Canvas Background Library), under #439 and ADR-0068.

## Context

Grant asked for selectable premium canvas materials, his own supplied textures, and an upload of any picture, chosen per project and
per person, inside the existing "How this project looks" sheet. The board already paints a dotted grid from three variables (the
view's origin and zoom), the arrangement is one last-writer-wins row per person per project (`dashboard_layout_set`), and the page
chrome already carries a procedural microcement (`scripts/art/microcement.py`).

## Decisions

1. **A background is a small reference in the workspace document, never image bytes.** `bg: { id, mode, scale, intensity, tint, at }`
   lives in the existing `__workspace` entry (`layout.js`: `cleanBg`, `mergeBg`, `setBg`, `bgOf`). `id` is a library id, `custom`, or
   `default`. A project that never chose has `bg: null` and draws exactly what it drew before (the microcement). No migration, no new
   gateway action, no new table.
2. **Two devices settle on the newer choice, without disturbing notes.** `at` is when it was chosen, merged like a Post-it (newer wins,
   the same instant resolves the same way on every device, a local save prefers its own). It is carried through `check`, `saveChecked`,
   `adopt` and `commit` beside the notes, so choosing a background neither erases nor is erased by a note written elsewhere.
   "Restore the default" is itself a choice (`{ id: 'default' }`), so it can beat an older one. This is not strict compare-and-swap
   (#442) and does not pretend to be.
3. **Tiling materials are anchored to the WORLD; photographs to the viewport.** A tile is painted from the same `--bc-gx --bc-gy --bc-gz`
   as the grid, so it pans and zooms with the modules and cannot drift from the dots. It is built as a 2x2 mirror of the supplied image
   (`scripts/art/import_textures.py`), so every edge meets its own reflection and there is no seam however far the board is panned (the
   supplied images are not seamless; a plain repeat would show a seam every 1024px). Cover, fit and centre are viewport-anchored,
   because a photograph has no repeat and stretching one across a world that can be 200,000px wide is meaningless. One image is decoded
   once; zooming changes a CSS size, never a request. Tiles are drawn at half their pixel size so the grain is crisp on a dense screen
   and up to 2x zoom.
4. **The page chrome and the colour scheme are separate from the canvas.** Only `.bcpanes` takes the material; the top bar keeps its stone
   and light/dark stays a distinct choice. Grid dots follow the material's tone (dark dots on a light material, light dots on a dark one),
   not the scheme. Opacity is a veil of the canvas colour over the image and Shade is a neutral scrim, both per project.
5. **The library is data.** `web/studio/textures/bg/library.json` (and the module generated from it) lists every material; the picker reads
   `backdrop.entries()` and nothing else. Ids are stable and never reused (`retired: true` takes one out of the picker, not out of a
   project that chose it). Supplied images are imported with `npm run textures:import` (docs/ux/canvas-backgrounds.md); the originals
   are not committed, their SHA-1 is.
6. **A person's own picture stays in their browser for now.** The gateway has a private `files` bucket and one image action (a contact
   photograph), but no per-person image store a page may write to, and adding one is a new `hq-api` action plus a migration, which belongs to
   the backend workstream and was not authorised. So an uploaded picture is validated from its header BEFORE decoding (type by bytes, not by
   name or MIME; SVG refused; 15 MB, 40 megapixel and 12,000px limits), decoded at reduced size, re-encoded to WebP (JPEG where there is no
   WebP encoder) at no more than 2560px and 3 MB, and kept in IndexedDB (`bc.backdrops`), one per project. It is never in localStorage and
   never in the layout row. Sign-out deletes the database, so the next person at that browser has nothing of it. The cost, stated in the
   UI and the issue: it is not on another device, which shows the default and says why. The dependency to lift that is a gateway action and a
   private bucket path keyed by office and project, with an access rule that refuses another tenant.
7. **A Sample visitor is read-only, so the page does not send layout writes for one.** The arrangement, view and background still persist in
   their browser. Found by a real Sample run in which pressing Reset view asked the gateway to reset a layout.

## Consequences

- A background chosen on one device appears on every other (it is in the layout row); a custom picture does not.
- No server-side storage rule needs testing for backgrounds today; the tenant refusal tests apply the day the store exists.
- The library grows by importing a batch, with no UI change.
