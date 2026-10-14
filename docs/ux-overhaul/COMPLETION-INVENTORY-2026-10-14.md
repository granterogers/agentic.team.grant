# Team HQ completion inventory (14 October 2026)

Working record for the completion pass. Every row is checked against the repository, the live production
deployment and the browser, not against earlier prose. Status is updated as work lands; a row is closed only when its
verification is recorded.

## References verified before starting

| Item | Value | Verified |
|---|---|---|
| main | `65bc7b0a` (record commit) | `git rev-parse origin/main` |
| Last deployed code | `6bf4279a` | Vercel `meta.gitCommitSha` |
| Production deployment | `dpl_FSaS2u7METhax9KvDQxXo6dnqphn`, READY | Vercel v13 API, production target |
| Rollback | `dpl_9EDKjwUJrbxJeU3xYfYpo4ZVNDAK`, READY | Vercel v13 API |

## Sources reconciled

- `docs/ux-overhaul/CHECKLIST.md`: checkbox states disagree with its own body text (M13 is `[ ]` but its section is
  VERIFIED; M15 is `[ ]` but partly verified; M19 and M20 are `[ ]` although both releases have happened). Stale.
- `docs/ux-overhaul/RELEASE-CANDIDATE.md`: last section is the premium refinement release; earlier sections describe
  deployments that are no longer live. Historical, not a current claim.
- Independent review 1 (commit 33cd99c2): 3 majors (F1 to F3) fixed and probe-verified; minors F4 to F6 and F8 handled
  in bfc071a9 / 6bf4279a (see below).
- Independent review 2 (commit bfc071a9): no open blockers or majors. Its open minors were F4 (scroll position, not a
  defect; re-measured), F5 (fixed), F6 (fixed), F8 (fixed). Open NITs: see the defects table.
- GitHub issues (121 open). Team HQ UX items: #472 and #473 (UI D1/D2, requirements from draft PR #465 on
  `feature/auth-storage-portability-ui`), #411 (P2/P3 UX polish from the Sample tour), #422 (page-load fan-out, backlog),
  #453 (project name 54px at 320px), #450 (My Tasks shows only Today), #447 (verify:wired stale), #455 (static checks
  red on main), #414 (verify:hq, verify:talk and the gate use Grant's office as fixture), #436 (Mark done label),
  #440 (answers open with "I have not done this yet"), #424 (Sample seeded dates age), #430 (Sample walkthroughs).
  The remaining open issues are backend, security, migration or agent-behaviour work outside a frontend release.

## Defects and outstanding work

| # | Item | Severity | Status at start | Root cause | Required correction | Verification | Production / external action needed? |
|---|---|---|---|---|---|---|---|
| D1 | Source badge on real previews | MAJOR (visual) | Open | Source mark is a sibling of the tile face, absolutely placed top-left over the picture | Move the mark into the tile's meta line; no overlay on the preview | Probe: real-preview tile has no overlay; capture | No |
| D2 | Landing/header notification badge overlaps bell | MINOR (visual) | Open | `.bcstatus` offset `top:3px; right:1px` sits on the 18px bell glyph | Offset the count outside the glyph with a surface ring | Capture at 390 and 1440; probe bounding boxes do not intersect | No |
| D3 | Empty "No project open" state is sparse | MAJOR (UX) | Open | One sentence and one button on the void (`shell.js` ~901) | Deliberate empty state: heading, explanation, project cards, one primary action | Capture desktop and phone; probe the cards and action | No |
| D4 | Tile metadata contrast | MAJOR (a11y) | Unmeasured | `--bc-text-muted` on tile surfaces, unmeasured | Measure each meta colour pair in Light and Dark; correct to 4.5:1 | Contrast probe over every `.bcdocmeta` | No |
| D5 | Mobile Sample banner takes ~28% of a 390px screen | MAJOR (mobile) | Open | Notice strip with full sign-in form stacked above content | Collapse the sign-in form behind one control on phone; keep the sentence and every action | Phone capture; probe the strip height and the sign-in reachable | No |
| D6 | Sample initial load: 10 to 30+ s, connecting skeleton persists | MAJOR (performance) | Open, not measured | Unknown: auth, API, data or JS (to be measured) | Timing evidence per phase, then fix application-side causes | Navigation and request timing per phase, repeated runs | No (Sample is public) |
| D7 | Tile metadata/type stamp at narrow widths | fixed | Closed in 6bf4279a | n/a | n/a | probe-review-majors | n/a |
| D8 | Post-it grip target 20px (below 44px) | MINOR | Open | Grip bar height 20px | Enlarge touch area without changing the visible handle | Probe the bar box at touch emulation | No |
| D9 | Hamburger submenu, module icons, single Projects entry (#472, #473) | ENHANCEMENT | Open (tracked) | Separate brief workstream on a draft PR | Not started here: a feature set, not a defect in the shipped release | n/a | Decision for owner (scope) |
| D10 | Page-load fan-out (#422) | PERFORMANCE backlog | Open | About 25 gateway reads, 11 before an office exists | Measure first (D6), then change only the no-office reads | Acceptance run request counts | No |

## Verification infrastructure

| Check | Status at start | Assessment | Action |
|---|---|---|---|
| `verify:wired` | Red on main and on the pre-change commit | Stale selector (`.project[data-open]`, retired UI) | Repair against the current Team HQ selectors; do not weaken assertions |
| `verify:ui` | Refused by production-write gate | Targets Grant's office (#414). Writes are not needed for the UI checks | Classify and run against the Sample or local; never against Grant's office |
| `verify:talk` | Not run | Same as verify:ui (#414) | Classify; run on local or Sample |
| `gate:safe` | Not run | Read-only production fingerprints under `ALLOW_PRODUCTION_CHECKS` | Run in its three parts under the authorised check flag |
| Repository lint | 62 files fail on main | Pre-existing (#429, #455) | Lint only changed files; record the rest as unrelated debt |

## Authenticated verification

| Capability | Status at start | Route available |
|---|---|---|
| Team Settings save, agent configuration | Not verified | Sample Person harness (`docs/multi-user/SAMPLE-PERSON.md`), under the production-write flag already authorised |
| Appearance saved to an account | Not verified | Sample Person harness |
| Project-level appearance persistence | Not verified | Sample Person harness |
| Background image upload | Not verified | Sample Person harness; needs a file upload path |
| Document thumbnail generation and retrieval | Not verified (signed-in) | Sample Person documents |
| Document opening and version consistency | Partly verified in prototype | Sample Person documents |
| Tool and permission controls | Not verified | Sample Person harness |

Rule: no capability is reported as tested unless a run recorded it.
