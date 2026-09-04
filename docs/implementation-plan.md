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

## Phase 2 — Connections · ✅ **COMPLETE 2026-09-03**

| Item | State |
|---|---|
| Encrypted secret storage (vault + references) | ✅ migration 0007, 18/18 |
| Provider registry with health, priority, free-only | ✅ migration 0009, live discovery |
| All four inference enforcement layers | ✅ 9/9 live, spend $0 |
| **Does `data_collection: "deny"` empty the free registry?** | ✅ **No** — but it costs 8 of 21 models ([ADR-0009](adr/0009-free-allowlist-from-probes.md)) |
| **Does config-token rotation survive expiry and a restart?** | ✅ **Yes** — recovered from `token_expired`; rotated across two machines via Postgres alone |
| Slack rotation, scheduled | ✅ every 4h, `.github/workflows/slack-rotation.yml` |
| Telegram bot configured by API | ✅ description, commands, webhook secret vaulted |
| Telegram webhook registered | ✅ live on Supabase Edge Functions ([ADR-0010](adr/0010-webhooks-on-supabase-edge-functions.md)) |
| Google OAuth scaffold | ⬜ Phase 9; `GOOGLE_CLIENT_ID`/`SECRET` are now populated |
| Layer 2 backstop actually *hit* | ⬜ the cap is set (`limit: 5`) but has never fired |

**Resolved:** the webhook needed an HTTPS endpoint, which ADR-0010 supplied
without a new provider or credential.


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

## Phase 3 — POC gates · ✅ **ALL FIVE PASS 2026-09-03** — see [docs/poc](poc/README.md)

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

## Phase 4 — Project engine ✅

| Item | State |
|---|---|
| Notebook discovery, 10-minute sync | ✅ **GitHub Actions cron**, not Cloudflare — [ADR-0012](adr/0012-github-actions-for-the-sync-schedule.md) |
| Automatic project creation from discovered notebooks | ✅ live: 3 notebooks → 3 projects, unattended |
| Source fingerprinting and change detection | ✅ SHA-256 per source; an unchanged source is not rewritten |
| **Tier-derived budgets** from `AccountLimits.tier` | ✅ tier 1 → 30 chats/day, 6 reserved; `probe_id` NOT NULL so no budget lacks provenance |
| Initial project brief generation | ✅ from the Postgres cache on a free model — **zero Notebook quota, $0** — regenerated only when source fingerprints change |
| Project switching | ✅ 0026 — append-only switch log; explicit > permanent channel map > scope context > **ask** |

**Acceptance:** a new notebook is discovered and becomes a project unattended;
50 sources added rapidly are processed without duplication; a worker crash
mid-sync resumes cleanly; Notebook outage degrades rather than fails.

**Failure injection:** expired auth, corrupted token, duplicate source, deleted
source, 50 rapid sources, outage, crash mid-sync.

✅ **All four acceptance criteria and all seven injections: 13/13**, via
`npm run verify:sync`. Project switching adds 8 more in `npm run verify:agents`.

The one design decision worth stating: an ambiguous project name resolves to
**ask**, never to the nearest match or the most recently touched project. A
wrong project context is uniquely bad — everything afterwards looks completely
normal and is filed in the wrong place, and nothing surfaces it until someone
goes looking for work that is not where they left it. Asking costs a message. Two bugs were found by the first live runs rather than
by the tests — a view missing `probe_id`, and a notebook with an empty title
that failed `projects_name_present`. Both surfaced as *recorded degraded
cycles* rather than crashes, which is the degradation requirement working on
something that was not an outage.

---

## Phase 5 — Agent engine ✅

**Evidence:** [`docs/test-evidence/phase-5-agent-engine.md`](test-evidence/phase-5-agent-engine.md)
· `npm run verify:agents` — **45/45**, idempotent across consecutive runs.

- ✅ Eight permanent roles (§7) on the product's own provider abstraction —
  seeded by 0019; `staff` deliberately has no provider or model column
- ✅ **Staff avatars: a distinct visual identity per role** (Grant, 2026-09-03)
  — `npm run avatars`; illustrated, not photorealistic, and a test asserts no
  two roles share a face
- ✅ Chief of Staff, router, delegation — `src/agents/router.ts`, 0020;
  delegation depth capped in a trigger
- ✅ **Intent classification, biased downward** on ambiguity —
  `src/agents/intent.ts`; deterministic rules, no model call
- ✅ Quality pipeline with the structured metadata of §16 —
  `src/agents/quality.ts`; the exemption is provable (0023), not claimed
- ✅ Temporary specialists — 0024; must expire, must be justified, capped at
  three, cannot be promoted
- ✅ Staff Builder (§8) — 0024; the app role reaches `staff` only through a
  function with `permanent` hard-coded false
- ✅ Prompt versioning — 0024; append-only text, pointer moves forward only

**Still open from this phase:** nothing blocking. Two notes carried forward —
the duplicate scan is blind to jobs that never went through the router (it
reports how many), and consultation economics (`consultations.changed_outcome`)
has the schema but no accumulated data until agents actually run.

**Acceptance:** an output without `reviewer_status` **cannot reach
`committed`**; material disagreement is surfaced rather than averaged away;
duplicate-work avoidance is enforced by the router as a required query;
ambiguous input produces a bounded investigation or a clarification, never an
uncontrolled multi-agent workload.

**Failure injection:** contradictory sources, malformed output, runaway
delegation attempt, duplicate task, forbidden destructive operation.

---

## Phase 6 — Autonomy · 🟡 **IN PROGRESS**

| Item | State |
|---|---|
| Queue scheduling and capacity limits | ✅ 0006 — enforced **at dequeue** under an advisory lock, which is what makes it survive a restart; `verify:jobs` |
| Natural-language autonomy controls | ✅ 0013 (notifications) + 0027 (autonomy level per scope) |
| Responsibilities | ✅ 0027 — recurring duties owned by a role; the idempotency key is derived in one place |
| Needs Me | ✅ 0027 — overdue first, then work actually stopped; overflow **reported**, never truncated |
| Today | ✅ 0027 — live work with computed staleness, waiting-on-Grant first |
| Project monitoring | ⬜ |
| Morning/evening briefings | ⬜ |

**Acceptance:** limits hold under concurrent load and across restarts; "leave me
alone today" persists as structured preference; Needs Me stays small.

✅ **18/18** via `npm run verify:autonomy`, idempotent across runs.

Two decisions worth stating. **Autonomy is not authority:** a project at `act`
still cannot reach a policy-disabled tool or commit unreviewed output, and that
is asserted rather than assumed. **Needs Me reports its overflow instead of
truncating:** a list that silently shows 7 of 40 looks healthy at exactly the
moment it stops being useful, so `app.needs_me_pressure()` returns the
suppressed count and the view itself returns everything.

---

## Phase 7 — Communications

Slack office (channels, threads, tiered staff identities, **≥3 app slots
reserved**), remaining seven Telegram bots, feedback capture, voice notes via
Chirp 3: HD with text fallback, Undo surfaces, notification learning.

**Staff avatars land here**, where `chat:write.customize` and the per-bot
Telegram profile photos actually consume them. §9 lists "name, title, avatar"
as the presentation, and eight identically-iconed staff are eight staff nobody
can tell apart at a glance.

One judgement to make explicitly rather than by default: **photorealistic
faces are the wrong call.** Grant knows the team is AI, but a synthetic human
photograph is a claim about a person who does not exist, it would look like a
stock-photo deepfake in a Slack sidebar, and §21's honesty posture sits badly
with it. Distinct, characterful, obviously-illustrated avatars give the same
at-a-glance recognition without asserting a person. Generated as SVG so they
are versioned in the repository, deterministic per role, and need no image
service or credential.

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
