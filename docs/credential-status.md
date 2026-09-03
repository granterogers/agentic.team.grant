# Credential status

**Verified:** 2026-09-03, by live API call against each credential.
**Latest run:** [`docs/test-evidence/2026-09-03-credential-verification.md`](test-evidence/2026-09-03-credential-verification.md)
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
| `OPENROUTER_API_KEY` | ✅ **works, credited, capped** | `is_free_tier: false`, `limit: 5`, `usage: 0` (2026-09-03) |
| `GEMINI_API_KEY` | ✅ **works** | `models?key=` → 200, 50 models |
| `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | ⚠️ **partial** | REST → 200, but **no DDL path** |
| `SUPABASE_DB_URL` | ❌ **unusable from a build session** | Direct connection (IPv6-only) *and* all non-443 TCP egress blocked — see below |
| `SUPABASE_ACCESS_TOKEN` | ⬜ **absent — the one Phase 1 blocker** | Management API → `401`, i.e. reachable, credential missing |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | present | not yet exercised |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | present | not yet exercised — Phase 9 |
| `TELEGRAM_CHIEF_BOT_TOKEN` | ✅ **works** (fixed 2026-09-03) | `getMe` → `@agenticteamgrantbot`, id 8967954396 |
| `GROQ_API_KEY` | ⬜ **no longer set** | previously `401`; now absent from the environment. Nothing depends on it |
| `SLACK_BOT_TOKEN` | ✅ **works** (2026-09-03) | `auth.test` → `ok:true`, team `T0BUCJ2L5FD`, bot `ai_team_hq`, **17/17 scopes** |
| `SLACK_SIGNING_SECRET` | ❌ **empty string** | variable exists, value length 0. Needed for Gate 4 |
| `SLACK_CLIENT_SECRET` | ⬜ **absent** | needed for Gate 4 |
| `SLACK_APP_TOKEN` | ⬜ empty — **correctly so** | Socket Mode only, which §4 rejects |

---

## Resolved since the last run

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

### ✅ `SLACK_BOT_TOKEN` — RESOLVED 2026-09-03

The app is installed. `auth.test` returns `ok: true` for workspace **Agentic Team
Grant** (`T0BUCJ2L5FD`), bot user `ai_team_hq` (`U0BUG0RPZ8B`), bot id
`B0BUN78DELS`. The `x-oauth-scopes` header lists **all 17 requested scopes,
none missing and none extra**, and `is_enterprise_install: false` confirms the
app remains a private internal install — which is what preserves the rate-limit
exemption ADR-0004 relies on.

Still outstanding for Gate 4: `SLACK_SIGNING_SECRET` (currently an empty string)
and `SLACK_CLIENT_SECRET` (absent).

### ⬜ `GROQ_API_KEY` — no longer present

Previously returned `401 Invalid API Key`; it is now absent from the environment
altogether.

**Not urgent.** Groq is a marginal provider in the researched plan — its free
tier carries an **8,000 TPM ceiling that makes a single 35k-token summarization
impossible at any volume**. Fix it if convenient; nothing depends on it.

---

## ❌ Supabase — no wire-protocol path exists from a build session

Superseded finding. The previous version of this section concluded that a
**database connection string** would unblock migrations. Measurement on
2026-09-03 disproved that.

`SUPABASE_DB_URL` is now set, and it fails for two independent reasons:

1. It is the **Direct connection** (`postgres@db.<ref>.supabase.co:5432`), which
   publishes AAAA records only. This container does not support the IPv6 address
   family at all — `socket(AF_INET6)` raises `OSError 97`. Supabase Free offers
   no IPv4 for Direct connections.
2. **All non-443 outbound TCP is blocked.** Against the *IPv4* Session-pooler
   host: port 443 connects, ports 5432 and 6543 time out. The session's egress
   proxy documents `raw-TCP databases` as not supported.

Reason 2 subsumes reason 1: **no connection string of any kind — Direct, Session
pooler, or Transaction pooler — can work from a Claude Code cloud session.**
Asking Grant for a better string, which this document did twice, cannot help.

**The path that does work:** the Supabase **Management API** executes SQL,
including DDL, `REVOKE` and `CREATE POLICY`, over HTTPS.
`POST /v1/projects/{ref}/database/query` returns `401 Unauthorized` — reachable
through the proxy, credential missing. It needs a **personal access token**
(`sbp_…`), which is a genuine §14 human-only action.

Recorded as [ADR-0007](adr/0007-ddl-over-management-api.md), which also moves
`pg_dump` and the mandatory restore test into a scheduled GitHub Actions
workflow, since `pg_dump` has no HTTPS mode and therefore can never run in a
build session.

Escape hatches re-confirmed closed: PostgREST executes no DDL by design; no
`exec_sql` RPC exists (`PGRST202`) and creating one is itself the DDL we lack a
path for; the Supabase CLI wraps the same wire protocol.

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

`GET /api/v1/key` on 2026-09-03 returns:

```
is_free_tier:        false
is_provisioning_key: false
usage:               0
limit:               5
limit_remaining:     5
limit_reset:         None
```

`is_free_tier: false` confirms the $10 credit landed, moving the key from **50
to 1,000 requests/day** — the 20× increase that makes D2 Option B viable. And
`limit: 5` means **enforcement layer 2 of ADR-0005 — a hard per-key spend cap —
is now actually in place**, where before it was absent.

⚠️ `limit_reset: None` means the $5 cap is **lifetime, not monthly**. At Config
B's ~$3/month the key will stop around mid-October, and it will present as an
outage rather than as a billing event. Either set the cap to reset monthly or
plan to raise it.

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
