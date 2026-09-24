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



## Passes 3–7 — live voice, tool pages, states, responsive, accessibility

These passes were recorded in their commit messages as they landed and this
table was written from those commits afterwards, so the finding numbers 20–54
used in working notes are not repeated here. Each row names its commit.

| Commit | Finding | Fix |
|---|---|---|
| `715652f` | A failed live call showed the shared `call.js`'s raw exception (*"Failed to fetch"*) in 12.5px muted type and said *"press the phone"* in an experience whose control is a microphone | `livevoice.plainly()` translates at this experience's edge; a legible chip that retires after ~12s; unit test proved red |
| `cba5ca7` | The To-dos page read `t.due`, which rows rarely carry, so no row showed its date and the overdue one looked undated | the miniature's `dueWords`/`isLate`; late in the danger ink; one counter design |
| `2bd182e` | The task record opened with an empty date (Save would have cleared it) and a free-text assignee showing the slug *emma* | reads `due_on`; the assignee is a picker valued with the office's staff slug; the spec reference and data-model copy removed |
| `bd6d439` | Docs toolbar of mismatched heights; the venue sample was a 206-byte stripe that read as hazard tape | one 44px toolbar; a real 16 KB illustration |
| `a165a04` | `.bcsources` was both the upload picker grid and the Sources list, so the list laid itself out as 200px columns with each logo beside the wrong name | picker renamed `.bcpickfrom`; Sources is a card grid |
| `2032974` | Eight places printed a database slug (*claire*, *tom*) to the screen; the portfolio and home disagreed about one task's date; a 16px activity entry among 13px ones | roster lookup everywhere; the shared date reader; one text size |
| `175ffc3` | Signed out, the Team page said *"Asking the office…"* for ever; failed face photos drew the broken-image glyph; embedded modules used the studio's display face | the example team drawn read-only; failed faces hidden; `--display` mapped |
| `40ee426` | Removed modules were offered as bare words that read as labels | dashed *+* chips, and one sentence saying removing hides and deletes nothing |
| `07f5543` | Add Contact dialog far larger than its five fields | sized to them |
| `7fb3361` | Empty modules were dead ends; outage copy said *"prototype standing in"* and *"token"* | each empty module offers the action that fills it; plainer shared sentences |
| `f5e9719` | **Signed in on a slow connection, the page said "Prototype data — sign in" and showed invented projects** | *"Connecting to your office"* with a spinner and a neutral outline |
| `14570fa` | Nothing listened for the network dropping, so changes made offline looked saved | offline/online listeners redraw the strip; a signed-in page re-asks on reconnect; four checks proved red |
| `b386af8` | At 320–360px a module header widened the layout viewport and the tray ran off the side (same on `main`) | meta wraps below 400px; the Attention word becomes a bell below 380px |
| `55a6d59` | No suite measured below 390px, which is why the above was invisible | `verify:basecamp-states` gains a 320px leg, proved red without the fix |
| `c5a3683` | axe: 6 failing rules (nested interactive headers, contrast, unlabelled separators, no h1, heading jumps); the controls audit silently skipped half the home after pressing a close cross | 0 violations; the audit clears layout storage per visit, 375 to 439 pressed |

## Harness notes

- `verify:basecamp-reconcile` was 19/21 in this sandbox (office.invalid → proxy tunnel failure). Taught the reason, tied to that host. 21/21.
- `verify:basecamp-voicenote` needs `espeak-ng` (installed). My 40px composer buttons were caught by its 44px floor — the detector working.
- `basecamp:measure` caught my first counters at 39px on touch — detector working.

## Isolated review deployment

| | |
|---|---|
| URL | **https://team-hq-ux-review.vercel.app/basecamp/p/legacy-coaching-course** |
| Vercel project | `team-hq-ux-review` — NEW, created by this branch; no existing project touched |
| First deployment | `dpl_GUUYN8dUGpSZJmfRbkD7yG8TPyws` |
| Latest deployment | `dpl_fYx3iPWCKsFkNT6H2JSVhhJov2c1`, from commit `8f3046c`+contrast fix; `bc/wire.js` byte-identical to the branch, `bc/compose.css` carries the last change; 4 routes x desk and iPhone 14 rendered from the sandbox, 0 page errors, 0 overflow |
| How | `npm run deploy:ux-review` (`scripts/deploy/ux-review-preview.ts`): static `web/studio` by digest, rewrites-only `vercel.json` |
| Not touched | `ai-team-hq`, `agentic-team-hq-basecamp` and every alias; no secret, env var, SSO setting, allow-list or edge function |
| Office | none — `config.js` is deliberately absent (`index.html`: "a 404 here is not an error"), so the copy shows the example projects and cannot reach or write to any office |
| Verified | 5 files sha1-identical to the branch; rendered in Chromium from the sandbox at 1440 and 390, 0 overflow, real webfonts |
| To remove | delete the `team-hq-ux-review` project in Vercel |

## Behavioural branch handoffs

Nothing in this branch needs the backend branch in order to work. Two things
belong to it, and both are handled here at the Basecamp edge only, so the
shared modules are unchanged:

**BEHAVIOURAL BRANCH HANDOFF 1 — `web/studio/call.js` passes a raw error
message to the page.** A refused or failed live call surfaces `e.message`
(a browser or network string) and says *"press the phone"*. The Basecamp
microphone translates it (`bc/livevoice.js` `plainly()`, with four unit tests
in `tests/bc/livevoice.test.ts`); the legacy studio still shows the raw text.
The durable fix is for `call.js` to return a reason code and let each surface
word it.

**BEHAVIOURAL BRANCH HANDOFF 2 — `web/studio/chat.js` writes the failure text
as the AGENT'S message.** When a turn fails, the row that comes back is
attributed to the specialist, so a failure reads as something a person said.
The Basecamp thread now draws a failed or unanswered turn as a notice
(*"No answer came back"*, with Try again, via `chat.retry`) instead of a
message; the underlying row shape is unchanged. Whether `chat.js` should stop
attributing it at all is the backend branch's call.

## Integration handoff

| | |
|---|---|
| Branch | `claude/dazzling-dirac-acjwqf` (pushed; not merged; no PR opened) |
| Merge base | `d1c9247adc78c840c953c10450c81225a097e62c` — `main` untouched |
| Scope | the Basecamp experience, `web/studio/bc/*` — 11 files |
| Shared files touched, and why | `web/studio/app.js` (imports `prose` from the new `prose.js`; dock gains the Basecamp-only voice note and `data-bc-noteproject`; `bcContext.chatRetry` and `repaintDock` — every addition behind `state.experience === 'basecamp'`, legacy `verify:ui` 54/54 and `verify:wired` clean) · `web/studio/data.js` (two shared outage sentences reworded, labels unchanged; one sample size label) · `web/studio/prose.js` (NEW, moved verbatim out of `app.js`) · `web/studio/samples/venue.png` · `package.json` (one script, `deploy:ux-review`) |
| Suites changed | `scripts/verify/basecamp-{contacts,controls,failures,journey,reconcile,states,todos,voicenote}.ts` — every change strengthens or re-points a check; each new check was proved red |
| New | `scripts/deploy/ux-review-preview.ts`, `tests/bc/livevoice.test.ts` |
| Not touched | gateway, worker, edge functions, migrations, API contracts, secrets, allow-lists, aliases |
| Likely conflicts | `web/studio/app.js` (large, shared: `paintDock` and the `bcContext` object) · `web/studio/data.js` (`SOURCE_STATE`) · any verify suite the backend branch also edits. `bc/*` is this workstream's alone |
| Review copy | https://team-hq-ux-review.vercel.app/basecamp — its own Vercel project; delete that project to remove it |

## NEXT ACTION

Complete. The report is the last thing in this workstream; nothing is
pending except Grant's review. Pristine baseline for comparisons: `git
worktree add /tmp/basewt d1c9247`.

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

## Pass 9 — voice note in the dock, and a privacy defect

| # | Finding | State |
|---|---|---|
| 62 | The dock ("Chat with Team") — Team Chat for most people — had no voice note; only the separate Chat page did | **fixed** — same control and panel in the dock composer (Basecamp only); machinery extracted to one `voiceNote()` factory used by both |
| 63 | **PRIVACY: leaving the Chat page mid-recording left the microphone recording with no control on screen**; any re-render drew the panel into a detached node (pre-existing) | **fixed** — instances resolve their composer live and `resync()` after every render: restore the recording/review if the composer exists, **stop the microphone if it does not**. Same for closing the dock |
| 64 | Opening a module while the dock was open covered the dock with the modal backdrop (Stop unreachable mid-recording) | **fixed** — on desktop the expanded view stops at the dock's edge |
| — | 6 new checks in `verify:basecamp-voicenote` (43/43); 4 proved red by disabling the stop path | recorded |

## Pass 10 — the Chat page while the team works

| # | Finding | State |
|---|---|---|
| 65 | **In-flight answer drawn as an empty message** (name, time, no words) — "I asked and nothing came back" | **fixed** — a working row: spinner, the dock's words (sending / working / slow), live elapsed time, Ask again when slow |
| 66 | A failure drawn as the **agent saying** "I could not reach the office…" | **fixed** — a notice from the office ("No answer came back"), with the reason |
| 67 | No way to retry on the Chat page (the dock had one) | **fixed** — `ctx.chatRetry` = the dock's `chat.retry`; Try again resends once |
| 68 | New answers landed under the sticky composer; the page did not follow | **fixed** — follows the thread when the reader was at the end (remembered on scroll, per #197) |
| — | 7 new checks in `verify:basecamp-failures` (50/50). One was vacuous at first (`:empty` never matches `<p></p>`), then racing a 30s `innerText()` wait — both found by sabotage and fixed | recorded |

## Pass 11 — working states beyond chat

| # | Finding | Fix | Evidence |
|---|---|---|---|
| 69 | Saving a to-do record on the example projects redrew the page with no confirmation, and focus jumped to Close | the successor Save button takes focus and says *Saved in this browser.* in a status region | driven: `data-said role=status` present, focus on Save; todos 30/30, journey 55/55 |
| 70 | Signed-in saves, uploads and ticks | already go through `attempt()`, which disables the control, says *Saving…* and then the office's own sentence | read `office.js` `attempt`; Docs upload signed out refuses with the sign-in sentence |
| 71 | Schedule on a phone hid the month grid and with it the month's name, so September ran into October with only a gap | the agenda carries its own month heading, shown only where the grid is hidden | 390 capture |
| 72 | Schedule's Overdue pill sat on the row's top edge while date, title and name were centred | centred with its row | probe: pill y 536 = name y 536 |
| 73 | On touch widths the activity entry read "Olivermade the course one-pager": the 44px rule used inline-flex, which drops the space between the bold name and the sentence | padding instead of flex, same 44px | scratch scan of every flex/grid container with text beside an element, 13 routes x 2 widths: 0; with the old rule restored it flags the row on 7 routes, so the scan can fail |
| 74 | Card Table told a phone user to drag a card, a gesture a touch browser does not do with HTML drag | *Drag a card to another column, or choose its stage on the card* — true on both, since each card carries the stage menu | 390 capture |
| 75 | My own portfolio signals (#portfolio pass) dimmed zero counts to 4.07:1 — found by the final axe sweep, 12 nodes | opacity 0.8 — about 4.8:1 | axe, 14 routes x desk and phone: 0 violations |

## Pass 12 — final adversarial review

A fresh reviewer read the whole diff against `d1c9247` without editing
anything. Four findings, every one confirmed in the code before anything was
changed, and three of them in this branch's own voice-note work:

| # | Finding | Fix | Proof |
|---|---|---|---|
| 76 | **A voice note recorded in the dock on the portfolio went to no project**: the dock files a typed line under the thread it shows (open project, else Unnamed, else the first), the voice note used `state.project`, which is null there. And the Basecamp branch of `drawShell` returns before its `paintDock()`, so even a correctly filed note did not appear in the dock | the dock form carries the project it shows; the dock's voice note reads it; `askTheTeam` repaints the dock as well as the page (`ctx.repaintDock`) | new voicenote check, red on the pre-review `wire.js` |
| 77 | **A render during transcription brought "Send to the team" back** — a second press sent the note twice — and a failure was written into the composer the render had thrown away; every resync also minted a new object URL, never revoked | the panel is always drawn through `paint()`, which remembers what it drew; resync restores exactly that; a failure paints on the live panel; a `sending` guard; one URL per recording, revoked on release | two new voicenote checks, one of which proves a redraw really replaced the composer; both red on the pre-review `wire.js` |
| 78 | One recorder, two composers: pressing the page's microphone while the dock recorded stopped the dock's recording into the page's panel | an instance does not reach into a recording the other owns | read; covered by the ownership guard |
| 79 | **A vacuous check of mine**: the journey suite's "assignee persisted" picked the first option, which was the task's current assignee (the fake office had one person), so an ignored edit passed | a second person in the fake roster; the pick must differ from the current value, asserted | sabotaging the save to drop the assignee turns two checks red (54/56) |

Clean by the reviewer's reading: every new interpolation escapes; per-render
listeners sit on nodes the redraw replaces, the rest are attached once; every
`paintDock` addition is behind the Basecamp guard; new CSS is scoped; the
review deploy touches only its own Vercel project and prints no secret.

Suites after the fixes: voicenote 48/48, journey 56/56, failures 50/50, home
45/45, todos 30/30; lint, typecheck, check:templates, check:secrets, smoke.
