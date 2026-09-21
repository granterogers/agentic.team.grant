# Deployment reconciliation — 21 September 2026

## What is live, and how that is known

| Change | Where it lives | Live? | How proved |
|---|---|---|---|
| 0535 terminal-failure journal | DB trigger | **yes** | `tgenabled = O` |
| 0536 a resumption is not a retry | DB function | **yes** | `verify:resumes` |
| 0537/0538 backup + progress readings | DB | **yes** | `verify:backups` |
| 0540 chore delegation | DB | **yes** | the reachability check drives the *deployed* hourly door |
| **0541/0542 the escape guard** | DB triggers + `harness_job` | **yes** | see below — proved *through the deployed worker* |
| **0543/0544 the backup pager** | DB + pg_cron | **yes** | Telegram answered `200 message_id 1266` |
| `hq-api` worker kick | edge function | **yes** | deployed 18:47; re-proved at 4 s pickup |
| **`src/db/executor.ts` 5xx retry** | worker bundle | **NO** | see the dependency below |
| **`src/handlers/chores.ts` backup pass** | worker bundle | **NO**, and it does not matter — 0540 delegates from SQL | the reachability check |

### The escape guard is live for the deployed worker, and that was not assumed

`verify:artifact-slack` runs end to end **through the deployed worker** — its
own checks say *"the deployed worker took the request and finished with it —
complete"* and *"the report job finished"*. That worker then attempted a Slack
delivery and the delivery row came back **`suppressed`**. So the guard applies
to the production worker as deployed, with no deploy of mine, because it lives
entirely in `app.claim_delivery`'s callees rather than in the worker's bundle.

That was the design intent of putting it in the database and it is the reason
the most important fix of this run needed no deployment at all.

## Why the worker was NOT deployed

`worker` was redeployed at **21:48 UTC on 21 September** — during this session,
by the parallel Shadow Grant workstream. `claude/human-simulation-harness`
carries **20+ changed files under `src/`** that this branch has never seen:

```
src/agents/mine.ts          src/agents/retraction.ts    src/agents/teaching.ts
src/agents/understand.ts    src/handlers/instruction.ts src/migrations/check.ts
src/simulation/*            (13 files)
```

This branch's `src/` changes are three files, two of which go into the worker
bundle:

```
src/db/executor.ts          src/handlers/chores.ts      supabase/functions/hq-api/index.ts
```

`npm run deploy:worker` publishes **this branch's whole `src/`**. Doing that
now would overwrite a worker built minutes ago from a branch with twenty more
changed files, silently rolling back their work. That is the one thing a
parallel run's deployment policy forbids, so the deployment step is stopped
here rather than attempted.

Building a merged tree locally and deploying that was considered and rejected:
it would put code that exists in no branch, and that nobody has reviewed, into
production under this workstream's name.

## THE EXACT DEPENDENCY, and what must be verified after integration

**Dependency:** `src/db/executor.ts`'s `status >= 500` retry is not in the
deployed worker, and cannot be until this branch and
`claude/human-simulation-harness` are integrated and the worker is deployed
from the merged result.

**Consequence while it is undeployed:** a transient Management-API 5xx on the
worker's fallback path is raised as though Postgres had answered, which burns
a job attempt. 0536 narrows the exposure — a job making checkpoint progress no
longer spends attempts — but it does not remove it.

**After integration, verify:**

1. `npm run deploy:worker` from the merged branch, and record the version.
2. That the merged `src/db/executor.ts` still contains `status >= 500`, and
   `npm test -- tests/db/` passes (6 gateway tests).
3. That `src/handlers/chores.ts` still calls `app.chores_for_backups` — and
   note it will then run TWICE per pass, once from the handler and once from
   0540's delegation. That is harmless by construction and asserted:
   `verify:backups` drives the pass twice and requires exactly one open chore.
4. `npm run verify:escapes` and `npm run verify:backups` against the deployed
   worker, to confirm neither the guard nor the pager regressed across the
   merge.
