# Prerequisites

> **HISTORICAL — this is not the setup guide.**
>
> Written 2026-09-02, as a Phase 0 deliverable. It describes the accounts THIS
> office was planned around, in the order that plan reached them. The current
> required list is shorter: a Supabase project, an access token and an
> OpenRouter key, about ten minutes, all free.
>
> **If you are setting up your own Agentic Team, read [`SETUP.md`](../SETUP.md).**
> It is the one current starting point, it is generated from
> `src/fresh/contract.ts` so it cannot drift from what the code actually
> needs, and `npm run fresh:doctor` will tell you where you are in it at any
> point.
>
> This page is kept because it records how THIS office was built, which is
> worth having. It is not kept because it is current, and parts of it are not.

---



**Date:** 2026-09-02
**Status:** Phase 0 deliverable, per spec §32 (First Action)

Everything here is **human-only** — it needs a human identity, a payment
method, a consent screen, or a decision that is Grant's to make. Anything that
could be automated has been left out on purpose, per the spec's rule that Claude
Code must never ask Grant to do what it can do itself.

Nothing is blocked on the whole list. Work proceeds phase by phase, and each
section below says which phase it gates.

---

## Part 1 — Two decisions (blocking, but they are just answers)

These block Phase 3 and Phase 2 respectively. Both are explained in full in
`docs/feasibility-validation.md`.

### D1. iOS voice: accept the platform limit, or plan a native shell?

An iOS PWA **cannot** keep the microphone alive when backgrounded or
screen-locked. The documented fix needs a native background-audio declaration a
web app cannot make. Foreground, screen-on conversation works fine.

| | Choice |
|---|---|
| **(a) Recommended** | Accept it. Voice is a screen-on, in-app experience. Telegram voice notes cover away-from-screen, which §18 already provides for. Gate 1 passes, amended to say "foreground, screen-on". |
| (b) | Plan a thin native shell as a documented Phase 8+ option. The web app stays the product. |
| (c) | Telephony — Grant calls the team. New integration, per-minute cost. |

**Gates:** Gate 1 acceptance wording.

### D2. Secondary inference: strict $0, or hard-capped ~$10/month?

Free-only is achievable on *quota* but fails on **data terms** — Google states
human reviewers may read free-tier API input and output, and many OpenRouter
free endpoints exist because the provider harvests traffic. Separately, the
request tier the plan needs requires a **$10 lifetime credit purchase**, so a
zero balance cannot be the guarantee.

| | Choice |
|---|---|
| **(a) Recommended** | Hard-capped ~$10/mo with every enforcement layer intact. Honours "never *silently* spend" while dropping a $0 target that costs privacy. |
| (b) | Strict $0. Available, but the system must then accept weaker models or Google's data terms, and should not be given confidential material. |

**Gates:** Phase 2 provider registry defaults.

---

## Part 2 — Accounts and subscriptions

### P1. Dedicated Google account — **required, Phase 0** ⚠️

Create a **new Google account solely for AI Team HQ**. Do not use Grant's
personal or INNERGY Gmail. Spec §4 requires this, and research added a second
reason: the automation's session gets rotated out from under it if the same
account is used interactively in a browser.

Two rules that follow, and they matter operationally:

- **Do not browse Gemini Notebook signed in as this account** while the worker
  is running. If you want to read the notebooks yourself, **share them** to your
  own account instead.
- All Notebook automation, Google OAuth, and project sharing hang off this
  account.

### P2. Google AI Pro — **OPTIONAL / deferred** (superseded)

**Do not buy this yet.** My earlier "mandatory" verdict was wrong: it assumed
agents *converse with Notebook to reason*, which is the wrong architecture.
Notebook is the knowledge layer, not the inference engine.

Pulling each source's text **once** and caching it in Postgres costs no chat
quota, which puts realistic usage near **5–15 chats/day against a 50/day
limit**. The only real ceiling is **50 sources per notebook** — and the free
tier allows 100 notebooks, so a large project can be split behind the adapter.

Revisit only when a project approaches 50 sources, or Notebook-native Deep
Research proves better than ours. Full analysis in
`docs/cost-and-hosting-decisions.md` §3.

### P3. OpenAI account with billing — **OPTIONAL** (voice only) 💳 ~$24/mo

Voice is an optional premium feature; the system is complete without it.
Already supplied and verified working. For Realtime voice. Set a **usage limit** in the OpenAI dashboard as a hard
backstop independent of our own budget tracking — belt and braces on the one
intentionally paid component.

Expect **~$24/mo** at 30 min/day on `gpt-realtime-2.1-mini`, ~$58 on the full
model.

### P4. OpenRouter — **recommended, $10 one-off** (key already supplied)

Verified working, currently `is_free_tier: true` = **50 req/day**.
**Purchase $10 of credit once** (optional but high value). This is what unlocks 1,000
requests/day instead of 50; at 50 the plan misses by 2.7×.

Then create a **dedicated API key with a hard spend limit** (not the account's
main key) — that key's limit is the out-of-band backstop behind the in-band
`max_price` enforcement.

### P5. Supabase account — **required, Phase 1**, free

Create a project. Free tier is fine to start. Note it has **no backups at all**,
which is why the nightly offsite dump is mandatory infrastructure rather than
prudence — that part is automated.

### P6. Cloudflare account — **required, Phase 1**, free

For Workers (app + webhooks), Cron Triggers (scheduler), and R2 (backups).

### ~~P7. Oracle Cloud Always Free~~ — **REMOVED, not needed**

No always-on VM is required. `notebooklm-py` in master-token mode is **pure
HTTP with no browser**, so the 10-minute sync is a short serverless invocation.
Vercel's Python runtime (GA, 3.12–3.14) hosts it alongside the app.

Reintroduced only if Gate 2 proves master-token auth unusable and browser
automation becomes necessary — which is the POC's job to decide, not an
assumption.

### P8. Google Cloud project — **Phase 7**, free tier

For Text-to-Speech (voice notes). Chirp 3: HD gives **1M characters/month free
perpetually** with 30 distinct voices and native OGG/Opus output — no
transcoding needed for Telegram.

---

## Part 3 — Things only you can click

### P9. Telegram bots via BotFather — **Phase 2 (one), Phase 7 (rest)**

`/newbot` in BotFather is the **only** manual step. Everything else — name,
description, commands, **and profile photo** — is API-settable since Bot API 9.4
(2026-02-09), so the spec's claim that avatars need BotFather by hand is stale.

- **Phase 2:** create **one** bot (Chief of Staff) and hand over its token.
- **Phase 7:** create the remaining seven once the first is proven end-to-end.

Don't create eight up front. If something is wrong with the first, it is wrong
with all eight.

### P10. Slack workspace + app configuration token — **Phase 2**

1. Create a Slack workspace for AI Team HQ (Free plan is sufficient — it allows
   10 app installs. V1 uses **ONE** shared app, per addendum §3 — not eight).
2. Go to <https://api.slack.com/apps>, scroll **below** the app list to **"Your
   App Configuration Tokens"** → **Generate Token**, selecting that workspace.
3. Hand over **both** values: the config token (`xoxe.xoxp-…`) and the refresh
   token (`xoxe-…`).

Two things to know:

- **The config token expires in 12 hours.** That is expected and handled —
  automated rotation runs every 6–8 hours. This is why both values are needed:
  the refresh token is single-use and rotates each time.
- One token covers **all apps in the workspace**, so this is a **one-time** step,
  not per staff member.

**One residual manual step per app:** each created app needs an OAuth install
click to the workspace. Creation and configuration are automated; installation
grants the tokens. Eight clicks total, spread across Phase 7 — not eight setup
processes.

### P11. Google OAuth consent — **Phase 9**

Consent screens for Gmail / Calendar / Drive, using least-privilege scopes, on
the dedicated account. Gmail starts read + draft only, with **no automatic
sending**, per §20.

---

## Part 4 — How to hand over credentials

**Do not paste secrets into the chat.** Put them in the Claude Code cloud
environment's configuration, in `.env` format:

> claude.ai/code → this environment → gear icon → **Environment variables**

Then, once each connection is proven working, migrate the sensitive ones to that
environment's **API credentials**. That store attaches values to outbound
requests *after* they leave the session, so the raw key never enters the session
and cannot be logged. Candidates flagged now, per the spec's instruction to
raise this proactively: `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and every
Telegram bot token.

### The three stores, which do not overlap

| Store | Serves | Holds |
|---|---|---|
| Cloud env **Environment variables** | Claude Code build sessions | bootstrap credentials |
| Cloud env **API credentials** | Claude Code, via Anthropic's proxy | sensitive keys, never visible in-session |
| **GitHub Actions secrets** | CI workflows only | CI-only values — **not** readable by Claude Code sessions |
| **Production app secrets** | the deployed Team HQ | runtime credentials Grant enters in the app's own Settings → Connections & Secrets |

Production secrets are **never** inherited from the build environment.

### Note on `.secrets.local`

There is **no `.secrets.local`** in this project, and none should be created.
The spec removed it in two places, because a local bootstrap file only matters
when a session runs on someone's own machine — which never happens here. The
Environment variables field plays exactly that role. (Raised because it came up
twice in direction; see `docs/design/slack-app-lifecycle.md` for the full note.
Nothing in the architecture depends on the outcome.)

### One credential that is a file, not a value

The Gemini Notebook **master token** is a file (`master_token.json`), so it
cannot use the API-credentials mechanism. It is produced by one interactive
sign-in as the dedicated account and is then good for months, self-healing on
expiry. Handling is covered when Phase 4 begins — flagged here so it is not a
surprise.

---

## Part 5 — Bootstrap order

Nothing waits on the full list. Each phase needs only its own row.

| Phase | Needs |
|---|---|
| **0** — bootstrap | P1 (dedicated Google account). Decisions D1, D2 can follow. |
| **1** — foundation | P5 Supabase, P6 Cloudflare |
| **2** — connections | D2, P4 OpenRouter, P9 one Telegram bot, P10 Slack workspace + config token |
| **3** — POC gates | D1, P2 Google AI Pro, P3 OpenAI |
| **4** — project engine | *(nothing — no VM needed)* |
| **7** — communications | P8 Google Cloud TTS, P9 remaining seven bots, per-app installs |
| **9** — Google ecosystem | P11 OAuth consent |

### Right now, to unblock everything

1. **Create the dedicated Google account** (P1) — nothing Notebook-shaped moves
   without it.
2. **Answer D1 and D2** — two decisions, no setup work.
3. **Create Supabase and Cloudflare accounts** (P5, P6) — both free, and they
   unblock Phase 1 immediately.

Phase 1 can begin as soon as P5 and P6 exist.

---

## Cost summary

| Item | Monthly | When |
|---|---|---|
| ~~Google AI Pro~~ | **deferred — optional** | revisit at 50 sources |
| OpenAI Realtime (`2.1-mini`) | **optional** ~$24 | voice only |
| Secondary inference (capped, if D2a) | ~$10 | Phase 2 |
| OpenRouter credit | $10 **one-off** | Phase 2 |
| Hosting, database, storage, backups | $0 | — |
| **Mandatory total** | **$0/mo** | |
| **Recommended (private inference)** | **~$3/mo** + $10 one-off | |

**Corrected 2026-09-02.** The mandatory cost is **$0/month** — there is no
required subscription. The recommended configuration is **~$3/month** plus a
$10 one-off. See `docs/cost-and-hosting-decisions.md` for all four cost classes
and the three inference configurations.
