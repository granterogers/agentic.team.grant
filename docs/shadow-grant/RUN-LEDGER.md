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
| 4 | 21 Sep | Harness foundations — scenario core, hidden-intent firewall, sabotage-proved | DONE |
| 5 | 21 Sep | Four personas, seeded meaning-preserving roughener, sabotage-proved | DONE |
| 6 | 21 Sep | 66 goal families across 11 groups; compositional generator | DONE |
| 7 | 21 Sep | Seven dimensions, deterministic evaluator, transport seam, `npm run shadow:baseline` | DONE |
| 8 | 21 Sep | First honest baseline; 3 harness defects found and fixed; 5 product findings | DONE |
| 9 | 21 Sep | Findings filed: #290, #291, #292, #293; #289 commented rather than duplicated | DONE |
| 10 | 21 Sep | Multi-turn reactive arcs; §9 preference chain measured step by step | DONE |
| 11 | 21 Sep | Frozen held-out corpus with a generator fingerprint; variance characterised (13pt spread) | DONE |
| 12 | 21 Sep | Shadow Grant mode — ten conversations, narrative ending | DONE |
| 13 | 21 Sep | Real-world failure intake, with redaction proved | DONE |
| 14 | 21 Sep | `npm run shadow:sabotage` — 8 detectors, each proved red-capable | DONE |
| 15 | 21 Sep | Channel translation coverage through the real Telegram adapter | DONE |
| 16 | 21 Sep | Live canonical door written, gated behind a first-run checklist, never run | DONE |
| 17 | 21 Sep | Documentation; #294 filed (repo test suite cannot pass without a token) | DONE |
| 18 | 21 Sep | Integration-readiness check against main | IN PROGRESS |

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
| B1 | Live canonical-door runs, live judge calls, live Supabase oracles | Not a question — a credential. This Cloud session has no `SUPABASE_ACCESS_TOKEN` / `OPENROUTER_API_KEY`. Nothing is asked of Grant: the door is written (`src/simulation/canonical.ts`) and gated behind `--i-have-checked-the-first-run`. | YES — everything else was reachable offline and is done. |

## What was found, and where it went

| Finding | Where |
|---|---|
| A preference is only recognised with an explicit persistence marker (4/12) | [#290](https://github.com/granterogers/agentic.team.grant/issues/290) |
| A dash is not a clause boundary, so a withdrawal is invisible | [#291](https://github.com/granterogers/agentic.team.grant/issues/291) |
| An implied obligation, and work stated as prose, read as idle thoughts | [#292](https://github.com/granterogers/agentic.team.grant/issues/292) |
| A question with an instruction attached is read as a question | [#293](https://github.com/granterogers/agentic.team.grant/issues/293) |
| `npm run test` cannot pass without a Supabase token | [#294](https://github.com/granterogers/agentic.team.grant/issues/294) |
| The two task matchers disagree — reproduced offline | comment on [#289](https://github.com/granterogers/agentic.team.grant/issues/289) |

**Nothing in the product was changed.** §18: the baseline comes before any fix.

## Defects found in the harness itself

Kept because the ratio is the point, and because CLAUDE.md calls validating
the test before believing the finding its most-used rule.

| The instrument was wrong | How it was caught |
|---|---|
| Agency scored off a function that decides something else (21 scenarios) | reading the failures, then driving the function directly |
| Safety searched messages for the evaluator's own words — 0% with no passes | reading the tally rather than the findings |
| Em dashes inside voice transcripts, which no transcriber can produce | reading the generated messages |
| Self-correction dropped the withdrawn half's negative constraint | strengthening a test that could not fail |
| Composition could open an arc with a reply | the arc-ordering invariant |
| The hyphen guard had no test at all | `npm run shadow:sabotage`, on its first run |
| Two sabotage anchors had drifted | the same, reported INCONCLUSIVE rather than passing |
| A sabotage that landed textually and did nothing | the same |
| Shadow Grant complained about turns the evaluator declines to judge | reading the four-persona comparison |
| A four-part edit where three parts silently no-op'd | grepping for the result instead of trusting the diff |

Three separate times a check reported a false all-clear because something did
not land: a `python3 -c` sabotage whose `\b` became a backspace, a grep
against a file that did not exist, and the multi-edit above. Every proof in
this workstream now prints evidence that it landed before its verdict counts.
