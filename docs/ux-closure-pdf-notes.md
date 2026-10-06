# PDF cover limits (HQ-PDF-015)

Branch `claude/ux-closure-pdf`. Renderer only; no migration, no network, no production access. Ledger not edited.

## What changed
1. **Pale logo no longer vanishes.** `image.ts` reads, for alpha PNGs, `luma` = {mean, light share, opaque share} of the visible pixels. `src/artifacts/cover-plan.ts` `logoPlate()` decides the plate deterministically: a logo that is mostly pale (>=60% of visible pixels with relative luminance >= 0.5) gets a DARK plate on the light standard cover (primary where it is dark enough, else ink), and none on a dark band where it stands off (white mark on band); on a light band it gets the dark plate. Dark/colour alpha logos: no plate on standard, paper plate on band (as before). Opaque PNG/JPEG carry their own background: paper plate on band, none on standard (as before). The first draft used the MEAN luminance and plated a dark-wordmark-plus-orange-tile logo with a plate the colour of the band; the share-of-pale-pixels rule fixed it (found by viewing).
2. **Sparse cover composed.** `cover()` estimates what the cover will carry (headings, summary lines are known up front) and shares the spare room: up to 55% (max 170 pt) goes to a taller colour field that seats the title lower; if the contents still end well clear of the foot, `coverFinish` draws a quiet colophon (READING TIME derived from words at 200/min, BASED ON "N sources, listed on page P"/"No sources cited"). The author is deliberately not repeated (a cover-line test forbids it). Rich covers get neither.
3. **Long titles** step down 30 / 25 / 22 / 20 pt (2/3/4/5 lines) via `fitCoverTitle`; ellipsis only past the 20 pt step, at a word.
4. **Logo scaling** `logoBox`: within 150x52 keeping aspect; a wide strip takes more width (max 230) to reach 22 pt height; tiny images scale up; a strip that would still be under 10 pt high is left off with the note "The logo is too thin to read at cover size, so it was left off." PNG and JPEG verified. **WebP stays refused** ("only PNG and JPEG images can be drawn"): no decoder without a new dependency.
5. QA: `layoutCollisions` unchanged and green on every matrix cell; the matrix test asserts no problems and `validatePdf` ok.

## Evidence
- `npx tsx scripts/sample/pdf-cover.ts <out> tests/artifacts/fixtures matrix` (72 covers: short/long title x none/white/black/colour logo x thin/rich x standard/band x default/compact) and `... logos` (wide, tiny, thin, tall, light grey, JPEG; std and band). Rasterised with `pdftoppm -r 60/70`; contact sheets viewed: /tmp/pm/A.png, B.png, A2.png, /tmp/pl/L.png, /tmp/pd/D.png (baseline before: /tmp/pdfbase/base.png).
- New fixtures: `logo-white-rgba.png`, `logo-black-rgba.png`, `logo-lightgrey-rgba.png`, `logo-wide-rgba.png`, `logo-thin-rgba.png`, `logo-tall-rgba.png`, `logo-tiny.png`.
- `tests/artifacts/cover-limits.test.ts` (new, 15 tests). Sabotage: `light = false` -> 4 red; title steps disabled (22 pt allows 0 lines, floor 2) -> 1 red; both restored, 199/199 green.
- **Pinned hash changed on purpose**: `BASELINE_SHA` in `style.test.ts` 83b55b49... -> 4154fea2... (thin-cover field growth). Pages 2+ pins in `cover.test.ts` unchanged and green.

## Remains
- A cover with a summary and 1-2 sections still has ~100 pt of paper above the foot; the field growth is capped so the cover does not become a poster. Colophon appears only when there is clear room.
- Mid-tone logos (neither pale nor dark) on the standard cover get no plate; judged legible on the pale wash.
- Tiny raster logos are scaled up to 52 pt and look soft. WebP/SVG/16-bit/interlaced/CMYK still refused with a reason.
