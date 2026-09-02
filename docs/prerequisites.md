# Prerequisites

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
personal or Innergy Gmail. Spec §4 requires this, and research added a second
reason: the automation's session gets rotated out from under it if the same
account is used interactively in a browser.

Two rules that follow, and they matter operationally:

- **Do not browse Gemini Notebook signed in as this account** while the worker
  is running. If you want to read the notebooks yourself, **share them** to your
  own account instead.
- All Notebook automation, Google OAuth, and project sharing hang off this
  account.

### P2. Google AI Pro on that account — **required, Phase 3** 💳 ~$20/mo

Not optional, despite the spec's free-tier assumption. The free tier allows
**50 chats/day, 3 audio overviews/day, and Deep Research 10 per *month***. Eight
agents on 10-minute polling exhaust that in an afternoon.

Pro raises this to 500 chats/day, 20 Deep Research/day, 300 sources/notebook.

### P3. OpenAI account with billing — **required, Phase 3** 💳 ~$24/mo

For Realtime voice. Set a **usage limit** in the OpenAI dashboard as a hard
backstop independent of our own budget tracking — belt and braces on the one
intentionally paid component.

Expect **~$24/mo** at 30 min/day on `gpt-realtime-2.1-mini`, ~$58 on the full
model.

### P4. OpenRouter account — **required, Phase 2** 💳 $10 one-off

Sign up and **purchase $10 of credit once**. This is what unlocks 1,000
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

### P7. Oracle Cloud Always Free — **Phase 4**, free

For the Python Notebook worker. Two caveats worth knowing before you rely on it:
Oracle **halved** Always Free ARM capacity on 2026-06-15, and instances can be
reclaimed when idle. Fallback is Hetzner CAX11 at ~€6/mo. Ask before spending.

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
   10 app installs, including custom apps, so eight staff apps fit).
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
| **4** — project engine | P7 Oracle (or accept ~€6/mo Hetzner) |
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
| Google AI Pro | ~$20 | Phase 3 |
| OpenAI Realtime (`2.1-mini`, 30 min/day) | ~$24 | Phase 3 |
| Secondary inference (capped, if D2a) | ~$10 | Phase 2 |
| OpenRouter credit | $10 **one-off** | Phase 2 |
| Hosting, database, storage, backups | $0 | — |
| **Baseline** | **~$54/mo** | |
| If free infra tiers give way | **~$86/mo** | |

The spec never named a budget. If ~$54/mo is wrong, the two levers are voice
(−$24, text-only) and strict-$0 inference (−$10, at a privacy cost). Say so
before Phase 3 rather than after.
