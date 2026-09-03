# Credential status

**Generated:** `npm run audit:credentials` · **Last run:** 2026-09-03
**No secret values appear in this file or anywhere in this repository.**

> ⚠️ **This file used to be written by hand, and it was wrong three times.**
> It said `GOOGLE_CLIENT_ID` was *present* when the variable held an empty
> string; it said `SUPABASE_DB_URL` was *set* when its password had never once
> authenticated; and `SLACK_SIGNING_SECRET` was recorded as a placeholder when
> it was empty. Each cost a round trip with Grant.
>
> One word caused all three. **"Present" was read as "working"**, and those are
> four different states. The audit script distinguishes them, so this file is
> now generated rather than asserted.

## The four states, and why the distinction earns its keep

| State | Meaning |
|---|---|
| ✅ **WORKING** | a live call succeeded with it |
| ⚠️ **UNVERIFIED** | plausible value, nothing has ever exercised it |
| ❌ **EMPTY** | the variable exists and holds nothing — **the most misleading state**, because every "is it set?" check passes |
| ⬜ **ABSENT** | not in the environment |

`EMPTY` is the one that does damage. A presence check passes, a status document
records success, and the failure surfaces weeks later inside a job.

§11 makes the point about quotas — *"'free' means measured, not assumed"* — and
it is exactly as true of credentials.

## Current state

| credential | state | detail |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | ✅ WORKING | DDL over HTTPS; PostgreSQL 17.6 |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ WORKING | PostgREST responds 200 |
| `SUPABASE_DB_URL` | ⚠️  UNVERIFIED | 86 chars — the DIRECT (IPv6-only) string; unusable here and its password was reset — see ADR-0007 |
| `OPENROUTER_API_KEY` | ✅ WORKING | is_free_tier=false usage=0 limit=5 |
| `OPENAI_API_KEY` | ✅ WORKING | 124 models, 10 realtime-capable |
| `GEMINI_API_KEY` | ✅ WORKING | 50 models |
| `TELEGRAM_CHIEF_BOT_TOKEN` | ✅ WORKING | @agenticteamgrantbot (id 8967954396) |
| `SLACK_BOT_TOKEN` | ✅ WORKING | team Agentic Team Grant as ai_team_hq |
| `SLACK_SIGNING_SECRET` | ⚠️  UNVERIFIED | 32 chars — cannot be verified without an inbound signed request; shape check only |
| `SLACK_APP_CONFIG_REFRESH_TOKEN` | ✅ WORKING | superseded by the vault; rotation ok, 40172s to expiry |
| `GOOGLE_CLIENT_ID` | ❌ EMPTY | variable exists but holds nothing |
| `GOOGLE_CLIENT_SECRET` | ❌ EMPTY | variable exists but holds nothing |
| `VERCEL_TOKEN` | ⬜ ABSENT | not in the environment |
| `BACKUP_S3_ENDPOINT` | ⚠️  UNVERIFIED | 41 chars — superseded by the vault — the backup workflow reads from there |
| `BACKUP_S3_ACCESS_KEY_ID` | ⚠️  UNVERIFIED | 25 chars — superseded by the vault — the backup workflow reads from there |
| `BACKUP_S3_SECRET_ACCESS_KEY` | ⚠️  UNVERIFIED | 31 chars — superseded by the vault — the backup workflow reads from there |
WORKING=8  UNVERIFIED=5  EMPTY=2  ABSENT=1

The audit fails the build only on a credential needed for the phase **currently
being built**. A Phase 9 credential being absent is correct rather than a fault,
and flagging it would train everyone to ignore the output.

## Notes on the non-working entries

**`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — empty, not present.** Needed for
Phase 9 (Gmail read + draft, Calendar, Drive), so not urgent. But the OAuth
scaffold cannot be built against them, which is worth knowing now rather than in
Phase 9. Recorded in `HUMAN_ONLY_PREREQUISITES.md`.

**`SUPABASE_DB_URL` — deliberately unusable here.** It is the direct,
IPv6-only connection string, and its password was reset on 2026-09-03 after
proving it had never authenticated (ADR-0007). Nothing reads it; the live
password lives in the vault. Kept only because a future Vercel deployment wants
a pooler URI.

**`SLACK_SIGNING_SECRET` — genuinely unverifiable until an endpoint exists.** It
authenticates *inbound* requests, so there is nothing to call. Shape is checked
(32 hex characters) and that is all honesty permits.

**`BACKUP_S3_*` — superseded.** The backup workflow reads these from the vault
now, because the session's egress policy refuses the GitHub Actions secrets API
and every value in Actions had to be a manual step (ADR-0010's lesson, applied
one table over). The environment copies are harmless leftovers.

**`VERCEL_TOKEN` — absent.** Grant reported adding it; it has not appeared in
this container. Not blocking: ADR-0010 moved webhooks to Supabase Edge
Functions, so Vercel is needed for the Notebook sync (Phase 4) and the Team HQ
UI, neither of which is being built yet.

## Migration to API credentials

Unchanged advice, now with a reason attached. Once proven in use, these should
move from **Environment variables** to the environment's **API credentials**, so
the raw value never enters a session and cannot be logged:

- `SUPABASE_ACCESS_TOKEN` — the highest-blast-radius credential in the project;
  it can execute arbitrary SQL
- `OPENAI_API_KEY`, `TELEGRAM_CHIEF_BOT_TOKEN`, `SLACK_BOT_TOKEN`

**Not eligible:** the Notebook master token (a *file*), and the Slack config
pair — which rotates, and therefore lives in the database (§15). That one is
already done: rotation has been running since 2026-09-03.
