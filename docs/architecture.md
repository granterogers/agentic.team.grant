# Architecture

**Date:** 2026-09-02
**Status:** Phase 0 deliverable, per spec §32. Design only — no implementation yet.
**Companion:** `docs/design/core-invariants.md` holds the provider-independent
core (command layer, ledger, job engine, quality gate). **Read that first.**
This document binds that core to specific vendors and explains why each was
chosen over the alternatives.

---

## 1. Shape of the system

```
   Slack ──┐
   Voice ──┤                                                 ┌──► Slack
Telegram ──┼──► Canonical Command Layer ──► Router ──► Jobs ──┼──► Telegram
 Team HQ ──┘         (normalize only)      (Chief of      │   ├──► Team HQ
                                            Staff)        │   └──► Notebook
                                                          │
                              ┌───────────────────────────┴──────┐
                              │  Quality gate ──► Ledger commit  │
                              └──────────────────────────────────┘
```

Four surfaces, one organisation. The surface an instruction arrives on affects
**only** authentication, the reply address, and delivery policy — never what the
organisation does. That invariant is the whole point of the design and is
covered in `core-invariants.md` §1.

### Deployment topology

| Component | Runs on | Why |
|---|---|---|
| Next.js app + API routes | **Cloudflare Workers** via `@opennextjs/cloudflare` | no cold-sleep, free tier viable for commercial use, and it is where the webhooks land |
| Postgres, auth, realtime | **Supabase Free** → Pro if needed | the operational source of truth |
| Notebook worker (Python) | **Oracle Cloud Always Free ARM VM** | needs a long-running process, not request-scoped compute |
| Scheduler | **Cloudflare Cron Triggers** | 10-minute cadence, free, colocated with the app |
| Queue | **Postgres** (`SKIP LOCKED` or pgmq) | transactional with the state it guards |
| Backups | **Cloudflare R2** | 10 GB free, egress free |

**$0/month** if the free tiers hold; **~$32/month** realistic fallback
(Supabase Pro $25 + Hetzner ~$6.53). Three named fragilities: Supabase pausing
after ~1 week of no *user* database activity, Supabase's total absence of
backups on Free, and Oracle's idle reclamation plus ARM capacity lottery.

### Rejected, and why it matters

- **Vercel** — disqualified twice over. Its commercial-use ban covers *"any
  Deployment used for the purpose of financial gain of anyone involved…
  including a paid employee or consultant writing the code"*, and **Hobby cron
  is capped at once per day**, so `*/10 * * * *` fails at deploy time. Either
  alone rules it out.
- **Netlify** — Free is 300 credits/month and **a production deploy costs 15**.
  Twenty deploys exhaust the month before serving a request.
- **Render / Fly.io / Railway** — Render offers **no background workers or cron
  on free at all**; Fly removed its free allowance; Railway is now a 30-day
  trial.
- **Socket Mode** — needs a persistent connection Workers cannot hold, and Slack
  recommends HTTP for production regardless.

---

## 2. Data layer

Two sources of truth, per §6, and the boundary is strict.

**Gemini Notebook** owns project source material, rich knowledge, source URLs,
and Notebook-generated artifacts.

**Supabase/Postgres** owns *everything machine-readable and operational*: tasks,
responsibilities, agent state, the projects registry, activity, decisions,
notifications, feedback, approvals, provider usage, quota accounting, agent
prompt versions, change events, reversals, configuration, and staff identities.

> **The system must remain fully functional with Notebook unavailable.** Given
> that Notebook automation rests on undocumented endpoints, this is not a
> theoretical resilience goal — it is the expected failure mode. Notebook
> outage is a *degraded mode*, never a system failure.

Table groups (schema detail lands in Phase 1):

| Group | Holds |
|---|---|
| Identity & config | `staff`, `staff_prompt_versions`, `projects`, `system_config`, `autonomy_settings` |
| Work | `jobs`, `job_runs`, `tasks`, `responsibilities`, `initiatives` |
| Knowledge | `findings`, `outputs`, `output_reviews`, `sources`, `source_fingerprints` |
| History | `events` (append-only), `reversals` |
| Channels | `slack_app_credentials`, `telegram_bots`, `channel_messages`, `notification_prefs` |
| Metering | `provider_usage`, `provider_health`, `quota_accounting` |

Two enforcement points that must be database-level, not conventional:

- **`events` is append-only** — revoke `UPDATE`/`DELETE` from the application
  role. A convention that history is immutable is not immutability.
- **Row-level security throughout.** Single-user today, but the service-role key
  is the highest-blast-radius credential in the system and must not be the
  thing standing between a bug and the ledger.

---

## 3. Voice layer

**`gpt-realtime-2.1-mini`** by default, `gpt-realtime-2.1` where instruction-
following matters more than cost. Both GA, 128k context, 32k max output. The
spec's `gpt-realtime` / `gpt-realtime-mini` are **deprecated and removed from
the API on 2027-01-20**; `gpt-4o-realtime-preview` shut down 2026-05-07.

**Browser WebRTC**, with the permanent key never leaving the server:

1. Browser asks our Worker for a session.
2. Worker mints an ephemeral client secret at **`/v1/realtime/client_secrets`**
   (`ek_` prefix, TTL 600s default, 10–7200 range).
3. Browser exchanges SDP at **`/v1/realtime/calls`**.

Anything citing `/v1/realtime/sessions` for minting is stale. Session cap is
**60 minutes**, not 30.

WebRTC is right for a second reason beyond latency: it gets **automatic
server-side truncation of unplayed audio on interruption**, which WebSocket
clients must hand-roll via `conversation.item.truncate`. Barge-in is closer to
free.

### Voice tools must never block

A realtime tool call cannot wait for a substantive job. So voice tools are
exactly two kinds:

- **Deterministic reads** — project status, task lists, latest findings. Fast SQL,
  no model. Per §10, do not call an LLM where ordinary code will do.
- **Enqueue-and-acknowledge** — creating work returns "I've set that going" and
  the job outlives the conversation, surfacing later per delivery policy.

The async tool-call wire format is **under-documented** — confirmed in OpenAI's
developer notes, absent from the reference guide. Verify empirically in Gate 1
before designing around it.

### The iOS constraint, stated plainly

An installed PWA **cannot** keep the microphone alive when backgrounded or
screen-locked, and is *worse* than a Safari tab for this. The documented remedy
requires a native `Info.plist` background mode a web app cannot declare.
Foreground screen-on conversation works. See decision **D1** in
`docs/prerequisites.md`.

### Cost

**Prompt caching is load-bearing, not an optimisation.** Realtime is stateful
and re-sends accumulated context — ~1.2M tokens/day at 30 min/day, nearly all
cache hits at $0.30–0.40 per 1M. Uncached, the full model would cost ~$1,158/mo
instead of ~$58: a **20× difference**. Any cost model that ignores caching is
wrong by more than an order of magnitude.

---

## 4. Secondary inference

A provider registry with routing, health, and circuit breakers (§11). Priority:

1. **OpenRouter `:free`** — the only provider with real capacity. Meters by
   *requests* (20 RPM / 1,000 RPD), not tokens, so ~135 requests/day fits with
   7.4× headroom.
2. **OpenRouter cheap-paid, hard-capped** — if decision **D2a** is taken.
3. **Groq free** — 200k tokens/day but an **8,000 TPM ceiling that makes a
   35k-token summarization impossible at any volume**. Short inputs only.
4. **Cloudflare Workers AI** — ~375k input tokens/day on a 70B model.
5. **SambaNova** — 20 requests/day per model. Marginal.
6. **Gemini free** — **non-confidential material only.** See below.

**GitHub Models is retired** (2026-07-30) and must be removed from the spec.

### Model per role

| Role | Model | Price /1M |
|---|---|---|
| Long-context summarization | `qwen3.7-flash` (1M ctx) | $0.03 / $0.13 |
| Analytical reasoning, critique | `deepseek-v4-flash-latest` (1.31M ctx) | $0.05 / $0.16 |
| Mechanical classification | free tier, or cheapest available | $0 |

At realistic volume that is **$2.83–8.25/month** — which is why the $0 rule
costs more than it saves.

### Enforcing "never silently paid"

Principle 8 is the requirement; these layers are the mechanism. All injected by
the **HTTP wrapper, never by callers** — a caller that can opt out is not an
enforcement layer.

1. **`provider.max_price: {prompt:0, completion:0, request:0, image:0}` with
   `allow_fallbacks: false`.** The in-band guarantee. Documented to **prevent
   execution** when unmet, not merely derank.
2. **A dedicated API key with a hard `limit`.** Out-of-band backstop.
3. **Allow-list rebuilt from live `/api/v1/models`**, admitting only
   `pricing.prompt === "0"`. Never a hard-coded list.
4. **Post-response circuit breaker on `usage.cost > 0`.**

Three hazards, all silent:

- **`openrouter/auto:free` still charges.** `:free` on a router is a no-op.
  `openrouter/free` is the only safe router.
- **`allow_fallbacks` defaults to `true`** — wrong for this system.
- **`data_collection` defaults to `"allow"`** — also wrong.

### The privacy constraint

Google states free-tier content is used to improve Google products and that
*"human reviewers may read, annotate, and process your API input and output"*
(except EEA/CH/UK). Many OpenRouter `:free` endpoints exist *because* the
provider harvests traffic — so `data_collection: "deny"` may **empty the free
registry**.

> This is the most likely way the free-only path fails in practice, it is
> untested, and it is cheap to test. **Test it first in Phase 2**, before
> building the registry around an assumption.

---

## 5. Notebook adapter

`notebooklm-py` (pin exact version; v0.8.1 at time of writing) as an **embedded
Python library in pure-HTTP mode** — not via its MCP server, which is built for
interactive agent tooling and would add an unnecessary hop and OAuth surface to
an unattended backend.

**Auth: master token.** One interactive sign-in as the dedicated account
produces a durable token, good for months, that re-mints cookies on demand and
self-heals expiry in-process with no browser. **No Chromium at runtime.**

Operational rules:

- Read `AccountLimits.tier` at startup and **derive per-day budgets from the
  detected tier** — never hard-code quota numbers, which Google changes without
  updating its own published tables.
- **Artifact generation is best-effort and never in a critical path.**
  Documented precedent: on 2025-11-25 infographics and slide decks went to 0 for
  free users with no doc update.
- Artifact generation is **async with a task id** — model it as a durable job
  with a poll step, not a blocking call.
- **Fingerprint sources locally** for change detection. Do not rely on Notebook
  to say what is new.
- **The dedicated account must not be browsed interactively while the worker
  runs**, or it rotates the worker's session out from under it.

The adapter interface is shaped so it can also be satisfied by the **official
Gemini Notebook Enterprise REST API**, which exists and is documented. The
boundary has a real migration target, not a hypothetical one.

---

## 6. Slack integration

Full detail and provenance in `docs/design/slack-app-lifecycle.md`.

### Credential storage — one row per app, not one env var

**This is the section a future maintainer must read before "simplifying" it.**

`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` and `SLACK_APP_TOKEN` are **per-app
credentials, not global constants.** With eight staff bot identities,
`process.env.SLACK_BOT_TOKEN` is not merely untidy — it is **unrepresentable**.
There is no correct value for it. Any code path reading it appears to work while
exactly one app exists and **breaks silently on the second**.

> Every code path needing Slack credentials reads them from Supabase, keyed by
> the app it is acting as. **Never from `process.env`.**

`slack_app_credentials`:

| Column | Notes |
|---|---|
| `staff_id` / `app_identifier` | FK to the staff member this app belongs to |
| `slack_app_id` | Slack's identifier |
| `bot_token` | **encrypted at rest** |
| `signing_secret` | **encrypted at rest** |
| `app_token` | **encrypted, nullable** — expected `NULL` on every row, since Socket Mode is not used. A non-null value means something enabled it unintentionally. |
| `installed_at` | |
| `last_verified_at` | feeds connector health; distinguishes "never worked" from "worked and has now broken" |

Credentials are written **immediately** on successful create-and-install — never
held only in memory or logs, never printed. Local debugging uses an explicit
gitignored `.slack-dev-override.local` override, never a default expectation.

Only the human-provided **config token pair** lives in the bootstrap store. It
is a *separate, short-lived, cross-app* credential — do not conflate it with the
per-app ones.

### App lifecycle

One human bootstrap generates a config token pair, then app creation is
automated via `apps.manifest.validate` → `create` → `update` / `export` /
`delete`. Always validate before create — a rejected manifest partway through
eight apps is a partial-state problem not worth creating.

**The config token expires every 12 hours.** Rotation via
`tooling.tokens.rotate` must exist **before** manifest automation is built, must
run proactively every 6–8 hours (never reactively after a failure), and must
persist **both** rotated values — the refresh token is single-use. Rotation
state lives in Supabase encrypted, because a credential that rotates twice a day
cannot live in build-time configuration.

**Prove rotation survives a restart and a full expiry window before building on
it.** A rotation mechanism that has not been observed rotating is an assumption.

### Identity architecture

Slack Free allows **10 app installs**, custom apps included, so eight fit with
two spare — but `username`/`icon_url` overrides (current `chat:write.customize`
scope, not deprecated) are **cosmetic only**: an overridden identity is **not
`@mentionable`, not DM-able, and absent from the member list**.

So: **3–5 senior staff get real separate apps** (the only way to be
addressable); the rest present via one shared app with overrides; **reserve ≥3
of the 10 slots**. Telegram carries the identity weight instead, where per-bot
identities are strictly better.

### Cliff edge

> **Never enable public distribution on any AI Team HQ Slack app.**

Slack's 2025 rate-limit restrictions exempt internal custom apps — verbatim:
*"Internal customer-built applications are not impacted… For Custom apps,
`conversations.history` and `conversations.replies` are limited to 50+ requests
per minute."* The punitive 1-request/minute, 15-object limit applies to
**commercially distributed non-Marketplace** apps. Enabling distribution
silently reclassifies an app and would cripple any agent reading channel
history, with no error saying why. Belongs in the manifest review checklist and
in Gate 4 as an explicit negative assertion.

---

## 7. Telegram integration

Eight separate bots — comfortable, and better than Slack for identity. No
official bot-count limit is published.

**Only `/newbot` is manual.** Name, description, short description, commands
**and profile photo** are all API-settable — `setMyProfilePhoto` arrived in Bot
API 9.4 (2026-02-09), so the spec's claim that avatars need BotFather is stale.

**HTTP webhooks**, per app, verified by secret token.

### Undo must be an absolute state write

Telegram's entire documented retry contract is one sentence — *"we will repeat
the request and give up after a reasonable amount of attempts"* — with **no
retry count, no backoff, and no ordering guarantee**. With `max_connections`
defaulting to 40, duplicate deliveries can be genuinely **concurrent**.

Therefore Undo is modelled as an **absolute state write** keyed on the original
`event_id`, not a relative reversal, and idempotency is enforced **below the
channel** in the ledger — not guarded in the callback handler. §21 requires
pressing Undo twice to be safe; this is the only way that holds.

### Voice notes

**Google Cloud TTS Chirp 3: HD** — 1M chars/month free *perpetually* (monthly
reset, not a trial credit), **30 distinct `en-US-Chirp3-HD-*` voices**,
first-party terms, and native `OGG_OPUS` output so `sendVoice` needs **zero
transcoding**. Fallback: **Kokoro-82M**, Apache-2.0, 54 voices, self-hosted, no
quota. Degrade to text rather than ever incurring paid TTS.

**`edge-tts` is rejected**, not caveated: it reverse-engineers a private
Microsoft endpoint, and Microsoft's own guidance says commercial use that way
violates its terms. **Piper** also lost its former standing — relicensed
GPL-3.0, and its docs state it is *"intended for personal use and text to
speech research only"*.

---

## 8. Job engine and scheduling

Full design in `core-invariants.md` §4. Bindings:

- **Queue in Postgres.** `SKIP LOCKED` is explicitly blessed by Postgres' own
  docs for queue tables. pgmq (Supabase Queues) is less code; hand-rolling wins
  if we want priorities, backoff and scheduled-for columns. Either way **the
  idempotency key is ours to own**: pgmq's "exactly once" is scoped to the
  visibility timeout, **not across retries**, and it has no dedup feature.
- **Scheduler:** Cloudflare Cron Triggers primary; GitHub Actions (public repo)
  fallback; a systemd timer on the worker VM as watchdog. GitHub Actions cannot
  be primary — 4,320 runs/month at 10-minute cadence exceeds the Free
  private-repo allowance, and public-repo schedules are **auto-disabled after 60
  days of inactivity**.
- **Supabase keep-alive must come from outside the project.** Pausing triggers
  at ~1 week of no *user* database activity, and internal `pg_cron` does not
  credibly count as activity.

---

## 9. Backups

Supabase Free provides **no backups at all** — Supabase's own remedy is to run
`db dump` yourself. So per §24 this is **mandatory infrastructure**:

- Nightly logical `pg_dump` → **Cloudflare R2** (10 GB free, free egress).
- Application configuration and critical metadata exported alongside.
- Notebook rich media stays in Notebook; only metadata and references mirror.
- **Restoration is documented *and tested*.** An untested backup is a belief.

---

## 10. Observability

Per §23, and the key point is that there is **one** explanation surface:
querying the `events` ledger by `correlation_id`. Not a separate logging system
that can disagree with the ledger about what happened.

Stored per action: trigger, agent, tools used, sources, a **concise rationale
summary**, provider, usage, result, resulting actions.

> **Never store or expose chain-of-thought.** §23 forbids it, and it is enforced
> at the write boundary: the ledger writer accepts only a short structured
> rationale, and agents have no API that could dump raw reasoning into it.

Health pages: system, connector, provider, sync, queue, recent failures, retry
status. Alert Grant **only when automatic recovery has failed** or work is
materially affected — which is what `last_verified_at` on each connector exists
to distinguish.

---

## 11. What this architecture deliberately does not do

- **It does not depend on Anthropic or Claude Code at runtime.** Claude Code is
  the development agent only. The agent engine runs on the product's own
  provider abstraction. This session's MCP servers and scheduled triggers are
  build-time conveniences and must not appear in the product — in particular,
  the 10-minute Notebook sync runs on Cloudflare Cron, never on a Claude Code
  trigger.
- **It does not treat any channel as privileged.** Slack, Telegram, Voice and
  Team HQ are peers. §31's cross-interface acceptance test is the automated
  proof, asserting the normalized command is equal across paths modulo
  `origin_channel`, `origin_ref` and `command_id`.
- **It does not let Notebook hold operational state.** Notebook can vanish; the
  system keeps working.
- **It does not let agents rewrite their own prompts.** §17: versioned, weekly
  proposal, Grant's manual approval. The intent-classification thresholds in
  particular are a cost governor, and a self-adjusting cost governor that drifts
  upward is exactly the failure that rule prevents.

---

## 12. Decision log

| ID | Decision | Rationale |
|---|---|---|
| AD-01 | Cloudflare Workers over Vercel | Vercel's commercial-use ban and once-daily cron cap each disqualify it |
| AD-02 | HTTP Events API over Socket Mode | Workers cannot hold a persistent connection; Slack recommends HTTP for production |
| AD-03 | Per-app Slack credentials in Postgres | a single env var is unrepresentable with 8 identities |
| AD-04 | `gpt-realtime-2.1-mini` default | current GA model; spec's names are removed 2027-01-20 |
| AD-05 | `notebooklm-py` embedded, master-token, pure HTTP | unattended-capable, no Chromium; MCP hop unnecessary for a backend |
| AD-06 | Postgres queue over external broker | transactional with the state it guards; `SKIP LOCKED` is blessed |
| AD-07 | Undo as absolute state write | Telegram guarantees neither retry count nor ordering |
| AD-08 | Google Cloud TTS Chirp 3: HD | perpetual free quota, first-party terms, native OGG/Opus |
| AD-09 | Recommend capped ~$10/mo inference | free-only fails on data terms; the cap preserves "never silent" |
| AD-10 | Ledger append-only at DB level | a convention of immutability is not immutability |
