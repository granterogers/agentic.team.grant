# ADR-0068: Team HQ's project page is an infinite canvas, and navigation is a hamburger menu

Status: accepted, 8 October 2026. Tracked by #439. Supersedes the "still bound to the viewport: this is NOT an infinite
canvas" decision recorded in `web/studio/bc/layout.js` on 4 October 2026 (HQ-LAYOUT).

## Context

Grant's 8 October brief (`docs/spec/team-hq-ux-overhaul-2026-10-08.md`) asked for a spatial workspace: wheel zoom about the
pointer, panning without limits, panels placed anywhere, a dotted CAD grid, no Home screen, no Jump To, a compact chat that
can be widened, live dictation, and a lighter stone-grey look. The 4 October workspace was already freeform (continuous
move and resize, no grid, per-project persistence, named layouts), but bounded to the window.

## Decisions

1. **Keep the freeform engine, add a view.** `layout.js` stores `{ mods, zoom, pan, layouts, postits }` in the same
   `__workspace` entry the office already stores through `dashboard_layout_set`. `pan` is new, optional and defaults to the
   origin, so every stored document keeps working and no migration is needed. The viewport maths is pure
   (`toWorld`, `toScreen`, `zoomAt`, `panBy`, `fitView`, `gridStep`) and tested without a browser
   (`tests/studio/canvas-view.test.ts`, including a 500-step drift test). `clampRect` clamps to the stage only when it is
   given one (defaults, presets, tidy); a placed rectangle is bounded only by size and by +-100,000 logical pixels.
2. **No library.** The existing drag, resize, alignment guides, tints, layouts and persistence are sound, and every module
   is wired to them. A canvas library would mean rewriting each module's chrome for no behaviour Grant asked for.
3. **One transform paints everything.** `stage.js` writes `translate(x, y) scale(zoom)` on the stage and `--bc-gx`,
   `--bc-gy`, `--bc-gz`, `--bc-gstep` on the board, so the dotted grid (a CSS radial gradient on the board) and the modules
   cannot disagree. The grid doubles its spacing rather than crowding below 14px.
4. **The wheel belongs to the canvas except over content that scrolls.** Pinch (ctrl or cmd wheel) always zooms; a discrete
   wheel over bare canvas or a module with nothing to scroll zooms about the pointer; a trackpad two-finger scroll and
   Shift+wheel pan; any wheel over an element that can scroll scrolls it. Two touches pinch-zoom and pan; one finger on bare
   canvas pans.
5. **Phones and portrait tablets (<= 860px) keep the stacked layout.** The canvas is for a pointer and a screen with room;
   the iPhone experience is deliberately unchanged.
6. **Navigation is one hamburger** (`bc/menu.js`): projects (active one marked), Create project, Search, My Tasks,
   Activity. It replaces the Home button, the portfolio screen, the Jump To control and Shift+J, and the bottom tray.
   With no project selected `/` is the empty dotted canvas. **The Cmd/Ctrl+K command palette is kept**: it shared Jump's
   dialog but is a different feature (it finds records and runs workspace commands) that Grant asked for separately.
7. **Light stone is the default scheme; dark is a choice.** `bc/tokens.css` defines the colour tokens per scheme
   (`data-scheme`, or the system preference when unset). The texture is an original, procedural, seamless microcement tile
   (`scripts/art/microcement.py`, 215KB webp), laid over the canvas colour with a blend mode so one file serves both
   schemes. No third-party image, nothing to licence.
8. **Dictation uses the browser's streaming SpeechRecognition**, the engine the Chat page already used, behind a tested
   state machine (`web/studio/dictation.js`). No new provider, no audio kept by us, no cost. In Chrome the audio goes to
   Google to be transcribed; the button says so before it is pressed. Firefox has no such engine, so the button is disabled
   with the reason. The live voice conversation is untouched.
9. **Document Style loses Tone of voice, Who it is for and Standing instructions** from the form. The office keeps what is
   stored (a patch touches only the keys it names) and the documents still read it, so nothing is lost; what remains is the
   visual style (colours, two fonts, title page).
10. **Project Settings loses the Team and Project tabs.** Rename, export and archive moved to a fold at the foot of the page;
    How it looks was already in the project menu.

## Consequences

- 48 harness scripts navigated from the portfolio or Jump. They now read the project from the menu; the ones that depended
  on the old behaviour were updated, and `verify:canvas` and `verify:chat-dock` are new.
- A canvas clipped by `overflow: hidden` clips any popover appended inside it. Popovers are fixed-position on the body.
- A module can sit outside the window. `Fit` and `Reset view` are how a person gets back.
- Layout persistence is unchanged in kind: per project, per browser, mirrored to the office. It is not stored per user in
  the office beyond what `dashboard_layout_set` already does; moving that is a multi-user decision, not this one.
