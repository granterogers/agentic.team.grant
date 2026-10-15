# Auth, storage, portability and UI: status and checkpoint

Branch: `feature/auth-storage-portability-ui` · Draft PR: #465 · Issues: #466–#473
Baseline: `origin/main` at `6958ed3200d2e5e9d44c1cef77952586d335a20a`.
Production: **not touched.** No merge into `main`, no deploy, no live auth or Supabase configuration change, no production migration, no production read.

## Checkpoint log

| Commit | What |
|---|---|
| `e908b0d` | Standard-format serialisers for contacts (vCard 4.0), events (iCalendar 2.0) and tasks (CSV, JSON). 31 tests. |
| `b07be56` | Project Settings buttons and the gateway route that serve those formats, backed by migration 1070 (`app.project_records`). |
| (next) | Password sign-in (#466): decisions in `src/auth/password.ts`, four actions in `supabase/functions/signin`, a password form on the sign-in screen. Closed until `PASSWORD_SIGN_IN` is set. |

## Correction to the earlier analysis

The first status report said there was no per-project export. That was wrong. `app.project_export` (migrations 0325, 0326, 0720) already packages a project as one neutral JSON document (about fourteen tables; documents as text by relative path), reached by the Download button in Project Settings. The gap is narrower than first stated: the existing export is JSON only, does not carry original document bytes, and has no restore path.

## Workstreams

| Issue | Workstream | State |
|---|---|---|
| #466 | A1 password sign-in | **Code and UI built, behind a switch.** Unit-tested; two browser journeys and two screen captures at 390 px and 1440 px. Not verified against live Supabase Auth. Username login, password reset completion and a rate limit beyond Auth's own are not built. |
| #467 | A2 Google sign-in | Not started. Needs an OAuth client the owner creates. |
| #468 | B1 storage audit and provider comparison | **Provider comparison done** (`docs/storage/PROVIDER-COMPARISON-2026-10-14.md`, from official pricing pages fetched 14 Oct 2026). Recommendation: Cloudflare R2 primary, B2 as the alternative. Storage audit (measured database and object growth) **not done**: needs read-only production measurement and owner authorisation. |
| #469 | B2 storage abstraction and migration | Not started. Depends on B1. |
| #470 | C1 standard-format exports | **Built and verified** (see below). Live gateway and browser journey not run against production. |
| #471 | C2 restore and ZIP | Not started. Restore into a new project needs an idempotency record and careful document inserts. |
| #472 | D1 module colours and glow | Not started. |
| #473 | D2 hamburger icons and Projects submenu | **Partly done** (`5c29613`): Projects is one top-level item that shows or hides the list (click and keyboard), expanded by default, scrolling past half the screen; verified at 1440 and 390 px. Desktop hover-to-reveal and the icon and colour consistency check are not done. |

**Lint note.** `biome.json` includes only `*.ts` and `*.json`. The web JavaScript and CSS under `web/` are not linted by biome. Their checks are `npm run check:templates`, the unit suites that read the source, and the browser captures. Earlier notes that said "biome clean" for web files referred to TypeScript only.

### C1: standard-format exports (#470), verified

What a person can do: in Project Settings → Standard formats, press **Contacts · vCard**, **Calendar · iCalendar**, **Tasks · CSV** or **Tasks · JSON**. The file downloads; a refusal shows the office's words.

Verification:
- `npx vitest run tests/portability`: 46 passed. Includes a sabotage (a wrong file name turns the wiring test red; restored).
- Migration 1070 applied to the local schema replica (`bash scripts/isolated/replica.sh`, built from the repository's migrations). `tests/migrations/project-records.replica.sql` runs inside a rollback and passes: contacts only from the project, tasks only from the office, a native event that was synced to Google counted once, cross-office and cross-project reads return null, an unknown kind is refused.
- Full unit suite green. Lint of new files clean. `check:templates` and `check:secrets` clean.

Not verified: the gateway route against the live deployment; the browser journey against a real office (the button needs a token); `check:gateway-wrappers`, which reads the production database and was refused without an authorised flag (the new wrapper was exercised directly on the replica instead); the SQL proof is not registered in `verify:critical` (it is a manual replica run, documented here).

Limits, by design: attendee names and recurrence are not exported (the cache does not hold them). Calendar all-day dates are cut in the office zone. Spreadsheet formula text is apostrophe-prefixed.

### A1: password sign-in (#466)

What a person can do: on the sign-in tab, enter an email and a password and press **Sign in with password**, or press **Forgot the password?**. The link option stays below, and it reuses the same address field. Nothing appears unless the office switches it on.

Server (`supabase/functions/signin`): `methods`, `password_sign_in`, `password_sign_up`, `password_reset`. Every password action answers "not switched on" until `PASSWORD_SIGN_IN` is `1` or `true`. Refusals that could reveal whether an address has an account return one sentence. Auth does the hashing and the checking; nothing here stores a password.

Verification:
- `npx vitest run tests/auth/password.test.ts`: 14 passed, covering the policy boundaries (length, bytes, the address inside a password), the session mapping and bounds, the closed-by-default switch, and wiring of the switch in the function source.
- Sabotage: making the gate ignore the setting turns the wiring test red; restored and green.
- Browser (Playwright, local, sign-in function stubbed): a good password stores the session under `hq.session` exactly as the link path does; a refused password shows the office's sentence and stores nothing; no page errors; no horizontal scroll at 390 px or 1440 px. Captures in `.out/entry-*.png` (not committed).
- Full unit suite green.

Not verified: a real Supabase Auth call. A real email round trip. The password-reset completion page (the link Auth emails goes to the existing magic-link return path, which is not changed here). Rate limiting beyond what Auth provides.

## Owner configuration needed (nothing here has been changed)

1. **Password sign-in.** In the Supabase project used for staging first: Auth → Providers → Email → enable *Email* with password sign-in; decide whether email confirmation is required. Then set the secret `PASSWORD_SIGN_IN=1` on the `signin` function, and only then on production, after approval.
2. **Google sign-in (#467).** Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID (Web application). One authorised redirect per environment. Provide the client ID through the existing vault. Do not paste the secret into chat.
3. **Storage provider (#468).** Confirm which provider you want to evaluate first, and whether any paid tier is off limits.

## Remaining work, in order

1. C2 restore into a new project (#471), with a round-trip test on the replica.
2. D1 and D2 module colours and the Projects submenu (#472, #473), verified at 390 px and desktop with captures.
3. B1 storage audit and research (#468), using dated official sources.
4. Register the SQL replica proof in the gate, or convert it to a counted TypeScript proof.

## Continuity

Next action: C2 (#471). Start from `src/portability/export-route.ts` and `migrations/1070_…`. The restore reads the shape `app.project_export` writes; do not change that shape without a version bump. Restore into a new project only, refuse an existing slug, and record an idempotency key before writing.
