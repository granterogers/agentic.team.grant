# Microsoft To Do: production preparation

Status: **prepared, not executed.** Nothing has been run against production. Each production read or write below needs
Grant's explicit go-ahead for that specific step (CLAUDE.md, "Production access is forbidden by default").

Code under review: branch `claude/beautiful-cannon-75w02q` at `d22e871` (pushed). Version 0.13.0. Migration `1095` is the
only new migration. The tree was clean and 469 related tests passed on this commit.

## 1. What production will receive

| Part | Where | Risk if wrong | Reversible? |
|---|---|---|---|
| Migration `1095` (additive: tables, functions, one disabled duty row) | `migrations/1095_*.sql` | Migration fails and rolls back | Additive; the duty row can be disabled |
| `worker` (new `microsoft.todo_sync` handler) | `supabase/functions/worker` | Worker fails to start | Redeploy previous version |
| `hq-api` (three operator actions, settings section) | `supabase/functions/hq-api` | Settings card cannot connect | Redeploy previous version |
| Page (Settings card and tile) | `web/studio` | Card missing or wrong | Redeploy previous page |
| `microsoft-oauth` (new consent function) | `supabase/functions/microsoft-oauth` | Connect fails | Delete or redeploy |

Until Grant presses **Connect**, the duty is disabled and nothing touches his Microsoft account. Connecting is the only
action that starts a round.

## 2. Decisions Grant must make first

**A. Which To Do list the office uses.** Today the duty uses Microsoft's **default list**, which is his personal list.
The first round would then:

- send every open office task into that list, and
- import every task already in that list into the office.

Two options:

1. **A dedicated list (recommended).** Create a new list in To Do named `Team HQ`, and have the duty use it.
   This keeps his personal list out of the office. It needs a small addition: the list id is set from a list the
   office can see, or entered once. This is **not built yet**. Say so before any production connect.
2. **The default list.** Accept the merge described above. No code change.

**B. Accepting the first-run merge.** Under option 2, every existing To Do task on the default list is imported. Pulled
tasks are then office tasks, and deleting one in the office is asked about, one question at a time, never silently.

**C. No staging run.** The staging runbook (`docs/staging-microsoft-todo.md`) was prepared but not run. Production would
be the first live call to Microsoft Graph. The mitigations are the disabled duty, the per-task delete question, and a
dedicated list (decision A). Grant accepts this, or asks for staging first.

## 3. Read-only production checks (need `ALLOW_PRODUCTION_CHECKS=1`, Grant's go-ahead)

Run from a shell with `SUPABASE_PROJECT_REF` set to the production ref and no write flag:

1. The ledger: `app.schema_migrations` highest applied is `1094` (the heartbeat migrations `1093` and `1094`, from
   branch `claude/zen-fermi-5kmv8v`), and `1095` is absent. Nothing on this branch can be applied until that branch is
   merged here (see the note at the top of section 4).
2. An operator office exists. The migration inserts the duty row for `app.operator_office()`, the first operator office.
   If none exists, the insert fails and the migration rolls back. Safe, but it must be known first.
3. `npm run check:gateway-wrappers`, `npm run check:callers` and `npm run check:anon-exposure`, against production.
   `check:callers` was passing on 22 October after 1092. A new `public` wrapper must not change that.

## 4. Writes, in this order (need `ALLOW_PRODUCTION_WRITES=1`, Grant's go-ahead for each)

The deploy scripts require a clean tree at a pushed commit (ADR-0067). `d22e871` is pushed. Do not deploy from a dirty
tree.

1. **Migration:** `npm run migrate:one -- migrations/1095_a_microsoft_todo_connection_is_an_office_connection.sql`
   (with `SUPABASE_ACCESS_TOKEN` and `ALLOW_PRODUCTION_WRITES=1` in the shell only). Confirm the ledger is 1095.
2. **Worker:** `npm run deploy:worker`. Its probe must pass.
3. **hq-api:** `npm run deploy:hq-api`. Probe: unauthenticated 401, authenticated 200.
4. **Page:** `npm run deploy:hq` (page and hq-api together), or `npm run deploy:hq-page` if only the page changed. Probes
   must pass.
5. **Consent function:** `SUPABASE_PROJECT_REF=baujwlzcziasnfhhkchg npm run deploy:microsoft-oauth`. The ref is set
   explicitly; the script has no default. Its probe must answer 400 to a start with no state.
6. **Record:** update `docs/ops/deployment-state.json` in the same commit as the deploy record. `npm run
   check:deployment-state` must pass.

## 5. Grant's steps (portal, cannot be automated)

1. Open https://entra.microsoft.com and sign in with the Microsoft account that owns the To Do lists.
2. Identity > Applications > App registrations > New registration. Name: `Team HQ`. Supported account types:
   **Personal Microsoft accounts only**.
3. Redirect URI, type **Web**, exactly:
   `https://baujwlzcziasnfhhkchg.supabase.co/functions/v1/microsoft-oauth/callback`
4. Copy the **Application (client) ID**.
5. Certificates & secrets > New client secret. Copy its **Value**, not the Secret ID. Microsoft shows it once.
6. API permissions > Add a permission > Microsoft Graph > Delegated: `Tasks.ReadWrite` and `offline_access`.
7. In the production page, Settings, the **Microsoft To Do** card: paste the client id and secret value, press **Save**,
   then **Connect Microsoft To Do**. Consent, then return to Settings with `?microsoft=connected`.

Do not paste the client secret into chat. It goes only into the card, which stores it in the vault.

## 6. After connecting

- The card should show the connection working and the list name.
- Within 15 minutes, one round runs. Its result appears as an Activity line beginning "Microsoft To Do:".
- A round that cannot reach Microsoft says so in the card. Nothing is changed on either side in that case.

## 7. Rollback

- **Stop the sync, keep everything:** press **Disconnect** in the card. It removes the links, list, health and refresh
  token, and keeps every task. The client id and secret are kept.
- **Stop the duty without disconnecting:** `update public.responsibilities set enabled = false where slug =
  'microsoft-todo-sync'` for the office. Needs a production write and its own go-ahead.
- **Code:** redeploy the previous worker, hq-api and page versions. Migration `1095` is additive and stays.

## 8. Known limits (ADR-0076)

- Urgent and important both sync as "high"; an urgent task edited in Microsoft comes back as important.
- Due dates are the day only.
- Personal accounts only: no administrator consent is involved.
- Choosing a list other than the default is not built (decision A).
- The first live Graph call will be production (decision C).
