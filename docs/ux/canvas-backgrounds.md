# Canvas backgrounds: how to import textures, where the images came from, and what is verified

Tracked by #445. Decisions: `docs/adr/0069-canvas-backgrounds-are-references-anchored-to-the-world.md`.

## Importing a batch of supplied textures

1. Put the supplied images (PNG, JPEG or WebP) in a folder OUTSIDE the repository, for example `~/textures/batch-2`.
   The originals are not committed (they are large); each is identified later by the SHA-1 recorded in `library.json`.
2. Optionally write a map file naming each one (see `docs/ux/texture-batches/2026-10-09-batch-1.map.json`): the id, display name,
   category, credit and licence, and optionally `mode`, `intensity` (0.2 to 1) and `tint` (0 to 0.6) defaults.
   Without a map the id and name come from the file name, and `credit` and `license` stay EMPTY, which `tests/studio/canvas-background.test.ts`
   refuses: say where it came from.
3. Run `npm run textures:import -- --src ~/textures/batch-2 --batch 2026-10-xx-batch-2 --map <map.json>`
   (`--dry-run` first to see what it would do).
4. Open the picker (How this project looks, Canvas background) and judge each one on the real canvas, light and dark; adjust its
   `intensity` / `tint` defaults in the map and re-run only if you removed the id (an id is never overwritten).
5. Commit `web/studio/textures/bg/` and the map file. Run `npm run verify:canvas-background` and `npx vitest run tests/studio/canvas-background.test.ts`.

Each image is FLATTENED before it is tiled (the large-scale light and dark is subtracted, the grain kept), because a gradient that comes round every tile reads as
stripes when the canvas is zoomed out; set `"flatten": { "radius": 30, "strength": 1 }` per image in the map (a smaller radius flattens more; strength 0 turns it off). After changing it, re-render from
the same originals with `--reprocess`: ids and the projects that chose them are unaffected. Judge every new texture zoomed OUT (the gallery script does this) as well as at 100%.

What the importer guarantees: an image already imported (same SHA-1) is skipped; an id taken by a different image gets a numeric suffix,
so a project that chose an id never sees it change meaning; each image becomes a 2048x1152 (or the image's own aspect, doubled) mirrored
tile and a 192px thumbnail; the average colour and tone (light or dark) are recorded so the grid dots stay visible.

To retire a texture, set `"retired": true` in `library.json` and regenerate `library.js` (run the importer with `--dry-run`, which rewrites
nothing, so edit both files together). Do not delete it: a project may still name it.

## What is in the library, and where it came from

| id | name | category | source |
|---|---|---|---|
| (default) | Microcement | default | procedural, `scripts/art/microcement.py`; nothing to licence |
| slate | Blue-grey slate | stone | batch 1 |
| walnut | Warm walnut | wood | batch 1 |
| brushed-aluminium | Brushed aluminium | metal | batch 1 |
| warm-microcement | Warm microcement | stone | batch 1 |
| linen | Natural linen | fabric | batch 1 |
| leather | Tan leather | leather | batch 1 |
| paper | Handmade paper | paper | batch 1 |
| speckled-stone | Speckled light stone | stone | batch 1 |
| none, solid-stone, solid-sand, solid-sage, solid-mist, solid-charcoal | plain colours | colour | defined in code |

**Batch 1** (`2026-10-09-batch-1`): eight images supplied by Grant Rogers on 9 October 2026 as `textures.zip` (1672x941 PNG, named
`ChatGPT Image 8 Oct 2026 ...`). They are used as supplied for this application; the licence line recorded for each is that Grant generated
them with ChatGPT image generation and supplied them for use here. They are not third-party photographs. Nothing else has been imported:
no image was invented to fill a gap, and the brief's "travertine" and "oak" are represented by what Grant supplied (a speckled light
stone and a walnut), named for what they are.

## What is verified

`npm run verify:canvas-background` (real Chromium, local page, no network) and `tests/studio/canvas-background.test.ts` (26). Preview,
Cancel, Apply and reload for every material on the real board; per-project choices; stored reference size and no image data; notes,
positions and view untouched; texture and grid share one origin and the tile scales exactly with zoom; no stretch, no reloads, no seam;
upload accepted and optimised; refused: not an image, SVG, a 60,000px "bomb", empty, over 15 MB, truncated JPEG, a lying header;
a storage failure; remove; the missing-picture fallback; sign-out wipes the database; a phone; the keyboard. Not applicable: server storage
authorisation here (proved against the real gateway: `scripts/isolated/background-storage.ts`, and on production: `npm run sample:release-acceptance`).

**Custom pictures are now stored in the office (ADR-0070, deployed 9 October 2026):** one per project, kept in this browser first and in the office second, so
another device draws it from a signed link and caches it by revision. `verify:canvas-background` drives that flow against a stand-in office (81 checks);
`npm run sample:release-browser` drives it on the deployed page with two independent sessions. Evidence and limits: `docs/ux/deploy-442-445.md`.
