# Aesthetic inspection matrix

Which surfaces of Team HQ were opened, audited and looked at in the 9 October 2026 sprint, and what was found. It is written from
the runs themselves (`scripts/verify/surface-lab.ts`, `gallery.ts`, `icon-audit.ts`, `motion-focus.ts`, `aesthetic-qa.ts`), not from
memory, and it does not claim coverage it does not have.

## How to read the verdicts

- **Verified**: the surface was opened by a real press (the lab fails the surface if the thing it expected is not on screen) and the
  audit found nothing: no sideways scroll, no clipped text, nothing past the edge, type 12px or more, touch targets 40px or more on a
  phone (labels and hit-area pseudo-elements counted), no placeholder cut off, no hue that is neither the accent nor a state or module
  role. **"Read" means I also looked at the screenshot**; without it the verdict is audit only.
- **Defect corrected**: the audit or my reading found something; it is fixed and re-run.
- **Partially verified**: opened and audited in some contexts only (named).
- **Blocked**: could not be reached, with the reason. Never counted as verified.
- **Not inspected**: nothing was opened.

Contexts: devices 360, 390, 430 (touch), 1024, 1280, 1440, 1920; dark and light; looks Original, Slate & Silver, Forest & Brass, Warm
Graphite; accents slate, clay, moss (gallery). Not every surface was run in every context (see "Contexts" per row).

## Surfaces

| Surface | Contexts | Verdict | Read by eye | Notes |
|---|---|---|---|---|
| Project board | 7 devices x 2 schemes; 4 looks at 1440 | Defect corrected | yes | document pages near-black in light (paper); chat-open switch cut mid-word; type floor |
| Home / empty canvas (signed out) | 7 x 2 | Verified | audit only | |
| Home (signed in, no project open) | writer, 1440 and 390 x 2 | Verified | yes | |
| First-run ("Your office is ready") | writer, 1440 and 390 x 2 | Verified | yes (390 light) | |
| Project menu (burger) | 7 x 2; 4 looks | Defect corrected | yes | glass; menu heading 11.5px |
| New-project form | writer 1440 and 390 x 2 | Defect corrected | yes | placeholder cut off in the menu width |
| Page menu (three dots) | 1440 x 2 | Defect corrected | yes | 18px type and no panel: now the menu system |
| Command bar | 7 x 2 | Defect corrected | yes | label sat on the input |
| Background picker | 7 x 2 | Defect corrected | yes | 11px labels; phone strip; 24px swatches |
| Layouts popover | 1440 x 2 | Verified | yes | gained "Fit my arrangement to this window" |
| Module tint popover | 1440 x 2 | Verified | yes | |
| Note (focused) | 1440 x 2 | Verified | audit only | phone has no notes (by design) |
| Attention | 1440 x 2 | Verified | audit only | |
| Chat (expanded dock) | 7 x 2 | Defect corrected | yes | 10px speaker line and initials; touch close |
| Chat (phone, full screen) | 390 | Verified | yes | |
| Maximised To-dos | 7 x 2 (+ empty, writer) | Verified | yes (light) | |
| Maximised Card table | 7 x 2 | Verified | audit only | |
| Maximised Docs & files | 7 x 2 | Verified | audit only | |
| Maximised Schedule | 7 x 2 (+ empty, writer) | Defect corrected | yes | 30px Day / Week / Month on a phone |
| Maximised Contacts | 7 x 2 | Verified | audit only | |
| Maximised Activity | 7 x 2 | Verified | audit only | |
| Schedule, compact and medium (Day/Week/Month) | QA suite, 1440 | Verified | yes | persisted and in step with the maximised view |
| Event editor | 7 x 2 | Defect corrected | yes (gallery, phone) | 36px fields at 14px type; all-day checkbox target |
| Contact record, Document viewer, Task record | 7 x 2 | Verified | yes (390, task 1440) | select boxes now draw their own chevron |
| Search, My Tasks, Activity | 7 x 2 | Verified | yes (My Tasks) | signed-out prototypes; a signed-in run was not made |
| Project settings | 7 x 2 | Defect corrected | yes | the card sat flush under the prototype strip; one shared rule gives every page card its 12px margin (10 October) |
| Settings: Team, Autonomy, Requests, Learned, Services, Messaging, Appearance, Usage and health, Help | 7 x 2; looks | Verified | Team, Services, Messaging, Appearance, Usage (yes); Autonomy, Requests, Learned, Help (audit only) | |
| Settings > Appearance: Look, Accent, Scheme, Materials | 1440 and 390, both schemes | Verified | yes | new; persistence in the QA suite |
| Component gallery (17 live components) | 12 appearances | Verified | yes (2) | |
| Empty project (all modules empty) | writer, 1440 and 390 x 2 | Verified | yes | |
| Confirmation dialogs (confirm, danger confirm, ask) | 1440 and 390 x 2 | Verified | yes | opened through the dialog module the product uses, with the product's own wording; the lab's first fixture had a placeholder the real call does not, and the audit caught that one as cut off on a phone |
| Tooltips | n/a | **Not a surface to inspect** | | Team HQ has no tooltip component: hover help is the browser's native `title`, whose look is the operating system's. Every icon-only control now carries a `title` and an accessible name (`icon-audit.ts` fails one without), which is the part that belongs to the product. |
| Notifications / undo strip | 1440 and 390 x 2 (writer) | Defect corrected | yes | the strip is the only transient notification the product has; its wrapping, palette and 44px keys were fixed (10 October). `undo-bar`, `-error`, `-long`, `-message` in the lab |
| Voice controls (microphone, live voice, dictation) | button states only | **Partially verified** | | the buttons are measured; a real microphone is not testable here |
| Loading, error and offline states | `basecamp-states` (80 checks) | Verified by the existing suite | no | not re-photographed in this sprint |
| Signed-in data-heavy pages (real office) | none | **Blocked** | | production access is off; the stand-in office has one empty project |
| Sign-in, create account, signed-out notice, set-up-office screens | 1440 and 390 x 2 (`auth` group, `officeMode` stand-in) | Defect corrected | yes (sign-in, set-up) | axe clean; the "Sign out" link is a 44px target on a phone |
| Palettes x looks x glass x depth, axe over pages, menus, settings, popovers | 4 looks x 2 schemes x 2 devices (Solid, deep); 4 palettes x 2 schemes (Soft, flat); Forest and Graphite (Rich, soft) | Verified | sample read | 360 + 240 + 180 lab captures, 1 contrast defect found and fixed (Jump row on the Ink palette) |

Counts from the final lab runs (same 144 surface-by-context cells, phone 390 and desktop 1440, both schemes): **before the sprint's changes
98 verified, 36 with a finding, 10 blocked; after, 134 verified, 0 with a finding, 10 blocked** (the 10 are "needs a signed-in office" and
"not offered on a phone"). The before run uses the same, improved detector against the pre-sprint page, so the numbers compare like with like;
the detector was proved able to fail first (planted defects in `gallery.ts`, `icon-audit.ts`, `motion-focus.ts`).

## Where the eye found what the audit could not

- The glass blur was not blurring (a frosted top bar swallowed it): audit green, screenshot wrong.
- A grey square behind the three dots: my own glass rule had hit the wrapper. Audit green, screenshot wrong.
- Near-black document slabs on the light board: no overflow, no contrast failure, no dead control.
- A To-dos switch cut to "8 te": clipped inside a button, below the ellipsis the audit knows about.

None of these would have been found by a count. That is why this document has a "read by eye" column.
