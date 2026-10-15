# Morning report — 15 October 2026

Repository: `granterogers/agentic.team.grant`. This report follows the structure of the eight-hour brief (sections A–J).
Numbers are measured in this session. Anything not run is listed as not run.

## A. Executive summary

Shipped to production on your instruction: migration `1074` (projects can be archiving or restoring) and the page
(module look, phone checkbox, project menu). Merged to `main`: the lifecycle rules, the module look, the gate fixes.

Prepared on branches, not merged, not deployed: the module menu icons (`feat/menu-module-icons`) and an export fix that
refuses another office's project (`fix/export-refuses-other-offices`, migration `1075`).

The brief's four workstreams are not complete. Password and Google sign-in, external storage, backup retention and the
staging preview are not built, and each needs an owner decision or a credential. **Release recommendation: partially
ready (section J).**

## B. Branch and deployment

- Repository: `granterogers/agentic.team.grant`.
- Brief's feature branch (`feature/auth-storage-portability-ui`): **not used**. The work is split across the branches
  below, which is a departure from the brief.
- Draft PRs and merges:
  - #477 module look: merged (`afe87a26`).
  - #479 gates and screenshot run: merged (`e6b660e7`).
  - #478 archive lifecycle: merged (`b7501b4d`).
  - #480 deploy record: merged (`14f65ad8`).
- Open, not merged:
  - `feat/menu-module-icons` (`31144184`): module icons in the project menu.
  - `fix/export-refuses-other-offices` (`f56aa426`): migration 1075 and the round-trip proof.
  - `docs/morning-report-2026-10-15`: this report and the security review.
- Staging preview: **not deployed** (no staging environment is available to this session; section I).
- Main: merged, on your instruction, and the brief forbade it without approval. An earlier fast-forward of `main` to
  the sign-in branch, made without a pull request, is still in place.
- Production:
  - Migration `1074` applied. Production ledger: 821 before, 822 after, latest `1074`.
  - Page deployed as `dpl_GixBZzkwkvUekHADwRtEBQ8rgaGo`. Rollback point: `dpl_BWk6MvPTAF7JaEnUdv5H481hWd4K`.
  - Not deployed: worker, hq-api, signin, voice.
  - Migration `1075` is **not** applied to production.

## C. Authentication

- Password login: **not built**. The PIN sign-in you chose replaces it, and password login is switched off.
- Username support: **not built**.
- Google sign-in: **not built**. Google *service* access (Gmail, Calendar, Drive) works. The consent screen is in Testing
  and expires tokens after seven days.
- Existing-account migration: nothing migrated. The PIN table is additive; existing identities are unchanged.
- Password recovery: built (reset link flow) but retired on the sign-in path. Its round trip has never been verified.
- Session persistence: the code exists; not tested across browser restarts.
- Owner configuration still required: Google OAuth client, redirect URIs and the consent screen (section I).
- Tests: `tests/auth/pin.test.ts` 11 of 11 pass (hashing, lockout, comparison).

## D. Storage recommendation

- Existing storage (measured 14 October): database 389 MB, object storage 690 MB.
- Provider comparison: written 14 October, **not re-verified** in this session. It covers Cloudflare R2, Backblaze B2,
  Supabase Storage and Google Drive. Re-verification needs current pricing pages, which were not fetched.
- Selected architecture: none implemented. The brief's starting hypothesis (Supabase Postgres, R2 for objects, optional
  Drive backup) remains the candidate.
- Implementation status: **not built**. The provider abstraction, signed URLs, staged migration and reconciliation are
  not built. The reconciliation module exists but has not been run.
- Expected database savings and performance impact: **not measured**.
- Free-tier constraints: from the 14 October comparison only; unverified.

## E. Export and restore

Export formats present in the database package (`app.project_export`, verified this session):
the package has `project`, `tasks`, `contacts`, `documents`, `collections`, `answers`, `automations`, `sources`, `team`,
`format`, `format_version` and `exported_at`.

Standard formats (from the earlier PR, unit-tested): vCard `.vcf` (contacts), iCalendar `.ics` (events), CSV and JSON
(tasks), JSON (project metadata), native document files, Markdown or JSON (notes).

- Complete project export: works. The package and ZIP manifest are produced.
- Archive integrity: the ZIP has a manifest with SHA-256 checksums; the restore refuses a malformed key.
- Restore round trip, measured this session (`scripts/isolated/project-roundtrip.ts`, a local replica):
  three tasks, two contacts and one document were exported, restored as a new project (`unnamed-restored`), and all of
  them were found in the restored project by content. A repeat restore returned the stored answer and wrote no project.
  10 of 10 checks pass. **The round trip is local only, on a replica. It has not been run on a real project.**
- Missing from the complete package: **calendar events**. The package has no events section. The brief requires them.
  Not fixed in this session.
- Not verified: export coverage of conversations, activity and artifacts; secrets exclusion beyond one package.
- Manual archive: the lifecycle states and the refusal of work during archiving/restoring are live (migration 1074,
  proof `archive-lifecycle.ts`, 10 of 10). The archive and restore *operations* that move a project through those states
  are **not written**.
- Automated backups: **not scheduled**. Retention policy is written and its planner is unit-tested, but nothing executes it.

## F. User interface

- Module background: neutral. Verified in a browser (opaque white surface on the light theme).
- Coloured title and icon: done. Each module's title takes its colour (Contacts, Docs and Schedule are visibly different).
- Border glow: done. Visible on every module.
- Hamburger menu icons and colours: done on branch `feat/menu-module-icons`, not yet merged. Seven rows show their module
  icon in its colour, from the same identity table the dashboard uses. Verified in a browser.
- Projects submenu: done. Opens, collapses, lists projects, and stays open while the pointer moves into it (desktop).
  Keyboard and mobile tap are not verified.
- Desktop and mobile results: `scripts/verify/module-look.mjs`, 16 of 16 checks pass, at 1440 by 900 and at 390 wide.
  Chromium only. Safari not tested.
- Before and after screenshots: the final desktop capture was reviewed; before-state images are not kept in the repo.
- Phone task checkbox: fixed. It drew as "+ |" because of a percentage-offset bug; it's now a closed box (verified at 3x).

## G. Testing

Counts are from the last full run in this session.

- Unit (`npm test`): 475 files passed, 1 skipped; **7,387 tests passed, 21 skipped, 0 failed**.
- Web unit (`tests/web`): 245 of 245.
- Typecheck (`npm run typecheck`): exit 0. Lint (`npm run lint`): exit 0.
- Templates, migrations, secrets, proof registry (`check:templates`, `check:migrations`, `check:secrets`, `check:proofs`): exit 0.
- Replica proofs (local, not production):
  - `archive-lifecycle.ts`: 10 of 10. Negative control: 4 fail on the relaxed-only copy, as expected.
  - `project-roundtrip.ts`: 10 of 10. Negative control: the foreign-office check fails on the unmigrated replica.
- Browser journeys: **1 of the 15** required journeys is written, and it has 16 checks (`module-look.mjs`).
- Security findings: 1 found and fixed (section H).
- Performance results: **none measured**.
- Automated, mocked and live categories:
  - Automated (unit, replica): the counts above.
  - Mocked: the PIN tests use real hashing; the storage tests were not run.
  - Live integration: **none run this session** against production or any provider, apart from the migration ledger
    read, the page dry run, the page deploy and the three endpoint probes listed in section B.
- Not exercised: Telegram, Slack, team chat and voice regressions. The brief asks for these, and none were exercised.
- Not run: `npm run gate:safe`, `npm run verify:critical` on a fresh clone, `verify:hq`, `verify:ui`, `verify:talk`.

## H. Security and rollback

Security review (summary; the full review is `docs/release/SECURITY-REVIEW-2026-10-15.md`):

- **Finding (fixed in branch `fix/export-refuses-other-offices`, migration 1075, not deployed):** `app.project_export`
  returned a package for another office's project id. Its project sections were empty, but the team section reported
  every agent as on the project. Severity: low to medium. No other office's data was returned; the answer was false, and
  the boundary is the function, not the gateway.
- Verified: the export and restore refuse a malformed idempotency key; a repeat restore writes nothing; the restore
  requires an active office (`app.require_office`); the package contains no credential-shaped field (one export checked).
- Not verified: cross-office restore; signed URLs (none exist); row-level security on the live database (no production
  read this session); malicious archive inputs (ZIP-slip, oversized archives) beyond the existing unit tests.
- Unresolved high-risk issues: none found in the parts exercised. The parts not exercised are listed above.

Rollback:

- Page: promote `dpl_BWk6MvPTAF7JaEnUdv5H481hWd4K` (the previous deployment) with the Vercel dashboard or the deploy
  script's rollback.
- Migration 1074: additive. Rolling it back means restoring the constraint `projects_status_known` to three states and
  restoring the fourteen readers from their pre-1074 definitions. Those definitions are in migration history.
  Do not roll back while any project is `archiving` or `restoring`.
- Migration 1075: a `create or replace` of `app.project_export`. Rolling back means re-applying the previous definition,
  which is `app.project_export` as in migration 0720.
- Deployment record: `docs/ops/deployment-state.json` describes the page and migration state.

## I. Remaining owner decisions and configuration

Decisions:

1. Password login: replace PIN sign-in, or sit beside it? Username rules if password login is wanted.
2. Staging environment: do you want a Vercel preview with its own Supabase project? Without it, the brief's staging step
   cannot be done.
3. Backup retention: approve the exact list before any deletion. The retention planner refuses to run without it.
4. Calendar events in the complete export: confirm the events section should be added (a migration to the export function).

Configuration:

- Google OAuth (for Google sign-in): in the Google Cloud console, set the OAuth consent screen to In production (or add
  test users), add the authorised redirect URI for the sign-in function, and add the staging origin separately. The
  client ID and secret go in the Supabase Vault, never in the repository or the chat.
- Cloudflare R2 or Backblaze B2: create a bucket, a scoped access key, and store the key ID and secret in the vault under
  the names the storage configuration reads. Nothing is created until you say so.

## J. Release recommendation

**PARTIALLY READY — SPECIFIC BLOCKERS REMAIN.**

What is ready to merge after review: `feat/menu-module-icons`, `fix/export-refuses-other-offices` (migration 1075 is
additive and tested on a replica).

What is blocked:

- Password and Google sign-in (owner decisions and console configuration).
- External storage (provider accounts and credentials).
- Backup retention and scheduling (owner approval of exact lists).
- Staging preview (owner-provided isolated environment).
- Calendar events in the export (decision and a migration).
- Restore on a real project, and the browser journeys beyond one.

Proposed merge and production sequence (not executed):

1. Review and merge `fix/export-refuses-other-offices` and `feat/menu-module-icons` into `main`.
2. Apply migration `1075` to production with `npm run migrate` (both production flags, a clean tree, a pushed commit).
   Verify with a read-only query that the refusal text is in `app.project_export`.
3. Deploy the page from the pushed commit with `scripts/deploy/hq-page-delta.ts --go` (both flags, `DEPLOY_SOURCE_SHA`).
   Probe the page and the notebook endpoints.
4. Record the deployment in `docs/ops/deployment-state.json` in the same commit, and run `check:deployment-state`.
5. Keep the rollback point (section H) until the next release.
