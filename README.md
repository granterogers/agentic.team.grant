# AI Team HQ

A private, cloud-first agentic operating system: a persistent business think
tank of eight AI staff that works across projects, reachable from Slack,
Telegram, or the web.

**Not a chatbot.** Work is queued, routed to the smallest justified set of
specialists, reviewed before it commits, delivered exactly once to the right
place, and undoable. Every inference attempt is recorded, and paid inference is
prevented by deterministic code rather than by a prompt.

```
10,370 lines of TypeScript · 59 migrations · 649 unit tests
21 live verification suites, 419 checks against real services
```

---

## State, honestly

| Phase | |
|---|---|
| 0–6 · foundations, ledger, job engine, projects, agents, autonomy | ✅ complete |
| 7 · communications | ✅ complete. Five of seven staff bots answer; two are BotFather clicks and nothing waits on them |
| 8 · Team HQ web app | ✅ built and deployed; one criterion unclaimed¹ |
| · knowledge layer | ✅ ADR-0013 decided and built: connector-agnostic `documents`, a connector registry, Postgres full-text search, Notion connected |
| 9 · Google ecosystem | 🟡 unblocked but unscheduled — ADR-0013 re-based it onto Grant's own account, which was always the supported path |
| 10 · hardening | 🟡 **in progress** — provider failover, §31's cross-interface equality, a security pass over the live endpoints, and every §18 degradation case bar one |

¹ Whether it *feels* right on a phone. A script can check the viewport and the
touch targets; it cannot check that. §13's precedent is that a subjective
acceptance waits for the human.

### The thing to know before anything else

**A project is a row in Postgres and the documents attached to it.** Every
knowledge tool — Notion, an upload, a URL — is a connector that feeds documents
in and can be disconnected without losing them. Retrieval is full-text search
over content the database already holds: no provider, no quota, no credential.

That is **[`docs/adr/0013`](docs/adr/0013-the-project-is-the-source-of-truth.md)**,
and it was decided the hard way. On 2026-09-04 Google disabled the account this
project used for NotebookLM — reinstated a day later on appeal, with nothing
lost, because the design already treated the notebook as a replaceable adapter.
The appeal reversed the penalty and not the policy, so the automation is gone
for good and the architecture is the better for it.

Read that ADR before touching the knowledge layer, and
**[`docs/account-continuity.md`](docs/account-continuity.md)** before assuming
any vendor account is safe.

---

## Start here

| Read | For |
|---|---|
| **[`docs/HANDOFF.md`](docs/HANDOFF.md)** | ⭐ **Starting a session.** Where things are, what to read, what is waiting |
| **[`docs/known-problems.md`](docs/known-problems.md)** | ⭐ **Everything currently wrong**, with severity and owner |
| [`AI_TEAM_HQ_MASTER_SPEC.md`](AI_TEAM_HQ_MASTER_SPEC.md) | The canonical specification. Supersedes everything else |
| [`docs/defects-fixed.md`](docs/defects-fixed.md) | The 25 defects found and closed, and the one shape of mistake that keeps recurring |
| [`docs/degradation-coverage.md`](docs/degradation-coverage.md) | §18's twenty degradation cases mapped to the checks that cover them, and the three that do not |
| [`docs/test-evidence/`](docs/test-evidence/) | What the checks found **by failing** — the best reading in the repo |
| [`docs/adr/`](docs/adr/) | 14 decisions, with the reasoning that produced them |
| [`docs/new-environment.md`](docs/new-environment.md) | Four commands and two variables, to start a fresh session without rediscovering anything |
| [`src/jobs/worker.ts`](src/jobs/worker.ts) | The rule the system is built on, in its header |

---

## How it fits together

```
Slack ─┐                                   ┌─ Slack  (the office: full detail)
       ├─ adapters ─→ inbound_commands ─→ router ─→ jobs ─→ worker ─→ delivery ─┤
Telegram┘   (translate only,              (dedupe    (state    (gates)   (once) ├─ Telegram (the pager)
             never decide)                 required)  machine)                  └─ Team HQ (read-only)
                          │                                │
                          └──────── Postgres ──────────────┘
                              canonical for everything
```

**Postgres is the system.** Not a cache, not a projection — the ledger, the
queue, the state machine, the enforcement. Adapters translate and never decide;
the database refuses illegal transitions rather than trusting callers not to
attempt them. Every vendor above it is replaceable, which is why an account ban
cost three project references and one document rather than the project.

### The surfaces

| | What it is for |
|---|---|
| **Slack** | the office — results in the thread that asked, presented as the staff member who produced them |
| **Telegram** | the pager — important and above only, silent below urgent |
| **Team HQ** | [ai-team-hq.vercel.app](https://ai-team-hq.vercel.app) — read-only dashboards, five views, sparklines |
| **Voice** | built, degrades to text without a credential |

---

## Running it

```bash
npm run verify        # lint, typecheck, migrations, 649 unit tests, secret scan
npm run verify:db     # every live suite in order — ~25 minutes
npm run inventory     # which credentials work, and which account each hangs off
npm run export:portable   # a copy of everything that needs no vendor login
```

Individual live suites: `verify:slack` (56 checks) · `verify:telegram` (28) ·
`verify:hq` (24) · `verify:worker` (19) · `verify:agents` (53) · and ten more.

`verify:slack` and `verify:worker` each need the job queue to themselves and
refuse to start rather than produce misleading red.
`npm run purge:fixtures -- --go` clears debris.

**You cannot reach Postgres directly from a build session** — no non-TCP egress.
Everything goes over the Supabase Management API (ADR-0007). This is not a
workaround to remove; it is the environment.

---

## The one lesson this codebase keeps teaching

Every phase has produced the same defect wearing a new costume: **a check whose
result does not depend on the thing under test.** A hardcoded literal. A query
against the wrong column. A test running as the wrong role. A fixture blocked by
an earlier gate. A check asserting a function's return value rather than its
consequence. A component tested only against its own expectations, green on both
sides of an interface they disagreed about.

And the two siblings, each learned the hard way:

- **A test that changes real configuration must restore it.** Three instances: a
  permissions check left `gmail.send` enabled, a prompt-versioning test rewrote a
  real role's prompt, and a gate fixture left a global mute that silenced every
  routine notification for three days.
- **A failing check that notifies nobody is indistinguishable from a passing
  one.** The backup rehearsal failed twelve nights running, correctly and
  loudly, in a place no human looked.

So: **when you write a check, ask what it would do if the feature were deleted.**
If it would still pass, it is not a check. The live suites are full of explicit
CONTROL assertions for exactly this reason, and they have all earned their place.

---

## Cost

$0.09, total, for eight avatar images — the only money this project has ever
spent. Inference runs on verified-free models behind four enforcement layers,
and a paid call is prevented by code, not by intention.
