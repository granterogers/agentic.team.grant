# Security review — 15 October 2026

Scope: the parts of the four workstreams that changed in this session, reviewed against the brief's section 21. Method:
read the live definitions in a local replica built from the repository's migrations, drive the functions with real rows
inside rolled-back transactions, and run the controls. Production was read only for the migration ledger and the
function definitions that the migration and the page deploy needed.

## Findings

### F1 — Export returned a package for another office's project (fixed in branch, not deployed)

- Where: `app.project_export(p_office, p_project_id)` (migration 0720). Reached through `public.project_export`, which
  is `security definer`.
- What happened: a call with office B and a project that belongs to office A returned a package. The project, task,
  contact, document and source sections were empty, because the project resolved to null. The `team` section was not:
  with no project, the staff join matched nothing and `coalesce(ps.active, true)` reported every agent as on the project.
- Measured: `public.project_export(<other office>, <A's project>)` answered with `team` of eight agents, all
  `on_this_project = true`.
- Severity: low to medium. No other office's record came back. The answer was false, and it is a tenant-boundary
  defect because the function, not the gateway, is the boundary.
- Fix: migration `1075` refuses with `22023` "no project of this office has that id". It is spliced from the live
  definition at apply time, and a control refuses to apply unless the refusal is present.
- Verified: on a copy with 1075, the foreign call is refused and the office's own export is unchanged. On the unmigrated
  replica, the same check fails (negative control). Proof: `scripts/isolated/project-roundtrip.ts`, 10 of 10.

### F2 — Lifecycle writers accepted work during an archive (fixed and deployed)

- 14 writers named only `archived` in their refusal. A task or event could be written into a project being archived or
  restored.
- Measured before the fix (relaxed-constraint copy): an archiving project accepted a task and an event; a restoring
  project did the same. After: both refused with "no active project". Active and paused projects still accept work.
- Fix: migration `1074`, deployed to production (verified read-only: constraint admits the states, 14 readers carry the
  predicate, none names only `archived`).
- Proof: `scripts/isolated/archive-lifecycle.ts`, 10 of 10.

## Checked, no defect found

- Restore requires a 64-character SHA-256 key and refuses a malformed one before writing anything.
- A repeat restore of the same archive returns the stored answer and writes no project (idempotency).
- The restore requires an active office (`app.require_office`).
- `project_restores` has row-level security enabled, and `anon` and `authenticated` are revoked from it (migration 1071).
- The export package contains no credential-shaped field. Checked on one package (the proof's own source project); the
  check is a regular-expression scan over the JSON text and is not exhaustive.
- The PIN is stored as a salted PBKDF2-SHA256 hash, 210,000 iterations; five wrong tries lock the account for fifteen
  minutes (`src/auth/pin.ts`; 11 unit tests pass).
- The PIN table `public.sign_in_pins` is row-level-secured, with `anon` and `authenticated` revoked (migration 1073).

## Not verified (no evidence either way)

- Cross-office restore. Only export was tested across offices.
- Row-level security on the live database. No production policy read was made in this session.
- Malicious archive inputs: path traversal (ZIP-slip), oversized archives and bad compression. The existing unit tests
  cover parts of this; they were not re-run against this session's changes.
- Signed URLs and object-key manipulation. Object storage is not built, so there is nothing to test.
- Google sign-in and account linking. Not built.
- Session expiry and sign-out across browsers. Not tested.
- Export of conversations, activity and artifacts: coverage not verified, so their exclusion of secrets is unknown.

## Unresolved high-risk issues

None found in the parts exercised. The unverified parts above are the risk.

## Recommended before the next release

1. Add a cross-office restore proof, using the same pattern as the export refusal.
2. Run the zip-slip and oversized-archive unit tests against the current parsers, and add a case for a path with `..`.
3. Read the live row-level-security policies for `projects`, `tasks`, `contacts`, `documents` and `project_restores`
   (read only, with the production-check flag, once you approve it).
4. Confirm the export excludes OAuth tokens and session tokens by scanning a package from a project with a connected
   source.
