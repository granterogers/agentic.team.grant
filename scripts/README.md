# Scripts

About 930 TypeScript and shell scripts. Most are checks, verifications and deploy steps. You rarely need more than a handful.

## The ones to know

| Command | What it does |
|---|---|
| `npm test` | The unit suite |
| `npm run verify` | The core gate: lint, typecheck, migration ledger, tests and the secret scan |
| `npm run check:migrations` | Checks every migration is recorded in the ledger, and the ledger matches the files |
| `npm run check:secrets` | Scans the repository for secret values before a push |
| `npm run verify:wired` | Checks every control in the app has a name and a handler |
| `npm run verify:ui` | Checks the app at desktop and phone sizes: text size, touch targets and overflow |
| `npm run migrate:one -- <file>` | Applies one migration to production (with the production flags), after the change is pushed |
| `npm run deploy:hq` | Deploys the page and gateway (with the production flags) |
| `npm run deploy:worker` | Deploys the worker (with the production flags) |

## Folders

| Folder | What it holds |
|---|---|
| `sample/` | Checks and captures that run against the Sample Office only, including the README screenshots |
| `isolated/` | Checks that run against a local replica of the database, with no production contact |
| `deploy/` | The deploy steps and their probes |
| `verify/` | The verifications, one per feature |
| `gate/` | The gate that runs the whole set and fails on the first real problem |

Production flags are described in [`../docs/production-access-guard.md`](../docs/production-access-guard.md). Scripts that can touch production start by importing the gate module that refuses them unless the flags are set.
