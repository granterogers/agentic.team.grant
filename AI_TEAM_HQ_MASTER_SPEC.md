# AI TEAM HQ — MASTER SPECIFICATION

**Version:** 1.0 · **Date:** 2026-09-02
**Status:** ⭐ **CANONICAL.** From this point forward this document is the
definitive specification.

**Consolidates:** the original Master Claude Code Build Prompt · the Feasibility
Audit & Implementation Override (2026-09-02) · Grant's decisions of 2026-09-02 ·
corrections from Phase 0 research against current official documentation.

**Supersedes** the source documents where they conflict. Those are preserved for
history; contradictions between them are resolved here and recorded in
`docs/adr/`.

---

## 0. Reading order

| Document | Role |
|---|---|
| **this file** | canonical requirements |
| `docs/adr/` | why each material decision was made |
| `docs/design/core-invariants.md` | provider-independent core mechanics |
| `docs/architecture.md` | vendor bindings |
| `docs/implementation-plan.md` | phases and gates |
| `docs/prerequisites.md` | what Grant must do |
| `docs/cost-and-hosting-decisions.md` | cost classes and open choices |
| `docs/research/` | evidence, with source URLs |

---

## 1. Mission

A private, cloud-first, project-agnostic agentic operating system: a persistent,
proactive business think tank that works across projects. One Gemini Notebook =
one project.

Grant can open Team HQ on mobile or desktop, see what matters at a glance, talk
naturally by voice, talk to any staff member, receive proactive messages, add
staff from Settings, point the team at different projects, let it act
autonomously on non-destructive work, inspect and roll back history, and see
exactly what is being spent.

**This is an AI organisation platform, not a chatbot.**

---

## 2. Core principles

1. Frontend simplicity, backend sophistication.
2. **Cloud-first.** No local development machine. Every Claude Code session runs
   in a cloud environment against the GitHub repository. **Measured constraint
   (2026-09-03):** that environment permits outbound **HTTPS on 443 only** — no
   raw-TCP database connections, no IPv6. Anything needing the Postgres wire
   protocol at build time runs in GitHub Actions instead (ADR-0007).
3. One permanent core team, adapting across projects.
4. Gemini Notebook defines project identity and knowledge — **as a replaceable,
   high-risk adapter** (§7).
5. **Postgres is authoritative** for all operational state.
6. Voice is an **optional premium interface**, provider-agnostic.
7. **Minimize recurring cost; prefer free services wherever technically
   sensible** — without compromising reliability to save fractions of a cent.
8. **Never silently use a paid model.** Any paid capability is explicitly
   enabled by Grant, with projected cost shown first.
9. All important actions are versioned.
10. Non-destructive work: do it and tell Grant.
11. Destructive/irreversible work: require explicit approval.
12. All substantive outputs pass quality control.
13. Proactive, but bounded by configurable capacity controls.
14. No duplicated work — including across interfaces.
15. Jobs resume safely after crashes and restarts.
16. **Provider and framework independence.** Nothing depends on Anthropic or
    Claude Code at runtime; Claude Code is the development agent only.
17. Everything important is documented and maintainable by another agent or
    human later.
18. **Compiling is not done.** A feature is complete only when tested and
    stress-tested.
19. **STRICT SEQUENTIAL BUILD GATE.** One phase at a time, proven before the
    next begins. Never build ahead around an unproven dependency.

---

## 3. Development philosophy

Before any third-party integration: research current official documentation,
verify the library or API still works, prefer stable documented free or low-cost
solutions, and **use a better current approach over anything this spec names if
one exists** — documenting the decision.

Claude Code must act autonomously wherever technically possible, use CLI/API
automation rather than asking Grant to click, and stop only for genuinely
human-only actions (§14).

**Never blindly implement assumptions from this specification.**

---

## 4. Verified technology decisions

Every row verified against current official documentation or a live API call on
2026-09-02. Evidence in `docs/research/`.

| Concern | Decision | Note |
|---|---|---|
| App + API | **Vercel Hobby** (or Cloudflare Workers) | Hobby permissible for personal non-commercial use |
| Python sync | **Vercel Python function**, GA 3.12–3.14 | **no VM required** |
| Scheduler | **external trigger → app route** | Vercel Hobby cron is once-daily; schedule from outside |
| Database | **Supabase / Postgres** | current publishable/secret key architecture |
| Queue | **Postgres** (`SKIP LOCKED`, or pgmq) | idempotency key is ours to own either way |
| Voice | **`gpt-realtime-2.1-mini`** (configurable) | ⚠️ re-verify immediately before Gate 1 |
| Inference | **provider router**, OpenRouter-first | config A/B/C, Grant's choice |
| Notebook | **`notebooklm-py`**, master-token, pure HTTP | high-risk adapter |
| Slack | **ONE shared app**, HTTP Events API | app `A0BUFRVSSLD` created |
| Telegram | Bot API, HTTP webhooks | one bot for V1 |
| TTS | **Google Cloud Chirp 3: HD** | 1M chars/month free, native OGG/Opus |
| Backups | nightly `pg_dump` → **Cloudflare R2**, run in **GitHub Actions** | mandatory: Supabase Free has none. `pg_dump` cannot run in a build session — ADR-0007 |
| Migrations | versioned SQL in `migrations/`, applied over the **Supabase Management API** | build sessions have no raw-TCP egress — ADR-0007 |

### Explicitly rejected

| Rejected | Reason |
|---|---|
| Always-on VM (Oracle/Hetzner) | unnecessary — the sync is pure HTTP |
| Native iOS app | **Grant's decision**: foreground/screen-on voice is sufficient for V1 |
| Socket Mode | needs a persistent process; Slack recommends HTTP for production |
| One Slack app per staff member | not a V1 requirement (§9) |
| `edge-tts` | reverse-engineers a private Microsoft endpoint; commercial use violates terms |
| Piper | relicensed GPL-3.0; docs state personal/research use only |
| GitHub Models | retired 2026-07-30 |
| Netlify | 300 credits/month, 15 per production deploy |
| Agent frameworks (CrewAI/LangGraph/AutoGen) | not without proving they improve durability, observability or maintainability (§20) |

### Deprecated identifiers — never hard-code

`gpt-realtime`, `gpt-realtime-mini` (removed **2027-01-20**),
`gpt-4o-realtime-preview` (dead 2026-05-07). Token minting is
`/v1/realtime/client_secrets`; SDP exchange is `/v1/realtime/calls`; anything
citing `/v1/realtime/sessions` is stale. Session cap is 60 minutes.

> **All model and provider identifiers are configuration, never constants.**

---

## 5. Canonical command layer — a hard architectural boundary

Slack, Telegram, Team HQ and Voice are **interchangeable front ends to the same
organisation**. No channel-specific handler may implement core orchestration.

Every inbound instruction normalizes into one envelope before any business logic
runs:

```
command_id · origin/channel · origin_ref · actor · project_id · recipient/agent
instruction · normalized intent · conversation context · timestamp
correlation/job id · idempotency key
```

> **Channel adapters may only translate. They may never decide.**
> No classifying intent, choosing an agent, creating a task, or calling a model.

After normalization the *same* orchestration, agents, tools, quality control,
persistence, ledger, rollback and job engine run regardless of origin.

**Acceptance (§13):** the same instruction via Slack and via Voice must produce
identical canonical commands modulo `origin_channel`, `origin_ref` and
`command_id` — asserted as an **automated equality test**, not observed by eye.

### Intent classification — the cost governor

`thought` · `question` · `discussion` · `suggestion` · `light_investigation` ·
`assignment` · `direct_command`

Two rules make it safe:

- **Ambiguity resolves downward, never upward.** Unsure between `suggestion` and
  `assignment` → take the cheaper one and say so.
- **Deterministic-first.** Do not call a model where ordinary code will do.

Thresholds change only through the weekly approved proposal (§19). A
self-adjusting cost governor that drifts upward is the failure this prevents.

### Cross-interface deduplication

The same instruction may arrive twice through different surfaces. Detect using
idempotency keys, source message IDs, short time windows, project, recipient,
semantic similarity, and existing active job intent — **not exact text match**.

**When uncertain, link to or reuse the existing job rather than silently
creating duplicate substantive work.** Record why something was judged a
duplicate.

### Voice and background work are strictly decoupled

Voice understands → normalizes → persists → creates a durable job →
acknowledges conversationally. Grant may then close Safari, drop the connection,
or switch device: **the work continues**, surfacing later in Team HQ, Slack,
Telegram, Notebook or a future voice session.

Voice tools are only ever **deterministic reads** or **enqueue-and-acknowledge**.
They never block on substantive work.

---

## 6. State, history and durability

### Event ledger

Append-only. Never updated, never deleted — **enforced at the database level** by
revoking `UPDATE`/`DELETE` from the application role. A convention of
immutability is not immutability.

Per event: `event_id`, `correlation_id`, `project_id`, actor, trigger,
action_type, timestamp, before/after state, **rationale summary**, source refs,
provider/tool used, `reversible`, `reversal_method`, related job/task.

> **Never store or expose chain-of-thought.** Enforced at the write boundary: the
> ledger accepts only a short structured rationale, and agents have no API that
> could dump raw reasoning into it.
>
> **Never write decrypted secrets into the ledger** — store secret references
> only.

`reversible` and `reversal_method` are set **at write time by the code performing
the action**, never inferred later. If the author cannot say how to undo it, it
is `reversible = false`.

### Undo ≠ database rollback

Undo appends a **compensating action**; it never rewrites history. Keyed on the
original `event_id`, so **pressing Undo twice is harmless by construction** —
not by guarding a callback handler, because Telegram's documented retry contract
is one sentence with no retry count or ordering guarantee, and duplicate
deliveries can be genuinely concurrent.

**Model Undo as an absolute state write, not a relative reversal.**

Anything with an unrecallable external effect is `reversible = false`. Never
offer an Undo that cannot undo.

### Job engine — explicit state machine

```
queued · running · waiting_external · waiting_user · output_created
quality_review · committing · committed · notifying · complete
retrying · paused · cancelled · failed
```

Transitions are constrained and logged. Requirements:

- **Idempotency key per job**, derived from semantic inputs, so re-enqueueing
  identical logical work collides rather than duplicates.
- **Every transition is a committed database write** — recovery is "read state,
  continue".
- **Boot recovery sweep** reconciles jobs left in transient states.
- **Side effects are idempotent or ledger-guarded.**
- **Capacity limits enforced at dequeue**, so they hold across restarts and
  across all channels at once.
- **Per-provider circuit breakers**, state in the database.
- **Shared visibility:** before starting an investigation an agent must query
  open jobs and recent findings — enforced by the router, not left to agents.

**Parent/child structure** is explicit: an initiative owns child tasks with
dependencies, responsible agent, status, provider usage, artifacts and findings.

**Cancellation and pause are first-class.** "Stop that", "pause it", "cancel the
research" must work: cancellation propagates to children, **no new provider calls
occur after cancellation**, and completed evidence is preserved.

**Long-running work must not look stuck.** Surface current phase, responsible
agent, completed steps, next step, blocked/waiting-on-provider/waiting-on-Grant,
retrying — and **estimated scope, never fabricated completion times**.

### Configuration pinning per job

At job start, record agent prompt version, orchestration policy version,
provider-routing config, autonomy config and tool-policy version. Define whether
a running job continues under pinned configuration, adopts safe changes, or
restarts.

### Scheduling is separate from execution

```
external scheduler / heartbeat → due-work dispatcher → Postgres schedule tables
→ durable job queue → workers
```

**Do not create one external cloud scheduler job per responsibility.** The
persistent engine owns Notebook polling, briefings, capacity reports, weekly
reviews, self-improvement proposals, delayed tasks, "get back to me tomorrow",
watch renewal, reconciliation and retries.

All substantive work survives browser closure, voice/Slack/Telegram
disconnection, worker restart and server restart.

### Event idempotency everywhere

Persist source event IDs and process idempotently for: Telegram updates, Slack
events, Google notifications, scheduler heartbeats, Notebook sync scans,
provider callbacks, and UI retry submissions.

---

## 7. Knowledge layer — Gemini Notebook as a high-risk adapter

**Notebook is the project knowledge and artifact layer. It is NOT the inference
engine for the team.** Agents do not "converse with Notebook to reason."

Consumer Notebook automation relies on **undocumented private RPC behaviour**.
Google's official Enterprise API does **not** apply to the consumer product.

### Rules

- Maintain a strict **`NotebookAdapter` boundary**.
- **Never** make operational state depend on Notebook. Postgres remains
  authoritative for jobs, events, staff state, configuration, decisions,
  recovery, usage, approvals and history.
- **Runtime capability discovery**, reporting at least:
  `AVAILABLE` · `AVAILABLE_UNOFFICIAL` · `DEGRADED` · `UNAVAILABLE` ·
  `AUTH_REQUIRED`
- **Never blindly retry an ambiguous Notebook write.** After a timeout or
  uncertain write, **reconcile actual Notebook state first**. Assume undocumented
  operations may not be cleanly idempotent.
- **Fingerprint sources and AI-generated writes**; prevent duplicate processing.
- Health checks, auth-refresh procedures, connector diagnostics.
- **A Notebook outage or breaking API change must degrade Notebook functionality
  without corrupting or disabling the rest of Team HQ.**

### Quota design — free tier is sufficient

Free tier: 100 notebooks · **50 sources/notebook** · 50 chats/day ·
3 audio overviews/day · 10 Deep Research/**month**.

The design that fits it:

1. Pull each source's text **once** via fulltext/guide retrieval; cache in
   Postgres, fingerprinted.
2. Agents reason over cached text on the normal inference provider — **zero
   Notebook quota**.
3. Reserve Notebook chats for genuine cross-source synthesis.

Realistic usage: **~5–15 chats/day against 50**. Read `AccountLimits.tier` at
startup and derive budgets from the detected tier — **never hard-code quota
numbers**, which Google changes without updating its own published tables.

**Artifact generation is best-effort and never in a critical path** — documented
precedent: infographics and slide decks went to 0 for free users on 2025-11-25
with no doc update.

**The dedicated Google account must not be browsed interactively while the
worker runs**, or it rotates the worker's session out from under it.

### Knowledge adapter contract

```
list_projects() · get_project() · list_sources() · get_source()
add_source() · remove_source() · add_note() · query()
request_artifact() · get_artifact() · health() · capabilities()
```

Notebook is one implementation. A future official API or a different knowledge
system is another.

### Write-back requires value filtering

Do **not** write every intermediate output back. Evaluate future project value,
duplication, confidence, source quality, whether it improves the Notebook, and
whether Notebook is even the right destination.

Naming: `AI Team — Research Brief — [Topic] — YYYY-MM-DD`. Avoid clutter.

### Knowledge fallback

If Notebook is unavailable: continue operational work, **store pending
write-backs**, preserve sources and findings in Postgres marked *pending
Notebook synchronization*, and reconcile on return. **Never lose completed
research because Notebook is down.**

---

## 8. Capability registry

A machine-readable registry. Every external capability exposes: name, connector,
availability, **official/unofficial status**, auth state, health, last successful
verification, last error, policy state, **cost classification**, enabled/disabled.

```
notebook.query            = AVAILABLE_UNOFFICIAL
notebook.generate_slides  = AVAILABLE_UNOFFICIAL
telegram.send_message     = AVAILABLE
gmail.send                = DISABLED_BY_POLICY
openrouter.free_reasoning = DEGRADED
```

**Agents query available capabilities rather than assuming tools exist.** If a
connector is unavailable the orchestrator degrades gracefully.

### Kill-switches

Every integration is independently disableable — Notebook, Slack, Telegram,
OpenAI, OpenRouter, Google, Gemini, Groq, GitHub. **Disabling or losing one
connector must never require taking the application offline.**

### Connector reconciliation

Webhooks and push events are **hints, not truth**. Slack event → reconcile state
if needed. Google notification → fetch authoritative resource state. Notebook
poll → compare against fingerprints. Telegram callback → verify the action is
still valid.

---

## 9. The team

### Staff are identities, not processes

A staff member is **not** an always-running process, a permanently allocated LLM,
a provider, or a model. Staff are persistent structured identities: name, role,
responsibilities, expertise, communication style, personality, autonomy settings,
project assignments, prompt version, quality rules, notification settings, memory
references, provider preferences.

```
agent identity → task requirements → orchestration policy
→ inference requirement → model router → provider/model
```

**Instantiate reasoning only when needed.** Do not model eight staff as eight
running services. Finance, Research and Strategy keep their identity even if the
underlying provider changes entirely.

### Roles (8 permanent)

Chief of Staff · Research Director · Strategy Director · Growth & Marketing
Director · Finance & Data Director · Operations Director · Quality & Risk
Director · Communications & Creative Director.

Temporary specialists are recommended by the Chief of Staff and use shared
channels — no dedicated bots or apps.

### Consultation economics

**Do not automatically invoke every relevant-looking staff member.** Multi-agent
work consumes quota, adds latency, and can reduce clarity.

- Deterministic code first.
- Trivial work spawns no subagents.
- Simple factual retrieval is not a team meeting.
- Substantive tasks use the **smallest justified specialist set**.
- Quality/Risk review remains mandatory where defined.
- **Do not simulate staff discussion for theatrical effect.**

Track per job: consultations, reason for each, provider requests consumed, and
**whether each consultation actually changed or improved the outcome**.

### Slack identity — V1 is ONE app

**ONE shared AI Team HQ app** (created: `A0BUFRVSSLD`). Staff are presented via
`chat:write.customize` plus rich blocks: name, title, avatar, persistent
metadata.

**True staff identity lives in Postgres, never in Slack message authorship.**

Known limit: an overridden identity is **cosmetic** — not `@mentionable`, not
DM-able, absent from the member list. Per-staff apps are considered only after
Gate 4 passes, install limits are re-verified, and a real UX benefit is shown.

> ⚠️ **Never enable public distribution.** Slack's rate-limit restrictions exempt
> internal custom apps; distribution silently reclassifies an app and cuts
> history-reading throughput ~50× with no explanatory error.

---

## 10. Quality control

No substantive output bypasses review.

**Requires review:** research conclusions, strategy, recommendations, changes
based on inference, external sources, Notebook write-backs.
**Exempt:** deterministic retrieval, mechanical transformation, answers quoted
from already-reviewed material. The exemption is defined by **how the answer was
produced** — deterministic path vs inference — because that is checkable.

Every substantive output carries: confidence (High/Medium/Low), evidence type
(Verified/Inferred/Speculative), sources, contradictory evidence, reviewer
status, reviewed timestamp.

- **Disagreement is surfaced, never averaged away.**
- **The gate cannot be bypassed by the caller** — the commit step reads
  `reviewer_status`; an output without it cannot reach `committed`.

### Source provenance

Every substantive finding preserves: source URL/ID, retrieval timestamp, title,
publisher, publication date, reliability classification, direct evidence vs
inference, contradiction links, the agent that used it, and the project/job.

### Structured output validation

Any model output that triggers further machine action is validated first —
schemas, typed parsing, bounded retries, explicit failure state.

> **Never allow free-form model output to directly trigger destructive or
> high-impact tool calls.**

---

## 11. Safety, policy and cost control

### Tool permission levels — enforced centrally

| Level | Kind | Examples | Rule |
|---|---|---|---|
| **0** | read-only | read DB, query Notebook, search web, read Calendar/Gmail | auto-allowed |
| **1** | reversible internal write | create task, internal note, preferences, draft | auto-allowed, logged |
| **2** | external but reversible | Calendar event, routine post, approved Notebook note | per autonomy policy |
| **3** | high-impact / destructive | **send email**, delete, publish, spend money, modify production, change security | **explicit approval** |

**The tool router enforces this. Agents must not self-authorize around it.**

### Policy engine, separate from prompts

> **Prompts may explain policy. Code must enforce policy.**

Deterministic checks for: paid model use, destructive actions, email sending,
production writes, spending, job concurrency, daily investigation limit,
specialist call limit, notification caps, quiet hours, connector permissions.

### Gmail is draft-only by policy

Expose Gmail **search, read, create draft**. Do **not** expose a send capability
merely because the OAuth scope would technically permit it. Sending stays
disabled by application policy until Grant explicitly enables it.

### Cost guard before expensive work

Before substantive AI work, estimate expected requests, likely tokens, whether
paid providers could be touched, current free quota, current voice budget, and
job priority. If free resources are insufficient: **queue non-urgent work**,
reduce unnecessary consultations, use deterministic tooling, and notify Grant
only when meaningful work is blocked.

### Provider router — one central abstraction

Handles provider selection, free-only policy, capability matching, rate-limit
detection, retry, fallback, health, local usage accounting, structured output
validation. **No ad-hoc provider calls anywhere else in the codebase.**

Enforcement layers, all injected by the HTTP wrapper — never by callers:

1. `provider.max_price` all-zero with **`allow_fallbacks: false`** — documented
   to *prevent execution*, not derank.
2. A dedicated API key with a hard spend limit — out-of-band backstop.
3. Allow-list rebuilt from live `/api/v1/models` (`pricing.prompt === "0"`).
4. Post-response circuit breaker on `usage.cost > 0`.

Three silent hazards: **`openrouter/auto:free` still charges** (`:free` on a
router is a no-op; `openrouter/free` is the safe one); **`allow_fallbacks`
defaults to `true`**; **`data_collection` defaults to `"allow"`**.

### "Free" means measured, not assumed

For every external dependency document: current free allowance, whether a card
is required, hard quota, request/token/runtime limits, overage behaviour,
whether automatic paid overage is possible, whether it can be disabled, current
measured usage, projected usage, and the fallback when exhausted.

### Usage provenance

Every capacity figure shown to Grant is classified:

- **AUTHORITATIVE** — reported directly by the provider
- **CALCULATED** — derived from a known quota plus complete local accounting
- **ESTIMATED** — incomplete provider information or partial accounting

**Never present estimated quota as authoritative.** Track local usage for every
provider even where provider-side metrics exist. Notebook has **no live usage
counters**, so its figures are always ESTIMATED.

---

## 12. Interfaces

**Slack = office** · **Telegram = pager** · **Team HQ = canonical dashboards** ·
**Notebook = knowledge** · **Voice = live conversation**

### Voice — optional premium

Foreground, screen-on, iPhone Safari. **Grant's decision: background and
screen-locked operation are NOT required, and no native iOS application will be
built.**

The browser never receives the permanent API key: server-minted ephemeral
credentials, WebRTC where currently recommended.

### Telegram

One Chief of Staff bot for V1. Only `/newbot` is manual — name, description,
commands **and profile photo** are API-settable (Bot API 9.4). Buttons:
👍 Useful · 👎 Not useful · ↩ Undo · Open Project · Mute 24h · More Detail.

Natural-language instructions ("leave me alone today", "only important things")
become **structured persistent preferences**.

### Needs Me — a structured blocker object

Anything requiring Grant creates a blocker with: project, job, requested action,
why it is needed, real deadline if any, consequences of delay, approval options,
originating agent, and **whether work can continue around it**.

> This prevents random agent messages from becoming the approval system.

### UI

Slick, premium, executive, non-technical. Home order: Important Insights ·
Needs Me · Today · Projects · Team Activity · Project Health.

Show confidence, Verified/Inferred/Speculative, reviewed status, source count
and important contradictions — **without exposing raw model traces or hidden
reasoning**. No raw JSON or token/debug detail in normal workflow.

### Memory

Raw transcripts are **not** the memory. Persist structured facts: decisions,
preferences, assignments, project context, notification instructions, approvals,
commitments, outcomes. Transcripts may be referenced; durable state is
structured.

---

## 13. POC gates — there are FIVE

**Strictly sequential.** Complete one, test deeply, record PASS evidence, then
begin the next. Never run later gates in parallel in a way that could hide a
failure in an earlier dependency.

| Gate | Subject |
|---|---|
| **1** | OpenAI Realtime |
| **2** | Notebook automation |
| **3** | Telegram |
| **4** | Slack |
| **5** | Secondary inference failover |

### Evidence requirements

A gate is **not** PASS because code ran once. Store under `docs/poc/gate-N-*/`:
date, environment, exact model/provider versions, test cases, automated test
output, failure tests, screenshots or video, measured latency, measured cost,
known limitations, and an explicit PASS/FAIL with reasoning.

### Gate 1 — personal acceptance is mandatory

Automated tests are insufficient. Grant must personally use the iPhone voice POC
for **20+ minutes** and judge naturalness, latency, interruption, voice quality
and overall feel.

> **Claude must prepare the test but must never mark subjective acceptance PASS
> before Grant has actually performed it.**

Amended for D1: **foreground, screen-on**. Re-verify current model names against
the live API immediately beforehand; benchmark mini against full.

### Gate 2 — highest-risk dependency

Test aggressively: list notebooks, list sources, add URL, add document, create
note, query, artifact generation and retrieval, auth refresh, headless restart,
multiple polling cycles, source deletion, source duplication, **ambiguous
timeout**, worker crash mid-operation, re-authentication, rate limiting, and
**simulated API/schema break**.

> **If this gate proves too brittle, stop.** Do not build the rest of Team HQ
> around it. Research and test the simplest alternative knowledge layer first.

### Gate 4 — shared app first

Prove installation, auth, channel mapping, project channel creation, DM, thread,
reactions, event receipt, **command normalization**, preference updates, rate
limits, token revocation, reconnect/reinstall, that **Postgres remains
canonical**, and that **Slack history loss does not break the application**.
Only then consider per-staff apps.

### Gate 5 — prove paid inference cannot happen accidentally

Test: valid free model · 429 · outage · malformed response · provider disabled ·
all free providers exhausted · **a paid model accidentally returned by model
discovery** · **router receives a model without verified free status**.

Acceptance: no paid call, non-urgent work queues, blocked urgent work raises a
blocker, local usage records stay correct. **Enforced by deterministic code, not
by a prompt.**

---

## 14. Human-only prerequisites

Before asking Grant anything, Claude must determine: can this be done by CLI? by
API? by browser automation? by inspecting existing configuration? Is user
authorization legally or security-wise required?

Grant should normally only handle: account creation · API key creation where the
provider requires it · OAuth consent · BotFather bot creation · unavoidable
CAPTCHA/2FA · billing approval · subjective acceptance testing.

> **Never ask Grant to edit source code or type commands Claude can execute.**

Recommended setup order: dedicated Google account → private repo → Supabase
project → OpenAI key → OpenRouter key → **one** Chief of Staff Telegram bot →
**one** Slack workspace → one test Notebook shared to the dedicated account →
Notebook headless auth POC → Google Cloud OAuth only once exact scopes and
callback URLs are known → optional Gemini/Groq only if a proven capacity gap
exists.

**Do not ask Grant to create 8–10 Telegram bots or multiple Slack apps at
bootstrap.**

Live status: `docs/prerequisites.md`, `docs/credential-status.md`.

---

## 15. Secrets

Four non-overlapping stores:

| Store | Serves |
|---|---|
| Cloud env **Environment variables** | Claude Code build sessions — bootstrap |
| Cloud env **API credentials** | sensitive keys the session must never see |
| **GitHub Actions secrets** | CI only — not readable by build sessions |
| **Application encrypted store** | the deployed runtime |

Production secrets are **never** inherited from the build environment.

Supabase uses the current publishable/secret architecture: the publishable key
may appear in browser code; **the server secret must never enter client code,
never be logged, and never enter the event ledger**.

**Slack per-app credentials live in Postgres, one row per app** — never a flat
environment variable. With multiple bot identities there is no correct value for
a single `SLACK_BOT_TOKEN`. Only the human-provided **config token pair** lives
in the bootstrap store, and its rotating state belongs in the database.

Secrets must never appear in logs, the ledger, error traces sent to models,
frontend state, screenshots, telemetry, or generated documentation. Use secret
references; only the connector invocation layer receives decrypted credentials.
**Redact common token patterns from logs automatically.**

---

## 16. Backups

Supabase Free provides **no backups at all**. Nightly `pg_dump` to R2 is
mandatory infrastructure.

`pg_dump` speaks the Postgres wire protocol and has no HTTPS mode, so it can
never run in a Claude Code build session (§2.2). It runs as a **scheduled GitHub
Actions workflow**, whose credentials live in Actions secrets — a store §15
already designates as unreadable by build sessions. The restore rehearsal runs
on the same schedule, which makes the tested restore below **continuous evidence
rather than a one-off**. See ADR-0007.

**A backup feature is incomplete until restoration is tested.** Test: fresh
database restore, project registry, event ledger, job state, staff settings,
encrypted-secret reference behaviour, and reconciliation with external systems
after restore. Document exact restoration steps.

---

## 17. Autonomy and capacity

Do non-destructive work autonomously; notify after meaningful completion; ask
only for destructive/irreversible actions or true blockers.

V1 defaults, conservative: **3 simultaneous substantive jobs · 3 specialist
consultations per job · 5 autonomous investigations per project per day · 3
immediate direct alerts per agent per day**; everything else batched into a
digest.

Natural-language controls persist as structured preferences.

---

## 18. Degradation tests

Beyond normal stress testing, explicitly test: Notebook unavailable 24h ·
Notebook private API breaks · Notebook auth expires · Slack disabled · Telegram
disabled · voice budget exhausted · Realtime unavailable · OpenRouter exhausted ·
**every** free provider unavailable · Google OAuth revoked · invalid refresh
token · expired watch subscription · **crash after commit but before
notification** · **crash during a Notebook write** · duplicate command ·
duplicate webhook · same command twice · **semantically equivalent command
through two interfaces near-simultaneously** · stale Telegram Undo · stale Slack
action · malformed provider output · transaction failure mid-job · **backup
restore to a replacement database**.

In every case: **canonical state is preserved and duplicate substantive work is
avoided.**

---

## 19. Self-improvement

Automatic adaptation may change only low-risk structured preferences — mute
state, digest preference, verbosity, notification frequency where Grant directly
instructed it.

**Never silently change** role identity, authority, core prompts, tool
permissions, spending policy, quality rules, or destructive-action policy. Those
require the weekly versioned proposal with diffs and Grant's manual approval.

---

## 20. Google integrations

Least-privilege scopes on the dedicated account. Gmail read + draft only.
Calendar read/write. Drive read-only. GitHub read-only if added.

**Watch/push subscriptions are not permanent.** Store channel ID, resource,
creation time, expiration, renewal status, last notification, last successful
reconciliation, last error. Implement automatic renewal, failed-renewal alerts,
periodic reconciliation against authoritative provider state, and safe
re-creation after restart. **Push improves efficiency but must never be the only
means of maintaining correct state.**

**OAuth testing-mode risk:** do not leave long-running automation dependent on a
development configuration whose refresh tokens expire unexpectedly. Document
development and production/personal modes separately — publishing status,
verification requirements, warning screens, user limits, sensitive scopes,
refresh-token behaviour, reconnection and revocation flows.

---

## 21. Not an agent-framework experiment

Before introducing CrewAI, LangGraph, AutoGen or similar: prove it materially
improves durability, observability or maintainability, and verify licensing,
cloud suitability, recovery semantics and provider independence.

**If ordinary TypeScript/Python orchestration with Postgres jobs is simpler and
more reliable, prefer it.** Do not add framework complexity merely because the
product contains "agents".

---

## 22. Completion criteria

V1 is complete only when **both** scenarios work reliably.

### A — source to conversation

Grant adds a source to the Money Mastery Notebook from his phone → detected
within the sync interval → Research analyzes → justified specialists consulted →
Quality/Risk reviews → useful findings written back → operational metadata in
Postgres → Slack project channel updated with correct staff identity → Telegram
notified where policy warrants → Grant can react/respond/Undo → Grant opens Team
HQ on iPhone, presses **Talk to Team**, asks "what was Research going on about?"
→ Chief of Staff explains from real state → "bring Finance in" → Finance responds
→ "do what you think is best and let me know" → work continues autonomously →
all actions versioned → usage visible in-app and in the daily capacity report.

### B — cross-interface delegation

Grant says through **Slack**: *"I'd like to start looking at making a website for
the Money Mastery app."*

Chief of Staff identifies the project, creates a persistent initiative, delegates
to justified specialists, allows approved tools, routes conclusions through
Quality/Risk, works asynchronously, preserves tasks/sources/artifacts/decisions,
returns progress to the right Slack thread, places rich artifacts in Notebook,
and notifies Telegram only per policy.

**Then the semantically equivalent instruction through Voice must use the same
canonical command layer, same project state, same orchestration, same tools,
same persistence and same quality controls.**

> **The source interface must not change the organisation's behaviour.**

Generated website/prototype work happens in an **isolated job workspace or
branch**, never modifying a production application or repository without explicit
authorization.

---

## 23. Open decisions

| # | Decision | Blocks |
|---|---|---|
| **D2** | Inference config **A** ($0) / **B** (~$3 + $10 one-off) / **C** (~$8–32) | Phase 2 registry defaults |
| **D3** | Voice for V1: skip, or fund ~$24/mo | Gate 1 scheduling |
| **D4** | Email Vercel Support to settle the Hobby ambiguity | nothing — recommended hygiene |

**Resolved:** D1 — foreground/screen-on voice accepted, no native iOS app.

## Known-unverified

Carried forward honestly rather than filled with guesses:

1. Free voice alternative (browser STT + Chirp 3) — **unresearched**; the agent
   was killed by a spend limit.
2. Whether `data_collection: "deny"` empties the OpenRouter free registry —
   **test first in Phase 2**.
3. Gemini free-tier rate limits — Google removed the published tables.
4. Async Realtime tool-call wire mechanics — verify in Gate 1.
5. iOS 26 PWA audio regressions — credible reports, no Apple confirmation.
6. Echo cancellation quality on iOS — untested; make-or-break for barge-in.
7. Notebook write-back reversibility per artifact type — confirm before offering
   Undo on a write-back.
8. Vercel Hobby Active-CPU headroom for the sync — measure in Phase 1.
