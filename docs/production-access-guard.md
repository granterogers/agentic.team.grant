# Production-access guard

**Status:** implemented on branch `claude/ux-closure-guard` (HQ ledger row *production-access guard*).
**Code:** `src/safety/production-gate.ts` (the single definition), `src/safety/arm.ts`, `src/safety/require-production-*.ts`.
**Tests:** `tests/safety/production-gate.test.ts`, `tests/safety/production-gate-coverage.test.ts`, `tests/safety/coverage-lib.ts`.
**Manifest:** `docs/testing/production-access.json` (which npm commands write, which only inspect).

## Why

A previous autonomous run executed read-only production catalogue queries (`check:gateway-wrappers`, possibly `check:callers`
and `check:consumed`) for no better reason than that production credentials were present in its environment. Having a
credential is not permission to use it. The default is now **refusal**: a Node process about to reach production is stopped
before anything is sent unless a person said so, on that command line.

## The two switches

| Environment variable | Meaning | Needed by |
|---|---|---|
| `ALLOW_PRODUCTION_CHECKS=1` | Any contact with production: reads, catalogue queries, the vault, the deployed gateway, a browser pointed at the deployed site. | every inspection command, every `verify:*` suite that reaches production |
| `ALLOW_PRODUCTION_WRITES=1` | **In addition to** the above. Anything that writes, deploys, sends, stores a credential, or drains the queue. | `deploy:*`, `migrate`, `migrate:one`, `purge:fixtures`, `slack:*`/`telegram:*`/`notebook:*`/`notion:*` operators, `vault:export`, `work`, `step`, `notify`, `sample:seed|reset`, production-heavy suites, a Management API deploy/secret/config request |

Only the exact string `1` counts (`true`, `yes`, `0`, empty and ` 1` do not). Writes never imply checks and checks never imply
writes. Merely holding `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_DB_URL` is **not**
enough, and the refusal does not look at them at all: it is a property of the target.

On purpose:

```
ALLOW_PRODUCTION_CHECKS=1 npm run check:callers
ALLOW_PRODUCTION_CHECKS=1 ALLOW_PRODUCTION_WRITES=1 npm run deploy:worker
```

The refusal says what was refused, why, and the exact line to use:

> REFUSED: the Supabase Management API (SQL) would contact PRODUCTION (a read). Having Supabase credentials in the environment is
> not permission: an earlier autonomous run touched the real office by accident because they were there, so production access is
> off unless a person turns it on. To do this on purpose, run it as: ALLOW_PRODUCTION_CHECKS=1 <the same command>. Nothing was
> sent. Local work (the replica in scripts/isolated, unit tests, the static studio) needs no flag.

The message carries the method, origin and path only - never a query string or a credential.

## What counts as production

`isProductionUrl` (one list, in `production-gate.ts`): `*.supabase.com` (the Management API), `*.supabase.co` / `*.supabase.in`,
`*.vercel.app`, any URL containing the project ref, and any non-local host named by `SUPABASE_URL`, `HQ_API_URL`, `HQ_URL`,
`SUPABASE_DB_URL` or `DATABASE_URL`. `isRemotePgTarget` treats a Postgres connection as production unless it is a Unix socket or
localhost. Localhost, `127.*`, `::1` and `*.local` are never production, so a test pointing `ManagementApiExecutor` at a fake base
URL, the static studio server and the replica need **no flag**.

**Inert in Deno and where there is no `process`.** The edge worker *is* the production office; this gate protects build sessions and
operators and must never stop the office running itself. `supabase/functions/**` bundles `src/db/executor.ts`, which imports the
gate; the gate reads the environment only through `globalThis` and does nothing under Deno.

## Where it is enforced (choke points first)

1. **`ManagementApiExecutor`** (`src/db/executor.ts`): refuses in the constructor *and* in `execute`, before the first byte. 311 files
   construct one, including the vault readers (`readCredential`), `npm run q` / `qq`, and every `check:*`. This is the choke point for
   almost everything.
2. **`PgExecutor`** (`src/db/pg-executor.ts`): refuses a non-local connection in the constructor. It is the *only* file that imports
   `pg` (asserted by a test). `scripts/isolated/guard.ts` builds `postgresql://postgres@/<db>?host=<socket>` and is unaffected.
3. **The global `fetch` guard** (`installProductionFetchGuard`, armed by importing `src/safety/arm.ts` or by importing the executor):
   every raw `fetch` to a production host is checked first. A Management API request that deploys a function or changes secrets,
   config, the DB password or keys with a non-GET method, any PUT/PATCH/DELETE, and any non-GET to Vercel needs the writes flag.
   A `POST .../database/query` is SQL of unknown effect: it needs checks, and the commands that write say so themselves (4).
4. **Entry modules**, imported *first* in a script so it refuses before any other module runs, and only when the process was started
   from `scripts/` (`isScriptEntry`), so a unit test importing a script's exported helpers needs no flag:
   `require-production-writes` (68 entry files), `require-production-checks` (50), `require-production-site` (browser suites that fall
   back to a deployed URL: refused unless a site variable names a local server), `require-production-if-targeted` (local by default,
   refused when `PAGE`/`BASECAMP_SITE`/`HQ_URL` points at production).
5. **`scripts/suite-guard`** (`src/db/suite-guard.ts`, existing): a production-heavy suite already needed `HQ_PRODUCTION_INTENT=1`
   (`npm run suite -- x --production`, `gate`, `e2e`). It now **also** needs the writes flag, because a heavy suite writes fixtures.
6. **`scripts/db-query.sh`** (curl to the Management API): refuses at the top unless `ALLOW_PRODUCTION_CHECKS=1`.
7. **GitHub Actions workflows** that a person dispatches and that run production commands set the flags at workflow level
   (`backup`, `db-doctor` checks only, `slack-rotation`, `sync`, `telegram-login`, `vault-export`, `worker`). `ci.yml` does not.

`npm run suite` and `check:suite-classes` import the passive `arm` only: `suite` reads the project health API only when it is about to
run a production-class suite, and that request is refused by the fetch guard if the flag is missing.

## Verification that nothing bypasses it

`tests/safety/production-gate-coverage.test.ts` derives everything from `package.json` and the `scripts/` tree:

* every npm script whose import closure names a production target (`ManagementApiExecutor`, `PgExecutor`, the credential variables,
  `api.supabase.com`, `*.supabase.co`, `*.vercel.app`, `functions/v1`) has a gate module in its closure (>200 scripts);
* the same for **every** `.ts` file under `scripts/` (not only those named in `package.json`);
* any script named `deploy:*`, `migrate*` or `purge:*` must be in the manifest's `writes`; a new one cannot skip it;
* every manifest entry exists, and its entry file's **first** import is the right `require-production-*` module;
* `pg` is imported in exactly one place;
* the shell wrapper refuses before it builds a request;
* controls prove the detector can fail on an in-memory tree (a script with no gate, a gate that is only a comment, a wrong import order,
  a removed import) - and the real sabotage was run by hand: deleting the `arm` import from `scripts/verify/serve-studio.ts`, the
  `require-production-writes` import from `scripts/migrate.ts`, and adding a `deploy:newthing` to `package.json` each turned the suite
  red; each was restored and the suite returned to green.

`tests/safety/production-gate.test.ts` proves the refusal with **fake credentials set and the flag unset** and a fetch spy that is never
called (executor constructor, executor execute, raw guarded fetch, remote `PgExecutor`), that the flag lets the call through (the spy is
then called exactly once), the message text, the second-level writes gate (checks alone, writes alone, "true" - all refused), that
`migrate` and `check:gateway-wrappers` are refused as real subprocesses with a dead proxy configured, and that the replica path and
`scripts/isolated/guard.ts` are unaffected.

## Source provenance (6 October 2026, ADR-0067)

Holding the right flags is not the same as shipping something that exists. A deploy or a migration run (`scripts/deploy/*`, `scripts/migrate.ts`,
`scripts/migrate-one.ts`; not a `--dry` list) is ALSO refused unless its source is attributable: a git checkout, a tree with nothing dirty where it
ships (untracked files count; `docs/`, `tests/` and `.out/` do not ship), and a HEAD that is on a remote-tracking branch. It is asked once, in
`src/safety/require-production-writes.ts`, from the command being run, so a new deploy script is covered the day it is written
(`tests/safety/provenance.test.ts` asserts every file in `scripts/deploy/` is). The history checks (`checksum/missing`, `checksum/modified`, a
duplicate or lost number) live in the migration runner and have no switch. The single bypass is `ALLOW_UNPROVENANCED_DEPLOY="<reason, 20+
characters>"`: a sentence, logged to the screen and `.out/provenance-bypass.log`, waiving only the source checks. Do not use it to make a check
pass. "On a remote" means as of the last `git fetch`; the refusal says to push.

## Residual - what this does not guard, and why

* **Third-party APIs reached with their own keys** (OpenRouter, Slack, Telegram, Notion, Google, GitHub). They are not Supabase and not
  our deployments. Nearly every key is in the vault, which is read through the guarded Management API, so the realistic path is gated
  transitively. A key supplied directly in an environment variable is not gated.
* **A browser's own requests.** A Playwright page that was pointed at production calls it from the browser, not from Node. Browser suites
  that default to a deployed URL carry `require-production-site`; one pointed at production through an unlisted variable is not caught.
* **A command that does not start from `scripts/`** (`node -e`, an REPL) is covered by the runtime choke points (1-3) but not by the entry
  modules.
* **`scripts/vikunja-dev.sh`** and the Python notebook scripts do not reach Supabase.
* **Granularity of the entry gate is per file**, not per flag: `scripts/projects/manage.ts`, `scripts/sample/sample.ts` and `scripts/step.ts`
  each serve read and write sub-commands and need both flags for all of them.
* **SQL effect is not classified.** A `database/query` is never inspected, so a command that only needs checks could still write if it
  was written to; the writes list is by command, and heavy suites are covered by the suite classes.

## Inventory

Class: **none** touches no production target; **read** = needs `ALLOW_PRODUCTION_CHECKS=1`; **WRITES** = needs both; **suite** =
a `verify:*`/`poc:*`/`e2e`/`gate` verification suite, checks by the choke points and writes (heavy class) by `suite-guard`.

| Family | Commands (examples) | Contacts | Read / write | Guarded by |
|---|---|---|---|---|
| Deploys | `deploy:*` (16) | Management API admin, Vercel, functions | writes | entry writes + fetch guard (admin paths) |
| Migrations / purge | `migrate`, `migrate:one`, `purge:fixtures` | Management API SQL | writes | entry writes + executor |
| Operators that send or store | `slack:*`, `telegram:*`, `notebook:*`, `notion:*`, `vault:export`, `mcp:revoke`, `hq:token`, `bootstrap:*`, `backup:store-key|now|notify|rehearse`, `project`, `sample:seed|reset`, `office:second-person`, `step`, `notify`, `team:hello`, `avatars*`, `providers:discover`, `work`, `sync` | SQL, vault, third-party via vault | writes | entry writes + executor |
| Catalogue and drift checks | `check:callers`, `check:consumed`, `check:gateway-wrappers`, `check:anon-exposure`, `check:icons`, `check:leaks`, `check:answerable`, ... | Management API SQL, hq-api | read | entry checks + executor |
| Supabase forensics (p4, 5 Oct) | `forensics:capture`, `forensics:logs`, `forensics:usage`, `forensics:metrics` | Management API (collectors, token); `forensics:temp-logging` PUTs a Postgres config override | read; `forensics:temp-logging` **writes** (even its dry run needs both flags: the script can send a config PUT) | entry checks / writes + fetch guard (`common.ts` arms it). `forensics:preserve`, `:timeline` read local evidence files; `:idle-pass`, `:job-cost` run on a marked local replica: none |
| Ad-hoc queries | `q`, `qq`, `scripts/db-query.sh` | Management API SQL | read (SQL arbitrary) | entry checks / shell guard + executor |
| Measurement | `measure`, `levels`, `breadth`, `matrix`, `mutate`, `eval`, `replay`, `session`, `delegation*`, `incident:snapshot`, `inventory`, `audit:credentials` | SQL, vault, model providers | read | entry checks + executor |
| Production suites | `verify:*` (production-heavy 181), `poc:*`, `e2e`, `gate`, `gate:safe` | SQL, hq-api, deployed pages | writes fixtures | executor/fetch (checks) + `suite-guard` (writes) |
| Deployed-site browser suites | `verify:basecamp-*-live`, `verify:cors`, `verify:design`, `live:mirror`, `p6/live-entry` | deployed pages, hq-api | read | entry site + fetch guard |
| Local replica | `verify:isolated`, `scripts/isolated/*` | marked Unix socket only | local | not production by construction (`isRemotePgTarget`) |
| Local UI and static checks | `lint`, `typecheck`, `test`, `shots`, `smoke`, `verify:layouts`, `check:templates`, `check:migrations`, `check:branding` | none | none | passive `arm` where a production host is merely named |

### Every npm command

| Command | Class | Contacts | Guard |
|---|---|---|---|
| `lint` | none | - | - |
| `lint:fix` | none | - | - |
| `typecheck` | none | - | - |
| `test` | none | - | - |
| `test:watch` | none | - | - |
| `check:migrations` | none | - | - |
| `check:leaks` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `check:templates` | none | - | - |
| `verify:arrangement` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:wired` | none | - | - |
| `incident:snapshot` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `sample:fingerprint` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `verify:google-connect` | none | - | - |
| `check:secrets` | none | - | - |
| `check:gateway-wrappers` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `trust:proxy-ca` | none | - | - |
| `verify` | none | - | - |
| `migrate:one` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `migrate` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `notify` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `step` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `smoke` | none | - | - |
| `verify:breaks` | none | - | - |
| `verify:cors` | read | Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-site` + fetch guard |
| `verify:wrappers` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:layouts` | none | - | - |
| `verify:controls` | none | - | - |
| `verify:controls:studio` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:controls:team` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:controls:settings` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `shots` | none | - | - |
| `board` | none | - | - |
| `probe` | none | - | - |
| `space` | none | - | - |
| `system` | none | - | - |
| `verify:harness` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:history` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:access` | none | - | - |
| `verify:chat` | none | - | - |
| `verify:dictation` | none | - | - |
| `verify:transport` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:channels` | none | - | - |
| `verify:equivalence` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:conversation-all` | none | - | - |
| `verify:echo` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `wide` | none | - | - |
| `verify:github-token` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `notion:import` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `verify:ledger` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:jobs` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:journals` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:impediments` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:notice` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:delegation` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:decisions` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:drive` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:failures` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:corpus` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:modules` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:times` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:waiting` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:conversation` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:handoff` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:knows` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:governs` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:references` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:addressing` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:files` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:settings` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:search` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:graph` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:send` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:import` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `e2e` | WRITES | Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `verify:proposes` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:acquire` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:sheets` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:dryrun` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:briefing` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:lessons` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:context` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:preferences` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:rules` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:routing-quality` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:extract` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:trace` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:tasks` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:answers` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:asks` | none | - | - |
| `verify:attests` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:assets` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:transitions` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:db` | none | - | - |
| `backup:manifest` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `backup:connection` | read | Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `verify:restore` | suite | Management API (SQL, vault); Postgres (remote only if not a socket); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:credentials` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `bootstrap:backup-credentials` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `backup:credentials` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `bootstrap:db-password` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `backup:roles` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `providers:discover` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `verify:fallback` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:router` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `slack:rotate` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `telegram:configure` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `deploy:telegram` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `audit:credentials` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-checks` + executor + fetch guard |
| `verify:all` | none | - | - |
| `deploy:page` | WRITES | Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-writes` (both flags) + executor + fetch guard |
| `poc:gate-5` | none | - | - |
| `poc:gate-3` | none | - | - |
| `deploy:slack` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `slack:configure-events` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `poc:gate-4` | none | - | - |
| `poc:gate-2` | none | - | - |
| `notebook:import` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `notebook:learning` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `notebook:probe` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `notebook:bootstrap` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `notebook:deploy` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `sync` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `sync:status` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `verify:sync` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `brief` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `purge:fixtures` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `verify:agents` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:approval` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `avatars` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `verify:autonomy` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:undo` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:learning` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `avatars:png` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `verify:worker` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:slack` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:tts` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:telegram` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `avatars:photo` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `textures` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `textures:sheet` | none | - | - |
| `deploy:hq` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-writes` (both flags) + executor + fetch guard |
| `deploy:hq-api` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `deploy:slack-oauth` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `deploy:voice` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-writes` (both flags) + executor + fetch guard |
| `slack:tidy` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `slack:backfill` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `hq:token` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-writes` (both flags) + executor + fetch guard |
| `deploy:signin` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-writes` (both flags) + executor + fetch guard |
| `deploy:hq-basecamp` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `deploy:signin-origin` | WRITES | Management API (admin: ONE function secret, `SIGNIN_ALLOWED_ORIGIN`); deployed gateway/functions (refusal probes only) | entry `require-production-writes` (both flags) + fetch guard |
| `deploy:ux-review` | WRITES | Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-writes` (both flags) + executor + fetch guard |
| `deploy:voice-basecamp` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `verify:signin` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:hq` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `backup:notify` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `export:portable` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `inventory` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-checks` + executor + fetch guard |
| `slack:repair-refs` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `ask` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `search` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `verify:knowledge` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:unified` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:artifact` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:artifact-slack` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:stop` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:review` | none | - | - |
| `verify:organising` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:recovery` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:resumes` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:mytasks` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:schema` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `slack:rename-channels` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `notion:sync` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `verify:calendar` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:capability` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:notion` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `telegram:roster` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `telegram:configure-staff` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `backup:rehearse` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `backup:store-key` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `backup:now` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `verify:latency` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:scenario-a` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:cross-interface` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:capabilities` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:chaos` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:security` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:sequence` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:shapes` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `setup:python` | none | - | - |
| `deploy:mcp` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `mcp:revoke` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `verify:mcp` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `work` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-writes` (both flags) + executor + fetch guard |
| `vault:export` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `project` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `telegram:webhooks` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `slack:introductions` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `avatars:cartoon` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `notebook:slides` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `notebook:tidy` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `team:hello` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `telegram:recover-chats` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `verify:oauth` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:portfolio` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `deploy:worker` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `deploy:google` | WRITES | Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-writes` (both flags) + executor + fetch guard |
| `telegram:login` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `telegram:bots` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `verify:mail` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `telegram:avatars` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `telegram:rollcall` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `verify:ui` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:talk` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:identity` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:inverse` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:github` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:connections` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:notion-write` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `notion:adopt` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `verify:skills` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:boundary` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:disconnect` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `eval` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `replay` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-checks` + executor + fetch guard |
| `verify:judge` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:pulse` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:motion` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:offline` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:design` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-site` + fetch guard |
| `gate` | WRITES | Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `gate:safe` | WRITES | Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `deploy:hq-page` | WRITES | Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-writes` (both flags) + executor + fetch guard |
| `verify:run1-live` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:run2-live` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:run3-live` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:run3-effects-live` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:run4-live` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `coverage` | none | - | - |
| `verify:duties` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:notebook` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:google-live` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `q` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `verify:drains` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:escapes` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:roster` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `breadth` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `session` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `tier1` | none | - | - |
| `tier1:fast` | none | - | - |
| `levels` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `matrix` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `mutate` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `qq` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `verify:collaborates` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:routing-breadth` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:routing-heldout` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `measure` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `verify:reach` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:recovers` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:controls:project-a` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:controls:project-b` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:controls:project-phone-a` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:controls:project-phone-b` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:keyboard` | none | - | - |
| `verify:map` | none | - | - |
| `verify:routes` | none | - | - |
| `verify:documents` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:print` | none | - | - |
| `verify:budget` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `check:icons` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `check:branding` | none | - | - |
| `check:callers` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `check:pressable` | none | - | - |
| `check:capabilities` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `check:consumed` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `check:suite-classes` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | passive `arm` (fetch guard) |
| `suite` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | passive `arm` (fetch guard) |
| `sample:status` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `sample:seed` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `sample:reset` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `sample:use` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `sample:lesson` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `sample:notice-link` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `sample:channel-link` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `verify:slack-link` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:phone-header` | none | - | - |
| `verify:file-text-corpus` | none | - | - |
| `verify:file-text-docx` | none | - | - |
| `verify:slack-card` | none | - | - |
| `verify:dialogs` | none | - | - |
| `sample:documents` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `sample:confirm-ux` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `sample:envelope-canary` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `sample:dock` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `sample:labels` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `verify:incidents` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:named-project` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:delivery-office` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:channel-link` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `sample:tour` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `sample:chat` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `sample:voice-answer` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `sample:voice` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) |
| `sample:inventory` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `sample:intelligence` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) |
| `sample:activity` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `sample:chat-status` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `sample:product` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `sample:shots` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `verify:sample-settings` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:account-lifecycle` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:sample-tool-requests` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:google-reconnect` | none | - | - |
| `verify:account-ui` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:entry-ui` | none | - | - |
| `verify:capability-claims` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `check:tokens` | none | - | - |
| `verify:lately` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `slack:add-scope` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `verify:upload` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `slack:archive-identity-probes` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `fontmetrics` | none | - | - |
| `verify:checkpoints` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:parallel` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:triggers` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:connectors` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:browser` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:browse-live` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:form-rules` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:browse-asked` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `shot:browser` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `verify:ci` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `check:reachable` | none | - | - |
| `mapview` | none | - | - |
| `verify:task-state` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:approval-race` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:retry-writes` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:tasks-ui` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-if-targeted` + fetch guard |
| `vikunja:dev` | none | - | - |
| `verify:vikunja` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `check:one-brain` | none | - | - |
| `verify:anchors` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:progress` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:plans` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:plan-stability` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:pursues` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:composes` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:chief` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:understands` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `shadow:baseline` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `shadow:preferences` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `shadow:freeze` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `shadow:variance` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `shadow:grant` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `shadow:intake` | none | - | - |
| `shadow:coherence` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `shadow:sabotage` | none | - | - |
| `shadow:channels` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `shadow:world` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `shadow:matrix` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `shadow:probe-live` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `shadow:alignment` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) |
| `migrate:next` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `check:provenance` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `verify:backups` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:obligation` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `delegation` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `delegation:delta` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `verify:another-go` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `check:standing` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `verify:withdraw` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `check:chatter` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `verify:lastword` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `check:undo` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `check:believes` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `check:anon-exposure` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `check:system-secrets` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `check:machine-key` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `check:ownership` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `check:office-edges` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `check:office-conversion` | none | - | - |
| `check:office-gateway` | read | Management API (SQL, vault); Postgres (remote only if not a socket); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `verify:p3-app` | suite | local replica (marked Unix socket); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `p3:inventory` | read | Management API (SQL, vault); Postgres (remote only if not a socket); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `check:office-raw-sql` | none | - | - |
| `office:second-person` | WRITES | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-writes` (both flags) + executor + fetch guard |
| `check:arity` | read | Management API (SQL, vault); Postgres (remote only if not a socket); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `check:carrier-writers` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `check:suite-offices` | none | - | - |
| `check:answerable` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions | entry `require-production-checks` + executor + fetch guard |
| `check:voice-sessions` | read | Management API (admin); deployed gateway/functions | passive `arm` (fetch guard) |
| `check:door-origins` | none | - | - |
| `verify:basecamp-routes` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:drive-live` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:chat-live` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:contacts-live` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-livevoice` | suite | Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:voice-note-live` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-chat` | suite | Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-drive` | suite | Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-voice-session` | suite | Management API (SQL, vault); Postgres (remote only if not a socket); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-project-turn` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:team-hq-journey` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-stale-answer` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-voicenote` | suite | Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-touch` | suite | Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-failures` | suite | Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-torture` | suite | Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-affordance` | suite | Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `live:mirror` | read | Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-site` + fetch guard |
| `verify:basecamp-words` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-settings` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-voice` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-contacts` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-back` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-docs` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-look` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-reconcile` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-live` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-site` + fetch guard |
| `verify:basecamp-signin` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-site` + fetch guard |
| `verify:basecamp-todos-live` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-site` + fetch guard |
| `verify:basecamp-arrangement-live` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-site` + fetch guard |
| `verify:basecamp-docorder-live` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-site` + fetch guard |
| `verify:basecamp-cards` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-todos` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-board` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:workspace` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:calendar-ui` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:docs-ui` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:palette` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:activity-ui` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:ux-motion` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:ux-a11y` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:style-ui` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `basecamp:shots` | read | Management API (admin); deployed gateway/functions | passive `arm` (fetch guard) |
| `basecamp:measure` | read | Management API (admin); deployed gateway/functions | passive `arm` (fetch guard) |
| `verify:basecamp-actions` | none | - | - |
| `verify:basecamp-journey` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-keyboard` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-preservation` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-classes` | none | - | - |
| `verify:basecamp-states` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `basecamp:gate` | none | - | - |
| `basecamp:gate2` | none | - | - |
| `verify:basecamp-controls` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:basecamp-covered` | none | - | - |
| `basecamp:compose` | read | Management API (admin); deployed gateway/functions | passive `arm` (fetch guard) |
| `verify:basecamp-home` | suite | Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `review:build` | read | deployed pages / Vercel | executor / fetch guard (checks) |
| `config:site` | read | Management API (admin); deployed gateway/functions | passive `arm` (fetch guard) |
| `check:backend-ref` | read | Management API (admin); deployed gateway/functions | passive `arm` (fetch guard) |
| `deploy:preview` | WRITES | Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-writes` (both flags) + executor + fetch guard |
| `verify:basecamp-photo` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-site` + fetch guard |
| `verify:basecamp-waiting` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-site` + fetch guard |
| `verify:basecamp-running` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-site` + fetch guard |
| `verify:basecamp-sources` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-site` + fetch guard |
| `verify:basecamp-team` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-site` + fetch guard |
| `verify:basecamp-addsource` | read | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | entry `require-production-site` + fetch guard |
| `verify:final-audit-live` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:policy-live` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:isolated` | suite | local replica (marked Unix socket) | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |
| `verify:run5-live` | suite | Management API (SQL, vault); Management API (admin); deployed gateway/functions; deployed pages / Vercel | executor / fetch guard (checks) + `suite-guard` (heavy needs writes) |

### Integration note (5 October 2026)

p4's forensics collectors reached this guard AFTER it was written, with `SUPABASE_PROJECT_REF` defaulting to the production ref
(`baujwlzcziasnfhhkchg`) in `common.ts`, `temp-files-logging.ts` and many older scripts. A script run without the variable therefore
targets production by default; the guard then refuses it without the flag, which is the intended failure. For staging, the
variable must be set explicitly (the staging preflight, `npm run staging:preflight`, refuses an unset ref).

### Staging binding (5 October 2026)

The flags cannot tell staging from production. In a shell with `TARGET_ENVIRONMENT=staging`, `npm run staging:preflight` writes
`.staging/attestation.json` (identifiers only, 8 hours), and `assertProductionChecksAllowed` / `assertProductionWritesAllowed`
then also require that the attestation exists, is unexpired, still matches the environment, and that the target actually
contacted (a `<ref>.supabase.co` host, a Management API `/projects/<ref>` path, a database host, a `*.vercel.app` page) is the
attested project or site. Enforced at the same choke points as the flags: the executors, the fetch guard and every command entry.
A shell that does not say staging is not bound. See `src/safety/staging-binding.ts` and `tests/staging/binding.test.ts`.
