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
- [ ] **TODO** "unauthorized" — trace and repair the auth/session path
- [ ] **TODO** A voice session can actually be established
- [ ] **TODO** Pressing the voice button moves nothing around it
- [ ] **TODO** Inactive = red, active/listening = green
- [ ] **TODO** State changes cause no layout movement

### 4. To-dos
- [ ] **TODO** Completing a to-do must not make it disappear
- [ ] **TODO** Completed items stay visible with a clear done state
- [ ] **TODO** The completion click target is reliable and whole
- [ ] **TODO** State persists across reload

### 5. Contacts
- [ ] **TODO** Full-screen contact scrolls without jumping back to the top
- [ ] **TODO** Miniature entries show the contact photograph, with a fallback
- [ ] **TODO** Clicking a miniature contact opens THAT contact
- [ ] **TODO** Clicking the panel title maximises the whole Contacts view

### 6. Panel resizing
- [ ] **TODO** Widening one panel shrinks its neighbour rather than shoving it away
- [ ] **TODO** Minimum and maximum sizes respected, no overlap
- [ ] **TODO** A panel only moves to another row when both cannot fit at minimum width

### 7. Card Table
- [ ] **TODO** Miniature rendering designed deliberately, not a shrunken full view
- [ ] **TODO** Expanded rendering: sizing, spacing, clipping, overflow, typography, responsive
- [ ] **TODO** Miniature cards drag/reorder deliberately and stably
- [ ] **TODO** A drag does not open the card
- [ ] **TODO** Ordering persists after reload where intended

### 8. Docs & Files thumbnails
- [ ] **TODO** Audit the file/document types and the thumbnail paths
- [ ] **TODO** Fix broken, missing, distorted, wrongly sized previews
- [ ] **TODO** Deliberate fallback where no genuine thumbnail can be made
- [ ] **TODO** Verified with several real file types

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
