# Prompt: create a staging environment for Team HQ

Copy everything between the two lines below into ChatGPT. It is written to stand alone.

---

You are helping Grant Rogers set up a **staging** environment for an application called **Team HQ**. Staging is for
testing one feature, a Microsoft To Do sync, against Grant's own personal Microsoft account before anything goes to
production. Your job is the portal and account work: create the resources, record their identifiers, and tell Grant
exactly what to send back. You do not deploy code. Another assistant (Claude Code) does the deploys afterwards, from
Grant's machine and repository.

## Hard rules

1. **Never touch the production project.** Production is the Supabase project with ref `baujwlzcziasnfhhkchg`. Do not
   open it, change it, rename it, pause it, or copy anything from it. If a screen offers production as a choice, pick
   the new staging resource and nothing else.
2. **Never ask for, print or store a secret value in chat.** That includes passwords, tokens, client secrets, database
   passwords and access tokens. Tell Grant where each secret goes (see step 6) and move on. If a value appears in your
   output by accident, tell Grant to revoke it and rotate it.
3. **Create only what is listed.** Do not connect Google, Telegram, Slack or Vikunja. Do not create any other project,
   bot, OAuth client or workspace. Those integrations stay switched off in staging.
4. **Use Team HQ as the name.** Do not use any other product or company name in anything you create.
5. **Ask Grant before anything that costs money or is hard to undo.** The free tiers are enough for this. If a plan
   upgrade is offered, decline it and report it.
6. **Stop and report** if a step does not match these instructions, if a screen is missing, or if you are unsure which
   project or app you are looking at. Do not guess.

## What you are creating

| # | Resource | Where | Name | Notes |
|---|---|---|---|---|
| A | Supabase project | https://supabase.com/dashboard | `team-hq-staging` | New project, free plan, nearest region. Not production. |
| B | Vercel preview for the page | https://vercel.com | the existing Team HQ project, a **preview** deployment | Preview only, never production. |
| C | Microsoft app registration | https://entra.microsoft.com | `Team HQ (staging)` | Personal Microsoft accounts only. |

## Step A: the Supabase project

1. Open https://supabase.com/dashboard and sign in as Grant.
2. Choose **New project**. Organisation: Grant's personal one. Name: `team-hq-staging`. Region: the one nearest Grant.
   Plan: **Free**. Set a database password, and tell Grant to store it in a password manager (do not send it to anyone).
3. Wait until the project shows as healthy.
4. Open **Project Settings > General** and copy the **Reference ID**. It is 20 letters and digits. Call this
   `STAGING_REF`. Confirm it is **not** `baujwlzcziasnfhhkchg`. If it is, stop and report.
5. Open **Project Settings > API** and copy the **Project URL**. It should be `https://<STAGING_REF>.supabase.co`. This is
   not a secret, so it may be reported back. Do **not** copy the `service_role` key or the `anon` key into chat.
6. Confirm the project has **no** tables or functions yet. A new project should be empty. If it is not empty, stop.

## Step B: the Vercel preview

1. Open https://vercel.com/dashboard and find the existing **Team HQ** project. Do not create a new one unless Grant asks.
2. Create a preview deployment of the branch `claude/beautiful-cannon-75w02q` from the project's **Deployments** page.
   Do not promote it to production, and do not change the production domain or the production environment variables.
3. Copy the preview's address (it ends in `.vercel.app`). Call this `STAGING_SITE`. Confirm the address is not the
   production domain `ai-team-hq.vercel.app`. If it is, stop and report.
4. If Vercel asks for a build, leave the defaults. The page is built by Claude Code, not by this step, so a failed build
   can be reported and left.

## Step C: the Microsoft app registration

1. Open https://entra.microsoft.com and sign in with **Grant's personal Microsoft account** (the one that owns his To Do
   lists).
2. Go to **Identity > Applications > App registrations > New registration**.
3. Name: `Team HQ (staging)`.
4. Supported account types: **Personal Microsoft accounts only**.
5. Redirect URI: platform **Web**, value exactly
   `https://<STAGING_REF>.supabase.co/functions/v1/microsoft-oauth/callback`
   (substitute `STAGING_REF` from step A.4).
6. Press **Register**. On the Overview page, copy the **Application (client) ID**. Call this `STAGING_MICROSOFT_CLIENT_ID`.
   It is not a secret, so it may be reported back.
7. Go to **Certificates & secrets > New client secret**. Description: `team-hq-staging`. Expiry: 6 months.
   Copy its **Value** (not the Secret ID). Microsoft shows it once. **Do not paste it into chat.** Tell Grant to keep it
   in a password manager until he enters it in the Settings card (see "Where each secret goes" below).
8. Go to **API permissions > Add a permission > Microsoft Graph > Delegated permissions**. Tick `Tasks.ReadWrite` and
   `offline_access`. Press **Add permissions**. Do not grant admin consent (not needed for a personal account).

## Where each secret goes (tell Grant this, do not handle it yourself)

- **Microsoft client secret value:** pasted into the Microsoft To Do card in the staging Team HQ Settings page, once the
  page is live. The card stores it in the Supabase vault.
- **Supabase database password:** kept in Grant's password manager. It is needed only if a direct database connection is
  used. Claude Code will say if it is.
- **Supabase access token** (for deploys): Grant creates it at https://supabase.com/dashboard/account/tokens, and sets it
  in his own terminal session only. Do not create it for him and do not paste it.
- **Vercel token:** same rule, created by Grant in his own terminal only.

## What to send back

Send Grant a single message, in this exact shape, with no secret values in it:

```
STAGING_REF=<20 characters>
SUPABASE_URL=https://<STAGING_REF>.supabase.co
STAGING_SITE=https://<the preview>.vercel.app
STAGING_MICROSOFT_CLIENT_ID=<guid>
MICROSOFT_REDIRECT_URI=https://<STAGING_REF>.supabase.co/functions/v1/microsoft-oauth/callback
PRODUCTION_REF_CHECKED=yes (it is not the staging ref)
SECRETS_STORED_BY_GRANT=yes/no for each: entra secret, supabase db password, supabase token
ISSUES=<anything that did not match these instructions, or none>
```

## What Grant does next, and what Claude Code does after

Grant pastes that message back to Claude Code in the repository session. Claude Code then does, in order:

1. Checks the values, and refuses to continue if the ref equals `baujwlzcziasnfhhkchg`.
2. Sets a dedicated staging shell with `TARGET_ENVIRONMENT=staging`, the staging values and the identifiers above, then
   runs `npm run staging:preflight`. It must print `STAGING PREFLIGHT PASSED`.
3. Replays all migrations into the staging database.
4. Holds the duties, then deploys the worker, the Team HQ API, the consent function and the page to staging only.
5. Grant opens the staging page, goes to Settings, and pastes the client id and the secret value into the Microsoft To Do
   card. He presses **Connect Microsoft To Do**, signs in with his personal account and accepts.
6. Claude Code turns on the sync duty for staging only and reads back the result, including the Activity log.

## Known limits you should tell Grant about

- The page deploy script currently targets **production** on Vercel. It must be changed to a preview target before the
  staging page is deployed, or it will overwrite the live site. Claude Code will make that change and check it first.
- Several deploy scripts default to the production project ref when no ref is set. Claude Code will set the ref
  explicitly for every staging command.
- The Microsoft To Do sync is not yet proven against a live account. Staging is where that first happens.

---

## Notes for the person reading this file (not for ChatGPT)

- The prompt intentionally does not contain any secret, and it contains only identifiers that are already in the
  public repository.
- The Vercel and deploy-script issues above are real and are not solved by the prompt. They are listed in the prompt so
  the staging owner knows what to expect.
