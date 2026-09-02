# AI Team HQ

A private, cloud-first, project-agnostic agentic operating system — a persistent
business think tank that works across projects, reachable by voice, Slack,
Telegram, or the web app.

**Status: Phase 0 (bootstrap). No application code yet, by design.**

The build follows a strict sequential gate: one phase at a time, each proven by
tests, failure injection and restart-recovery before the next begins. Phase 0 is
research and design.

---

## Start here

| Read this | For |
|---|---|
| **[`HUMAN_ONLY_PREREQUISITES.md`](HUMAN_ONLY_PREREQUISITES.md)** | ⭐ **What Grant needs to do.** 3 blockers, two of them 60-second fixes. Start here. |
| **[`AI_TEAM_HQ_MASTER_SPEC.md`](AI_TEAM_HQ_MASTER_SPEC.md)** | ⭐ **CANONICAL specification.** Consolidates the original prompt, the audit addendum, and verified corrections. |
| [`docs/adr/`](docs/adr/) | Why each material decision was made |
| [`docs/cost-and-hosting-decisions.md`](docs/cost-and-hosting-decisions.md) | Cost classes, three inference configs, corrected verdicts |
| [`docs/prerequisites.md`](docs/prerequisites.md) | Longer-form prerequisites (superseded in part) |
| [`docs/feasibility-validation.md`](docs/feasibility-validation.md) | Which assumptions survived contact with current reality, and which did not |
| [`docs/architecture.md`](docs/architecture.md) | The chosen stack and why each vendor beat its alternatives |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | The phased plan, gates, and what "done" means each time |
| [`docs/design/core-invariants.md`](docs/design/core-invariants.md) | The provider-independent core — command layer, ledger, jobs, quality gate |

---

## The shape of it

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

**The central invariant:** four surfaces, one organisation. The surface an
instruction arrives on affects only authentication, the reply address, and
delivery policy — never what the organisation does. Channel adapters may
translate; they may never decide.

Two sources of truth: **Gemini Notebook** owns project knowledge and rich
artifacts; **Postgres** owns everything operational. The system stays fully
functional with Notebook unavailable.

---

## Stack

| Layer | Choice |
|---|---|
| App + API | Next.js on Vercel Hobby (or Cloudflare Workers) |
| Database | Supabase / PostgreSQL |
| Voice | **optional** — OpenAI Realtime (`gpt-realtime-2.1-mini`), browser WebRTC |
| Secondary inference | Provider registry, OpenRouter-first, hard-capped |
| Notebook | `notebooklm-py`, master-token auth, behind an adapter |
| Channels | Slack — **one shared app** (HTTP Events API), Telegram Bot API |
| Notebook sync | Python serverless function — **no VM** |
| Scheduler | external free trigger → app route |
| Backups | Nightly `pg_dump` → Cloudflare R2 |

Running cost: **$0/month mandatory.** No required subscription exists.
Recommended configuration ~**$3/month** plus a $10 one-off. See
[`docs/cost-and-hosting-decisions.md`](docs/cost-and-hosting-decisions.md).

---

## Five things worth knowing up front

Each is explained in full in the feasibility document.

1. **iOS cannot keep a PWA microphone alive when backgrounded or screen-locked.**
   ✅ **Resolved** — foreground/screen-on accepted; no native iOS app.
2. **Free-only inference fails on data terms, not cost.** Providers may train on
   or human-review free-tier traffic; the paid floor is ~$3–9/month.
   ⏳ Open decision **D2** — three configs offered, defaulting to $0.
3. **The Notebook free tier is sufficient** once you stop treating Notebook as
   the inference engine: cache source text once, reason locally. Google AI Pro
   is **optional and deferred**.
4. **Supabase Free has no backups at all**, so the nightly offsite dump is
   mandatory infrastructure rather than prudence.
5. **No always-on VM is required.** The Notebook sync is pure HTTP.

---

## Secrets

No secret-bearing file should exist in this repository at all. `.gitignore` is a
backstop for mistakes, not the mechanism.

Four stores, non-overlapping:

| Store | Serves |
|---|---|
| Cloud env **Environment variables** | Claude Code build sessions — bootstrap values |
| Cloud env **API credentials** | same, for sensitive keys the session must never see |
| **GitHub Actions secrets** | CI only — not readable by build sessions |
| **App's encrypted store** | the deployed runtime |

Production secrets are never inherited from the build environment. There is no
`.secrets.local` in this project.

Slack per-app credentials live in Postgres, one row per app — **never** in an
environment variable. With eight bot identities there is no correct value for a
single `SLACK_BOT_TOKEN`. See the Slack section of the architecture document
before changing this.

---

## Development

Every session runs in a Claude Code cloud environment against this repository.
There is no local development machine.

Claude Code is the **development agent only**. Nothing in the product depends on
Anthropic, Claude Code, or this session's tooling at runtime.
