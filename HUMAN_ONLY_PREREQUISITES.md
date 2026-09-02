# HUMAN-ONLY PREREQUISITES FOR GRANT

**Updated:** 2026-09-02 22:30 UTC · Required by addendum §56.5

Only actions you genuinely have to perform. Everything automatable has been
automated or is queued to be. Each item was tested against the addendum §40
filter — CLI? API? browser automation? inspect existing config? — before landing
here.

**Current state: 3 things block progress. Two are 60-second fixes.**

---

## 🔴 Blocking now

### 1. Re-paste the Telegram bot token · *2 minutes*

`TELEGRAM_CHIEF_BOT_TOKEN` is **invalid** — `getMe` returns
`404 Not Found`.

The value is **35 characters**, but a Telegram token looks like
`<digits>:<~35 chars>` (~46 total). It appears **only the half after the colon
was pasted** — the numeric bot ID and colon are missing.

**Fix:** re-copy the whole token from BotFather and update the environment
variable.
**Blocks:** all Telegram work, Gate 3.

### 2. Supabase database access · *2 minutes*

REST works, but **no table can be created**. Verified: PostgREST does not execute
DDL, no `exec_sql` RPC exists (`PGRST202`), and neither a database password nor a
management token is present.

**Fix — either one:**

- **Preferred:** Supabase → Project Settings → **Database** → **Connection
  string** (URI form, with password). This is what a normal migration toolchain
  needs and what Phase 1 requires anyway.
- Or: Account → **Access Tokens** → a personal access token for the Management
  API.

**Blocks:** the entire Phase 1 schema, the `slack_app_credentials` table, and
Slack config-token rotation — rotation produces a new pair that must be persisted
somewhere durable, and there is nowhere yet.

### 3. Install the Slack app · *1 minute*

The app was **created programmatically** — you do not need to build it.
Installation is the one step only you can authorize.

**→ [Install AI Team HQ](https://slack.com/oauth/v2/authorize?client_id=11964614685523.11967879910693&scope=chat:write,chat:write.customize,channels:read,channels:manage,channels:history,groups:read,groups:history,im:read,im:write,im:history,mpim:read,mpim:history,reactions:read,reactions:write,users:read,team:read,files:write)**

Then from <https://api.slack.com/apps/A0BUFRVSSLD>, add to the environment:

| Variable | Location |
|---|---|
| `SLACK_BOT_TOKEN` | OAuth & Permissions → Bot User OAuth Token |
| `SLACK_SIGNING_SECRET` | Basic Information → App Credentials |
| `SLACK_CLIENT_SECRET` | Basic Information → App Credentials |

**Blocks:** Gate 4.

---

## 🟡 Decisions (no setup work — just answers)

### D2. Inference cost posture

| | Monthly | Notes |
|---|---|---|
| **A** | **$0** | free only. Currently `is_free_tier: true` = **50 req/day** vs ~135 needed, so throttled to 1–2 investigations/day. Poor privacy: providers may train on and human-review your data. |
| **B** ⭐ | **~$3** + $10 one-off | 1,000 req/day (20× headroom) **and** `data_collection: deny`. Best value in the analysis. |
| **C** | ~$8–32 | stronger models, optionally plus voice. |

**Defaults to A until you choose**, so nothing can spend without your say-so.
Full analysis: `docs/cost-and-hosting-decisions.md` §4.

### D3. Voice for V1?

Skip (**$0**) or fund **~$24/mo** on `gpt-realtime-2.1-mini`. The system is
complete without it. A free browser-based path exists in principle but is
**unverified** — I won't present it as real until it is tested.

### D4. Email Vercel Support · *optional hygiene*

Hobby's commercial-use clause is broader than its five examples, none of which
match a personal non-monetized tool. Vercel's own remedy for uncertainty is to
ask them. One paragraph settles it permanently.

---

## 🟢 Later — not needed yet

| When | What |
|---|---|
| **Phase 4** | **Dedicated Google account** + one test Notebook shared to it. ⚠️ Do **not** browse Notebook signed in as that account while the worker runs — it rotates the worker's session out from under it. |
| **Phase 4** | One interactive Google sign-in to mint the Notebook master token (then good for months). |
| **Phase 7** | Google Cloud project for TTS — only once exact scopes are known. |
| **Phase 9** | Google OAuth consent screens, least-privilege. |
| **Gate 1** | **Personally use the voice POC for 20+ minutes.** Mandatory and cannot be delegated — I must not mark subjective acceptance passed on your behalf. |
| *if needed* | Groq key is invalid (401). Low priority — its 8,000 TPM ceiling makes it marginal anyway. |

**Not needed:** 8–10 Telegram bots · multiple Slack apps · Oracle/Hetzner VM ·
Google AI Pro · any monthly subscription.

---

## ✅ Already working — nothing for you to do

| Credential | Verified |
|---|---|
| `OPENAI_API_KEY` | 124 models; `gpt-realtime-2.1` and `-2.1-mini` both present |
| `SLACK_APP_CONFIG_TOKEN` | app created with it |
| `OPENROUTER_API_KEY` | works, free tier |
| `GEMINI_API_KEY` | 50 models |
| Supabase REST | responds 200 |

---

## How to hand over credentials

**Not in chat.** Put them in `.env` format at:

> claude.ai/code → this environment → gear icon → **Environment variables**

Once each connection is proven, migrate the sensitive ones to **API
credentials**, so the raw value never enters the session and cannot be logged:
`OPENAI_API_KEY`, the Supabase secret key, `TELEGRAM_CHIEF_BOT_TOKEN`,
`SLACK_BOT_TOKEN`.

Not eligible: the Notebook master token (a *file*), and the Slack config pair
(it **rotates**, so it belongs in the database).

---

## The fastest path to unblocking Phase 1

1. Re-paste the Telegram token *(2 min)*
2. Add the Supabase connection string *(2 min)*
3. Install the Slack app and hand over its three values *(1 min)*
4. Answer **D2** *(no work)*

Items 2 and 4 alone unblock Phase 1 — the schema, ledger, job engine, and the
tested backup restore.
