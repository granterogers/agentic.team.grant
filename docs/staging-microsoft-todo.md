# Testing Microsoft To Do on staging

Runbook for trying the Microsoft To Do sync against a live Microsoft account on a **staging** deployment, before anything
reaches production (ADR-0076, and the staging plan in `docs/staging-handoff-plan.md`). Production is not contacted at any
step. Staging is a separate Supabase project, a separate Vercel preview and a separate Microsoft app registration.

Secret values never go in chat, in a commit or in a file in the repository. The Microsoft client secret goes into the
Settings card, which stores it in the vault. Supabase and Vercel tokens stay in your shell for the session only.

## Who does what

- **You** create the Supabase project, the Vercel preview and the Microsoft app registration. These are portal steps and
  cannot be done from here.
- **Claude** runs the checks, the deploys and the migration once you have the staging values and the go-ahead.

## 1. Create the staging Supabase project

1. Open https://supabase.com/dashboard and choose **New project**. Name it `innergy-office-staging`, pick the region
   nearest you, and keep the free plan.
2. When it is ready, copy the project ref. It is the part of the address after `/project/`, 20 letters and digits.
   This is `<staging-ref>` below.

## 2. Create the staging Microsoft app registration

1. Open https://entra.microsoft.com and sign in with the Microsoft account that owns the To Do lists you want to test
   with.
2. Go to **Identity > Applications > App registrations > New registration**.
3. Name it `INNERGY Office (staging)`. Under **Supported account types** choose **Accounts in any organizational
   directory and personal Microsoft accounts**.
4. Under **Redirect URI** choose **Web** and enter exactly:
   `https://<staging-ref>.supabase.co/functions/v1/microsoft-oauth/callback`
5. Press **Register**. On the Overview page, copy the **Application (client) ID**. This is `STAGING_MICROSOFT_CLIENT_ID`.
6. Go to **Certificates & secrets > New client secret**. Copy its **Value** (not the Secret ID) into your password
   manager. Microsoft shows it once. You will paste it into the Settings card later.
7. Go to **API permissions > Add a permission > Microsoft Graph > Delegated permissions**. Tick `Tasks.ReadWrite` and
   `offline_access`, then press **Add permissions**.

## 3. Name the production identifiers, so staging refuses them

Create the local, git-ignored file `.staging/production-identifiers.json` with the production identifiers the preflight
must refuse:

```json
{ "refs": ["baujwlzcziasnfhhkchg"], "hosts": [], "identifiers": [] }
```

## 4. Set the staging shell and pass the preflight

Open a new terminal used only for staging. Print the variable list, then set each value:

```bash
npm run staging:preflight -- --template
```

The values to set are:

- `TARGET_ENVIRONMENT=staging`
- `SUPABASE_PROJECT_REF=<staging-ref>` and `STAGING_EXPECT_REF=<staging-ref>`
- `STAGING_GATEWAY_URL=https://<staging-ref>.supabase.co/functions/v1/hq-api`
- `STAGING_WORKER_URL=https://<staging-ref>.supabase.co/functions/v1/worker`
- `STAGING_STORAGE_URL=https://<staging-ref>.supabase.co/storage/v1/`
- `STAGING_SITE_URL=<the Vercel preview address>`
- `VERCEL_ENV=preview`
- `STAGING_MICROSOFT_CLIENT_ID=<the Application (client) ID from step 2>`
- `STAGING_GOOGLE_CLIENT_ID=unused`, `STAGING_TELEGRAM_BOT=unused`, `STAGING_SLACK_TEAM=unused`,
  `STAGING_VIKUNJA_URL=unused` (these integrations stay off in staging)

Then run:

```bash
npm run staging:preflight
```

It must print `STAGING PREFLIGHT PASSED`. Anything else means do not continue: the preflight names the field that failed.

## 5. Tokens for the session

Set `SUPABASE_ACCESS_TOKEN` in the same staging shell, from your Supabase account. Do not paste it into chat.

## 6. Build the staging database

From the staging shell, with the two production-access flags set for the staging target only:

```bash
ALLOW_PRODUCTION_CHECKS=1 ALLOW_PRODUCTION_WRITES=1 npm run migrate
```

This replays every migration in `migrations/` into the empty staging project, including `1093`.

## 7. Hold the duties, then deploy

```bash
npm run staging:posture -- hold
npm run deploy:worker
npm run deploy:hq
npm run deploy:mcp
SUPABASE_PROJECT_REF=<staging-ref> npm run deploy:microsoft-oauth
```

`deploy:microsoft-oauth` needs its project ref set explicitly. It has no default. It prints the redirect address it
expects, which must match step 2.4.

## 8. Connect the staging office

1. Open the staging page on its Vercel preview address and sign in as the staging office.
2. Go to **Settings > Connections** and find the **Microsoft To Do** card. It shows the six set-up steps and the redirect
   address the server expects.
3. Paste the **Application (client) ID** and the **client secret Value** into the two boxes and press **Save**.
4. Press **Connect Microsoft To Do**, sign in with your Microsoft account and accept the permissions. You are returned to
   Settings with `?microsoft=connected` in the address.

## 9. Let the duty run

```bash
npm run staging:posture -- allow microsoft-todo-sync
```

The duty runs every 15 minutes. Within one round you should see:

- the card say the connection is working and name your default To Do list;
- the health reading in the card turn green;
- any task created in the office appear in your Microsoft To Do list, and the reverse.

Each step that fails is shown in the card with a plain reason. Send Claude the card text and the time of the failure
to diagnose it.

## What this run does not test yet

- There is no "test with my account" button. A round runs on the 15-minute schedule, so a failure takes up to that long to
  show. A test button that runs one round on demand is the next thing to build if this run shows the need.
- Choosing a list other than the default is not built.
- Urgent and important tasks both sync as "high" in Microsoft To Do (ADR-0076).

## When staging is satisfied

Production is a separate, explicitly authorised step. It means applying `1093` with `npm run migrate:one` under the
production write flag, then the same deploys against the production ref, then connecting Grant's own office. Claude will
not run any of it without a specific go-ahead.
