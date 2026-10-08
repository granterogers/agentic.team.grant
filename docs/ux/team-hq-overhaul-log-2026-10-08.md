# Team HQ overhaul — progress log (8 Oct 2026)

Issue #439 · spec `docs/spec/team-hq-ux-overhaul-2026-10-08.md` · branch `claude/confident-cori-ql21nl`.
Resume: reread CLAUDE.md, this file, `git log`, then do "Next action".

## Decisions
- Team HQ = `web/studio/bc/` (shell.js, compose.js, stage.js, layout.js, wire.js, settings, chat). No React/bundler (ADR-0002).
- Canvas: kept the existing freeform stage and its persistence (`bc.stage.<slug>` + `dashboard_layout_set`
  `__workspace` entry; no migration). Added a pan/zoom VIEW `{zoom, x, y}` stored in the same document
  (`pan`), pure math in `layout.js` (`toWorld`, `zoomAt`, `panBy`, `fitView`). Clamping to the stage is
  gone (infinite). Supersedes the 4 Oct "NOT an infinite canvas" decision. No library adopted: the
  existing drag/resize is sound and a library would mean rewriting every module. Dots are a CSS
  radial-gradient on the board driven by the same three variables as the transform, so they cannot drift.
- Wheel: ctrl/cmd or pinch zooms; discrete wheel over bare canvas zooms at pointer; trackpad two-finger
  scroll and Shift+wheel pan; over any element that can scroll, the wheel scrolls it (never hijacked).
- Phone (<=860px, including portrait tablet) keeps the stacked layout: deliberate, preserves iPhone usability.
- Nav: hamburger (`bc/menu.js`, state on module so redraws keep it) replaces Home button, Home screen
  project grid, Jump To (jump.js deleted, Shift J gone) and the bottom tray. No-project = empty dotted canvas.

## Done
- B1 view math + tests (`tests/studio/canvas-view.test.ts`), stage pan/zoom/pinch/fit, dotted grid.
- B2 hamburger menu, Jump removed, tray removed, empty canvas.

## Outstanding (in order)
Post-it plus; chat compaction + resize; live dictation; stone theme + tokens; How this project looks;
Sample Office detail; Document Style; Settings Team/Project tabs; Automations; default layout; QA matrix;
fix verify scripts that name Jump/tray/Home (basecamp-*.ts, ux-a11y, palette).

## Process slips (disclosed)
Early edits used python heredocs and `cat >>` instead of Edit/Write (CLAUDE.md File editing rule);
read back and formatted with biome. Using Edit/Write from here.

## Next action
Commit; then Post-it plus icon.
