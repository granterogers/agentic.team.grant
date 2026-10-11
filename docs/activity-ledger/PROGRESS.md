# Unified Activity Ledger - progress

Branch `feature/unified-activity-ledger`, cut from `origin/main` at `3caaebf` (11 October 2026). **Not merged, not deployed, no production
contact**: every database in this work is the local replica (`scripts/isolated/replica.sh`), no production flag was set, nothing was sent to any
person or service. Read `ARCHITECTURE.md` first; the other documents are linked from it.

## How to resume after a compaction or a restart

1. Read `CLAUDE.md`, then this file, then `ARCHITECTURE.md`.
2. Rebuild the replica if `/var/tmp/pgl` is gone: `bash scripts/isolated/replica.sh` (about a minute and a half; it replays every migration including 1060
   and 1061 into the `post` database).
3. Fast loop on a clone: `psql -h /tmp/pgs -p 55432 -U postgres -c "create database ledger template post"`, then
   `npx tsx scripts/isolated/activity-ledger.ts ledger` (a fresh clone per run: the proofs assume an empty ledger). The same for `activity-gateway`,
   `activity-worker`, `activity-redaction`.
4. The registered gate: `npm run verify:critical` (70 proofs, about 80 s) and `npx tsx scripts/gate/run.ts --tier extended --only activity-worker,activity-redaction`.
5. Sabotage: `bash scripts/isolated/activity-ledger-sabotage.sh [ids]` (about 8 minutes for half; split it to stay inside a ten-minute call).
   Gateway sabotages need a committed `HEAD` (they run in a worktree).
6. Measurements: `npx tsx scripts/isolated/activity-ledger-perf.ts <db> 3000` (about 100 s); `PERF_SEED_ONLY=1` seeds and stops so a plan can be read.

## State: complete for the brief's P0 to P7, with the gaps listed below

| Priority | Delivered |
|---|---|
| P0 existing architecture and security | Audit and gap analysis (`ARCHITECTURE.md` section 2); ownership classes; isolation design |
| P1 reliable event contract | `1060`: taxonomy as data, native append-only table, redactor and metadata cleaner, strict / safe / external writers, default-off fail-closed switch |
| P2 lifecycle instrumentation | Requests, routing, the whole job lifecycle (delegation, retry, completion, failure, cancellation), approvals, impediments, outputs and their review, deliveries (attempted / confirmed / failed / withheld), model calls with cost provenance, the action ledger: **all read from the authoritative table**, so none can be omitted. Native: `system.recovered` from the recovery sweep |
| P3 query and reconstruction | `app.activity_read` (filters, keyset cursor, three visibility levels), `app.activity_chain`, gateway sections `activity_feed` / `activity_chain` / `activity_health` |
| P4 Team HQ | `activity_ledger` section in the existing Activity row shape; `needLately` uses it only when on and non-empty; no visual change |
| P5 history | Nothing to back-fill by design; original timestamps; documented |
| P6 external agents | `EXTERNAL-AGENT-CONTRACT.md`; the SQL door, proved; **not exposed** |
| P7 performance, recovery, tests | Measured; three-stage read model; 17 sabotages; 7 unit sabotages |

## Evidence (all on the replica)

| What | Result |
|---|---|
| `npx tsx scripts/isolated/activity-ledger.ts` | 76 / 76 |
| `scripts/isolated/activity-gateway.ts` (real hq-api, two signed-in people) | 17 / 17 |
| `scripts/isolated/activity-worker.ts` (the real `recoverStalled`) | 10 / 10 |
| `scripts/isolated/activity-redaction.ts` (SQL and TypeScript redactors agree) | 37 / 37 |
| `npm run verify:critical` | **70 green, 0 red**, 3 775 assertions (one earlier run showed `p3-app-attack` red with `duplicate key ... pg_authid_rolname_index`: two proofs creating the same cluster-wide role at once; it passed alone, 1421/1421, and on the rerun of the whole gate. Nothing in this change creates a role) |
| `npm test` | 435 files, 6 791 tests pass (21 skipped, pre-existing) |
| `activity-ledger-sabotage.sh` | **17 of 17 caught**, control green (76/76, 17/17) |
| Unit sabotage (`tests/activity`, `tests/gateway/activity-sections`, `tests/web/activity-ledger-wiring`) | 7 of 7 caught (one first attempt made a syntax error and was redone) |
| `npm run lint` (`biome ci .`), `typecheck`, `check:migrations`, `check:secrets`, `check:templates`, `check:proofs`, `check:deployment-state`, `smoke`, `check:ownership --replica`, `check:office-edges --replica` | all exit 0 |
| `check:branding` | **fails on `main` too**: `web/studio/app.js:14331` (`surface: 'basecamp'`, a layout read from #442). Not touched here |

## Defects the verification found and fixed (so a reviewer knows what was close)

1. **A per-source limit of exactly the page size** made a source holding every remaining row look exhausted: a walk of one at a time returned 1 of 6 rows.
   Found by the gateway proof; the validity check replaced it, and a proof with a filter whose matches lie deeper than the newest rows now fails without it.
2. **A cursor rounded to milliseconds** (`new Date(...).toISOString()` in the gateway) skips events microseconds apart. Found by building the case; the instant is passed on as written.
3. **The first read model was 1.5 to 3.8 s a page at realistic volume**; the plan showed columns computed for rows never shown, the harness predicate run per source, and
   JIT compiling for 650 ms of a 70 ms query. Now about 100 ms, 1.6 times slower for ten times the rows.
4. **A sabotage runner that cloned a database already holding the migrations** let a sabotaged copy change only functions, so a seed-row sabotage "stayed green". The runner now strips the ledger from every clone and refuses a clone that still holds any.
5. A taxonomy test caught an id salt (`approval.decided`) that read like an event type the taxonomy does not have; renamed to `decided`.

## Remaining gaps (none hidden)

- **Seven production-catalogue checks were not run** (`check:callers`, `check:consumed`, `check:gateway-wrappers`, `check:anon-exposure`, `check:machine-key`,
  `check:office-callers`, `check:carrier-writers`): they refuse without `ALLOW_PRODUCTION_CHECKS=1`, which this work was not given. The reasoning for each is in
  `ARCHITECTURE.md` section 9; a reviewer with the flag should run them. `app.record_external_activity` is baselined with a reason.
- **Native writers**: only `system.recovered` is wired. `integration.rate_limited`, `budget.threshold_reached`, `tool.*` and `activity.corrected` are in the taxonomy and writable from SQL with no caller; a test names them.
- **Selective filters are the slow path** (severity >= error took 1.5 s at 24 000 transitions on the replica). Exact, or `partial: true`; not optimised further.
- **Index build time on production's tables is unmeasured** (`MIGRATION-PLAN.md`).
- **No rolling-deploy matrix on real versions** was run; the new-worker-on-old-schema case is proved by the missing-writer test.
- **No richer UI**; no retention job (nothing is deleted); `activity_write_failures` is not pruned.
- **The external boundary** (authenticated, scoped, per-worker) is the Hermes branch's work.

## Decisions

- **Reuse, do not copy** (ADR-0071). The existing rows are the events.
- **Migration numbers 1060 and 1061**; `main` and every other branch end at or below 1053. Re-check before applying.
- **System config key `activity.ledger_enabled`** (the key format forbids an underscore in the first segment).
- **`public.events` and `app.hq_studio_lately` are unchanged.**

## Process slips, disclosed (CLAUDE.md "File editing")

Files in the repository were changed with an editing tool throughout, except: one `sed -i` renaming the flag key in `migrations/1060_*` and one `python3`
heredoc fixing two string literals in `scripts/isolated/activity-ledger.ts` (both files created in this session, before any commit); one no-op
`sed -i.bak ... /dev/null` typed by reflex (changed nothing); one `pkill -f` that matched its own shell (exit 144, no effect); and `python3 -I` scripts in the
scratchpad and in temporary worktrees that mutate **copies** for the sabotage runs (no repository file). Files that needed formatting were rewritten with
the Write tool from `biome format` output, as the repository asks. `git stash` was used once for a comparison and restored.

## Final state

Branch `feature/unified-activity-ledger`; `git log origin/main..HEAD` lists the commits. `main` and production are untouched: the branch is based on, and
never merged into, `origin/main`; no migration was applied to any database but local replica clones; no deploy command was run.
