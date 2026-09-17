# FULL UX QA PASS WITH WARNINGS

The §74 report for the first explicitly-requested full UX QA under
`docs/spec/ux-qa-v2-2026-09-15.md`. Written after the run genuinely ended, as
§74 requires, and not before.

**QA DURATION:** 2026-09-15T18:52Z → 2026-09-16T02:52Z — **8 hours**, the
contracted minimum. Continuous, autonomous, no interruption of Grant and no
condition under §2 met.

**COMMITS:** 25 on `claude/phase-7-communications-kh8ow8`.

**ISSUES CLOSED:** 12 — #214, #215, #216, #217, #218 (all five P0s), #219, #220,
#158, #222, #160, #207, #240, plus #208 in Phase 2. Nine of them were finished
earlier in the run with a completion comment and were still showing as OPEN
until the final pass; that is itself a finding about how this run was tracked.

**ISSUES CREATED:** 1 — **#267**, `npm run space` cannot see the home board.
**#188** was updated with a new measurement rather than duplicated.

**PRODUCT COVERAGE:** every route the studio has, on desktop and phone, in both
themes: home board, project Overview, AI Team (board / chat / active jobs /
outputs), Documents, Tasks, Contacts, Sources, Project Settings (four panes),
global Settings (nine panes), the document viewer, the call panel, the command
bar. Plus the two surfaces that are not the web page at all — Telegram's pager
text and Slack's blocks.

**QA-HARNESS COVERAGE:** three new capabilities the standard asked for and the
repository did not have — `npm run system` (§§16–20 design-system inventory),
`npm run board` (§15 cross-screen board), `npm run verify:keyboard` (§30
journeys) — plus `npm run verify:credentials` (§35) and `npm run verify:breaks`.
Existing suites corrected where they were looking at the wrong thing:
`verify:controls` (three defects), `verify:access` (a check that passed for the
wrong reason), `verify:chat`, `verify:offline`, `verify:talk`, `verify:studio`,
`probe`, `smoke`.

**DESKTOP:** `verify:layouts` 64 states / 0 findings · `verify:ui` 57/57 ·
`verify:controls` 37 + 99 + 206 pressed, **0 unpressable, 0 findings**.

**PHONE:** `verify:controls` 21 + 75 + 190 pressed, 0 unpressable, 0 findings ·
touch targets enforced with real touch emulation · phone overflow scan clean ·
first content pixel on a project Overview **632px → 481px**.

**LIGHT / DARK:** both, through the stored preference rather than the media
query — `scripts/verify/seed-appearance.ts`, because an explicit preference
makes `prefers-color-scheme` inert and four audits had been standing in for a
light user incorrectly. Contrast measured in both. `verify:design` 21/21.

**TYPOGRAPHY:** `npm run system` — one family, no role changes size between
screens, nothing under the 12px floor except 68 strings drawn inside a document
facsimile, which are exempt and counted separately. #160 was the one real drift
and is fixed: the rail changed size when you entered a project.

**COLOUR SYSTEM:** near-duplicate detection rebuilt around a canvas converter
and per-theme bags — 130 reported pairs were a units bug; the real number is
**5**. Line height recorded as a ratio: 28 apparent values were 11.

**COMPONENT COHERENCE:** inventoried by `npm run system`; nothing incoherent
enough to act on without a design decision, which §22 says is Grant's.

**INFORMATION DENSITY:** `npm run space`. Project Overview panels carry 222px
and 269px below their content — that is #220's fixed panel height with #108's
fade, a setting rather than a defect, recorded on #188. The home board could not
be measured at all, which is **#267**.

**VISUAL COHERENCE:** `npm run board` — 14 screens × desktop/phone ×
light/dark on one wall, **0 captures missing**. Building it found that empty
states had never been captured outside a light desktop and Connections had never
been captured on a phone.

**ACCESSIBILITY:** `verify:access` 35/35, including a per-route heading tree
with three assertions it did not have (no skipped level, opens on its own h1,
has somewhere to jump to). #207 was real: a project screen had exactly one
heading, so heading navigation reached nothing.

**KEYBOARD:** `verify:keyboard` 24/24 across seven whole journeys. Three
product defects found and fixed — a redraw dropped focus onto the body, the
document viewer was a dialog with no focus trap, and the command bar's Ask row
did nothing at all with no project chosen.

**MOTION:** `verify:motion` 6/6, and one reduced-motion pass through
`verify:access`. Nothing requires animation to be understood.

**OVERFLOW:** clean at 390 / 768 / 1024 / 1440. The phone strip was measurably
broken at the start of the run (1px of switcher) and was recomposed.

**PROJECT UX:** the switcher, project identity, Project Settings as its own
scope (#158 / #36), and the isolation between global and project settings.

**CONVERSATION UX:** `verify:chat` 57/57. #215 was the largest single defect in
Phase 1 — the studio invented a reply rather than showing a request state — and
the thread now shows sending, thinking with an elapsed counter, delivered,
failed and retry.

**CALL UX:** `verify:talk` 40/40. #214: one button, two states, and the second
press genuinely ends the session rather than hiding a panel.

**MESSAGING UX:** #208 closed. Rendering four real pager shapes and reading
them found a Slack emoji shortcode arriving on Telegram as literal text and the
unreviewed warning said twice in one message. Both fixed at the class, with six
regressions asserting properties rather than wording.

**SETTINGS UX:** nine global panes and four project panes, every control
pressed, 0 unpressable. `verify:credentials` covers the two credential forms.

**SLACK UX:** `provenanceLine` unchanged in behaviour for Slack, asserted
explicitly — the de-duplication that helped Telegram must not remove a warning
where nothing else says it.

**TELEGRAM UX:** `verify:telegram` 37/37.

**FIXTURE/LEAK SAFETY:** `check:leaks` reports **22 archived debris projects**,
all pre-existing, most permanently undeletable because each holds a job. This
run created none. `verify:credentials` writes real credentials to the vault and
every call is inside `begin … rollback`, with a final assertion that nothing it
typed survived.

**CORS/NETWORK:** `verify:cors` 13/13, probed with the real page origin.

**REGRESSION:** 1,425 unit tests, `verify:hq` 42/42, `verify:wired` 65 control
attributes across 21 screens, `verify:breaks` (the failure state, pressed and
restored byte for byte), `verify:offline` 23/23, `check:secrets`,
`check:templates`, `check:migrations` (377 applied, all recorded).

## COULD NOT TEST

- **Typography as Grant will see it.** Chromium in this sandbox cannot reach
  `fonts.googleapis.com`, so every capture shows the fallback face. Any
  statement about the typeface itself is unreliable until the fonts are
  self-hosted.
- **The Google credential form in a browser.** It is drawn only while Google is
  disconnected, and disconnecting Google is a real destructive action on Grant's
  account. Its three page-level properties are asserted structurally and say so.
- **Whether it feels right in a hand.** §13's line, and §22's: a judgement is
  Grant's to make, not a script's.

## REMAINING RISKS

1. **#25, the spatial plane, is not built.** Grant said *"dont start
   implementation yet"* and nothing since revoked it specifically. A major
   redesign is the one thing not to do autonomously, so the home board (#219) is
   a board of panels rather than the plane he described. This is the largest
   open gap between the product and his stated direction.
2. **#267.** A reading off the desktop capture suggests the home board's Tasks
   panel reserves ~400px for one line of loading text. That is an opinion until
   `space` can measure it, and this repository has an expensive record of
   believing captures.
3. **22 debris projects** in Grant's project list, most undeletable by
   construction. Not created by this run and not fixable without a decision
   about removing jobs.
4. **#18 is still open.** The GitHub token pasted into a chat on 10 September
   still authenticates. Nothing in this repository can revoke it.
5. **#221** (icon library) deferred with a reason: it is in tension with the
   15 September restraint direction.

## Why PASS WITH WARNINGS rather than PASS

Every gate this repository has is green and every defect found in the run is
fixed, deployed and covered by a regression. Two things stop it being a clean
pass, and both are named above rather than smoothed over: **the product does not
yet match Grant's own stated direction for its main screen (#25)**, and **one
audit cannot see the screen that opens every session (#267)** — so there is a
surface about which this report can only say "nothing measurable was found",
which is not the same as "nothing is wrong".

## Before and after

**Before.** Pressing *Call the team* opened a modal and closing it left the
audio running. Sending a message produced an invented reply. There was no way
back to the homepage. Documents `+` trapped you. The studio could enter a
crashed state with no route out. Settings was a constrained sheet. The phone's
project switcher was 1px wide. A project screen had one heading. Five of the
eight rail roles changed size when you entered a project. A keyboard user was
returned to the top of the document after every action, and the document viewer
leaked focus behind itself twenty-three times in twenty-five Tabs. A Google
client secret pasted into the Client ID box was stored in plain text and printed
on the Settings page. Telegram said "nobody has checked this" twice per message,
once as `:warning:`.

**After.** All of that is fixed, deployed and has a check behind it. The
repository also has four capabilities it did not have this morning — it can
inventory its own design system, put every screen on one wall, walk itself by
keyboard, and attack its own credential forms with realistic bad input.

**What the run is really evidence of.** Five separate checks I wrote were wrong
before the product was, and in every case the wrongness pointed at something
alarming that was not true: the section read from the wrong `aria-current`, a
focus trap asserted on a page that is deliberately not a dialog, focus
visibility read from the wrong node, a journey that silently skipped itself, and
a refusal demanded where the office correctly does the right thing. That ratio
is the argument for §11's scepticism about the harness, and it is why each of
those five is written into the suite where the next person will meet it.
