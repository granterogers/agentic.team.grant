# Shadow Grant — durable run ledger

**Read this after any compaction, together with `CLAUDE.md` and
`docs/spec/shadow-grant-simulation-2026-09-21.md` (the mission, verbatim).**
This file is the memory. The conversation is not.

---

## Fixed facts of this run

| | |
|---|---|
| **Mission** | Build a permanent behavioural simulation system that behaves like Grant — and other imperfect humans — and pressure-tests Agentic Team through natural, messy, multi-turn use. |
| **The question it answers** | *"Could Grant use this office naturally without learning how the software wants to be spoken to?"* |
| **Branch** | `claude/human-simulation-harness` — **never** main |
| **Starting main SHA** | `3c9415084f4b2664bf8147d995412609e58a24f8` (Grant, 21 Sep 2026 14:29:32 +0300, *"docs: add Basecamp-inspired interface implementation specification"*) |
| **Architecture merge below it** | `9abf9ff864f3e15442a1b5a5aa9ed665e487a678` |
| **Start time** | 21 September 2026, session `session_01Ujnh1yh2NGjcSUn69fRnsx` |
| **Budget** | ~11 hours unattended. A progress report is not completion. A green suite is not completion. |
| **Parallel workstream** | A SECOND Claude Code Cloud session is simultaneously implementing the Basecamp-inspired Team HQ frontend (`basecamp_clone.md`, `web/studio`) in this same repository. Cloud filesystems are isolated; **Supabase, Vercel, Telegram, Slack, GitHub and the worker are shared.** |

## What this workstream owns

Simulator · behavioural QA · scenario generation · profiles · evaluators and
oracles · corpora · fixtures · the Shadow Grant runner · behavioural reports ·
narrowly necessary testing infrastructure · real-world failure intake.

## What it must not touch

`basecamp_clone.md` · the `web/studio` redesign · unfamiliar commits · the other
branch · unrelated open issues. **Never merge to main. Never self-merge. Never
deploy over the parallel frontend work.**

## The standing rule that outranks convenience

**Never train the product to pass the harness.** A failed sentence is evidence,
not a vocabulary request. If *"Make me a note to call Kevin"* fails while
*"Remind me to call Kevin"* works, the finding is *indirect future-action intent*
— classify the family, generate unseen siblings, do **not** add the phrase.

Production changes during this run only when a failure is severe, systemic,
reproducible, fixed at the right abstraction, and proved before and after.
Otherwise it is recorded, not fixed.

## Success is not "all green"

Success is: varied human interaction; hidden intent cannot leak; exact wording is
not the architecture; corrections and cancellations are tests; preference
continuity runs end to end; canonical reality outranks prose; judging is
independent; hard failures stay individually visible; sabotage proves every
detector can go red; failures reproduce from a seed; honest declines pass and
fabricated promises fail; and the baseline finds weaknesses nobody hand-authored.

---

## Phase log

Append-only. One line per checkpoint, newest at the bottom. Never rewrite history here.

| # | When | Phase | State |
|---|---|---|---|
| 0 | 21 Sep | Branch `claude/human-simulation-harness` cut from `3c94150`, pushed, tracking | DONE |
| 1 | 21 Sep | Mission persisted verbatim to `docs/spec/shadow-grant-simulation-2026-09-21.md`; this ledger created | DONE |
| 2 | 21 Sep | Repository mapping — §3's claims verified against real code | DONE |
| 3 | 21 Sep | Credential reality established: this session holds **no** Supabase / OpenRouter / HQ token | DONE |
| 4 | 21 Sep | Harness foundations — scenario core, hidden-intent isolation | IN PROGRESS |

## Decisions taken without asking

Recorded so they are not silently re-litigated. §24: *"Do not ask Grant ordinary
engineering questions."* §25: when ambiguous, take the safest reversible option,
record it, continue.

| # | Decision | Why |
|---|---|---|
| D1 | Branch is `claude/human-simulation-harness`, not the harness-assigned `claude/lucid-pascal-42sg44` | Grant named it explicitly in both the chat instruction and §1.3 of the mission. |
| D2 | The harness drives the SUT through a **pluggable transport**, not through one hardcoded door | This session holds no `SUPABASE_ACCESS_TOKEN`, `OPENROUTER_API_KEY` or `HQ_API_TOKEN`, so the live canonical door is unreachable from here. §25: a missing credential blocks the affected integration proof only. A transport seam means the same scenarios, personas, oracles and evaluators run offline now and against the live office the moment a token exists — rather than the harness being unbuildable today and unbuilt tomorrow. |
| D3 | The offline transport drives the product's **real comprehension layer**, not a mock office | `understand`, `intent`, `clauses`, `correction`, `negation`, `teaching`, `extract` and `say-what-you-dropped` are pure TypeScript with no database and no network (`understand` takes an injectable `ProviderRouter`). That layer is precisely where the mission's central question lives — *could Grant use this without learning how the software wants to be spoken to?* — so a large, honest share of the mission is answerable with no credentials at all. A mock office would answer nothing. |
| D4 | My mutation layer is deterministic and seeded; it does **not** replace `npm run mutate` | `scripts/mutate.ts` is model-driven SEMANTIC variation for the routing corpus and needs credentials. Mine is linguistic messiness — typos, fillers, fragments, voice-note shape — which must be reproducible from a seed (§7) and must not cost a model call. Different instruments; both kept. |
| D5 | No migration will be added unless genuinely unavoidable | §2, and the parallel Basecamp session may add migrations too. Numbering collides at 0534. Everything in this workstream is designed to need no schema change. |

## HUMAN_BLOCKED items

One blocked item must never block the mission. Each carries the exact question.

| # | Item | Exact question for Grant | Everything else continues? |
|---|---|---|---|
| B1 | Live canonical-door runs, live judge calls, live Supabase oracles | Not a question — a credential. This Cloud session has no `SUPABASE_ACCESS_TOKEN` / `OPENROUTER_API_KEY`. Nothing is asked of Grant: the transport seam (D2) means these run unchanged the moment a token is present. | YES — the comprehension transport, generator, personas, oracles, evaluator, sabotage proofs, corpora and intake are all reachable offline. |
