# HUMAN-ONLY PREREQUISITES FOR GRANT

> **HISTORICAL — this is not the setup guide, and it is not about you.**
>
> This is Grant's own account list, from September 2026: which of HIS bots,
> workspaces and credentials existed on which day. It is evidence about one
> installation, not instructions for another.
>
> **If you are setting up your own Agentic Team, read [`SETUP.md`](SETUP.md).**
> The genuinely human-only list there is three things for a working office —
> a Supabase project, an access token and an OpenRouter key — about ten
> minutes, all free, with a fourth if you want to talk to it on Telegram.

---


**Updated:** 2026-09-03 · Required by addendum §56.5

Only actions you genuinely have to perform. Everything automatable has been
automated or is queued to be. Each item was tested against the addendum §40
filter — CLI? API? browser automation? inspect existing config? — before landing
here.

**Current state: 1 item left, and it does not block Phase 1 starting.**

✅ Resolved 2026-09-03: Telegram · Slack install · Slack signing + client secret ·
D2 Option B with credit landed · **Supabase access token, with DDL proven to
actually work** — including a `REVOKE` verified to be *enforced*, not merely
accepted. Phase 1 is unblocked.

⬜ Outstanding: the **Backblaze B2 Application Key pair**. Needed to *finish*
Phase 1 (the tested backup restore), not to start it.

---

## 🟠 One item left · *2 minutes*

### Backblaze B2 Application Key

The bucket is done — `ai-team-hq-backups`, `eu-central-003`, private, encrypted.
What is missing is the key pair.

> **B2 sidebar → Application Keys → Add a New Application Key**
> - Name: `ai-team-hq-backup-writer`
> - Allow access to Bucket: **`ai-team-hq-backups`** — the bucket, not "All"
> - Type of Access: **Read and Write**
> - Leave file name prefix and duration blank

It shows two values **once**:

| Variable | B2 calls it |
|---|---|
| `BACKUP_S3_ACCESS_KEY_ID` | **keyID** |
| `BACKUP_S3_SECRET_ACCESS_KEY` | **applicationKey** |

Plus the three non-secret ones, if they are not in yet:

```
BACKUP_S3_ENDPOINT=https://s3.eu-central-003.backblazeb2.com
BACKUP_S3_REGION=eu-central-003
BACKUP_S3_BUCKET=ai-team-hq-backups
```

### …and the same five as GitHub Actions secrets

**Two stores, both manual.** The nightly `pg_dump` and its restore rehearsal run
in GitHub Actions, because `pg_dump` cannot run in a build session
([ADR-0007](docs/adr/0007-ddl-over-management-api.md)). Actions secrets are a
separate store from this environment's variables — master spec §15 lists them
separately on purpose, so a build session cannot read CI's credentials.

> **[github.com/granterogers/agentic.team.grant/settings/secrets/actions](https://github.com/granterogers/agentic.team.grant/settings/secrets/actions)**
> → **New repository secret**, once per value.

Also add `SUPABASE_ACCESS_TOKEN` there, so the restore rehearsal can create and
tear down its own scratch database.

⚠️ **Correction:** I previously said I could add these repository secrets
myself. **I cannot** — the session proxy refuses the Actions API outright
(`403 Access to this GitHub Actions path is not permitted through this proxy`).
Tested. This is a genuine human-only action, so it belongs here rather than
being assumed away.

**Blocks:** closing Phase 1, whose acceptance includes a real backup restored
into a fresh database. Not starting it.

### ~~Supabase database access~~ ✅ DONE 2026-09-03

The ask was wrong for two sessions — a connection string was requested when no
connection string could ever work from this environment. The access token you
supplied works, and DDL was exercised end to end over HTTPS: create, insert,
select, `REVOKE`, RLS, policy, drop, and a forbidden `UPDATE` correctly refused
with `42501`. [ADR-0007](docs/adr/0007-ddl-over-management-api.md), now Accepted.

### ~~Install the Slack app~~ ✅ DONE 2026-09-03

Workspace **Agentic Team Grant** (`T0BUCJ2L5FD`), bot `ai_team_hq`, **17/17
scopes**, still a private internal app. Signing secret and client secret since
supplied and correctly shaped.

### ~~Re-paste the Telegram bot token~~ ✅ DONE 2026-09-03

**@agenticteamgrantbot** (id 8967954396). Gate 3 unblocked.

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

## 📋 Everything else, up front

**→ [`docs/credential-shopping-list.md`](docs/credential-shopping-list.md)** —
every credential the build will ever need, by phase, with exact URLs and steps.

Grab **Batches 1–3** together (~15 min) and a single restart covers Phases 1
through 3. Batches 4 and 5 genuinely cannot be done early: they need the
deployed URL and the final scope list.

Most urgent: **Batch 1 (Cloudflare R2)** — Phase 1 includes a *tested* backup
restore, and Supabase Free has no backups at all, so offsite storage is needed
now rather than later.

---

## 🟢 Later — not needed yet

| When | What |
|---|---|
| **Phase 4** | **Dedicated Google account** + one test Notebook shared to it. ⚠️ Do **not** browse Notebook signed in as that account while the worker runs — it rotates the worker's session out from under it. |
| **Phase 4** | One interactive Google sign-in to mint the Notebook master token (then good for months). |
| **Phase 7** | Google Cloud project for TTS — only once exact scopes are known. |
| **Phase 9** | Google OAuth consent screens, least-privilege. ⚠️ **And the client credentials themselves**: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` exist as **empty** environment variables. `docs/credential-status.md` recorded them as "present" for a full day, because presence was read as working. Nothing is blocked yet — Phase 9 is far off — but they will need creating, not just consenting to. |
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

## What happens next

Phase 1 starts now — CI first, then the schema, the append-only ledger and the
job engine. The B2 key pair is the only thing still owed, and it is needed at the
*end* of Phase 1 rather than the beginning.

One correction worth recording: this document twice told you a session restart
was needed for new variables to be seen. That turned out to be false — the
Supabase and Slack values reached a **running** session with no restart. Handing
over between sessions is still sometimes necessary, but not for that reason.
