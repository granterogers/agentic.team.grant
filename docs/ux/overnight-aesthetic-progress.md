# Aesthetic refinement sprint: progress (10-hour programme, started 9 October 2026)

Branch `claude/lucid-mendel-ubvlk4`. Never merged, never deployed, no production contact. The interface is enhanced, not redesigned:
every change is a token, a refinement of an existing surface, or an optional control that defaults to today's look.

Start point `c5846918` (clean tree). After a compaction: read this file, run `git log --oneline | head -20`, continue at "Next".

## The tools built this sprint (all local, no network, no production)

| tool | what it does | proof it can fail |
|---|---|---|
| `npx tsx scripts/verify/surface-lab.ts` | opens every reachable surface (pages, menus, command bar, picker, every Settings tab, record pages, event editor, every maximised module, chat) per device x scheme x look x accent, captures it, audits it, writes `matrix.md/json`. `WRITER=1 ONLY=writer` signs in against a stand-in office (new-project form, first run). A surface that does not open is `blocked` with a reason, never counted verified. | every press names the element it expects to see; a surface that fails to open is reported |
| `scripts/verify/lib/surface-audit.ts` | the shared audit: sideways scroll (measured against the device, not the widened layout viewport), clipped text, spill past the edge, type < 12px, touch targets < 40px (labels and pseudo-element hit areas counted), cut-off placeholders, hues that are neither the accent nor a state/module role | planted-defect fixture in the gallery run: all 6 must be seen |
| `npx tsx scripts/verify/gallery.ts` | the component gallery: harvests the LIVE elements (top bar, toolbar, six modules, note, menu, command bar, event editor, picker, chat, three Settings tabs) into one grid on the real page, in every appearance. No copy of any markup to keep in step. | the planted-defect control runs first and fails the run if the audit misses one |
| `npx tsx scripts/verify/icon-audit.ts` | optical centring and stroke weight of every icon-only control (desktop and phone, both schemes), 326 measured | a planted off-centre icon must be caught |
| `npx tsx scripts/verify/motion-focus.ts` | reduced motion leaves no animation > 20ms on menu, chat and a maximised module; with motion on they do animate; every control reached by Tab (45) shows a focus indicator | a ring-less control must be caught; motion-on must animate (else the reduced check proves nothing) |
| `npx tsx scripts/verify/type-census.ts` | counts rendered text by size across every surface | prints; `TYPE_BUDGET=n` fails on drift |
| `npx tsx scripts/verify/aesthetic-qa.ts` | 241 browser checks: layout, background, schedule, burger, grid, settings, contrast, **looks**, **fit**, **narrow**, phone | each new section sabotage-proved |
| `tests/web/looks.test.ts` (17), `tests/studio/fit-window.test.ts` (10) | contrast of every look in both schemes from the stylesheet itself; the three new appearance keys; fit-to-window arithmetic and its safety | looks: a dark muted text sabotage went red; fit: removing the saved copy went red |

## Done, in order

1. **Looks** (Original is the default and unchanged; Slate & Silver, Forest & Brass, Warm Graphite): canvas and module face per scheme, accent is the person's separate choice. Settings > Appearance: Look cards, Accent, Colour scheme, **Materials** (frosted menus Solid/Soft/Rich, Depth Flat/Soft/Deep). Persisted locally and to the office (the writer takes any object).
2. **Frosted menus**: only floating surfaces. Found by looking: the top bar's own backdrop filter swallowed the menu's blur and board text showed through unblurred; the bar drops its filter while a menu is open.
3. **Depth** multiplies the one shadow scale (`--bc-depth`); tactile primary buttons (raised key, pressed state follows reduced motion), grooved segmented track.
4. **Touch**: hit areas grow around the drawn control (pseudo-elements) on `pointer: coarse`; form fields 44px / 16px type; icon picker 44px cells; hue swatches 40px; schedule Day/Week/Month 44px; agenda rows 40px. The phone picker strip shows 3.4 tiles so the cut-off says there are more.
5. **Type floor**: chat speaker line (10.5px) and avatar initials (10px), picker labels (11px), the menu's "PROJECTS" heading (11.5px) are 12px.
6. **Paper**: a document with no picture was the inverse of the surface, a heavy near-black slab in the light scheme; now `--bc-paper` / `--bc-paper-ink`.
7. **Narrow modules**: with the chat open the To-dos switch was cut mid-word ("8 te"). Modules are size containers on the canvas only (a first attempt on the phone collapsed controls to slivers; the lab caught it, a QA check now guards it); below 300px the switch drops its words, keeps its numbers and its accessible name.
8. **Command bar label** sat on the input's top edge; **new-project placeholder** was cut off.
9. **Fit my arrangement to this window** (Layouts menu, offered only when an arrangement does not fit): scales the arrangement's width keeping its shape, after saving the original as "Before fitting". Legacy layouts are never changed unasked.
10. A regression of mine, caught by the lab: the glass rule had been applied to the office-menu wrapper, painting a grey square behind the three dots. Fixed and pinned by a test.

## Verified (latest runs)

- surface lab: phone 360/390/430 and desktop 1024/1280/1440/1920, dark and light: 0 defects; 3 contexts blocked = "needs a signed-in office" in the non-writer run; the writer run opens them (12/12).
- gallery: 12 appearances (dark/light x 4 looks, 3 accents on Original), 17 components each, 0 findings.
- icon audit 0 problems; motion/focus 0 problems; contrast scan 0 offenders.
- `vitest tests/web tests/studio` 350 passing; `tsc` clean; `biome ci` exit 0.

## Later in the sprint

11. **Accessibility**: axe (WCAG 2 A/AA) was run over every lab surface; it found a conversation list with no list role, "Invalid Date" read to screen readers, a scroll region with no keyboard stop, warn/danger/empty-action text under 4.5:1 in the light scheme, and a text field inside a `role=menu`. All fixed; `aesthetic-qa` has an axe section with a planted-violation control (sabotage-proved).
12. **Page menu** brought into the menu system; **select boxes** draw their own chevron; **dialogs** (confirm, danger, ask) are in the lab.
13. **Every accent is readable on every look** (40 combinations, `tests/web/looks.test.ts`, sabotage-proved).
14. Before/after: the same 144 surface-by-context cells, before 98 verified / 36 findings / 10 blocked, after 134 / 0 / 10. Images in `docs/ux/aesthetic-sprint-2026-10-09/`; the coverage statement is `docs/ux/aesthetic-inspection-matrix.md`.

## Final state

- `aesthetic-qa` 265/265; `vitest` 5535 passing; `tsc` and `biome ci` clean; `check:branding`, `check:templates`, `check:secrets`, `smoke` clean.
- Existing suites green: canvas-background (81, 2 n/a), canvas-extremes, canvas-local, canvas-session, canvas-devices 7/7, boot-recovery, load-reliability, dictation-fallback, basecamp-keyboard/back/routes/preservation/states/touch.
- Red, and red identically on `main` (b8ea3c0): `basecamp-settings` ("every settings pane is still offered": it looks for `[data-setpane]`, which the Settings page no longer has) and `basecamp-chat` (waits for a visible `[data-bc-dock]`); both are stale against the product, not regressions. `check:tokens` still reports the pre-existing `--cols` and `--bc-shade-ink` (set inline by script); this sprint added none. Needing production access, not run: `basecamp-look`, `check:icons`, `tests/sessions/weather-is-not-a-failure`. `tests/staging/binding` (executor refuses a production ref in a staging shell) fails in this sandbox and no file it reads was touched.
- Not done by decision: the background material is still painted in two places (ADR-0069 anchors tiles to the world on purpose; a rounded, bordered board frame separates the two regions, so no seam reads at 2x). Type sizes still use 12 / 12.5 / 13 / 13.5 / 14 (a census is in `type-census.ts`); collapsing the half-pixel steps touches ~100 declarations for a 4% change and was left.

## Process notes (disclosed)

Edits go through Edit/Write. Slips: a python one-liner for the `index.html` stylesheet link; python multi-replace on `refine.css`, `surface-lab.ts`, `gallery.ts` and the audit (several times, read back and run each time); one `sed -i` on `icon-audit.ts` (a scratch-new file); the moved audit block was deleted from `surface-lab.ts` by python (a relocation). The reflex is the trap.
