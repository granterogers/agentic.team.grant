# Auth, storage, portability and UI: status and checkpoint

Branch: `feature/auth-storage-portability-ui`
Baseline: `origin/main` at `6958ed3200d2e5e9d44c1cef77952586d335a20a` (local `main` is behind at `3caaebfe`; the branch was cut from `origin/main`).
Production: **not touched.** No merge into `main`, no deploy, no live auth or Supabase configuration change, no migration.

## What this session did

1. **Discovery.** Read the repository, not the brief's assumptions. Several parts of the brief already have partial
   implementations here, and some have none (below).
2. **Baseline test run before any change.** `npx vitest run`: 453 test files passed, 1 skipped; 7,059 tests passed,
   21 skipped, 0 failed. Output saved at `.out/baseline-vitest.txt` (ignored by git).
3. **One workstream slice built and verified:** standard-format serialisers for contacts (vCard 4.0), calendar
   (iCalendar 2.0) and tasks (CSV and a JSON envelope). See `docs/portability/INDIVIDUAL-EXPORT-FORMATS.md`.
   31 new tests, all passing; a sabotage control proved the detector can fail.

## Gap analysis against the brief

| Workstream | What the repository has | What is missing | Status |
|---|---|---|---|
| **A. Password and username login** | Magic-link sign-in only, in `supabase/functions/signin/index.ts` (`type: 'magiclink'` at three call sites). Session handling in `src/auth/`. | Password sign-up and sign-in, username, password reset, password-strength and rate-limit policy. | **Not started.** Needs Supabase Auth email/password enabled, which is a live configuration change and needs owner approval. |
| **A. Google sign-in** | Google OAuth exists for connectors (Drive, Mail, Calendar) in `src/google/auth.ts`. It is not a sign-in provider. | Google as a login provider, identity linking and collision rules, a separate preview OAuth client. | **Not started.** Needs an OAuth client in the Google Cloud console and redirect configuration that only the owner can create. |
| **B. Hybrid storage** | `src/files/store.ts` and `src/backup/offsite.ts` exist. Not reviewed in depth this session. | Provider comparison with verified current pricing, storage audit by table, object migration, reconciliation. | **Not started.** The provider research needs live web sources and was not done. |
| **C. Standard-format export** | `src/backup/portable.ts` writes a whole-database JSON archive with a manifest; `src/backup/restore.ts` is a typed restore into an isolated replica only. | Per-project export; vCard, iCalendar and CSV output; ZIP archive; export UI; project-level restore. | **Serialisers done and tested. Read path, UI, ZIP and project restore not started.** |
| **C. Archive lifecycle** | Backup retention policy exists (`src/backup/retention.ts`, `docs/ops/backup-retention-policy.md`). | Project-level ACTIVE → ARCHIVING → ARCHIVED → RESTORING states. | **Not started.** |
| **D. Module colours, icons, glow** | Module colour and icon styling lives in `web/studio/bc/` (`refine.css`, `bc.css`, `compose.css`, `polish.css`). The projects menu is in `web/studio/bc/menu.js`. | Not audited this session. | **Not started.** Needs a visual pass with real browser screenshots at desktop and 390 px. |

## Owner decisions and configuration needed

These cannot be made safely by the engineering agent and are not requested as routine questions.

1. **Password sign-in.** Enable the Email provider with password sign-in in the Supabase project's Auth settings for
   a staging project first. Production auth changes are blocked until approved.
2. **Google sign-in.** Create an OAuth 2.0 client in Google Cloud Console with one authorised redirect per environment
   (production and preview separately), then provide the client ID through the existing vault mechanism. Do not paste
   the secret into chat.
3. **Storage provider.** Choose between the researched options once the comparison exists. The current hypothesis is
   Supabase PostgreSQL with Cloudflare R2 and optional Google Drive backup. Supabase Storage is the zero-new-vendor
   option, and R2 has no egress charge. Confirm there is no paid tier to avoid.
4. **Staging preview.** A preview deployment has not been attempted. It needs a staging Supabase project separate from
   production, as CLAUDE.md requires (`TARGET_ENVIRONMENT=staging` with `npm run staging:preflight`).

## Verification record

| Check | Result |
|---|---|
| `npx vitest run` before changes (baseline) | 7,059 passed, 0 failed, 21 skipped |
| `npx vitest run tests/portability` | 31 passed |
| Sabotage: `escapeText` without the `;` escape | 2 tests fail, restored, green |
| `npx biome ci src/portability tests/portability` | exit 0 |
| `npm run lint` (whole repo) | exit 1, **pre-existing**: 2 errors in `scripts/audit/credentials.ts`, `scripts/isolated/*`, `scripts/leak-witness.ts`, none in files this branch touches |
| `npx tsc --noEmit` | no errors in new files; 283 pre-existing errors in `scripts/verify`, unchanged |
| `npm run check:secrets` | clean, 4,210 files |
| `npm run check:templates` | clean |

Not run this session, and therefore not claimed: `verify:*` browser suites, `verify:critical`, `gate:safe`, any
production check, and any Telegram, Slack, voice or team-chat regression.

## Remaining work, in order

1. Per-project read path for contacts, calendar and tasks, through the gateway, with a project-scoped predicate and
   a test that another project's rows cannot appear.
2. Download control in project settings, with a browser check at 390 × 844.
3. Module colour and glow audit (Workstream D), which is independent and can run in parallel.
4. Password sign-in in code behind a disabled flag, with rate limiting and enumeration-safe errors, verified against a
   staging project only.
5. Storage provider research with dated, official sources, then the abstraction.
6. ZIP archive with manifest and checksums, then project restore into a new project, with a round-trip test.

## Continuity

Next action: step 1 above. Start from `src/portability/formats.ts`. The read function should take a project id and
return the rows already shaped for the serialisers. Do not add a gateway section until the read is covered by a test
that proves another project's rows are excluded.
