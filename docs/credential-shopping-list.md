# Credential shopping list — everything, up front

**Created:** 2026-09-03 · **Purpose:** stop asking Grant for credentials one at a time.

Every credential the build will *ever* need, with the phase that needs it and
where to get it. Grab them in batches so a session restart collects several at
once instead of one.

> **Why restarts matter at all:** environment variables are read when a session's
> container starts. Adding one mid-session is fine — it just won't reach the
> running container. **This friction is temporary.** From Phase 2 the app has its
> own encrypted secret store (master spec §15), and credentials entered there are
> picked up at runtime with no restart. Bootstrap is the only awkward part.

---

## ✅ Already supplied and verified

| Variable | Verified |
|---|---|
| `OPENAI_API_KEY` | 124 models; `gpt-realtime-2.1` + `-2.1-mini` present |
| `OPENROUTER_API_KEY` | `is_free_tier: false`, `limit: 5` |
| `GEMINI_API_KEY` | 50 models |
| `TELEGRAM_CHIEF_BOT_TOKEN` | `@agenticteamgrantbot` |
| `SLACK_APP_CONFIG_TOKEN` + refresh | app created |
| `NEXT_PUBLIC_SUPABASE_URL`, anon, service-role | REST 200 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | present, untested |

## ✅ Verified 2026-09-03 in this session

| Variable | Result |
|---|---|
| `SLACK_BOT_TOKEN` | ✅ works — `auth.test` ok, **17/17 scopes**, app installed |
| `SLACK_SIGNING_SECRET` | ❌ **empty string** — re-supply, see Batch 1 |
| `SUPABASE_DB_URL` | ❌ **unusable from a build session** — and no replacement string can help |

Full evidence:
[`test-evidence/2026-09-03-credential-verification.md`](test-evidence/2026-09-03-credential-verification.md).

> ⚠️ **The Supabase ask changed.** Measurement showed this environment blocks all
> non-443 outbound TCP — port 443 to the Supabase pooler connects, 5432 and 6543
> time out — so **no** Postgres connection string can work from a build session.
> What is needed instead is a **personal access token**, which works over HTTPS.
> [ADR-0007](adr/0007-ddl-over-management-api.md).

---

## 🔴 BATCH 1 — needed for Phase 1, not yet supplied

Three items. The first is the hard blocker; the other two are needed before
Phase 1 can finish.

### Supabase personal access token · ⛔ **blocks everything** · 1 min

1. <https://supabase.com/dashboard/account/tokens>
2. **Generate new token** → name it `ai-team-hq-migrations`
3. **Copy it immediately** — shown once

| Variable | Notes |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | `sbp_…`. Executes migrations over HTTPS |

This replaces the connection-string request. Keep `SUPABASE_DB_URL` set anyway —
the deployed app on Vercel needs a pooler URI even though this container cannot
use one. (When you get to Vercel, give it the **Session pooler** string, not the
Direct connection currently stored.)

### Slack app credentials · 1 min

`SLACK_BOT_TOKEN` arrived and works. Two values did not:

1. <https://api.slack.com/apps/A0BUFRVSSLD> → **Basic Information** →
   **App Credentials** → **Show**

| Variable | Field | State |
|---|---|---|
| `SLACK_SIGNING_SECRET` | Signing Secret | ❌ arrived empty |
| `SLACK_CLIENT_SECRET` | Client Secret | ❌ absent |

Needed for Gate 4, not for Phase 1 — but it is the same 60 seconds, so collect
it in this batch.

### Cloudflare R2 · free (10 GB, no egress charge)

1. Sign up / log in: <https://dash.cloudflare.com>
2. **R2** in the sidebar → **Create bucket** → name it `ai-team-hq-backups`
3. **R2** → **Manage R2 API Tokens** → **Create API Token**
   → permission **Object Read & Write**, scoped to that bucket
4. Copy the three values it shows **once**

| Variable | Where |
|---|---|
| `R2_ACCOUNT_ID` | R2 overview page, right sidebar |
| `R2_ACCESS_KEY_ID` | shown on token creation |
| `R2_SECRET_ACCESS_KEY` | shown on token creation — **once only** |
| `R2_BUCKET` | `ai-team-hq-backups` |

**Alternative if you'd rather not:** Backblaze B2 (10 GB free) works identically
via the S3 API. R2 is preferred for free egress, which matters when restoring.

> **These four also go into GitHub Actions secrets**, not only the environment.
> `pg_dump` speaks the Postgres wire protocol, so per
> [ADR-0007](adr/0007-ddl-over-management-api.md) the nightly backup and its
> restore rehearsal run as a scheduled Actions workflow rather than in a build
> session. I can add repository secrets myself once you supply the values — that
> part is not manual.

---

## 🟡 BATCH 2 — deployment, needed before Gate 1

Gate 1 requires a real URL on your iPhone, so the app must be deployed.

### Vercel

1. <https://vercel.com/signup> — sign in with GitHub
2. <https://vercel.com/account/tokens> → **Create Token**, scope "Full Account",
   no expiry (or 1 year)

| Variable | Where |
|---|---|
| `VERCEL_TOKEN` | account tokens page |

Lets deploys happen from CI without you clicking. **Don't** connect the repo
through Vercel's GitHub integration as well — two deploy paths cause confusing
double builds.

> Optional but recommended (**D4**): email Vercel Support confirming a personal,
> non-monetized tool is fine on Hobby. Their own docs say to ask when unsure.

---

## 🟡 BATCH 3 — the dedicated Google account, before Gate 2

⚠️ **This one has a rule attached.** Create a **brand-new Google account** used
only by AI Team HQ — not your personal or INNERGY account.

Two reasons, and the second is the one people miss:

1. Blast radius — it holds automation credentials.
2. **Correctness.** If you sign into Gemini Notebook interactively as this
   account while the worker is running, it rotates the worker's session out from
   under it and the sync breaks. To read the notebooks yourself, **share them**
   to your personal account instead.

Steps:

1. <https://accounts.google.com/signup> — e.g. `aiteamhq.grant@gmail.com`
2. Sign into <https://notebooklm.google.com> **once**, as that account, and
   create a test notebook called `Money Mastery`
3. Add 2–3 sources to it
4. Share it to your personal Google account (read access)

**No variable to hand over yet.** The Notebook master token is minted by one
interactive sign-in during Gate 2 — I'll walk you through it then. It is a
*file*, not a header value, so it cannot go in Environment variables.

---

## 🟢 BATCH 4 — Google Cloud TTS, before Phase 7

Voice notes. 1M characters/month free, perpetually.

1. <https://console.cloud.google.com/projectcreate> — create `ai-team-hq`,
   **signed in as the dedicated account**
2. Enable the API:
   <https://console.cloud.google.com/apis/library/texttospeech.googleapis.com>
3. **IAM & Admin → Service Accounts** → create `tts-worker`
   → role **Cloud Text-to-Speech User** → **Keys → Add Key → JSON**

| Variable | Notes |
|---|---|
| `GOOGLE_TTS_SA_JSON` | the JSON key, as a single-line string |

Requires a billing account on the project, but the free tier is genuinely free —
set a **$1 budget alert** as a tripwire.

---

## 🟢 BATCH 5 — Google OAuth consent, before Phase 9

Gmail / Calendar / Drive. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are
already supplied; what remains is the consent screen, which needs the exact
callback URL — so it waits until the app is deployed.

Scopes, least-privilege, per master spec §20:

```
calendar.events          (read/write)
gmail.readonly           (read)
gmail.compose            (draft only — NEVER gmail.send)
drive.readonly           (read)
```

> `gmail.send` is **never** requested. Sending stays disabled by application
> policy (master spec §11), not merely unrequested.

⚠️ **Publish the consent screen** rather than leaving it in Testing mode —
testing-mode refresh tokens expire unpredictably, which would break long-running
automation.

---

## ❌ Deliberately NOT needed

Recorded so nobody adds them "just in case":

| Not needed | Why |
|---|---|
| Google AI Pro | free Notebook tier is sufficient (ADR-0003) |
| Oracle / Hetzner / any VM | the sync is pure HTTP (ADR-0001) |
| 8–10 Telegram bots | one for V1 |
| Multiple Slack apps | one shared app (ADR-0004) |
| `SLACK_APP_TOKEN` (`xapp-`) | Socket Mode is not used |
| Groq | key no longer set; its 8k TPM ceiling makes it marginal anyway |
| Netlify / Render / Fly / Railway | rejected, master spec §4 |

---

## The efficient path

| Do now | Then |
|---|---|
| **Batch 1a** (Supabase token, ~1 min) | ⛔ **Phase 1 cannot start without this** |
| **Batch 1b** (Slack secrets, ~1 min) | Gate 4 ready |
| **Batch 1c** (R2, ~5 min) | Phase 1 runs start to finish uninterrupted |
| **Batch 2** (Vercel token, ~2 min) | deployment ready before Gate 1 |
| **Batch 3** (Google account + test notebook, ~10 min) | Gate 2 ready |

Doing all three now means **one** restart covers Phases 1 through 3. Batches 4
and 5 genuinely cannot be done early — they need the deployed URL and the exact
scopes.
