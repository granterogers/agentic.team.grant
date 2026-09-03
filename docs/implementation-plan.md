# Implementation plan

**Date:** 2026-09-02
**Status:** Phase 0 deliverable, per spec §32
**Governing rule:** §19 — **strict sequential build gate.** One phase at a time.
After each, stop feature work and prove it with automated tests, integration
tests, failure injection, restart/recovery tests, and mobile/desktop
verification. Do not start the next phase until the current one passes. If it
fails, fix and retest *the same phase* rather than building ahead.

---

## How each phase ends

A phase is complete only when all five hold. This is the same checklist every
time, deliberately.

1. **Acceptance criteria met** — the phase's own list below.
2. **Tests pass** — unit, integration, regression, plus the failure-injection
   cases named for that phase.
3. **Restart survival proven** — kill the process mid-work; state reconciles and
   work resumes. Not inspected, *demonstrated*.
4. **Evidence committed** to `docs/test-evidence/phase-N/` — §29 requires keeping
   evidence, so it lives in the repo, not in a chat transcript.
5. **Acceptance review** by the strongest reasoning capability (see
   `docs/research/claude-code-capabilities.md`). Not delegated.

**Escalation rule:** if the same failure recurs twice, stop implementing. Treat
it as a design defect, escalate to high-effort reasoning, fix the design, retest.
Never stack code on a repeatedly failing architectural assumption to conserve
model credits.

---

## Phase 0 — Bootstrap · *in progress*

**Done:**

- ✅ `.gitignore` first, as a secrets backstop
- ✅ Research pass on every named technology → `docs/research/`
- ✅ `docs/feasibility-validation.md`, `docs/architecture.md`,
  `docs/prerequisites.md`, this plan
- ✅ `docs/design/core-invariants.md`, `docs/design/slack-app-lifecycle.md`
- ✅ Build-environment and secret-store confirmation

**Remaining:**

- ⬜ **Decisions D1 (iOS voice) and D2 (inference budget)** — Grant's
- ⬜ Dedicated Google account (**P1**) — blocks everything Notebook-shaped
- ✅ Supabase access proven (DDL over the Management API — ADR-0007)
- ⬜ Offsite backup credentials (**P6**) — Backblaze B2 chosen; bucket created,
  key pair outstanding. Blocks closing Phase 1, not starting it
- ✅ CI: lint, typecheck, test, migration check, secret scan on every push
- ✅ Test harness skeleton and `docs/test-evidence/` structure

**Exit:** D1 and D2 answered; P1, P5, P6 exist; CI green on an empty test suite.

> CI must be green *before* Phase 1, not alongside it. A test harness added
> after the schema is a harness shaped by the schema.

---

## Phase 1 — Foundation · ✅ **COMPLETE 2026-09-03**

All acceptance criteria demonstrated against the live database, not asserted.
Evidence in `docs/test-evidence/`:

| Criterion | Result |
|---|---|
| `UPDATE`/`DELETE` on `events` fails at the database level | ✅ 15/15 — four layers |
| A job survives a hard kill at every one of its fourteen states | ✅ 34/34 |
| Re-enqueueing identical logical work collides | ✅ `23505` on the idempotency index |
| Undo twice is a no-op, by construction | ✅ partial unique index, `23505` |
| Capacity limits hold across a restart | ✅ 3 of 5 dequeues served across 5 connections |
| Slack credentials encrypted at rest, one row per app | ✅ 18/18 — storing a value is a type error |
| A backup restored into a fresh database and verified | ✅ 16/16, nightly |

`npm run verify` gates every commit; `npm run verify:db` re-runs all 83 live
database checks.


The core from `core-invariants.md`, built as one coherent unit. **No channels,
no agents, no UI beyond what proves it works.**

- Supabase schema: identity/config, work, knowledge, history, metering
- **`events` append-only, enforced by revoking `UPDATE`/`DELETE`** from the
  application role
- RLS throughout
- Job engine: **the fourteen states of master spec §6** (this plan previously
  said nine — see [ADR-0008](adr/0008-fourteen-job-states.md)), idempotency keys,
  `SKIP LOCKED` dequeue, **capacity limits enforced at dequeue**, per-provider
  circuit breakers
- **Boot recovery sweep** reconciling jobs left in transient states
- Compensating-action rollback, keyed on original `event_id`
- Health page and connector-health model
- Nightly `pg_dump` → R2, **plus a tested restore**
- Supabase keep-alive from outside the project

**Acceptance:**

- A job survives a hard kill at every one of its **fourteen** states and resumes
  correctly — including, specifically, a kill between `committed` and
  `notifying`, which is the case nine states could not express
- Re-enqueueing identical logical work collides instead of duplicating
- `UPDATE`/`DELETE` on `events` **fails at the database level**
- Undo twice is a no-op — proven by concurrent duplicate invocation, not
  sequential clicks
- Capacity limits hold across a restart
- **A backup is restored into a fresh project and verified.** An untested backup
  is a belief.

**Failure injection:** DB connection loss mid-transaction, duplicate event
write, worker killed in each state, provider timeout tripping a breaker,
migration rollback.

---

## Phase 2 — Connections · 🟡 **IN PROGRESS**

| Item | State |
|---|---|
| Encrypted secret storage (vault + references) | ✅ migration 0007, 18/18 |
| Provider registry with health, priority, free-only | ✅ migration 0009, live discovery |
| All four inference enforcement layers | ✅ 9/9 live, spend $0 |
| **Does `data_collection: "deny"` empty the free registry?** | ✅ **No** — but it costs 8 of 21 models ([ADR-0009](adr/0009-free-allowlist-from-probes.md)) |
| **Does config-token rotation survive expiry and a restart?** | ✅ **Yes** — recovered from `token_expired`; rotated across two machines via Postgres alone |
| Slack rotation, scheduled | ✅ every 4h, `.github/workflows/slack-rotation.yml` |
| Telegram bot configured by API | ✅ description, commands, webhook secret vaulted |
| Telegram webhook registered | ⬜ **blocked on a deployed URL** — not a credential gap |
| Google OAuth scaffold | ⬜ |
| Layer 2 backstop actually *hit* | ⬜ the cap is set (`limit: 5`) but has never fired |

**Blocked, and honestly so:** the webhook needs an HTTPS endpoint. Registering
one that points nowhere would make Telegram queue updates against a dead
endpoint, so it waits for deployment rather than being faked.


Credentials, provider registry, and the two riskiest unknowns — deliberately
front-loaded.

- Encrypted secret storage + Settings → Connections & Secrets
- Provider registry with health, priority, free-only flag
- **All four inference enforcement layers in the HTTP wrapper**
- Slack: rotation **first**, then `apps.manifest.validate`, then one app
- Telegram: one bot (Chief of Staff), webhook, secret-token verification
- Google OAuth scaffold (consent deferred to Phase 9)

### Test these two first

1. **Does `data_collection: "deny"` empty the OpenRouter free registry?** The
   most likely way free-only fails. Cheap to test, and it decides D2's viability
   — so test it before building the registry around either answer.
2. **Does config-token rotation survive a restart and a full 12-hour expiry
   window?** Everything Slack depends on a credential that expires twice a day.

**Acceptance:**

- Rotation observed rotating across a real expiry window and a restart
- `usage.cost > 0` trips the breaker and blocks further calls
- `provider.max_price` provably **prevents execution** rather than deranking
- A paid model cannot be reached by any code path, including via
  `openrouter/auto:free`
- One Slack app created, configured and installed by automation
- Telegram round-trip with idempotent callback handling
- No secret appears in any log

**Failure injection:** rotation with a stale refresh token, provider 429,
provider outage, malformed model output, revoked Slack token, duplicate Telegram
callback, webhook replay.

---

## Phase 3 — POC gates

**All FIVE** of §27's gates (addendum §4), **strictly sequential**. Complete one, record PASS evidence,
then start the next. Do not parallelise: it hides dependency failures.

### Gate 1 — Realtime voice on iPhone Safari

Minimal page: Start/Stop, connection state, three tools
(`get_project_status`, `create_task`, `get_latest_insights`).

**Amended acceptance, per D1:** 20+ minute natural conversation on iPhone Safari
**in the foreground, screen on**. Mic works, playback works, interruption works,
tool calls work, state reads and writes, reconnect tested, mic-denied handled,
cost measured. Benchmark `gpt-realtime-2.1-mini` against `gpt-realtime-2.1`.

**Additionally, because these were flagged unverified:**

- Real-device test across current iOS point releases (reported iOS 26 PWA audio
  regressions are credible but unconfirmed by Apple)
- **Echo cancellation** — the practical make-or-break for barge-in quality
- Async tool-call wire behaviour, empirically
- **Document the backgrounding limit as observed**, so it is recorded rather
  than rediscovered

### Gate 2 — Notebook automation

All operations from §27 against a test notebook, unattended across multiple sync
cycles, no duplicate source processing, state mirrored correctly. Master-token
refresh proven across an expiry. Confirm write-back reversibility **per artifact
type** before any Undo button is offered on a write-back.

### Gate 3 — Telegram

Message, image/document, callback buttons, thumbs up/down, Undo, **duplicate
Undo**, bot blocked, malformed callback, rate limit, webhook retry, voice note.

### Gate 4 — Slack

Connection, manifest path, channel creation/mapping, bot message, DM, thread
reply, reactions, natural-language preference update, rate-limit handling, token
revocation, reinstall. Plus two negative assertions: **public distribution is
never enabled**, and **the ledger remains authoritative with Slack history
unavailable**.

### Gate 5 — Secondary failover

Success, 429, outage, malformed output, fallback to next free provider, all
providers unavailable → queue, and **no paid model used**.

**Exit:** all five gates PASS with committed evidence, or a documented, proven
equivalent alternative.

---

## Phase 4 — Project engine

- Notebook discovery, 10-minute sync via Cloudflare Cron
- Automatic project creation from discovered notebooks
- Source fingerprinting and change detection
- Initial project brief generation
- Project switching
- **Tier-derived budgets** from `AccountLimits.tier`, never hard-coded

**Acceptance:** a new notebook is discovered and becomes a project unattended;
50 sources added rapidly are processed without duplication; a worker crash
mid-sync resumes cleanly; Notebook outage degrades rather than fails.

**Failure injection:** expired auth, corrupted token, duplicate source, deleted
source, 50 rapid sources, outage, crash mid-sync.

---

## Phase 5 — Agent engine

- Eight permanent roles (§7) on the product's own provider abstraction
- Chief of Staff, router, delegation
- **Intent classification, biased downward** on ambiguity
- Quality pipeline with the structured metadata of §16
- Temporary specialists
- Staff Builder (§8)
- Prompt versioning

**Acceptance:** an output without `reviewer_status` **cannot reach
`committed`**; material disagreement is surfaced rather than averaged away;
duplicate-work avoidance is enforced by the router as a required query;
ambiguous input produces a bounded investigation or a clarification, never an
uncontrolled multi-agent workload.

**Failure injection:** contradictory sources, malformed output, runaway
delegation attempt, duplicate task, forbidden destructive operation.

---

## Phase 6 — Autonomy

Responsibilities, queue scheduling, capacity limits, project monitoring, Today,
Needs Me, morning/evening briefings, natural-language autonomy controls.

Start at the spec's conservative V1 defaults: 3 simultaneous jobs, 3 specialist
consultations/job, 5 investigations/project/day, 3 immediate alerts/agent/day,
everything else batched.

**Acceptance:** limits hold under concurrent load and across restarts; "leave me
alone today" persists as structured preference; Needs Me stays small.

---

## Phase 7 — Communications

Slack office (channels, threads, tiered staff identities, **≥3 app slots
reserved**), remaining seven Telegram bots, feedback capture, voice notes via
Chirp 3: HD with text fallback, Undo surfaces, notification learning.

**Acceptance:** results reach the right thread with correct identity
presentation; TTS degrades to text rather than incurring cost; Undo is
idempotent under concurrent duplicate delivery.

**Failure injection (Slack):** token revoked, rate limited, duplicate event,
out-of-order event, bot removed from channel, connection interrupted, channel
renamed, app limit reached.

---

## Phase 8 — Full UI

Polished mobile/desktop app per §25, project dashboards with remembered
collapse/reorder, staff profiles, activity history, charts, and the Usage &
Capacity dashboard.

**Acceptance:** mobile-first interaction with desktop information density; no
raw JSON or token/debug detail in normal workflow; **estimated quota clearly
labelled as estimated**, per §12 and the Notebook finding that no live counters
exist.

---

## Phase 9 — Google ecosystem

Calendar read/write, Gmail read + draft (**no automatic sending**), Drive
read-only, optional GitHub read-only. Least-privilege scopes; push/watch
notifications over polling where available.

---

## Phase 10 — Hardening

Full failure injection across every integration, security review, backup restore
rehearsal, provider failover, crash recovery, regression suite, and the
documentation set of §30 — including the handoff guide for another coding agent.

**Exit — §31's completion criteria.** V1 is done only when both end-to-end
scenarios work reliably:

1. The Money Mastery source-to-notification-to-voice-conversation flow, all 21
   steps.
2. The **cross-interface delegation test**: the same instruction via Slack and
   via Voice produces identical backend behaviour. Automated as an equality
   assertion on the normalized command, modulo `origin_channel`, `origin_ref`
   and `command_id`.

---

## Sequencing rationale

Three deliberate departures from a naive reading of the spec's phase list:

1. **The two riskiest unknowns are tested in Phase 2, not Phase 3.** Whether
   `data_collection: "deny"` empties the free registry, and whether config-token
   rotation survives an expiry window, both determine architecture. Discovering
   either in Phase 7 would be expensive; both are cheap now.

2. **The Phase 1 core ships as one unit.** Ledger, job engine and rollback are
   mutually dependent — a partial ledger with no recovery sweep is not a
   milestone, it is a liability. Nothing above it is trustworthy until it is
   whole.

3. **Gate 1's acceptance is amended, not quietly failed.** iOS cannot do
   backgrounded PWA microphone capture. Testing for it would fail on a known
   platform limit; pretending otherwise would hide it. The gate tests what is
   achievable and the limit is documented as a finding.

## Known-open items carried forward

Tracked so nothing is built on a false sense of resolution. Full detail in
`docs/feasibility-validation.md` §8.

| Item | Resolved in |
|---|---|
| D1 iOS voice decision | Phase 0 |
| D2 inference budget decision | Phase 0 |
| Does `data_collection: "deny"` empty the free registry | Phase 2 (first) |
| Config-token rotation across real expiry | Phase 2 (first) |
| Async realtime tool-call wire mechanics | Gate 1 |
| iOS 26 PWA audio regressions | Gate 1 |
| Echo cancellation quality on iOS | Gate 1 |
| Notebook write-back reversibility per artifact type | Gate 2 |
| Gemini free-tier rate limits (tables now login-gated) | Phase 2, empirically |
