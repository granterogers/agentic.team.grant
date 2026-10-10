# INNERGY Agentic Team HQ: complete visual review gallery, 10 October 2026

Branch `integration/aesthetic-release-candidate`, page code at commit `7beac4e7df348e3c9030e02fc219849af20b28e0`. Open `index.html`.
This is a visual-review package, not a development change: the product code is untouched (`web/` is byte-identical to the commit above). Nothing was merged or
deployed, and production was not contacted.

## What is in the package

| Path | What |
|---|---|
| `index.html` | the gallery: a navigation index by interface area, Light and Dark side by side for the same screen, data, size and state, a switch between all sizes / desktop 1440 / phone and tablet sizes, click an image for the full-resolution PNG |
| `manifest.json` | one record per image (screen, scheme, look, palette, viewport, device, state, source, data kind, commit, file) and the NOT CAPTURED list |
| `screenshots/` | the **original, unedited** PNGs exactly as the browser wrote them (316 files, 65 MB). **Shipped in the ZIP, not committed to git** (size); regenerate with the commands below |
| `thumbs/` | 316 reduced JPEG thumbnails the index shows (640 px wide for desktop and tablet sizes, 220 px for phones). Derived images, for browsing only; judge pixels in `screenshots/` |

File names say what they are: `<area>__<screen>__<replica|standin>__<WxH>__<light|dark>__<look>-<accent>.png`.

## How the images were made (and what is behind them)

All images are real Chromium screenshots of the real page (`web/studio`) served locally. No mock-ups, no recolouring, no cropping and no retouching; the script
that builds the gallery only copies and labels. Two sources, stated on every card:

- **Local replica** (178 images): the real page, and the real `hq-api` and sign-in function code, answering from an **isolated Postgres replica** holding
  **synthetic rows**: six projects (one with a 100-character name), 140 to-dos on the busy project, 12 events, 36 documents, 28 contacts, 70 personal items with
  repeating reminders. The replica is real SQL and real code, not real data. The **chat conversation (90 messages) is GENERATED** and presented by the page; the
  office cannot seed a stored conversation, so every chat card says so.
- **Local stand-in** (138 images): the real page against the lab's stand-in gateway (one near-empty project) or the signed-out prototype. Used where the replica
  run does not reach a screen: sign-in, create-account, set-up-office, first run, empty states, dialogs, undo bar, new-project form, event editor, popovers.

Sizes: **1440x900** desktop and **390x844** iPhone-size are the main gallery; 360x740, 430x932, 768x1024 and 844x390 (landscape phone) are extras for five
screens. **All phone and tablet images are Chromium touch emulation. None is iOS Safari.** Themes: Light and Dark with the Original look and the Blue accent
(`slate` palette) for every pair. Looks Slate & Silver, Forest & Brass and Warm Graphite, and the Violet accent, are shown for the main dashboard and Settings
(Appearance and index) only, as asked.

## Inventory (screens x images)

| Area | Distinct screens | Images |
|---|---|---|
| Dashboard and project workspace | 5 | 20 |
| Menus and navigation (burger / project selection, page menu, background picker, Jump, new project) | 6 | 24 |
| Chat (dock open with a 90-message generated thread; emulated soft keyboard on phones) | 2 | 6 |
| My Tasks and Search | 3 | 12 |
| Schedule (compact, Day, Week, Month) | 4 | 16 |
| Maximised modules (To-dos, Card table, Docs and Files, Contacts, Activity) | 6 | 24 |
| Records and editors (task, contact, document, event editor, popovers, note) | 7 | 22 |
| Settings (index, Appearance top and scrolled, Behaviour, Channels, Connections, Help, Memory, Models, Requests, Team, Project settings) | 12 | 48 |
| Looks and palettes (3 other looks and Violet; dashboard, Settings index, Appearance) | 11 | 44 |
| Dialogs and notifications (confirm, destructive confirm, ask, undo bar x4) | 7 | 28 |
| Sign-in and onboarding (sign-in, create account, signed-out notice, set up office) | 4 | 16 |
| Empty and first-run | 4 | 16 |
| Responsive extras (360, 430, 768, 844x390) | 5 | 40 |

## NOT CAPTURED (with reasons)

| Item | Reason |
|---|---|
| Real iOS Safari | no WebKit or iPhone here; every 390 image is Chromium touch emulation |
| Real microphone, dictation, live voice in use | no audio hardware; buttons and idle states only |
| Hosted preview signed in, Sample Office on the hosted preview | the hosted preview cannot sign in; that is why this gallery exists |
| Real Grant data, real Google calendar, Telegram, Slack | production access is forbidden for this task; data is synthetic |
| Event editor over the populated replica | that capture failed and is not included; the editor is shown from the stand-in office |
| Task, contact, document record sheets on the stand-in; the Attention page | the stand-in has no records; the Attention page did not open in the lab. Record sheets come from the replica |
| Module tint and layouts popovers and sticky notes on a phone | not offered on a phone by design |
| Full-page / long-scroll captures | the page is a fixed-viewport canvas (ADR-0072): lists scroll inside their module or sheet; lists are shown through the maximised views. Settings Appearance is shown scrolled to its end; other panes taller than a phone screen are cut at the viewport |
| Operating-system push notifications | not part of the page; the in-page undo bar and dialogs are captured |
| Other looks beyond the dashboard and Settings | deliberately limited, as asked |

## Visual concerns found by looking at the captures

Read from the images, not from the code. Each is a judgement for you; none was changed in this task.

1. **Bright yellow sticky note** is the strongest colour on the board in both themes; on Dark it is the one saturated light patch (dashboard, every look).
2. **Pure-white document thumbnails in Dark** (for example "Venue contract", the blank white page tile in Docs and Files) are the brightest pixels on a dark board.
3. **Light theme is a mid grey-beige canvas with near-white panels**; the contrast between canvas and panel is soft and panel edges rely on a thin shadow, which
   reads weak on the My Tasks page and the sign-in card. There is no pure-white page in Light, but the stone canvas can read dull rather than harsh.
4. **Record sheets (task, contact, document) fill the viewport and are mostly empty** on desktop, especially the task sheet in Dark: a large dark slab with a small
   form top-left.
5. **Background picker on a phone**: the first swatch label breaks mid-word ("Microceme / nt").
6. **Maximised To-dos on desktop and the board's To-dos column** truncate long titles with an ellipsis while the Card table repeats the same truncated text; with
   the synthetic data the screens read repetitive (that is the data, not the product).
7. **Contacts order** shows "Contact 1, Contact 11, Contact 12, Contact 13": synthetic names sorted as text; not a visual defect.
8. **Chat on Light**: user bubbles are saturated blue against the stone panel, the agent bubbles are pale; the contrast between the two is strong, between the
   agent bubble and the dock background weak.
9. **The dashboard header on a phone** shows the project name truncated ("Riverside launc…") beside four controls.
10. Looks other than Original were captured only for the dashboard and Settings; Forest & Brass and Warm Graphite in Dark read well in those two screens, but
    every other screen is unseen in those looks.

## Verification of this package

- Every image was produced by the commands below against commit `7beac4e7`; the labels come from the capture that wrote the file, not from the file name.
- Light/Dark labelling was checked by measuring mean luminance of every image (all 316: Light above, Dark below the expected band, 0 mismatches), and a sample of
  about fifteen images was opened and read against its label (including the schedule on a phone, which was re-captured after the first pass showed the To-dos
  module under a "Schedule" label).
- `npx tsx scripts/gallery/verify-gallery.ts` opens `index.html` at 1440 and 390 px: 316 images, all load, no failed request, no horizontal overflow.
- One capture pass contaminated its own later runs and was repeated: pressing an accent colour in Settings is **saved to the account**, so a Violet press in the
  Dark run turned the next Light run Violet and Dark. Accent variants now come from a separate run seeded through storage (`--palette=paper`), and the replica
  database was rebuilt before each affected run.

## Commands that regenerate the captures (local, no production)

```
unset SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL
bash scripts/isolated/replica.sh                                   # once; then: createdb bq template post (drop first if it exists)
npx tsx scripts/isolated/stress-browser.ts bq --only=1440,390 --shots=.out/g/populated
npx tsx scripts/isolated/stress-browser.ts bq --only=1440,390 --gallery --shots=.out/g/gx
npx tsx scripts/isolated/stress-browser.ts bq --only=1440,390 --gallery --look=silver --shots=.out/g/look-silver   # also forest, graphite
npx tsx scripts/isolated/stress-browser.ts bq --only=1440,390 --gallery --palette=paper --shots=.out/g/pal-paper
WRITER=1 DEVICES=desktop1440,phone390 ONLY=pages,menus,settings,records,modules,popovers,dialogs,toasts,writer,empty,auth,chat OUT=.out/g/lab npx tsx scripts/verify/surface-lab.ts
WRITER=1 DEVICES=phone360,phone430,tablet768,phone390land ONLY=pages,menus,settings OUT=.out/g/resp npx tsx scripts/verify/surface-lab.ts
npx tsx scripts/gallery/build-gallery.ts .out/g <commit>           # copies, labels, writes manifest.json and index.html
npx tsx scripts/gallery/verify-gallery.ts
```

Run each long command on its own (each takes 4 to 6 minutes); rebuild the `bq` database before every populated run that follows one that pressed a Settings control.
