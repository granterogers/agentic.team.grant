# ADR-0074: A manual change pins only the module it touched

**Status:** Accepted (branch `claude/sleepy-mendel-tiodo0`, deployed to production 22 October 2026 as page `dpl_3r4jHvoMPbFvGUvj65MuaceejgvW`)

**Date:** 22 October 2026

## Context

ADR-0071 made the dashboard's geometry follow the window until the person arranges it. Option A (21 October) then laid
out a project automatically when nobody had touched it, but kept the rule that one move or resize made the WHOLE project
manual. Grant's brief for the intelligent dashboard layout (21 October) required the opposite: manual overrides take
precedence for the thing that was changed, and the rest of the dashboard keeps optimising itself. Requirements 10, 12
and 13 (granular overrides, respect for choices, hybrid behaviour) could not be met while one move froze everything.

## Decision

1. Each module carries its own `placed` flag. `placed: true` pins that module's position and size. Every other module
   is laid out automatically: its height follows its content, and it takes the highest free place around the pinned
   modules, with a keep-clear margin of one gap.
2. A move or a resize pins only the module moved. The modules it pushes out of the way are not pinned; they are laid
   out again around it.
3. Each pinned module has a **Return to automatic** control on its header. It releases that module's position and size
   and keeps its colour and stacking order.
4. **Arrange automatically** unpins every module. The manual layout is kept as a named backup,
   "Before automatic arrangement", in the project's layouts.
5. **Fit to window** scales only the pinned modules. A single pinned module has no arrangement to fit, so fit does
   nothing for it.
6. A saved layout keeps who arranged each module. Loading one pins its modules, except a module that was automatic when
   the layout was saved.
7. A document written before per-module flags existed is decided once, as before: if its rectangles are the default
   arrangement for the window it was made in, it follows the window; otherwise every module in it is pinned.

## Why

- It is the only reading of requirements 10, 12 and 13 that a person can predict: touching one module changes that
  module, and nothing else.
- It keeps the existing persistence and migration. Old saved layouts load as before, and nothing a person arranged is
  silently rearranged.
- It needs no new storage: the `placed` flag already existed per document, and the layout is recomputed from it on
  every render.

## Rejected

- **Pin the whole project on any move (the previous behaviour).** It is what requirement 13 forbids, and it made one
  small move turn off all automatic sizing.
- **Store every module's position and size on every change.** This is the stored-geometry model ADR-0071 replaced. It
  makes content changes invisible to the layout, so empty modules keep their old size.
- **Pin position and size separately.** Not built. It would double the number of states a module can be in, and the
  present limitation (a move or resize pins both) is visible and reversible with Return to automatic.

## What would reverse it

- Grant asks for a single whole-project manual mode again.
- Pinning position and size separately is needed (requirement 10 in full). That would supersede this ADR, not edit it.
- Per-device saved layouts (requirement 7 in full) are needed. Each device's layout would be a separate record, which
  changes the persistence model in `web/studio/bc/layout.js`.

## Verification

- Unit tests: `tests/studio/layout.test.ts`, `tests/studio/fit-window.test.ts`, `tests/studio/hybrid-layout.test.ts`
  (61 tests in those three files; the full studio and web suite passes).
- Browser scenarios on the Sample project at 1440 and 390 pixels: a real drag pins only the moved module; Return to
  automatic releases it; no overlaps at 1440, 1280, 820 and 390 pixels across three projects.
- Refresh: a pinned module returns at its exact rectangle after a page refresh.
- Not verified on a signed-in office, and not verified on an empty or fully populated project.
