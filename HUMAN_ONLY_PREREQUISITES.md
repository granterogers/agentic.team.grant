# HUMAN-ONLY PREREQUISITES FOR GRANT

**Updated:** 2026-09-02 22:30 UTC · Required by addendum §56.5

Only actions you genuinely have to perform. Everything automatable has been
automated or is queued to be. Each item was tested against the addendum §40
filter — CLI? API? browser automation? inspect existing config? — before landing
here.

**Current state: 2 blockers left.** Telegram ✅ resolved 2026-09-03. D2 ✅ decided: **Option B**.

---

## 🔴 Blocking now — 2 left

### ~~1. Re-paste the Telegram bot token~~ ✅ DONE 2026-09-03

Verified working: **@agenticteamgrantbot** (id 8967954396). Gate 3 unblocked.
Webhook still needs a deployed URL — not your problem, it's automated.

### 2. Supabase database access · *2 minutes*

REST works, but **no table can be created**. Verified: PostgREST does not execute
DDL, no `exec_sql` RPC exists (`PGRST202`), and neither a database password nor a
management token is present.

**Fix — either one:**

- **Preferred**, on
  [the Database Settings page](https://supabase.com/dashboard/project/baujwlzcziasnfhhkchg/settings/database):
  1. **Reset password** → **copy it immediately**; Supabase states it *"isn't
     viewable after creation"*.
  2. Click **`Connect`** in the top bar (the connection string is no longer in
     the page body) → **Session pooler** tab → copy the URI → substitute the
     password.

  **Session pooler, not Direct connection:** Direct is IPv6-only on Free and this
  build container needs IPv4; Session mode (unlike Transaction mode) supports the
  DDL migrations require. Set it as `SUPABASE_DB_URL`.
- Or: Account → **Access Tokens** → a personal access token for the Management
  API.

**Blocks:** the entire Phase 1 schema, the `slack_app_credentials` table, and
Slack config-token rotation — rotation produces a new pair that must be persisted
somewhere durable, and there is nowhere yet.

### 3. Install the Slack app · *1 minute*

The app was **created programmatically** — you do not need to build it.
Installation is the one step only you can authorize.

> ⚠️ **Do not search the Slack marketplace for it — it will never appear there.**
> This is a *private* app in your workspace, and it must stay unlisted: public
> distribution would silently cut our API throughput roughly 50×.
>
> Most reliable route: **[api.slack.com/apps/A0BUFRVSSLD/oauth](https://api.slack.com/apps/A0BUFRVSSLD/oauth)**
> → green **Install to Workspace** button.

**→ [Or use the direct install link](https://slack.com/oauth/v2/authorize?client_id=11964614685523.11967879910693&scope=chat:write,chat:write.customize,channels:read,channels:manage,channels:history,groups:read,groups:history,im:read,im:write,im:history,mpim:read,mpim:history,reactions:read,reactions:write,users:read,team:read,files:write)**

Then from <https://api.slack.com/apps/A0BUFRVSSLD>, add to the environment:

| Variable | Location |
|---|---|
| `SLACK_BOT_TOKEN` | OAuth & Permissions → Bot User OAuth Token |
| `SLACK_SIGNING_SECRET` | Basic Information → App Credentials |
| `SLACK_CLIENT_SECRET` | Basic Information → App Credentials |

**Blocks:** Gate 4.

---

## ✅ Resolved — OpenRouter card and spend cap

*Grant asked to be reminded until confirmed done. Raised at the start of each
working session.*

Two items at [openrouter.ai/settings/credits](https://openrouter.ai/settings/credits)
and the Keys page:

- [x] ✅ **DONE 2026-09-03 — card removed, Auto Top-Up off.** (Reported by Grant;
      not API-verifiable, since payment methods are not exposed by the key
      endpoint.)
- [x] ✅ **DONE — per-key spend limit set.** Verified live: `limit: 5`,
      `limit_remaining: 5`. ⚠️ `limit_reset: None` means this is a **lifetime**
      $5 cap, not monthly. Config B runs ~$3/month, so the key will stop around
      mid-October and will look like an outage. Either set it to reset monthly
      or plan to raise it.

<details><summary>Original reminder (kept for the record)</summary>

- **Confirm Auto Top-Up is OFF, then remove the saved card.**
      Auto Top-Up is opt-in — a toggle where you set "when credits are below X,
      purchase Y". If it was never enabled, the $10 was a one-off and nothing
      recurs. **Removing the card keeps the $10 balance** — disabling or removing
      a payment method does not refund or revoke credits already purchased.
      Worth doing anyway: with no card, an automatic charge is *physically
      impossible* rather than merely switched off, and when the balance runs
      down requests fail cleanly with a payment error — precisely the
      "never silently paid" behaviour the design requires.
- [ ] **Set a hard per-key spend limit (~$5/month).** The key currently reports
      `limit: None`. A per-key cap is **enforcement layer 2** in
      `docs/adr/0005-inference-cost-posture.md`, and it is absent — so a bug in
      our own code could currently drain the whole balance.

</details>

---

## 🟡 Decisions (no setup work — just answers)

### D2. Inference cost posture

| | Monthly | Notes |
|---|---|---|
| **A** | **$0** | free only. Currently `is_free_tier: true` = **50 req/day** vs ~135 needed, so throttled to 1–2 investigations/day. Poor privacy: providers may train on and human-review your data. |
| **B** ⭐ | **~$3** + $10 one-off | 1,000 req/day (20× headroom) **and** `data_collection: deny`. Best value in the analysis. |
| **C** | ~$8–32 | stronger models, optionally plus voice. |

✅ **DECIDED 2026-09-03: Option B.** Remaining step —
[add $10 credit at OpenRouter](https://openrouter.ai/settings/credits), which
flips the key from 50 to 1,000 requests/day. I will verify `is_free_tier`
becomes `false` afterwards.

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
| `OPENROUTER_API_KEY` | ✅ **$10 credit landed** — `is_free_tier: false` = 1,000 req/day |
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

1. ~~Telegram token~~ ✅ done
2. **Supabase `SUPABASE_DB_URL`** — reset password, then `Connect` → Session pooler
3. Install the Slack app, hand over its three values
4. ~~Answer D2~~ ✅ Option B — just add the $10 OpenRouter credit

**Item 2 alone unblocks Phase 1** — schema, ledger, job engine, and the tested
backup restore. Everything else can follow.
