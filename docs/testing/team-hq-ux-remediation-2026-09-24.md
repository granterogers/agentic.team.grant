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

Fix pass-1 findings, recapture, compare.

## Pass 3 — Live voice (header microphone)

| # | Finding | State |
|---|---|---|
| 20 | A failed call explained itself as **"Failed to fetch"** (raw exception from shared `call.js`) in 12.5px muted text | **fixed** — `livevoice.plainly()` translates at this experience's edge; `call.js` untouched. Unit-tested with a sabotage that turned it red |
| 21 | Copy said "press the phone"; this experience's control is a microphone | **fixed** in the same translation |
| 22 | A problem line had the weight of a caption | **fixed** — legible warm chip that retires after ~12s (paused on hover) |
| — | Idle mic is red | **kept** — Grant's explicit 23 Sep instruction ("Inactive = red, active = green") |

Trap I hit and recovered from: `git checkout -p` on an uncommitted file reverted the whole new function, not only the sabotage — CLAUDE.md's first trap. Restored from the text written; tests green.

## Pass 4 — tool pages

| # | Surface | Finding | State |
|---|---|---|---|
| 23 | To-dos page | rows read `t.due` (rarely present): no row showed a date; overdue looked undated | **fixed** — shared `dueWords`/`isLate` |
| 24 | To-dos page | Late/Stuck as 12px pills; home had counters | **fixed** — one counter design |
| 25 | Task record | **due field empty for a task due today; Save would have cleared the date** | **fixed** — reads `due_on` |
| 26 | Task record | assignee a free-text box showing slug `emma` | **fixed** — team picker; `verify:basecamp-todos` updated to drive it, proved red under sabotage |
| 27 | Task record | copy quoted "§20" to the user | **fixed**; swept every route for §/#nnn/slug/undefined/NaN/Invalid Date: none |
| 28 | Docs toolbar | 44px select beside 32px buttons; select said only "Custom" | **fixed** |
| 29 | Docs | prototype `venue.png` was a 206-byte stripe pattern (hazard tape on the deployed preview) | **fixed** — generated 16 KB illustration |
| 30 | **Sources** | **`.bcsources` defined twice (upload picker grid + sources list): list laid out as 5 × 200px columns, names truncated, each logo beside the wrong name** | **fixed** — picker renamed `.bcpickfrom`; full page redesigned as integration cards |
| 31 | Portfolio, waiting, outputs, activity, search | assignee printed as database slug in 8 places | **fixed** — roster lookup, either slug |
| 32 | Activity | pressable entry 16px among 13px neighbours (`font: inherit` on a button) | **fixed** |
| 33 | Card table, My Tasks | stale `t.due` again ("Due 16 September" for a 19 Sep overdue) | **fixed** — class closed: no `t.due` reader remains in bc/ |
| 34 | My Tasks (signed out) | "This browser has no token… the projects above" | **fixed** copy; swept all routes for token/API/RPC/payload/JSON/SDP/fixture/schema/gateway/job: none |
| 35 | Settings, dock, chat | failed face image paints the broken-image glyph over the initial | **fixed** — capture-phase `error` listener hides failed face images (scoped) |
| 36 | Settings roster, dock | names in the studio's display face (Anybody) inside Instrument Sans panes | **fixed** — `--display` mapped to `--bc-font` on the Basecamp root |
| 37 | Team (signed out) | "Asking the office who is on this project…" for ever (example projects have no uuid, so nothing is asked) | **fixed** — example team drawn read-only, labelled |

## Pass 5 — states (fake office: empty, huge, slow, refusing, unreachable, offline)

| # | Finding | State |
|---|---|---|
| 38 | Empty project: six boxes of one grey sentence, no next step anywhere | **fixed** — each empty module offers the one action that fills it |
| 39 | Assignee not on the roster rendered as a raw lowercase key (`priya`, `marcus`) | **fixed** — `pretty()` fallback |
| 40 | Outage copy said "the prototype standing in"; refused copy said "token" | **fixed** in shared `SOURCE_STATE` sentences (labels untouched; `verify:offline` locks those) |
| — | `verify:offline` 22/23 ("a first failure shows the outage strip") | **pre-existing on `main`** (proved in a pristine worktree at `d1c9247`); legacy studio surface — out of scope, recorded |
| — | Huge data (200 tasks, long names, 1.2M-word docs): no overflow, no clipping at 3 widths | `verify:basecamp-states` 64/64 |
