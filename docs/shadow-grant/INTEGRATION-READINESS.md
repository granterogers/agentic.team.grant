# Shadow Grant — integration readiness

Written at the close of the run, for Grant to decide merge order. **This
branch has not been merged and must not be self-merged.**

| | |
|---|---|
| **Starting main SHA** | `3c9415084f4b2664bf8147d995412609e58a24f8` |
| **Latest main SHA integrated** | `3c9415084f4b2664bf8147d995412609e58a24f8` — **main has not moved** |
| **Branch** | `claude/human-simulation-harness` |
| **Final branch SHA** | see `git rev-parse claude/human-simulation-harness` |
| **Commits** | 24 |
| **Migrations added** | **none** |
| **Production deployments performed** | **none** |

## Safe to merge: **YES**

## Shared files changed

**One: `package.json`.** Eight script entries appended to the end of the
`scripts` block. No dependency added, removed or moved.

```
+ "shadow:baseline"  "shadow:preferences"  "shadow:freeze"  "shadow:variance"
+ "shadow:grant"     "shadow:intake"       "shadow:sabotage" "shadow:channels"
```

If the Basecamp branch also appends scripts, git will conflict on that
region. It is the trivial kind: keep both lists. Nothing here renames or
changes an existing script.

## Files overlapping the Basecamp / UI work

**None.** Every other file is new and lives under a path this workstream owns:

```
src/simulation/     10 new files
tests/simulation/    4 new files
scripts/shadow/      8 new files
docs/shadow-grant/   5 new files
docs/spec/shadow-grant-simulation-2026-09-21.md
```

Nothing under `web/`, nothing in `src/agents/`, `src/handlers/`, `src/channels/`,
`api/`, `supabase/`, `migrations/` or `infra/`. No existing file was modified
except `package.json`.

That was deliberate and is worth stating plainly: the four product defects
this workstream found were **recorded, not fixed** (§18 — the baseline comes
before any fix), which is why a workstream that spent a day finding things has
a diff that cannot break anything.

## Focused gates

| | |
|---|---|
| `npm run shadow:sabotage` | **8 / 8 detectors proved** — each shown a defect, each went red, each restored bit-identical |
| `npm run shadow:freeze -- --check` | unchanged — the held-out corpus is comparable across this branch |
| `npm run shadow:channels` | 132 messages, 0 altered, 0 refused, 4 / 4 controls |
| `npm run shadow:baseline` | 132 scenarios, **0 hidden-intent leaks** |
| 8 fresh seeds | 1,056 unseen scenarios, **0 leaks**, one new product finding |
| `npm run shadow:grant` | 10 conversations × 4 personas |
| `npm run shadow:preferences` | §9's eleven steps, reported as a chain |
| `npx vitest run tests/simulation` | 50 passed |

## Broad gates

| | |
|---|---|
| `npm run lint` | **0** |
| `npm run typecheck` | **0** |
| `npm run test` | **1 — pre-existing and environmental, see below** |
| `npm run check:migrations` | 0 — 533 migrations, 533 applied |
| `npm run check:secrets` | 0 — 1,468 files, 55 env values, clean |
| `npm run check:templates` | 0 |
| `npm run check:leaks` | 2 — needs `SUPABASE_ACCESS_TOKEN`, unavailable in this session |

### About the one failing test

```
FAIL tests/sessions/weather-is-not-a-failure.test.ts
Error: process.exit unexpectedly called with "2"  ❯ scripts/sessions/run.ts:90
```

**All 2,256 tests pass.** One test *file* never loads, because importing it
runs a credential guard at module scope. Proved not to be this branch's:

- `git diff origin/main...HEAD` touches neither that test nor `run.ts`.
- With any non-empty `SUPABASE_ACCESS_TOKEN` the same file passes 6 / 6.

Filed as [#294](https://github.com/granterogers/agentic.team.grant/issues/294),
with the fix. It will be red on main for the Basecamp branch too.

## Migration numbering

No migration was added, deliberately — nothing in this workstream needs a
schema change, and the parallel session may be adding migrations of its own
around 0534. Nothing to reconcile.

## What a reviewer should actually check

1. **`src/simulation/isolation.ts`** — the wall. If it is wrong, every number
   in the baseline is a measurement of the harness telling the office the
   answer. `npm run shadow:sabotage` proves both of its detectors can go red.
2. **`src/simulation/canonical.ts`** — the only file that can write to shared
   infrastructure. **It has never been run**, refuses without
   `--i-have-checked-the-first-run`, and prints a checklist instead. Read that
   checklist before anybody runs it.
3. **`docs/shadow-grant/BASELINE-2026-09-21.md`** — in particular the variance
   section. The spread across seeds is about 13 points, so no single
   percentage in that document should be quoted as a reliability figure.

## What is NOT claimed

- Nothing about whether a task row appears, whether prose reads well, or
  whether a goal completes. Three of seven dimensions are `unreached` because
  this session had no credentials, and they are reported as unmeasured rather
  than assumed good.
- Nothing about routing, delegation or specialist synthesis.
- No reliability percentage from any single run.
- Nothing about Telegram or Slack beyond the local translation step.
