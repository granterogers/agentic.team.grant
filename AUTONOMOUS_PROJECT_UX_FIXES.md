# Autonomous project UI/UX fixes — working document

**Branch `claude/basecamp-team-hq`. Do NOT merge. Do not disturb the default Team HQ.**

This file is the source of truth for this run, not the conversation. If the
session is compacted or restarted: **read this file first**, then continue from
the first item that is not VERIFIED.

Status words, each meaning exactly one thing:

- **TODO** — not started
- **IN PROGRESS** — being worked on now
- **VERIFIED** — fixed AND the user-facing behaviour was driven in a real
  browser (or, for backend paths, over the network against the deployed thing)
- **BLOCKED** — cannot be done from here; the reason and the handoff are written down

A code change alone is never VERIFIED.

## Working order (Grant's, blockers first)

1. Restore Settings access
2. Repair Chat authentication and sending
3. Repair live Voice authentication
4. Repair To-do behaviour
5. Fix Contacts behaviour
6. Fix panel resizing / layout stability
7. Fix Card Table rendering and interactions
8. Fix Docs & Files thumbnails
9. Project appearance controls
10. Remove redundant header content, final visual cleanup

**Explicitly out of scope this pass:** the conceptual distinction between
Schedule and To-dos. Leave their information architecture alone except where
repairing the completion defect requires it.

## Checklist

### 1. Settings access (BLOCKER)
- [x] **VERIFIED** The three-dot / settings control — two real defects, both fixed
- [x] **VERIFIED** Accessible at every viewport size, 44px, hit-tested

### 2. Chat with Team (BLOCKER)
- [x] **VERIFIED** The cause was found and fixed at the root: there was no way to sign in
- [x] **VERIFIED** A real message reaches the deployed office and a real answer comes back
- [x] **VERIFIED** Enter sends
- [x] **VERIFIED** Shift+Enter makes a newline and sends nothing
- [x] **VERIFIED** The Send button still works
- [x] **VERIFIED** Opening Chat still uses the sidebar

### 3. Live voice (BLOCKER)
- [x] **VERIFIED** "unauthorized" — same root cause as Chat, plus honest 401 handling
- [x] **VERIFIED** A session is established (protocol-level; OpenAI itself still unproved)
- [x] **VERIFIED** Pressing the voice button moves nothing around it — measured
- [x] **VERIFIED** Inactive = red, live = green, asserted as colours
- [x] **VERIFIED** No layout movement, and the status line covers no control

### 4. To-dos
- [x] **VERIFIED** Completing a to-do no longer makes it disappear
- [x] **VERIFIED** Completed items stay in place, struck through, ticked, dimmed
- [x] **VERIFIED** Every completion target is 44px and nothing lies over it
- [x] **VERIFIED** State persists across reload (asserted as the tick, not as wording)

### 5. Contacts
- [x] **VERIFIED** Full-screen contact scrolls and holds its position through a redraw
- [x] **VERIFIED** Miniature entries show the photograph, initials where there is none
- [x] **VERIFIED** Clicking a miniature contact opens THAT contact
- [x] **VERIFIED** Clicking the panel title maximises the whole Contacts view

### 6. Panel resizing
- [x] **VERIFIED** Widening one panel shrinks its neighbour; nothing beyond it moves
- [x] **VERIFIED** Minimums respected, no overlap at any width (property test over every width)
- [x] **VERIFIED** A panel moves rows only when it cannot fit at its minimum width

### 7. Card Table
- [x] **VERIFIED** Miniature is columns that fit the pane (`auto-fit`, 128px minimum), not a shrunken board
- [x] **VERIFIED** Typography: ten sub-12px declarations raised to the floor; no clipping, no sideways overflow
- [x] **VERIFIED** Miniature cards drag between columns using the full board's own mechanism
- [x] **VERIFIED** A drag no longer also opens the card
- [x] **VERIFIED** The move survives a reload

### 8. Docs & Files thumbnails
- [x] **VERIFIED** A document's face comes from what the file IS, not from the four words the office emits
- [x] **VERIFIED** A picture is the picture; a spreadsheet, a deck, a recording and a video are objects
- [x] **VERIFIED** Deliberate fallback for a type this office has never met, and for a picture that will not load
- [x] **VERIFIED** The caption names the same thing the thumbnail shows
- [x] **VERIFIED** The gallery and the list show every document the same way
- [x] **VERIFIED** A recording plays whatever word the office filed it under
- [x] **VERIFIED** Real files of five types in the prototype: PDF, PNG, CSV, WAV, ZIP

### 9. Project appearance
- [ ] **TODO** Project colour / accent
- [ ] **TODO** Project image / cover where appropriate
- [ ] **TODO** Project icon
- [ ] **TODO** Per-project, not global; persists

### 10. Header space
- [ ] **TODO** Remove the redundant legacy project title area
- [ ] **TODO** Remove "6 modules built from interview corpus"
- [ ] **TODO** Remove the redundant Tasks summary in the same upper area
- [ ] **TODO** The workspace begins higher on the screen

## Discoveries, decisions, files changed

### 1. Settings access — what was actually wrong

The control had NOT disappeared. Before changing anything, it was measured at
five states (desktop signed out, desktop signed in, 1200, 900, 390): present,
visible, `opacity 1`, inside the viewport and hit-testing to itself in every
one, in the working tree AND in the deployed bytes. Two things were wrong, and
both are real:

1. **Nothing on it said settings.** A 38px unlabelled icon at the far right of
   a row, whose accessible name was "More about this page" — not a phrase
   anybody hunting for project settings would recognise. A control nobody can
   find is a control that does not exist.
2. **Its open state lived in the DOM.** This shell rebuilds itself for reasons
   that have nothing to do with the menu — a lazy read landing, the call
   painter ticking — and a rebuilt panel is a fresh hidden one. So the menu
   really did vanish a moment after being opened, which is the thing Grant
   experienced.

**Fixed:** the word *Settings* rides beside the dots from 720px up (icon alone
on a phone, where the row has no room, with the meaning in the accessible
name); the open state is a flag in `compose.js` that the markup reads and the
wiring sets, so a redraw re-renders the menu as the person left it; and
choosing an item closes it.

**A cascade trap on the way:** `.bcbtn.bcicon` in `compose.css` is two classes
and fixes a 38px square. A one-class rule in `bc.css` lost twice — first on
specificity, then on file order — and the button stayed square with the word
inside it and nowhere to go. The rule belongs in `compose.css`, after the rule
it overrides.

**Files:** `web/studio/bc/compose.js`, `web/studio/bc/compose.css`,
`web/studio/bc/wire.js`, `web/studio/app.js` (a `render` hook beside the
existing capture hooks), `scripts/verify/basecamp-settings.ts`.

### 2. Chat — the "unauthorized" was real and the endpoint was healthy

Established BEFORE writing anything, over the network, three ways:

| request | result |
|---|---|
| `/voice/turn` with the vault token | **200**, answering with real project names |
| the same with a wrong token | **401 `{"error":"unauthorized"}`** |
| the same with no token | **401 `{"error":"unauthorized"}`** |

So the endpoint was never broken. **Browser storage is per ORIGIN**, this
experiment is served from its own hostname, and there was **no way whatever to
put a token into it** — no sign-in control existed anywhere in the studio; the
only mechanism was setting `localStorage['hq.token']` by hand. So every call
from the preview was unauthenticated, and the page repeated the server's own
word.

**Three fixes, all at the root:**

1. **A sign-in control**, in the strip that already says the office cannot be
   seen. Password field, no autocomplete, cleared the moment it works, and
   **validated by use** — the office is the only thing that can say whether a
   token is good. A refused token is removed again, so the browser is never
   left holding a credential the office has rejected (which is the state that
   produced the original complaint).
2. **`chat.js` now handles 401 like `office.js` always has** — clears the token
   and says "This browser is not signed in to the office. Sign in and try
   again." It had its own `fetch` to a different endpoint, so it never learned.
3. **Enter sends, Shift+Enter makes a newline.** A textarea does neither on its
   own: Enter inserted a newline and nothing sent, so the keyboard could not
   send a message at all.

**Files:** `web/studio/bc/shell.js`, `web/studio/bc/wire.js`,
`web/studio/bc/compose.css`, `web/studio/chat.js`, `web/studio/app.js`,
`scripts/verify/basecamp-chat.ts` (new), `scripts/verify/chat-live.ts` (new).

## Verification log

**8. Docs & Files thumbnails — VERIFIED.**
- **The cause, and it was one cause.** `app.studio_documents` maps every
  document in the office onto four words — `audio`, `made`, `pdf`, `doc` — and
  three renderers each decided a thumbnail from that word. So a photograph, a
  spreadsheet, a slide deck and an archive all arrived as `doc` and were drawn
  as **pages of written text**, which is the one thing the drawing is not
  allowed to be: a picture of a document that does not exist. The file's own
  comment had said so since it was written.
- Widening the RPC would not have fixed it, because the office cannot know the
  type of a file it has never fetched. The face is DERIVED instead — kind, then
  media type, then the file's own extension — in `faceOf`, and the painter
  corrects it once the real bytes have a type.
- **The list view drew four lines of text unconditionally**, so the same
  spreadsheet was a green object in the gallery and a written page in the list.
  One drawing (`thumbFace`) serves both now.
- **The painter skipped every tile that had a glyph on it**, so a document
  known to be a picture showed the outline of a picture for ever — the one
  thumbnail that could have been the thing itself never was.
- **The caption still said "Document"** under a corrected tile. A label
  disagreeing with the picture beside it is worse than both being wrong,
  because each is then evidence the other is broken. One word map now, shared.
- **An image that will not load** fell back to the drawn page — the office
  asserting that a photograph is a page of writing. It falls back to a glyph.
- **Two of the three places asking "is this a recording?" asked the kind**, so
  a .wav filed as a `doc` reached a details page with no player on it.
- **And the sabotage found a defect the fix had not:** two documents pointing
  at one file are indistinguishable by reference, so pressing the second opened
  the first one's record. Resolved by title and reference together.
- Five real files of five types in the prototype, because a file type nobody
  can see the handling of is a file type nobody is checking.
- `verify:basecamp-docs` 26/26. **Controls:** the five face checks and the
  fallback check all go RED against the combined revert (both halves reading
  the four-word kind, which is the original code) and green against the fix;
  both recording checks go red against the kind-reading predicate. Each
  sabotage printed a count proving it had landed before the suite spoke.
- **Two checks I wrote could not fail and were removed or repaired.** The
  renderer and the painter are redundant by design, so sabotaging either alone
  left everything green; a "first frame" check written to separate them could
  not fail either, because `fileFor` resolves on a microtask and the painter
  has already run before a browser round trip can look. And the recording check
  was reading the wrong row — two fixtures share a file, so finding by
  reference found the one every version of the code gets right.
- `basecamp:gate` exit 0 (64 layout states, 0 findings, no overflow at any
  size, nothing under 44px). Every other basecamp suite green. `npm test`
  2,254 passing, lint 0, typecheck 0, `check:secrets` clean.
- **One regression of my own, caught by the gate:** item 4's "2 done" heading
  is the shape of a filter — a count beside a noun — and
  `verify:basecamp-affordance` correctly called it something that looks
  pressable and is not. It is `Done (2)` and an `h4` now.

**7. Card Table — VERIFIED.**
- **Measured rather than squinted at:** the miniature's column names were
  **10.5px** and the expanded board's card meta **11.5px**, against a stated
  12px floor. `verify:ui` enforces that floor only on the surfaces it walks and
  the Card Table was never one of them. Ten declarations raised across
  `compose.css`; a floor applied selectively is not a floor.
- The miniature's layout was already deliberate — `auto-fit` with a 128px
  minimum, so the pane decides how many columns rather than a number in the
  stylesheet. No clipping and no sideways overflow at 1600, 1200 or 390.
- Miniature cards now carry `data-bc-card` and `draggable`, and mini columns
  carry `data-bc-drop` — **the full board's own attributes**, so the existing
  wiring moves them. One mechanism on two surfaces.
- A drag no longer opens the card: the click that follows `dragend` is
  swallowed in the capture phase. Without it, dragging a card moved it and then
  opened it, so the board you were arranging vanished behind a record.
- `verify:basecamp-cards` 24/24.
- **The gate caught two things I had broken:** the journey suite still asserted
  the completed-work DRAWER (the defect itself, written down as a requirement),
  and my new sign-in field was 42px on eight surfaces — under the 44px floor.

**6. Panel resizing — VERIFIED.**
- **The cause:** `place()` clamped the new rectangle and handed it to
  `compact()`, whose only tool is vertical. A panel widened by one column shoved
  its neighbour onto a row of its own.
- A `squeeze()` step now negotiates horizontally first: a neighbour sharing the
  row gives way by shrinking, and only what still cannot reach its own minimum
  width is left for `compact` to move down — which is the one case Grant says a
  row change is right.
- **The first version passed the problem along:** it moved the neighbour
  rightwards keeping its width, so with three panels on a row the THIRD was
  shoved off instead of the second. Holding the neighbour's RIGHT edge and
  shrinking from the left means nothing beyond it moves at all.
- 7 new unit tests including two property tests (no width below its minimum, and
  no overlap, at every width from 3 to 12 columns), plus a real pointer drag in
  `verify:basecamp-torture`: the neighbour shrinks, stays on the row, nothing
  overlaps, and the panel beyond it does not move by a pixel. 30/30.
- **Two wrong findings of my own:** a drag of 180px that the panel absorbed as
  empty space (so the neighbour had no reason to give way), and a drag halfway
  across the neighbour, which asserted "shrinks" and "stays on the row" at a
  width where only one can be true.

**5. Contacts — VERIFIED. Three defects, three different causes.**

1. **The scroll jump was two defects stacked.** With a contact open there were
   EIGHT contact rows in the document — four in the dialog and four on the
   surface still rendering behind it — so half the presses landed on a copy the
   backdrop swallowed, and the wheel scrolled the PAGE rather than the dialog.
   The surface behind is `inert` while a dialog is open and the page is locked,
   so the wheel goes where the content is.
   Then the real jump: `render()` replaces the shell, so the dialog that comes
   back is a NEW element with `scrollTop` 0. The position is remembered on
   every scroll and restored after the redraw — **and restoring it during
   wiring silently did nothing**, because setting `scrollTop` on a box whose
   content has not been laid out yet clamps to zero. One frame later it takes.
2. **The miniature passed the row's INDEX** ("0", "1") while everything that
   opens a contact looks one up by `contacts.keyOf`. The lookup found nobody
   and the record fell back to the list — which is exactly "it merely maximises
   the Contacts panel". One key now, from one place.
3. **No face at all** in the miniature. A photograph where there is one,
   initials on a tint where there is not.
- `verify:basecamp-contacts` 31/31, and the scroll-memory check proved able to
  fail by restoring zero instead of the remembered position.
- **A defect I introduced and caught in the same minute:** marking the surface
  inert UNCONDITIONALLY made the whole page unclickable whenever no dialog was
  open. The suite reported it within seconds.

**4. To-dos — VERIFIED.**
- **The cause:** a completed task was moved into a `<details class="bcdone">`
  drawer that is CLOSED by default. Ticking something therefore removed it from
  where it was and left a summary line reading "1 completed task". That is
  exactly "clicking a to-do makes it unexpectedly disappear".
- Done work now stays where it is, after the open work, under a quiet "N done"
  heading, struck through and dimmed with its box ticked.
- **A second, latent defect found on the way:** the row asked
  `t.state === 'done'` while the list split asked
  `(t.state_raw ?? t.state) === 'done' || state_raw === 'cancelled'` — two
  predicates for one question, so a row could sit under the done heading
  without wearing the done state. One predicate now, used by both.
- The completion target is 44x44 on desktop and phone, and its centre
  hit-tests to itself.
- `verify:basecamp-todos` 30/30, and the target check proved able to fail by
  shrinking the hit area to 20px.
- **Three false findings of my own, all caught before being believed:** the
  hit test reported every target below the fold as "covered"
  (`elementFromPoint` is null outside the viewport), then every row scrolled
  out of its own pane as "covered" (clipped is not covered), and the
  persistence check asserted the drawer's old wording rather than the tick.

**3. Live voice — VERIFIED (except OpenAI itself).**
- Same root cause as Chat: `call.js` reads the same `hq.token`, so with none its
  `look_up` and `ask_the_team` calls came back 401 and Claire said
  "unauthorized" out loud. Both paths now clear the token and say a sentence,
  and a call started while signed out SAYS SO before connecting rather than
  failing on every tool.
- **A real layout defect, found by measuring rather than looking:** the call's
  status line was `flex-basis: 100%` inside the actions row, so the moment the
  call said anything, Chat with Team slid 309px sideways and the project menu
  dropped onto a new row. Out of flow now; every control's box is identical
  before and while the call is up.
- Taking it out of flow then made it COVER the panel's Mute and End — the way
  an absolutely positioned element goes wrong — which the same check caught in
  the same run. The head's line now stands down while the panel is up, so one
  place says what the call is doing.
- Red inactive / green live, asserted as computed colours rather than class
  names.
- `verify:basecamp-livevoice` 29/29, with real WebRTC and a loopback peer.
- A flaky check of my own was fixed properly: three state assertions used fixed
  sleeps against a 400ms repaint poll, so they passed or failed depending on
  what else the run had done first. They wait for the state now.

**1. Settings access — VERIFIED.**
- Measured at 5 viewport/auth states before and after; 44x44 minimum everywhere,
  119px wide with the word from tablet up.
- Pressed at desktop and phone: the menu opens, holds 6 items, and *Project
  settings* navigates to `/basecamp/p/<slug>/settings`, which renders the real
  pane ("Project Settings … Team / Automations / Labels / Project").
- `verify:basecamp-settings` 24/24 with three new checks.
- **The redraw check was proved able to fail**, and its FIRST version could
  not: it dispatched a resize, which redraws nothing here, so it passed against
  a deliberately broken build. Replaced with a real redraw through a hook
  exposed beside the existing capture hooks; the sabotage then turned it red.

**2. Chat — VERIFIED.**
- `verify:chat-live` 7/7 **against the deployed endpoint**: a real message, a
  real answer, and the answer names a project that is really in the database —
  so a canned string could not pass it. A wrong token and no token are both
  refused.
- `verify:basecamp-chat` 19/19 in a browser: no token offered a sign-in; a
  refused token says so and is not kept; the right one signs in, clears the
  field and dismisses the strip; the Send button sends and the answer appears;
  Enter sends; Shift+Enter makes a newline and sends nothing; a token that goes
  stale mid-conversation is explained in words rather than as "unauthorized"
  and is cleared.
- Two harness defects of my own on the way, both found and fixed rather than
  believed: a stub that answered every read with an empty project list (which
  emptied the studio and looked like a missing Chat button), and a payload with
  no crew that left no current project.
