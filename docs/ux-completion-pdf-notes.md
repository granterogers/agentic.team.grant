# PDF cover, logo and "save this report's style" (HQ-PDF-006, -007, -014, HQ-STYLE-013)

Branch `claude/ux-overnight-pdf`. Migration `0970_a_report_s_style_can_be_kept_as_the_project_s.sql` is **unapplied to production**; it was applied only to the local replica `cand_pdf2`. Nothing was deployed, no network, no model, no production token. The ledger was not edited.

## HQ-PDF-006 / 007 / 014 - appropriate design, polished artifact, high visual quality

**Now true**
- A project style's logo is drawn on the cover. `src/artifacts/image.ts` reads PNG (8-bit grey, RGB, palette, grey+alpha, RGBA; not interlaced) and JPEG (8-bit grey/RGB, baseline/extended/progressive). Opaque PNGs go in as Flate with PNG predictors; alpha PNGs are un-filtered and split into a colour plane plus an `/SMask`; JPEGs pass through as `/DCTDecode`. `pdf.ts` gained `Page.image` and emits each image once as an XObject however many pages use it; a page with no image keeps its old resources.
- Images arrive as bytes through an injected fetcher (`src/artifacts/logo.ts`: `loadLogo`, `storageFetcher`). The handler reads the style's `logo_document_id`, takes the document's storage path (office-scoped query), and renders with it. Refused, with a sentence and never a failure: missing document, no file, over 2 MB, over 4 MP or 4096 px, 16-bit, interlaced, CMYK JPEG, SVG/WebP/other, truncated or corrupt data, storage unreachable. The report is made without the logo and the answer says "The style asks for a logo and I left it off: <reason>".
- The cover is composed (`cover` / `coverFinish` in `report.ts`): masthead (logo on a paper plate when the field is dark, kicker, hairline); title anchored to the foot of a colour field whose height follows the title, with an accent mark; a facts strip (date, sections, sources, pages); the report's own opening as a SUMMARY; and a contents list with the real page of each section (drawn in a second pass once page numbers exist), cut with "and N more sections" when it does not fit. Same theme, same WinAnsi base-14 fonts, deterministic.
- Layout QA extended: `layoutCollisions` now also reports an image off the page, text over an image, and an image over an image. Text on a filled band remains allowed.

**Evidence**
- Rendered 9 variants (`npx tsx scripts/sample/pdf-cover.ts [out] [logoDir]`: default, band, band with green and RGBA logo, standard with JPEG logo, palette PNG with Times, compact band with a 3-line title, long title with RGB logo, no summary, 14 sections), rasterised with `pdftoppm -r 80`, looked at in three contact sheets; `pdfimages -list` shows the RGBA logo as `rgb` + `smask`. Defects found by looking and fixed: masthead hairline touching the logo plate; a fixed 300 pt field leaving empty colour above a short title (field now sized to the title); facts strip floating over a gap (moved under the field).
- Tests: `tests/artifacts/image.test.ts` (real ImageMagick fixtures in `tests/artifacts/fixtures/`, pixel-level check that the alpha and colour planes un-filter correctly, refusals, XObject sharing, collision RED/GREEN), `cover.test.ts` (contents page numbers, whole summary on the cover when the body omits it, clean for 48 style/logo/title combinations, pages 2+ byte-identical to the old renderer by pinned hashes, plate on band only), `logo.test.ts`. Full vitest: 4766 passed, 1 file failing (`tests/sessions/weather-is-not-a-failure.test.ts`, which refuses to run without `SUPABASE_ACCESS_TOKEN`, as before).
- Sabotage controls, each proved red and restored: PNG Paeth filter replaced (alpha test red), image collisions removed from `layoutCollisions` (2 red).
- **Pinned hash changed on purpose.** `BASELINE_SHA` in `tests/artifacts/style.test.ts` was `14290231...` (the old two-thirds-empty cover) and is now `83b55b49...`, explained in the test. The guarantees under it (no profile = default look; a profile never leaks into the next render) are unchanged, and pages 2 onward are pinned to the old renderer's output separately.
- `pdf.test.ts` "cover on a page of its own" was updated: the cover now lists headings by design, so it asserts the BODY text is not on the cover.

**Remains / honest limits**
- No live render of a logo from a real project's storage: the production fetcher (`storageFetcher`: signed link then fetch) is unit-tested with stubbed `fetch` only. First real exercise is a deployed run.
- Logo on a dark or transparent logo over a light `wash` field is not plated (plate is band-only); a white-on-transparent logo would vanish on the standard cover.
- A sparse report (one section) still leaves the lower third of the cover empty; the composition is top-anchored on purpose and fills as sections are added. A title over three lines at 25 pt is cut at a word with an ellipsis on the cover (the full title is in the metadata and foot); this existed before.
- No WebP/SVG/16-bit/interlaced/CMYK support (refused with a reason). No image blocks in the body: only the cover logo.
- Cover contents list has no clickable links; text-vs-filled-rectangle collisions are still not seen by QA.

## HQ-STYLE-013 - "Save this report's style as the project's"

**Now true** (nothing is extracted from a PDF)
- 0970 adds `document_provenance.style_snapshot`, written by the artifact handler with the rest of the provenance: the resolved profile (including fields the renderer does not draw, `source` removed) with the chosen title page and density laid over `formatting`, i.e. what the report looked like. `app.document_provenance_record` gains an optional 8th parameter (old 7-arg signature dropped by name; callers without it still work; an invalid snapshot is not stored and never loses the provenance row). `document_provenance_of` also returns `has_provenance` and `has_style_snapshot`.
- `app.style_adopt_from_document(office, slug, document, confirm, channel, by)`: replaces the project's profile with the snapshot and records `source = saved_from_document + document id`, plus a `style.updated` ledger row. With an existing project style and no confirm it changes nothing and returns `needs_confirmation` naming the fields it would replace. A report with no snapshot (made before 0970) returns an error saying so and changes nothing, even if confirmed. Refused by name: unknown report/project, not an office-made document, another project's report. A logo document the project does not hold is dropped and reported in `dropped`.
- Public wrappers `public.hq_style_adopt_from_document` and `public.hq_document_provenance` (PostgREST only exposes `public`). Gateway: action `style_adopt_from_document` (office, person only via `personBy`) and read section `document_provenance`.
- UI: `web/studio/bc/docview.js` (+ placeholder in `shell.js`, CSS in `docs.css`) draws "Use this report's style for the project" in the viewer of a made report that has provenance. The press sends the project and document with no confirmation; a style already in place gets an inline "Replace the project style / Keep the current style" step; a report with no recorded style says so on the press. Not drawn for uploads or made reports without provenance. No assistant tool was added (not trivial).

**Evidence**
- `npx tsx scripts/isolated/ux-be/06-style-adopt.ts cand_pdf2`: 35 checks, ALL PASSED, one rolled-back transaction, drives the real artifact handler (fake router, stubbed storage, injected logo fetcher): logo drawn, 16-bit logo refused and said, unreachable logo said, snapshot content, ask-before-replace changes nothing, confirmed adoption, ledger row, idempotent second press, adopt with no style, no-snapshot, other-project, not-made, unknown, dropped foreign logo, invalid snapshot, old arity, no delivery/blocker raised, teardown clean. `05-artifacts.ts cand_pdf2` still ALL PASSED.
- SQL sabotage (each red, then restored and green): confirm guard disabled (4 red), no-snapshot guard disabled (1 red), logo project check loosened (1 red).
- `scripts/verify/style-adopt-ui.ts` (new, stubbed gateway, 1440 and 390): 29 passed, 0 failed; screenshots `.out/ux-style-adopt-{1440,390}-{1-offer,2-done,3-confirm,4-nosnapshot}.png` viewed. `style-ui.ts` 8/8 and `docs-ui.ts` 39/39 still pass.
- `tsc --noEmit`, `biome ci .` (exit 0), `check:templates`, `check:migrations` clean. Not run (need a production token, per instructions): `check:callers`, `check:consumed`, `check:gateway-wrappers`, `check:anon-exposure`. The two new wrappers and the new action follow the 0923 pattern; `check:gateway-wrappers` should be run before deploy.

**Remains / decisions**
- Reports made before 0970 can never be saved (no snapshot, by design).
- The snapshot includes the design choices, so adopting a report whose title page was chosen by content shape pins that choice into the project style; and it includes inherited office fields, which become the project's own. Both follow from "this report's style" and are the owner's call.
- `check:consumed` may need `style_snapshot` classified; `check-ownership --replica` was not run.
- Deploy order: apply 0970 before deploying the worker only if you want snapshots; the worker works without it (arity follows what is passed) and the page hides the control when the section is absent.

## Files
`src/artifacts/{image,logo}.ts` (new), `pdf.ts`, `qa.ts`, `report.ts`, `style.ts`, `versions.ts`, `src/handlers/artifact.ts`, `migrations/0970_*.sql`, `supabase/functions/hq-api/index.ts`, `web/studio/bc/{docview.js,shell.js,docs.css}`, tests in `tests/artifacts/`, `scripts/isolated/ux-be/06-style-adopt.ts`, `scripts/verify/style-adopt-ui.ts`, `scripts/sample/pdf-cover.ts`.
