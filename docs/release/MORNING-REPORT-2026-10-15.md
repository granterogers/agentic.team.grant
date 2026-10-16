# Morning report — 15 October 2026

Repository: `granterogers/agentic.team.grant`. This report follows the structure of the eight-hour brief (sections A–J).
Numbers are measured in this session. Anything not run is listed as not run.

## A. Executive summary

Shipped to production on your instruction: migrations `1074` (projects can be archiving or restoring), `1075` (an
export refuses a project the office does not hold), `1076` (the complete export carries the project calendar) and `1077`
(a restore brings the calendar back), and the page (module look, phone checkbox, project menu icons).

Update, after the 1076 and 1077 applications: the calendar gap listed below is closed in the database. The migrations
were applied to production on your instruction; no page or worker deployment was made for them.
Merged to `main`: the lifecycle rules, the module look, the gate fixes, the export fix, the menu icons, this report, and
the deployment records.

Not deployed: the worker, hq-api, signin and voice. Their changes on `main` do not alter their behaviour.

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
  - #480 deploy record (1074 and the first page): merged (`14f65ad8`).
  - #481 export refuses another office's project (migration 1075): merged (`b0c5e14e`).
  - #482 module icons in the project menu: merged (`8e384444`).
  - #483 this report and the security review: merged (`bb61e4b0`).
  - #484 deployment record (1075 and the second page): merged (`88acffa7`).
- Open: none of the brief's branches. The deploy-record and report branches are merged.
- Staging preview: **not deployed** (no staging environment is available to this session; section I).
- Main: merged, on your instruction, and the brief forbade it without approval. An earlier fast-forward of `main` to
  the sign-in branch, made without a pull request, is still in place.
- Production:
  - Migration `1074` applied (production ledger 821 before, 822 after).
  - Migration `1075` applied (ledger 822 before, 823 after, latest `1075`). Verified read-only: the refusal text is in
    the live `app.project_export` definition.
  - Migration `1076` applied (ledger 823 to 824): the complete export carries `events`.
  - Migration `1077` applied (ledger 824 to 825, latest `1077`): a restore recreates the exported calendar events.
  - The ledger count and latest name come from `docs/ops/deployment-state.json` (`appliedAtRecord` 825,
    `highestAppliedAtRecord` 1077). I did not re-read production for this update.
  - Page `dpl_Fr1iDRevDSJbtUCgchrLoYXAY2uy` deployed, READY, serving the menu icons. Rollback point:
    `dpl_GixBZzkwkvUekHADwRtEBQ8rgaGo`.
  - Earlier rollback point for the first page: `dpl_BWk6MvPTAF7JaEnUdv5H481hWd4K`.
  - Not deployed: worker, hq-api, signin, voice.

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
- Calendar events (closed after this report was first written): migration `1076` adds an `events` section to the complete
  package, and migration `1077` restores those events into the new project with origin `archive`. Events that were
  filed from Google are skipped on restore and counted in the restore report, so they are not duplicated. The round-trip
  proof now asserts that the event added before export is present, by title, after restore. This update did not re-run
  the proof.
- Not verified: export coverage of conversations, activity and artifacts; secrets exclusion beyond one package.
- Manual archive: the lifecycle states and the refusal of work during archiving/restoring are live (migration 1074,
  proof `archive-lifecycle.ts`, 10 of 10). The archive and restore *operations* that move a project through those states
  are **not written**.
- Automated backups: **not scheduled**. Retention policy is written and its planner is unit-tested, but nothing executes it.

## F. User interface

- Module background: neutral. Verified in a browser (opaque white surface on the light theme).
- Coloured title and icon: done. Each module's title takes its colour (Contacts, Docs and Schedule are visibly different).
- Border glow: done. Visible on every module.
- Hamburger menu icons and colours: done, merged (#482) and deployed (page `dpl_Fr1iDRevDSJbtUCgchrLoYXAY2uy`). Seven rows
  show their module icon in its colour, from the same identity table the dashboard uses. Verified in a browser, and the
  live `bc/shell.js` contains the code.
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

- **Finding (fixed in migration 1075, merged and deployed 15 October 2026):** `app.project_export`
  returned a package for another office's project id. Its project sections were empty, but the team section reported
  every agent as on the project. Severity: low to medium. No other office's data was returned; the answer was false, and
  the boundary is the function, not the gateway.
- Verified: the export and restore refuse a malformed idempotency key; a repeat restore writes nothing; the restore
  requires an active office (`app.require_office`); the package contains no credential-shaped field (one export checked).
- Not verified: cross-office restore; signed URLs (none exist); row-level security on the live database (no production
  read this session); malicious archive inputs (ZIP-slip, oversized archives) beyond the existing unit tests.
- Unresolved high-risk issues: none found in the parts exercised. The parts not exercised are listed above.

Rollback:

- Page: promote `dpl_GixBZzkwkvUekHADwRtEBQ8rgaGo` (the page before the menu icons and migration 1075) with the Vercel
  dashboard or the deploy script's rollback. Older point: `dpl_BWk6MvPTAF7JaEnUdv5H481hWd4K`.
- Migration 1074: additive. Rolling it back means restoring the constraint `projects_status_known` to three states and
  restoring the fourteen readers from their pre-1074 definitions. Those definitions are in migration history.
  Do not roll back while any project is `archiving` or `restoring`.
- Migration 1075: a `create or replace` of `app.project_export`. Rolling back means re-applying the previous definition,
  which is `app.project_export` as in migration 0720, and then deploying the page from before the change. The
  refusal only removes a false answer; nothing stored changes.
- Migration 1076: a `create or replace` of `app.project_export`. Rolling back means re-applying the 1075 definition.
  Nothing stored changes.
- Migration 1077: a `create or replace` of `app.project_restore`. Rolling back means re-applying the 1071 definition.
  Restored events already in projects stay where they are; rolling back does not delete them.
- Deployment record: `docs/ops/deployment-state.json` describes the page and migration state.

## I. Remaining owner decisions and configuration

Decisions:

1. Password login: replace PIN sign-in, or sit beside it? Username rules if password login is wanted.
2. Staging environment: do you want a Vercel preview with its own Supabase project? Without it, the brief's staging step
   cannot be done.
3. Backup retention: approve the exact list before any deletion. The retention planner refuses to run without it.
4. ~~Calendar events in the complete export~~ Closed: migrations 1076 and 1077 were applied on your instruction.

Configuration:

- Google OAuth (for Google sign-in): in the Google Cloud console, set the OAuth consent screen to In production (or add
  test users), add the authorised redirect URI for the sign-in function, and add the staging origin separately. The
  client ID and secret go in the Supabase Vault, never in the repository or the chat.
- Cloudflare R2 or Backblaze B2: create a bucket, a scoped access key, and store the key ID and secret in the vault under
  the names the storage configuration reads. Nothing is created until you say so.

## J. Release recommendation

**PARTIALLY READY — SPECIFIC BLOCKERS REMAIN.**

Done since the first draft of this report: `feat/menu-module-icons` and `fix/export-refuses-other-offices` are merged and
deployed (section B). The recommendation still stands because the blockers below are not resolved.

What is blocked:

- Password and Google sign-in (owner decisions and console configuration).
- External storage (provider accounts and credentials).
- Backup retention and scheduling (owner approval of exact lists).
- Staging preview (owner-provided isolated environment).
- Restore on a real project (the calendar restore is proven on a replica only), and the browser journeys beyond one.

Merge and production sequence (executed on your instruction, 15 October 2026):

1. Merged #481, #482 and #483 into `main`.
2. Applied migration `1075` to production with `npm run migrate` (both production flags, a clean tree, a pushed commit).
   Verified with a read-only query that the refusal text is in `app.project_export`.
3. Committed the ledger line on `docs/deploy-record-1075`, pushed it, and deployed the page from that commit with
   `scripts/deploy/hq-page-delta.ts --go` (both flags, `DEPLOY_SOURCE_SHA`). Probed the page and the notebook endpoints.
4. Recorded the deployment in `docs/ops/deployment-state.json` (#484) and ran `check:deployment-state`.
5. Keep the rollback point (section H) until the next release.
