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

## Milestones

- [x] M1. Slate & Silver default; Original removed from `LOOKS`; saved `original` migrates to `silver`
      (`web/studio/appearance.js`, `tests/web/looks.test.ts`).
- [ ] M1b. Remove Original-specific base styles from the chrome (tokens.css / skins.css fallback values).
- [~] M2. Light / Dark / Device as three real modes. VERIFIED on `/` (scripts/verify/probe-scheme.ts, 6 cases, 0 page errors, screenshots in .out/probe): Light is light, Dark is dark, Device follows the OS both ways. The earlier 'Light looks dark' capture came from /classic/ (the shots harness loads it). Still open: no-flash-on-load proof and the segmented control's stored state after a reload.
- [~] M3. Solid buttons: removed the stacked gradient from .btn, .btn.primary (studio.css) and the basecamp primary overlay (bc/refine.css). Verified by screenshot. Still open: tertiary and destructive variants and the remaining gradients in studio.css (about 45 non-button gradients to review).
- [ ] M4. Landing and authentication redesign (light and dark, desktop and 390px).
- [ ] M5. Background textures: every preset visibly applies; Apply / Cancel / Restore default; upload path.
- [ ] M6. Scale, opacity and shade sliders: pointer, touch and keyboard; live rendering; persistence.
- [ ] M7. Stable settings dialog (no reposition on change); shared open/close transitions honouring reduced motion.
- [x] M8. Browser Back / Forward across Global Settings. FIXED: opening pushed no history entry, so Back left the app. Now one entry (settings: true); Back closes, Forward reopens, the page's Back button matches Back. `scripts/verify/probe-history.ts`: 4/4 verdicts, 0 page errors. Still open: Escape-key close path and project-context restore after Back (not probed).
- [x] M9. Global Settings. The top-right three-dot control now reads Global Settings (title and accessible name), distinct from Project Settings. It was already a direct control; a dropdown menu was not built.
- [ ] M10. Team Settings: real per-agent configuration backed by existing contracts (no invented controls).
- [ ] M11. Canvas drag and resize reliability for notes and modules; persistence after reload.
- [ ] M12. Card Table default width shows Not Started, In Progress, Stuck, Done together.
- [ ] M13. Hamburger direct module navigation with maximised view and return to canvas.
- [ ] M14. Team Chat: inline avatars, full-width bodies, drawer animation.
- [ ] M15. Document thumbnails (PDF first page, images, markdown/text, spreadsheet, fallbacks).
- [ ] M16. Calendar shell: fixed toolbar across Day / Week / Month.
- [ ] M17. Real-browser regression tests and screenshots (1920, 1440, tablet, 390) for each milestone.
- [ ] M18. Independent review pass (functional, visual, regression and security) with evidence per criterion.
- [ ] M19. Merge to `main` (requires branch-protection and review checks to pass).
- [ ] M20. Staged-tree production deploy, then production verification of the intended commit.

## Verification log

- M1: `npx vitest run tests/web` (16 files). Result recorded in the commit message.
