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
- [ ] **TODO** The three-dot / settings control has disappeared — restore it
- [ ] **TODO** Accessible at relevant viewport sizes and workspace layouts

### 2. Chat with Team (BLOCKER)
- [ ] **TODO** Sending fails with "cannot reach the office / unauthorized" — find the real cause
- [ ] **TODO** A real message reaches the office and a real answer comes back
- [ ] **TODO** Enter sends
- [ ] **TODO** Shift+Enter makes a newline
- [ ] **TODO** The Send button still works
- [ ] **TODO** Opening Chat still uses the sidebar

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

(appended as the run proceeds)

## Verification log

(appended as the run proceeds)
