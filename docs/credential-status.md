# Credential status

**Verified:** 2026-09-02 22:10 UTC, by live API call against each credential.
**No secret values appear in this file or anywhere in this repository.**

This doubles as the first real data for the addendum §6 capability registry —
these are exactly the fields that registry must carry.

---

## Summary

| Credential | State | Verified by |
|---|---|---|
| `OPENAI_API_KEY` | ✅ **works** | `GET /v1/models` → 200, 124 models |
| `SLACK_APP_CONFIG_TOKEN` | ✅ **works** | `apps.manifest.validate` → `ok:true`, then app created |
| `SLACK_APP_CONFIG_REFRESH_TOKEN` | ⚠️ present, **unused** | rotation deliberately deferred — see below |
| `OPENROUTER_API_KEY` | ✅ **works**, free tier | `GET /api/v1/key` → `is_free_tier: true`, usage 0 |
| `GEMINI_API_KEY` | ✅ **works** | `models?key=` → 200, 50 models |
| `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | ⚠️ **partial** | REST → 200, but **no DDL path** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | present | not yet exercised |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | present | not yet exercised — Phase 9 |
| `TELEGRAM_CHIEF_BOT_TOKEN` | ✅ **works** (fixed 2026-09-03) | `getMe` → `@agenticteamgrantbot`, id 8967954396 |
| `GROQ_API_KEY` | ❌ **invalid** | `GET /models` → **401 Invalid API Key** |
| `SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET` / `SLACK_APP_TOKEN` | ⬜ **placeholders** | expected — issued on install |

---

## Two credentials need your attention

### ✅ `TELEGRAM_CHIEF_BOT_TOKEN` — RESOLVED 2026-09-03

Previously invalid: the value was 35 characters with no colon — only the half
*after* the colon had been pasted, so `getMe` returned `404 Not Found`.

Re-pasted in full (46 chars, colon present) and verified:

```
ok: true
id: 8967954396
first_name: Agentic Team Grant
username: @agenticteamgrantbot
can_join_groups: true
```

Gate 3 is unblocked. Webhook is not yet configured — that needs a deployed
URL.

### ❌ `GROQ_API_KEY` — invalid

Returns `401 Invalid API Key`. Either expired, revoked, or mis-pasted.

**Not urgent.** Groq is a marginal provider in the researched plan — its free
tier carries an **8,000 TPM ceiling that makes a single 35k-token summarization
impossible at any volume**. Fix it if convenient; nothing depends on it.

---

## ⚠️ Supabase — works for data, cannot create tables

REST responds `200`, so the URL and service-role key are valid. But **schema
creation is not possible** with what is available:

- PostgREST does not execute DDL by design
- No `exec_sql`-style RPC exists on the project (`PGRST202`, checked)
- No database password / connection string is present
- No Supabase personal access token for the Management API

**Consequence:** the `slack_app_credentials` table — and every Phase 1 table —
cannot be created yet. This is what blocks Slack config-token rotation, since
rotation produces a new pair that must be persisted somewhere durable.

**To unblock, either:**

1. **Database connection string** (Supabase → Project Settings → Database →
   Connection string), which lets migrations run directly with `psql`; **or**
2. **Supabase personal access token** (Account → Access Tokens) for the
   Management API.

Option 1 is the better fit — it is what a normal migration toolchain expects and
what Phase 1 needs regardless.

### Also worth noting: key naming

The supplied variables use the **legacy** `anon` / `service_role` convention.
Addendum §5 asks for the current publishable / secret-key architecture. Not
blocking — the legacy keys work — but when the Supabase project is next
touched, prefer:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
```

The rule that matters is unchanged and independent of naming: **the server
secret must never reach client code, never be logged, and never enter the event
ledger.**

---

## ✅ OpenAI — and a Gate 1 prerequisite confirmed early

`GET /v1/models` returned 124 models. Realtime-capable models **present on this
account right now**:

```
gpt-realtime            (deprecated, removed 2027-01-20)
gpt-realtime-1.5
gpt-realtime-2
gpt-realtime-2.1        ← current full
gpt-realtime-2.1-mini   ← current mini, recommended default
gpt-realtime-2025-08-28
gpt-realtime-mini       (deprecated)
gpt-realtime-mini-2025-12-15
```

This **empirically confirms** the documentation research and satisfies addendum
§2's requirement to discover current model names from the live API rather than
from a specification. Both recommended models are available.

Addendum §2 also requires re-checking **immediately before Gate 1** — this check
is dated and does not substitute for that one.

---

## ✅ OpenRouter — free tier confirmed, which decides a cost question

`GET /api/v1/key` returns:

```
is_free_tier: true
usage: 0
limit: null
```

`is_free_tier: true` means **no credit has been purchased**, which puts the key
on the **50 requests/day** tier rather than 1,000. That independently confirms
the research finding, and it is the concrete reason Config A in
`docs/cost-and-hosting-decisions.md` is request-starved.

A one-off **$10** purchase moves this to 1,000/day — a 20× increase for a
non-recurring cost.

---

## Migration to API credentials

Per the spec's instruction to flag these proactively rather than leaving
everything as plain environment variables — once each connection is proven in
use, these should move from **Environment variables** to the environment's
**API credentials**, so the raw value never enters the session:

- `OPENAI_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (or its secret-key successor)
- `TELEGRAM_CHIEF_BOT_TOKEN`, once valid
- `SLACK_BOT_TOKEN`, once issued

**Not eligible:** the Gemini Notebook master token, which is a *file*
(`master_token.json`) rather than a header value, and the Slack config-token
pair, which **rotates** and therefore belongs in the database rather than in any
static store.
