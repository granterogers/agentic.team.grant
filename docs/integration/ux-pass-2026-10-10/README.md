# UX pass, 10 October 2026: before and after

Branch `integration/aesthetic-release-candidate`. Real Chromium screenshots of the real page over the isolated replica's synthetic office (busy project: 140 to-dos, 36 documents,
28 contacts, 12 events). One desktop size (**1920x1080**) and one phone size (**375x812**, iPhone X dimensions, Chromium touch emulation, **not iOS Safari**), Light and Dark, Original look,
Blue accent. "before" is the page at `f0c12bb4` (what you reviewed); "after" is this change.

File names: `<device>-<light|dark>-<dashboard|project-menu>-<before|after>.png` (16 files).

## What you asked for, and what changed

| You said | Change |
|---|---|
| Unify the top part of the screen; too much vertical space | The project's counters, workspace tools (Tidy, Layouts, Reset, Fit, zoom), Chat with Team, the microphone and the project menu now sit in **the top bar**, in one row with the project name, Attention, the office menu and Sign out. Desktop: the top of the screen went from about 155 px to 52 px. Phone: from about 195 px to 108 px (two rows: name and menus, then counters, Chat and the microphone). The dock shows icons only below 1580 px wide so it fits; every button keeps its name as a tooltip and for screen readers. |
| The very top is a different shade from the bit under it | The bar used to paint a **second copy** of the texture over the page's own. It now inherits the page's background exactly, and both are anchored to the viewport, so they cannot differ. |
| The grid must always be visible, whatever the texture | Dots are stronger on every material and each is drawn with a faint halo of the opposite lightness, so one of the two always differs from what is under it. On a phone, where the modules stack and no grid was drawn at all, the same dots now sit behind the stack. |
| The burger menu's project list is stuck together | Rows are 48 px with 8 px between them, the project badges are smaller than the rows, the sections are spaced apart, and the panel scrolls rather than clipping (Activity was cut off). |
| Every module should have its own colour by default | To-dos sky, Card Table violet, Docs and Files amber, Schedule teal, Contacts rose, Latest Activity mint: a tinted face, a coloured top rule and edge. Your own choice from the colour popover still wins. |
| An SVG icon on each module title | Outline icons (list-check, kanban, document, calendar, people, pulse) in each module's own colour, before the title. Decorative, because the title beside it names the module. |
| Light and dark unified everywhere | The bar, the board, the menus and the modules all read the same scheme tokens; Settings, maximised views and dialogs were not changed and already follow them. |

## Checked

- Aesthetic QA 289 of 289 (it also found my change had broken two of its own assumptions: the old "frosted bar" check, and a dot-spacing measure that a halo disturbed; both were corrected to assert the property, not the old design).
- Replica critical gate 68 of 68 proofs, 3,682 assertions. Unit tests for the web folder 143 of 143. `basecamp-home`, `basecamp-touch`, `basecamp-livevoice`, `basecamp-preservation`, phone-header: green. `basecamp-measure` and `basecamp-look` show exactly the failures they show on the previous commit.
- Lint, typecheck and template checks clean.

## Not verified here

iOS Safari, a real microphone, real data. A 360 px phone is a few pixels tighter in the counters row than 375; it scrolls rather than clipping.

## Regenerate

```
npx tsx scripts/isolated/stress-browser.ts bq --only=1920,375 --gallery --quick --shots=<dir>      # after
STUDIO_ROOT=<checkout of f0c12bb4>/web/studio npx tsx scripts/isolated/stress-browser.ts bq --only=1920,375 --gallery --quick --shots=<dir>   # before
```
