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
- [x] **VERIFIED** Colour: six, chosen per project, drawn on the project head
- [x] **VERIFIED** Picture: your own image, and a way back to the generated art
- [x] **VERIFIED** Mark: 451 icons, searchable, by domain
- [x] **VERIFIED** Per-project, not global — two projects hold two looks at once
- [x] **VERIFIED** Persists: `hq_project_look` writes and clears all three, proved against the office
- [x] **VERIFIED** Reachable from Project Settings as well as the three-dot menu

### 10. Header space
- [x] **VERIFIED** The legacy project title area is gone; the mark moved to the top bar with the name
- [x] **VERIFIED** The purpose sentence is gone from the project home
- [x] **VERIFIED** The task counts left the header for the to-dos surface, still as filters
- [x] **VERIFIED** The board begins at 205px rather than 283px (desktop) and 217px rather than 281px (phone)

### 11. Final reconciliation
- [x] **VERIFIED** A fresh end-to-end browser pass of the Project page, all ten in one session
- [x] **VERIFIED** Every item above reconciled against what the pass actually saw
- [x] **VERIFIED** `basecamp:gate` green end to end, and the two new suites are IN it

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

**Deployed, and the sandbox's browser taught to reach the real world.**

*The deploy.* `npm run deploy:preview` from HEAD `36cfebb`. It targets
`agentic-team-hq-basecamp`, which is NOT the production `ai-team-hq` project —
production is not reachable from that script by design. Verified by HASH, not by
loading it: every one of the **84 files** the deploy uploaded was fetched back
from the alias and its sha1 compared with the local file. **84/84 identical**,
and the served `bc/miniatures.js` is byte-identical to the working tree's and
carries this commit's `faceFor`. Alias:
`https://agentic-team-hq-basecamp-agentic-team-grant.vercel.app`.

*The browser could not reach the internet, and it was never a policy.* Every
report until now said a signed-in browser check "cannot be verified here". The
cause: outbound HTTPS goes through an agent proxy that re-terminates TLS, and
while Node, curl and git are configured for its CA, **Chromium reads the NSS
database at `$HOME/.pki/nssdb`, which existed and was EMPTY** — `nssPublic`
held zero rows — so every browser request to a public origin died
`ERR_CERT_AUTHORITY_INVALID` while the identical request from Node succeeded.
The system store was correct all along; the browser's was not.

`npm run trust:proxy-ca` writes the sandbox's own CA chain into that store with
`certutil -t "C,,"`, and is idempotent. **Nothing was weakened.** No
`--ignore-certificate-errors`, no `ignoreHTTPSErrors`, no application change, no
production exception — and the control says so: after the fix,
`expired.badssl.com`, `self-signed.badssl.com` and `wrong.host.badssl.com` are
**all still refused** while the real origins answer. The browser trusts the
proxy; the proxy validates upstream.

*What that bought.* `verify:basecamp-live`, new, **17/17 against the deployed
page signed in to Grant's real office** — a whole class of verification that
was previously reported as impossible:
- the page is the prototype without a token, and says so;
- signing in with the vault token clears the strip and shows material only the
  real office has;
- **CORS on `voice-token`, from the real deployed origin** — the one thing a
  server-side probe can never test, and CLAUDE.md records the voice call being
  dead for weeks for exactly this reason. It mints a real credential, not a
  degraded answer, and **a page on another origin is refused**, which is the
  control that matters because that endpoint takes no authentication;
- the gateway answers this origin with the office token, no remote image is
  broken, every document tile drew something.

**Control:** the same flow with a wrong token leaves the strip up, says *"The
office did not accept that token"*, and does not keep the credential — so the
live checks are not passing vacuously.

*Four findings in that suite's first runs, and all four were my harness, not
the product.* A four-second wait that was enough locally and not against the
real office; a "shows a real project" check that passed while the page was
still showing invented data, because the prototype has a project called
*Legacy Coaching Course* and so does his office; `client_secret` read as an
object when it is a string; and `includes('degraded')` matching the word in the
KEY LIST rather than the flag — a substring satisfied by a superstring, which
this repository already has a rule about. **Validate the test before believing
the finding**, four times in one suite.

*And one honest boundary in the data.* **Not one approved document in the live
office has a file behind it** — all 75 are connector records from NotebookLM,
Notion and uploads whose text lives in the row. So no thumbnail on the real
product can paint a first page today, and the drawn page is the correct answer.
Item 8's face derivation matters for files uploaded from here on; it changes
nothing about what he sees today. The suite says this rather than failing.

*Two integration legs that the unlock closed, on top of that.*

**The chat path from the real deployed origin.** `verify:chat-live` already
proved the endpoint from Node; what Node cannot prove is that the deployed page
can reach it, because a script sends no `Origin`. The same request now runs
from inside the page: it answers over CORS, the answer is a real sentence, it
**names a project that is really in the database**, and `did === 'answered'` is
asserted — so the office answered from its own state and **the suite can never
leave work in Grant's queue**.

**How a project looks, written through the real picker.** Item 9's last gap:
everything had been verified against the prototype and against the office
separately, and a PRESS had never changed a real row. It does now — a colour
chosen in the picker on the deployed page, polled at the OFFICE rather than
trusted from the optimistic redraw, and then **put back exactly as it was**
through the sanctioned writer, with the restore asserted and confirmed
independently afterwards. The subject is `ai-team-hq-test`, by name; his live
project was not touched.

`verify:basecamp-live` is **25/25**. It is deliberately NOT in `basecamp:gate`:
it needs a current deploy, the vault and the network, and a gate that depends
on a deploy being fresh is a gate that goes red for the wrong reason. It runs
after a deploy.

**Still pending, deliberately: the physical live-voice test.** A real
microphone, a real spoken exchange, on a real device. Everything up to it is
now verified — the credential is minted for the real origin — but nobody has
spoken to it.

**11. Final reconciliation — VERIFIED.**
- `verify:basecamp-reconcile`, new and in the gate: **20/20**. One browser
  session, one visit, every item in the order a person would meet them — the
  header's height, the mark in the top bar, the project menu, the chat sidebar
  (Shift+Enter makes a newline, Enter sends and empties the composer, the
  sidebar survives the send), the microphone (the layout does not move, the box
  is identical in every state, it says what happened), a to-do ticked and still
  there after a reload, the Card Table miniature's cards and columns, every
  thumbnail on the home, and a contact pressed by face.
- It exists because every other suite opens a fresh browser on ONE surface, and
  the interactions between fixes — a redraw that loses the dock, a tick that
  resets a filter, a call that moves the layout under a menu — only appear when
  one person does all of it in one visit. **Control:** breaking the dock's
  wiring turns two of its checks red.
- **Three findings in its first run, and two were the harness.** It looked for
  the sidebar as `.bcdock` when the studio calls it `#dock`, and it counted the
  sandbox's own TLS interception as failed requests: outbound HTTPS here goes
  through an agent proxy whose certificate this Chromium does not carry, so
  every avatar and every edge function fails with
  `ERR_CERT_AUTHORITY_INVALID`. That is the environment, not the page — and
  counting it would make every future run red for a reason no person will ever
  see. The pass now names and discounts exactly that, and reports how many it
  discounted rather than hiding them.

### What was NOT verified, and why
- **Nothing was tested against a signed-in deployed page in a browser.** The
  suites drive a local server with the prototype store, plus, where a backend
  is genuinely the subject, the deployed gateway or the database over the
  network (`chat-live`, and `basecamp-look`'s office leg). The sandbox cannot
  reach `*.supabase.co` from Chromium at all, so a signed-in end-to-end browser
  session is not available here — it is available to Grant.
- **Item 9's persistence is proved in the office, not through the picker's own
  press.** `hq_project_look` stores and clears a mark, a colour and a picture
  inside a rolled-back transaction, and the picker sends `p_slug` plus those
  arguments; the prototype has no backend, so pressing a colour in this
  environment correctly refuses rather than pretending.
- **Real media, a physical microphone and a real Drive account remain untested
  here**, as recorded in the earlier voice/contacts/Drive run. Unchanged by
  this pass.

**10. Header space — VERIFIED.**
- **Measured, not estimated.** Signed in, discounting the prototype strip a
  page with a token does not carry: the board began **283px** down the desktop
  and **281px** down a 844px phone. It begins at **205px** and **217px**. The
  header itself went from 151px to 73px, and 185px to 121px on the phone.
- Three things were stacked above the board and each repeated something
  already on screen. **The title**: the top bar's project chip names the
  project and is how you move between projects, so the page said the name
  twice, 173px apart. **The purpose**: a project-level fact restated at the top
  of every visit to the project's own home. **The task counts**: directly above
  a To-dos panel listing those same to-dos.
- **Nothing was merely deleted.** The project MARK moved up into the top bar
  beside the name, because a chosen colour, mark or picture is the project's
  identity and that title was its only appearance on this page — deleting it
  would have undone item 9 in the same commit. The task counts are FILTERS as
  well as counts, so they moved to the to-dos surface, where the to-dos are and
  where narrowing by them makes sense.
- **And one thing in that row was not redundant:** *"1 thing needs you"* is the
  team's finished work waiting to be read, not a to-do count, and nothing else
  on the home says it. `stateLine` was split into `needsYouLine` and
  `taskCounts` rather than deleted, so the header keeps the one and the to-dos
  surface gains the other.
- **Two defects I introduced and measured my way out of.** The mark rendered
  at **46px inside a 40px chip**, overflowing it — `.bcprojmark` is sized for
  the h1 it used to sit in. And it became `:first-child`, so the two rules
  written for the project NAME landed on the mark: the name lost its strong ink
  and its ellipsis. Both found by probing the computed box rather than by
  reading the capture; the name is `.bcjumpname` now, because a positional
  selector breaks the moment something is put in front of it.
- **A third, found in the phone capture:** the Card Table's counts took 226 of
  336px and squeezed its title to 44px, breaking it across three lines as
  `CARD TABL / E` and making the header 72px instead of 24px. The title holds
  its width now and the counts give way — a panel's name is the fixed point of
  its header.
- **And my CSS lost twice before it won**, which is this repository's oldest
  trap: every rule in this experience is prefixed `[data-experience='basecamp']`,
  so an unprefixed rule ties on specificity and loses on file order.

**9. Project appearance — VERIFIED.**
- **Almost all of it already existed and none of it was verified.** `lookSheet`
  holds six colours, 451 searchable marks and an image upload; it writes
  `app.hq_project_look`; the project head already draws `icon`, `iconHue` and
  `image`; and one of Grant's real projects already carries a mark and a colour
  chosen through it. So the work here was to prove the chain rather than build
  a second picker — which would have been two pickers writing three columns.
- **The one real defect: it had exactly one door.** The screen actually called
  *Project Settings* offered Export, Archive and a signpost to somewhere else,
  and said nothing about how the project looks. Somebody who went there to
  change the colour did not find it. A control nobody can find is a control
  they do not have — this experience already made that argument about the
  three-dot button itself. Project Settings now opens **the same picker**, not
  another one: one implementation, two doors, which is what the contact labels
  in that file already do.
- `verify:basecamp-look`, new, 20/20 — and two legs that are different claims:
  the page (the control is reachable from both doors, the picker is about THIS
  project by name, and the head draws the colour, the mark and the picture,
  falling back to the letter), and the office (`hq_project_look` stores a mark,
  a colour and a picture and clears them again, **inside a transaction that is
  rolled back**, because the subjects are Grant's real projects and a suite may
  not repaint them — the call is wrapped, not the assertion).
- **Controls:** removing the head's read of the chosen mark turns two checks
  red; removing the three-dot menu item turns the reachability check red;
  removing the Project Settings block turns two more red. Each sabotage printed
  a count first.
- **One wrong finding of my own, caught before it was believed.** The
  per-project check used `page.goto` between the two projects, which reloads
  and takes the seeded store with it — so it read each project's ORIGINAL
  colour and reported a working product as broken. It navigates through the
  studio's own router now, which is what pressing the project switcher does.
- `smoke` 0, `verify:wired` 0 (78 control attributes across 21 screens, no dead
  controls — the new button is looked up), lint 0, typecheck 0.

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
