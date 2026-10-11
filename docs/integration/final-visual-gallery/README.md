# INNERGY Agentic Team HQ: visual gallery, release candidate (11 October 2026)

Branch `integration/dashboard-polish-release-candidate`; page code as of commit `422ba454bfcfa1446c8fd55b491eb25f1352580e` (later commits on the branch change only tests and documents). 254 images. New since the previous gallery: the area **New in this release: populated states** (To-dos, Contacts, Activity, Calendar, Documents, the Appearance pane and the edge colour mode, drawn with realistic fixtures), the touch-target fixes to the calendar, and everything the dashboard-polish work changed in the other areas.
Open `index.html` (published as an isolated static site; see the commit message for the address in use).

**One desktop size (1440x900) and one phone size (390x844), Light and Dark, Original look.** Four images per screen: Desktop Light, Desktop Dark, Mobile Light, Mobile Dark.
The phone images are Chromium touch emulation, **not iOS Safari**. Nothing is edited: files are exactly what the browser wrote.

| Path | What |
|---|---|
| `index.html` | the gallery: jump menu by area, Size (All / Desktop / Mobile) and Theme (Both / Light / Dark) filters, Light and Dark side by side, tap to enlarge, swipe between images, pinch to zoom |
| `manifest.json` | one record per image (screen, theme, look, viewport, state, source, commit) and the NOT CAPTURED list |
| `thumbs/` | the reduced JPEGs the index shows (committed) |
| `screenshots/` | the original PNGs. Not committed (size, git-ignored); they are what the published site serves when you tap an image |

## Inventory

| Area | Screens |
|---|---|
| Dashboard and project workspace (with the consolidated top bar) | busy project board, long-name project board, home |
| Menus and navigation | burger menu / project selection, project three-dot menu, background picker, Jump |
| Chat | dock open (generated 90-message thread), widened dock, emulated soft keyboard on the phone |
| My Tasks and Search | My Tasks (70 items, repeating reminders), Search |
| Schedule | compact module, Day, Week, Month |
| Maximised modules | To-dos, Docs and Files, Contacts, Latest Activity, Schedule |
| Records and editors | task, contact and document record sheets, event editor, module colour menu and Layouts menu (desktop only) |
| Settings | index, Appearance (top and scrolled), Behaviour, Channels, Connections, Help, Memory, Models, Requests, Team |
| Dialogs and notifications | confirm, destructive confirm, ask-a-reason, undo bar (4 states) |
| Sign-in and onboarding | sign-in, create account, signed-out notice, set up your office |
| Empty and first-run | first run, empty board, empty To-dos, empty Schedule |
| New in this release: populated states | To-dos (priority, in-progress, done and label chips), Contacts (cards with only the fields each contact has), Activity (all records; Problems in the last 24 hours), Schedule (own and Google events, all-day, overlaps), Docs and Files (PDF page, picture, spreadsheet glyph, missing-file fallback, long title), the board in card and edge colour modes, a 100-character project name, Project Settings Appearance |

Sources (stated on every card): **local replica** (the real page and gateway code over an isolated Postgres replica with synthetic rows: 140 to-dos, 36 documents, 28 contacts, 12 events, 70 personal items)
and **local stand-in** (the real page against a near-empty stand-in office, used for sign-in, empty and dialog screens). The chat conversation is generated and presented by the page; the office cannot seed a stored one.

## NOT CAPTURED

Real iOS Safari; a real microphone; real data; the hosted staging preview signed in; the Attention page (it needs waiting items); the module colour menu, Layouts menu and sticky notes on a phone (not offered there by design);
OS push notifications; other looks, accents and screen sizes (the earlier gallery had them).

## Visual review: what the images show

Defects found by looking at the integrated images in the dashboard-polish passes and fixed (each has a check): the Appearance pane stripped the page's margins and surface on a phone (its live sample reused the board's class); the minimised calendar's day cells were 20px tall with overlapping hit areas; the to-do cards did not answer the pointer; the contact rows aligned their label to the last line of a wrapped link; four canvas tool buttons had no accessible name. Stand-ins are named on every card: the activity severity and the Google events in the new area are added at the browser boundary because the office stores neither here.

Defects found and fixed in the earlier aesthetic pass (genuine, small):
1. **Opening the chat widened the top bar's problem**: with the dock open or widened the bar is narrower than the window and its tools overlapped (Chat with Team over the zoom control). The bar now answers to its own width: one row when the chat is at its default width (so opening the chat does not move the board), two rows when it is widened.
2. **My Tasks on a phone**: a title that wrapped to several lines overlapped the date line under it (a negative margin made for one-line titles). Fixed.

Still visible, not changed (judgement calls, not defects):
- The bright yellow sticky note is the strongest colour on every desktop board, in both themes.
- Blank white document thumbnails ("Venue contract") are the brightest pixels on a dark board.
- On a phone the maximised To-dos sheet opens on "Showing yours" and so reads empty beside "99+ open" for a person with nothing assigned; "Show everything" is one tap away. The desktop sheet opens on everything.
- The phone counters row ("0 need you 56 late 0 stuck") is tight at 390 px and scrolls rather than clipping at narrower widths.
- The calendar's Day view opened on 20 October, not today (10 October), after the month view had been used.
- Synthetic data repeats ("Contact 11" before "Contact 2", identical task titles); that is the data, not the product.

## Regenerate (local, no production)

```
unset SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL
bash scripts/isolated/replica.sh      # then: createdb bq template post (drop it first if it exists; rebuild it before every populated run)
npx tsx scripts/isolated/stress-browser.ts bq --only=1440,390 --shots=.out/g2/populated
npx tsx scripts/isolated/stress-browser.ts bq --only=1440,390 --gallery --shots=.out/g2/gx
npx tsx scripts/isolated/populated-acceptance.ts bq --shots=.out/g2/acc      # the new populated-state area (rebuild bq first)
WRITER=1 DEVICES=desktop1440,phone390 ONLY=records,dialogs,toasts,writer,empty,auth OUT=.out/g2/lab npx tsx scripts/verify/surface-lab.ts
npx tsx scripts/gallery/build-gallery.ts .out/g2 <commit>   # then make thumbs, assemble the site folder and run: GALLERY_DIR=<folder> npm run deploy:gallery
npx tsx scripts/gallery/verify-live.ts <url>
```
