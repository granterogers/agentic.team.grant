# HUMAN-ONLY PREREQUISITES FOR GRANT

**Updated:** 2026-09-03 · Required by addendum §56.5

Only actions you genuinely have to perform. Everything automatable has been
automated or is queued to be. Each item was tested against the addendum §40
filter — CLI? API? browser automation? inspect existing config? — before landing
here.

**Current state: 2 blockers left.** Slack install ✅ resolved 2026-09-03 —
the token works and all 17 scopes are granted. Telegram ✅. D2 ✅ Option B, credit landed.

⚠️ **The Supabase ask has changed.** For two sessions this document asked you for
a *database connection string*. That was the wrong request — measurement on
2026-09-03 proved **no** connection string can work from a Claude Code cloud
session, because the session blocks all non-443 outbound TCP. Port 443 to the
Supabase pooler connects; ports 5432 and 6543 to the same host time out. So the
string you supplied fails, and the Session pooler string would have failed too.
See [ADR-0007](docs/adr/0007-ddl-over-management-api.md). What is needed instead
is an **access token**, which works over HTTPS.

---

## 🔴 Blocking now — 2 left

### 1. Supabase **personal access token** · *1 minute* · ⛔ blocks all of Phase 1

Not a connection string. A token.

> **[supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens)**
> → **Generate new token** → name it `ai-team-hq-migrations` → **copy it
> immediately**, it is shown once → add to the environment as
> `SUPABASE_ACCESS_TOKEN`.

Why this and not the connection string: Supabase's Management API executes SQL —
including the DDL, the `REVOKE UPDATE, DELETE ON events` that makes the ledger
genuinely append-only, and the RLS policies — over **HTTPS**, which this
environment permits. It is already confirmed reachable: the endpoint answers
`401 Unauthorized` rather than timing out, so the transport works and only the
credential is missing.

**Keep `SUPABASE_DB_URL` where it is.** It is the wrong shape for *this*
container but the deployed app on Vercel needs a pooler URI, and that is where it
belongs. One note for when you get there: the value currently set is the
**Direct connection**, which is IPv6-only on Free. Vercel will want the
**Session pooler** string instead — `Connect` → **Session pooler** tab.

**Blocks:** the Phase 1 schema, the append-only event ledger, the job engine, the
`slack_app_credentials` table, and Slack config-token rotation.

### 2. Slack signing secret · *1 minute*

`SLACK_BOT_TOKEN` came through and works. But `SLACK_SIGNING_SECRET` arrived as
an **empty value** — the variable exists with nothing in it — and
`SLACK_CLIENT_SECRET` is missing entirely.

> From **[api.slack.com/apps/A0BUFRVSSLD](https://api.slack.com/apps/A0BUFRVSSLD)**
> → **Basic Information** → **App Credentials** → **Show** next to each:

| Variable | Field | State |
|---|---|---|
| `SLACK_SIGNING_SECRET` | Signing Secret | ❌ empty — needed |
| `SLACK_CLIENT_SECRET` | Client Secret | ❌ absent — needed |

Without the signing secret, no inbound Slack request can be proven to have come
from Slack, so no Slack event may be trusted. Leave `SLACK_APP_TOKEN` blank —
that one is only for Socket Mode, which §4 rejects.

**Blocks:** Gate 4. Not Phase 1.

### ~~Install the Slack app~~ ✅ DONE 2026-09-03

Verified live: workspace **Agentic Team Grant** (`T0BUCJ2L5FD`), bot
`ai_team_hq` (`U0BUG0RPZ8B`), and **all 17 requested scopes granted, none
missing**. `is_enterprise_install: false` confirms it is still a private
internal app, which is what preserves our rate-limit exemption.

### ~~Re-paste the Telegram bot token~~ ✅ DONE 2026-09-03

Verified working: **@agenticteamgrantbot** (id 8967954396). Gate 3 unblocked.
Webhook still needs a deployed URL — not your problem, it's automated.

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
2. ~~Answer D2~~ ✅ Option B, and the $10 credit has landed (`is_free_tier: false`)
3. ~~Install the Slack app~~ ✅ done, token verified, 17/17 scopes
4. **Supabase personal access token** — the one thing Phase 1 waits on
5. Slack signing secret + client secret — needed for Gate 4, not for Phase 1

**Item 4 alone unblocks Phase 1.** Everything else can follow.
