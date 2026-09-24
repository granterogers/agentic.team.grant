# Team HQ (Basecamp) — UX/UI remediation ledger, 24 September 2026

Durable record of the Basecamp Team HQ UX workstream. **On compaction: reread
CLAUDE.md, then this file, then `git log --oneline origin/main..HEAD`, and
continue at NEXT ACTION.**

## Baseline

| | |
|---|---|
| Starting `main` | `d1c9247adc78c840c953c10450c81225a097e62c` (verified equal to expected) |
| Branch | `claude/dazzling-dirac-acjwqf` (the session's designated branch; branched from that `main`. The brief's preferred name `claude/team-hq-ux` was not used because this session may push only to its designated branch) |
| Surface | `/basecamp/...`, sources in `web/studio/bc/` |
| Out of scope | legacy studio, backend, migrations, fresh-install |
| Sandbox browser | `npm run trust:proxy-ca` needed an NSS db created first (`certutil -N`); now trusts the proxy CA with verification on |

## Capture tooling

`npm run basecamp:shots` — 104 screens × (viewport, full) at 1440 / 1024 / 768 / 390.

## Pass 1 — first look (overview, dark, desktop + phone)

| # | Surface | Finding | State |
|---|---|---|---|
| 1 | To-dos, Schedule | task titles CENTRED in their row, floating away from the checkbox / date chip | **fixed** `ce3081f` — root cause UA `text-align:center` on a stretched `.bclinky` button; fixed at the class |
| 2 | Card table, Docs, Contacts | content clipped mid-line at the card bottom with no fade | **fixed** `ce3081f` — scroll-timeline fade, inert when not overflowing |
| 3 | Docs & files | meta line sliced horizontally | **fixed** by #2 (it was the pane edge) |
| 4 | Page header | the `…` page menu is a near-invisible glyph on phone | **fixed** `ce3081f` — ringed face |
| 5 | Needs you | one small pill; Late / Stuck not visible | **fixed** `ce3081f` — three counters; zero muted & unpressable; 99+ cap |
| 6 | Home frame | dead band above toolbar, 140px below grid | **fixed** `ce3081f` |
| 7 | Latest activity | timestamp column and dot misaligned | open |
| 8 | Card table @1024 | clamped titles leak a third line into padding | **fixed** `ce3081f` — `overflow-clip-margin: content-box` |
| 9 | Phone to-dos | titles run under assignee, no ellipsis (inline-flex kills text-overflow) | **fixed** `ce3081f` |
| 10 | Tray | text glyphs ✎⌂✓≡ as icons; 10px label under the 12px floor | **fixed** `ce3081f` |

## Pass 2 — Team Chat

| # | Finding | State |
|---|---|---|
| 11 | **Enter in the chat field did a native form submit: page reload, message lost, no error** (functional defect) | **fixed** — submit handler + Enter sends / Shift+Enter newline |
| 12 | Message body in one `<p>`: newlines and numbered lists collapsed (CLAUDE.md #209 trap) | **fixed** — `prose()` moved verbatim from `app.js` to shared `web/studio/prose.js`, used by both |
| 13 | Composer: one-line input, 44px Voice note beside a 32px Send, idle mic wore a red "recording" dot | **fixed** — one composer surface, auto-growing textarea, 44px actions, dot only while recording |
| 14 | Composer below the fold on phone | **fixed** — sticky, clears the tray |
| 15 | Thread lines up to 1,270px; 22px letter faces; no role; you vs team undistinguished | **fixed** — 760px measure, 34px faces, role, accent on your lines |
| 16 | Phone dock = legacy 58vh sheet: ~160px thread, strip of page under it | **fixed** (scoped) — full screen above the tray |
| 17 | Dock row texture painted a pale block in the avatar gutter | **fixed** (scoped) |
| 18 | Recording meter = 14 equal 22px capsules | **fixed** — graduated level meter |
| 19 | Textarea `field-sizing:content` + auto grid track pushed phone to 461px | found by my own capture, **fixed** before commit |

## Harness notes

- `verify:basecamp-reconcile` was 19/21 in this sandbox (office.invalid → proxy tunnel failure). Taught the reason, tied to that host. 21/21.
- `verify:basecamp-voicenote` needs `espeak-ng` (installed). My 40px composer buttons were caught by its 44px floor — the detector working.
- `basecamp:measure` caught my first counters at 39px on touch — detector working.

## Changes

(appended as they land)

## Behavioural branch handoffs

(none yet)

## NEXT ACTION

Passes 1–7 done (home, chat, live voice, tool pages, states, responsive, a11y).
Next: full re-capture → visual critique loop (typography, colour, depth,
button families, portfolio home) → final gates → final screenshot set →
report. Pristine baseline worktree for comparisons: `/tmp/basewt` at
`d1c9247` (recreate with `git worktree add /tmp/basewt d1c9247` and symlink
node_modules if the container was recycled).

## Pass 8 — visual critique loop 1

| # | Finding | State |
|---|---|---|
| 55 | Signed-out strip 108px (sign-in stacked as a column) — largest thing above the fold on the deployed preview | **fixed** — one row, 65px, 44px field and button |
| 56 | "Sea of blue": every to-do and schedule title was accent link text, so real actions had nothing to stand out against | **fixed** — titles in strong ink, accent on hover/focus |
| 57 | Timeline dots floated beside the rule (#7) | **fixed** — nodes on the rule, level with the first line |
| 58 | `basecamp:measure` caught the new title buttons at 24px and the framed select at 42px on touch | **fixed** — hit areas grown without moving layout |
| 59 | Portfolio: no project identity, one lone pill, empty columns | **improved** — each project's own mark beside its name; the same Needs you / Late / Stuck signals as the project home (static figures: the preview is already one control) |
| 60 | **Add-a-task form: free-text "Assigned to"** — `hq_task_add` resolves `p_assignee` against `staff.slug`, so typing "Claire" or "claire" is refused by the real office; only a role slug worked | **fixed** — the record's picker, extracted to one shared `assigneePicker()`; `verify:basecamp-journey` now asserts `chief-of-staff` reaches the office |
| 61 | Contact record: the same face twice (header + a larger copy above the fields); eleven ungrouped boxes | **improved** — one face; fields under "Who they are / How to reach them / Next step" (still fully editable, per Grant). `verify:basecamp-contacts` looks for the photo on the record (header or form), 31/31 |
