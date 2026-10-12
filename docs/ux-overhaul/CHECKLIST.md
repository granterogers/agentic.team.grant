# Team HQ UX overhaul: durable checklist

Branch: `claude/busy-darwin-21mr9n`. Production page: `ai-team-hq.vercel.app`.

## Release-gate analysis (established 12 October 2026)

- **A1 (Activity Ledger human SQL review)** is defined in `docs/activity-ledger/APPROVAL-REQUEST.md` and gates the
  ledger's migrations `1060` to `1062` and everything after them (A3 to A5). It is scoped to the Activity Ledger.
  It does not cover `web/studio` CSS or JavaScript, and nothing in the frontend release depends on those migrations.
- **Production page bytes (checked against the live site):** the live `studio.css` equals `main`. The live `app.js`
  does not equal `main`. `main` carries dormant Activity Ledger page code, so deploying `main`'s page would ship
  ledger UI. Frontend release therefore uses the staged-tree method (`scripts/deploy/hq-page-delta.ts --root=...`):
  live bytes plus this branch's frontend delta only, with no ledger code.
- **Deploy authority:** `deploy:hq-page` writes production, so it runs only with `ALLOW_PRODUCTION_WRITES=1` and
  `ALLOW_PRODUCTION_CHECKS=1` set by a person for this named write. Provenance (ADR-0067) needs a clean tree and a
  pushed commit.

- **Branch protection:** the GitHub API returns 403 ("Resource not accessible by integration") for
  `repos/granterogers/agentic.team.grant/branches/main/protection` from this session, so the rule set could not be read.
  `.github/workflows/ci.yml` has no push, pull-request or schedule triggers (removed 8 September, see the file header), so no
  Actions check gates a merge. Recorded as a fact; the merge itself still needs the repository owner's approval path.

## Session 12 October 2026: what was verified

Verified in Chromium (scripts/verify/probe-*.ts, screenshots in .out/probe):
- Colour scheme on `/`: Light, Dark and Device correct in six cases, zero page errors.
- Global Settings Back and Forward: four verdicts true, zero page errors.
- Schedule toolbar: stable in Day, Week and Month at 1440 px.
- Card Table: 550 px at 1440 px in the Overview preset (was 417 px in the chat-open capture; the drawer narrows it).
- Team Chat: avatar on the name line, full-width bodies at 1440 px.

Not yet verified: any phone width for the changes above, the sliders (M6), textures (M5), the look sheet, drag and resize (M11),
the landing page (M4), document thumbnails (M15), Team Settings controls (M10), the hamburger module navigation (M13), and the
settings-sheet transitions (M7).

## Milestones

- [x] M1. Slate & Silver default; Original removed from `LOOKS`; saved `original` migrates to `silver`
      (`web/studio/appearance.js`, `tests/web/looks.test.ts`).
- [ ] M1b. Remove Original-specific base styles from the chrome (tokens.css / skins.css fallback values).
- [~] M2. Light / Dark / Device as three real modes. Phone verified (VIEW=phone, 6 cases, 0 errors). VERIFIED on `/` (scripts/verify/probe-scheme.ts, 6 cases, 0 page errors, screenshots in .out/probe): Light is light, Dark is dark, Device follows the OS both ways. The earlier 'Light looks dark' capture came from /classic/ (the shots harness loads it). Still open: no-flash-on-load proof and the segmented control's stored state after a reload.
- [~] M3. Solid buttons: removed the stacked gradient from .btn, .btn.primary (studio.css) and the basecamp primary overlay (bc/refine.css). Verified by screenshot. Still open: tertiary and destructive variants and the remaining gradients in studio.css (about 45 non-button gradients to review).
- [~] M4. Landing and sign-in (`/?welcome`, scripts/verify/probe-entry.ts, light and dark, 1440 and 390 px, 0 page errors). FIXED: the Sample Office box had a gold outline (--bc-section-accent) and the TEAM HQ kicker used the warm heading brown; both now use neutral and accent tokens. Buttons are solid, not gradient. Kicker contrast about 5:1 or better in both schemes. Open: a full pass on the sign-in tabs and the create-account flow (not driven), and the 'Email me a sign-in link' path, which needs a real mail send.
- [x] M5. Textures VERIFIED: all 15 presets apply a distinct background (Microcement is the built-in default art, so it reads as no override). Restore default resets to the default. Upload path VERIFIED (scripts/verify/probe-backdrop.ts): a real picture becomes 'Your picture', Apply enables, the board shows it as a pending custom background (bg custom), Cancel restores the saved walnut. Apply with an upload and its persistence are not yet verified (signed-in path). Phone not probed.
- [x] M6. Sliders VERIFIED (scripts/verify/probe-backdrop.ts, desktop 1440): keyboard moves Opacity (veil 30%->40%), Scale (tile 1024px->922px) and Shade (gradient appears at 10%); pointer drag on Opacity 0.6->0.95 moves the veil to 5%; output labels update. Touch uses the same native range input (not separately driven). Cancel reverts uncommitted changes. Apply persists across reload in the unsigned prototype (browser storage). Open: signed-in server persistence needs a writer (Sample Person) test; phone not probed. Wiring located: `bc/backdrop-ui.js` (range() at ~line 94; handler ~line 184; `--bc-bg-veilp` and `--bc-bg-shadep` set in previewCustom). Reached through the look sheet (`lookSheet` in app.js, opened by `openLook`). Not yet probed in a browser.
- [~] M7. Motion VERIFIED on open (scripts/verify/probe-motion.ts): Team Chat drawer slides in from +18px and fades over ~260 ms; Global Settings rises 8px and fades over ~220 ms; both are still under reduced motion (transform 'none' throughout). Added in bc/polish.css, which also covers the document viewer. Open: close transitions, appearance and project-settings sheets (not yet sampled), and the stable-dialog requirement (dialog position under slider changes, not yet probed).
- [x] M8. Browser Back / Forward across Global Settings. Phone verified (VIEW=phone probe-history: 4/4 verdicts, 0 errors). FIXED: opening pushed no history entry, so Back left the app. Now one entry (settings: true); Back closes, Forward reopens, the page's Back button matches Back. `scripts/verify/probe-history.ts`: 4/4 verdicts, 0 page errors. Still open: Escape-key close path and project-context restore after Back (not probed).
- [x] M9. Global Settings. The top-right three-dot control now reads Global Settings (title and accessible name), distinct from Project Settings. It was already a direct control; a dropdown menu was not built.
- [~] M10. Team Settings, audited against the real contracts (scripts/verify/probe-team.ts, 1440 px, 0 page errors).
  Exists and maps to a contract: name, role, pronouns, responsibilities, subject words, how they write (`hq_staff_update`); stand down and put back on (`hq_staff_retire`, chief of staff protected); Telegram bot; tool permissions (`hq_staff_tool_set`). Saving needs a signed-in writer, so the save path is NOT yet verified here.
  Not offered, by design: a per-person model. Migration 0018 says staff deliberately have no model column and the router chooses per kind of work; the editor now says so in one line. Delegation ceilings are code (ROSTER_CEILINGS), not stored per person. Autonomy is set per project and tool (Autonomy and approvals). Not yet built: a read-only usage line from inference_usage per person, and a live status line in the editor.
- [~] M11. Canvas drag and resize VERIFIED on desktop (scripts/verify/probe-drag.ts): a module dragged by its header moved (+120,+60); its resize handle changed size (+60,+40) without moving it; a Post-it moved by its grip; five repeated 30px drags moved +154px (the extra 4px is the 6px alignment guide snapping to a neighbour, by design); all positions persisted across reload in the unsigned prototype. Open: zoom levels, touch, overlapping modules, Post-it resize.
- [x] M12. Card Table: FIXED at the real cause. The miniature's `auto-fit minmax(128px, 1fr)` fitted three columns in the module's ~510px card area, so Done wrapped. Minimum is now 106px (compose.css); at 1440 px the board shows four columns in one row (scripts/verify/probe-project.ts: columns 4, rows 1). The Overview preset width stays at 0.39. Phone and the open-chat case (board narrowed to ~417px) are not four columns and are recorded as open. Overview preset widened the board from 0.29 to 0.39 of the stage (layout.js). Measured at 1440: Not Started, In Progress and Stuck now sit side by side; Done still wraps beneath. Four readable columns need about 0.48, which would remove the starter Post-it strip that layout.test.ts requires, so this is a recorded trade-off, not a finished item. Open: horizontal scroll for narrow widths, and whether to accept a wider board with the starter note hidden on desktop.
- [ ] M13. Hamburger direct module navigation with maximised view and return to canvas.
- [~] M14. Team Chat: phone verified (probe-project chat, 390 px: avatars on the name line, full-width bodies). Inline avatars and full-width bodies DONE (bc/polish.css, dock messages; captured in Chromium at 1440: avatar on the speaker's name line, body full width). Still open: phone capture of the drawer, drawer open/close animation (M7), and the composer and voice path re-verified after the change.
- [ ] M15. Document thumbnails (PDF first page, images, markdown/text, spreadsheet, fallbacks).
- [x] M16. Calendar shell: fixed toolbar across Day / Week / Month. Phone verified (VIEW=phone probe-calendar: toolbarStable true, 0 errors). FIXED: the compact title wrapped in week view (a longer range), which grew the bar and moved the switch by 18px and New by 9px; the body also sized the module's height to its content. Now: one-line title with ellipsis, fixed bar height, the module fills its space (flex 1 1 0), and the bar is sticky. `scripts/verify/probe-calendar.ts`: switch at y 643 and New at y 606 in Day, Week and Month (toolbarStable true, 0 page errors). Desktop measured; phone not yet measured.
- [ ] M17. Real-browser regression tests and screenshots (1920, 1440, tablet, 390) for each milestone.
- [ ] M18. Independent review pass (functional, visual, regression and security) with evidence per criterion.
- [ ] M19. Merge to `main` (requires branch-protection and review checks to pass).
- [ ] M20. Staged-tree production deploy, then production verification of the intended commit.

## Verification log

- M1: `npx vitest run tests/web` (16 files). Result recorded in the commit message.
