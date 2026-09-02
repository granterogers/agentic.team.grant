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
| **[`docs/prerequisites.md`](docs/prerequisites.md)** | **What Grant needs to do.** Two decisions and a short list of accounts. Start here. |
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
| App + API | Next.js on Cloudflare Workers (`@opennextjs/cloudflare`) |
| Database | Supabase / PostgreSQL |
| Voice | OpenAI Realtime (`gpt-realtime-2.1-mini`), browser WebRTC |
| Secondary inference | Provider registry, OpenRouter-first, hard-capped |
| Notebook | `notebooklm-py`, master-token auth, behind an adapter |
| Channels | Slack (HTTP Events API), Telegram Bot API |
| Worker | Python on an always-free ARM VM |
| Scheduler | Cloudflare Cron Triggers |
| Backups | Nightly `pg_dump` → Cloudflare R2 |

Running cost: **~$54/month** (voice ~$24, Google AI Pro ~$20, inference ~$10),
with infrastructure at $0 and a ~$32/month fallback if the free tiers give way.

---

## Four things worth knowing up front

Each is explained in full in the feasibility document.

1. **iOS cannot keep a PWA microphone alive when backgrounded or screen-locked.**
   Foreground voice works. Locked-screen conversation needs a native shell.
   Open decision **D1**.
2. **Free-only inference fails on data terms, not cost.** Providers may train on
   or human-review free-tier traffic, and the paid floor is only ~$3–9/month.
   Open decision **D2**.
3. **The Gemini Notebook free tier cannot run this team** — 50 chats/day and
   Deep Research 10 per *month*. Google AI Pro is a functional prerequisite.
4. **Supabase Free has no backups at all**, so the nightly offsite dump is
   mandatory infrastructure rather than prudence.

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
