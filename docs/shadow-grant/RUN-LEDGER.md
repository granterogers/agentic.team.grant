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
| 18 | 21 Sep | Integration-readiness check against main — no overlap, one shared file | DONE |
| 19 | 21 Sep | Eight fresh seeds (1,056 unseen scenarios): one new product finding, one of mine | DONE |
| 20 | 21 Sep | Baseline re-recorded after the generator changed; corpus re-frozen | DONE |
| 21 | 21 Sep | **Network egress opened.** B2 resolved: `api.supabase.com`, `openrouter.ai`, `*.supabase.co` all reachable | DONE |
| 22 | 21 Sep | Live canonical door **driven for the first time**. Checklist steps 1-3 passed. One harness defect found by driving, fixed | DONE |

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
| B1 | ~~No credentials in this session~~ | **RESOLVED 21 Sep** — Grant supplied `SUPABASE_ACCESS_TOKEN`, `OPENROUTER_API_KEY` and `SUPABASE_DB_URL`. | — |
| B2 | ~~Live canonical-door runs~~ | **RESOLVED 21 Sep.** The environment's egress allowlist now permits `api.supabase.com` (200), `openrouter.ai` (200) and `baujwlzcziasnfhhkchg.supabase.co` (401 - reachable, no bearer). `db.…supabase.co:5432` still does not resolve, which is expected and unused: the harness goes through the Management API. | — |

## What was found, and where it went

| Finding | Where |
|---|---|
| A preference is only recognised with an explicit persistence marker (4/12) | [#290](https://github.com/granterogers/agentic.team.grant/issues/290) |
| A dash is not a clause boundary, so a withdrawal is invisible | [#291](https://github.com/granterogers/agentic.team.grant/issues/291) |
| An implied obligation, and work stated as prose, read as idle thoughts | [#292](https://github.com/granterogers/agentic.team.grant/issues/292) |
| A question with an instruction attached is read as a question | [#293](https://github.com/granterogers/agentic.team.grant/issues/293) |
| A message that is entirely a cancellation reads as an instruction | comment on [#291](https://github.com/granterogers/agentic.team.grant/issues/291) |
| `npm run test` cannot pass without a Supabase token | [#294](https://github.com/granterogers/agentic.team.grant/issues/294) |
| The two task matchers disagree — reproduced offline | comment on [#289](https://github.com/granterogers/agentic.team.grant/issues/289) |
| The live door cannot test 52% of the corpus: the simulated world is not in the live office, and the 3 dimensions that would catch it have no scoring branch | [#295](https://github.com/granterogers/agentic.team.grant/issues/295) |

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
| The negation guard was written from contractions and missed every pronoun | eight fresh seeds |
| The live door's `dedupe_key` was refused by a CHECK on ~9 runs in 10 | driving it, on the first live run |
| The `safety` reason asserted "the comprehension door executes nothing" on a CANONICAL run | reading the first live verdict |
| Three of the seven dimensions have no scoring branch at all, and report as `unreached` | reading the first live verdict |

Three separate times a check reported a false all-clear because something did
not land: a `python3 -c` sabotage whose `\b` became a backspace, a grep
against a file that did not exist, and the multi-edit above. Every proof in
this workstream now prints evidence that it landed before its verdict counts.

## The live door: credentials arrived, the network did not

**21 September, after the run.** Grant populated the session with
`SUPABASE_ACCESS_TOKEN` (44 chars), `OPENROUTER_API_KEY` (73) and
`SUPABASE_DB_URL`. All three look right. None of them can be used from this
environment.

| host | needed for | result |
|---|---|---|
| `api.supabase.com` | the Management API — every SQL statement the harness runs | `403 CONNECT tunnel failed` at the agent proxy |
| `openrouter.ai` | the judge, and the office's own inference | `403 CONNECT tunnel failed` |
| `baujwlzcziasnfhhkchg.supabase.co` | edge functions, PostgREST | `403 CONNECT tunnel failed` |
| `db.baujwlzcziasnfhhkchg.supabase.co:5432` | the direct Postgres route | `getaddrinfo ENOTFOUND` — DNS does not resolve |
| `api.github.com` | Issues, pushes | **200** |

`curl -sS "$HTTPS_PROXY/__agentproxy/status"` confirms the proxy is enabled
and not selective; the refusal is the environment's **network egress
allowlist**, chosen when the environment was created, and documented at
<https://code.claude.com/docs/en/claude-code-on-the-web>.

`src/db/pg-executor.ts` already records the underlying constraint in its own
comment — *"non-443 TCP egress is blocked there"* — so the direct Postgres
route was never going to work here even with a DSN.

**Nothing in the harness needs changing for this.** The transport seam exists
for exactly this case: `npm run shadow:baseline -- --live
--i-have-checked-the-first-run` will work unaltered from any environment that
can reach those hosts. What is blocked is the proof, not the code.


---

## The live door, driven — 21 September

**Phase 22. `src/simulation/canonical.ts` had never been run. It has now.**

### The environment

B2 is closed. Every host the harness needs is reachable from this session:
`api.supabase.com` 200, `openrouter.ai` 200,
`baujwlzcziasnfhhkchg.supabase.co` 401 (reachable, no bearer),
`api.github.com` 200. The Management API executes SQL and returns rows.
`db.…supabase.co:5432` still does not resolve — expected, and unused, because
the harness goes through the Management API, which is HTTPS.

### What driving found that reading could not

**The `dedupe_key` was malformed on about nine runs in ten.**
`inbound_dedupe_key_shaped` is `^[a-z]+:[a-z_]+:[A-Za-z0-9:_.-]+$`, so the
SECOND segment may not contain a digit. The key was
`shadow:<runToken>:<nth>` and the run token is
`Math.random().toString(36)`, which usually contains one. Driven against the
live constraint, **4 of 5 real tokens were refused**; the token that this
first live run actually drew was `mo1x9024`, which the old shape would have
refused. Every run would have died on its first insert with a CHECK
violation.

The key is now `teamhq:shadow:<token>-<nth>` — the token moves to the third
segment, where digits are legal, and the first segment becomes the channel,
which is what every real key in the table already does
(`telegram:message:…`, `teamhq:my_tasks:…`). Proved: 12 of 12 freshly
generated keys pass the live constraint.

This is exactly what the module's own header predicted about itself, and the
reason the checklist exists: *"Driving a function finds what reading it
cannot."*

### The checklist, step by step

| Step | What it required | Result |
|---|---|---|
| 1 | one scenario, `noaction.acknowledgement`, the cheapest message | `"great thanks"` → the office answered **`"Noted."`**, one attempt, `complete`, 35.3s |
| 2 | the row is marked as harness traffic | `requested_by = teamhq:verify-shadow-mo1x9024`, `is_fixture` **TRUE**, `app.harness_job()` **TRUE**, `announce` **FALSE** |
| 3 | nothing was delivered | **0** deliveries in the window |
| — | nothing was created | projects **1510 → 1510**; `app.unnamed_project()` is a STABLE select over an existing singleton and creates nothing |

The office's behaviour was correct: `"great thanks"` convened nobody, created
nothing, and got a two-word acknowledgement. That is precisely what the
family exists to check — §10's *"convening three specialists over 'thanks' is
the theatre that is fake participation"*.

### The three layers that kept it off Grant's phone, each checked rather than assumed

1. `announce = false`, set in the same statement that creates the job.
2. `is_fixture` GENERATED true — verified against the live generation
   expression, which contains `'%:verify-%'`, and `teamhq:verify-shadow-…`
   matches it.
3. **Migration 0523, and this one was measured rather than read.** Applied
   2026-09-20 08:49. `app.claim_delivery` does consult `app.deliverable_to`.
   Since 0523 there have been **28 harness deliveries, 28 suppressed, 0
   actually sent**. Before it, 69 went out unsuppressed.

### What running live did NOT unlock, and this is the finding that matters

The README says the three dimensions that are unreachable offline — *did the
row appear* (`reality`), *did the prose read well* (`conversation`), *did the
goal complete* (`completion`) — *"all become answerable from canonical
state"*. **They do not, because nothing in the evaluator has ever been able
to score them.**

`src/simulation/evaluate.ts` builds its findings from four functions —
`understanding`, `context`, `agency`, `safety`. The only place the other
three are ever emitted is one loop over `observation.unreached`, and that
loop can only ever produce the verdict `unreached`. There is no pass branch
and no fail branch for any of them, on any door.

The canonical door correctly reports `unreached: []` — everything IS
reachable there — so the loop emits nothing, and `tally()` counts a
**missing** dimension and an **unreachable** one identically. The summary
therefore prints `reality — unreached 1` whether the door cannot see it or
nobody wrote the check.

This is CLAUDE.md's found-nothing shape in its most expensive form: the
live door exists largely to answer those three questions, and the instrument
has no way to answer them. It is a **harness gap, not a product defect**, and
it is recorded rather than fixed in this pass because writing three new
oracles is a phase, not a checklist step.

**Nothing in the product was changed.**


---

## The blocker the live door actually has — 21 September

The checklist's steps 1-3 passed and containment held on every run. The
thing that stops the corpus going live is not safety. It is that **the world
the corpus asks about does not exist in the live office**, and the two ways
to make it exist are mutually exclusive.

### What was observed

`project.lookup/grant-like/0` said *"ok so give me the satte of play on the
funding one"*. The office answered:

> *"I don't have any record of a funding status update in the office data…
> If you can point me to the specific document or project where the funding
> info lives, I can pull the measured or calculated figures from there."*

That is **correct behaviour**. `DEFAULT_WORLD` contains
`simgrant Match Funding Bid` (nicknames *the bid*, *the funding one*, *the
grant thing*); the live office's active non-fixture projects are
`legacy-coaching-course`, `unnamed`, `ai-team-hq-test`,
`learning-my-ai-team`, `ai-learning`. There is no funding project, so there
is nothing to resolve, and saying so is the office being honest.

The evaluator scored the turn **understanding pass, context pass, agency
pass**. Nothing was wrong with those verdicts either. The turn is green and
it measured nothing about referent resolution.

### How much of the corpus this is

| | |
|---|---|
| scenarios naming a simulated project, or declaring one in intent | **68 of 132 — 52%** |
| families affected | **40 of 66** |
| declared layers | referent 12, history 25, execution 56, comprehension 39 |

Run the whole corpus live today and roughly half of it produces a green
report about a world the office has never heard of — with the three
dimensions that would have caught it (`reality`, `conversation`,
`completion`) having no scoring branch at all. That is the found-nothing
shape with a plausible number in front of it.

### Why provisioning the world is not a small job

The two available options contradict each other, and the contradiction is
enforced in the database:

- **Fixture projects** (`fixture-…`) are safe — `app.provision_missing_channels`
  (0419) only fires for a project that is active, attached, **not a fixture**
  and **more than fifteen minutes old**, so no Slack channel is created. But
  `app.resolve_project_by_name` filters `not p.is_fixture` — **verified
  against the live definition, not remembered** — so a fixture project
  cannot be resolved by the nickname the referent families exist to test.
  Every one of them would fail for the wrong reason.
- **Real projects** resolve correctly and are **permanent debris**: a project
  that gathers a job can never be deleted, `project_delete` refuses it for
  ever, and after fifteen minutes it earns a real Slack channel that Slack
  cannot delete. CLAUDE.md records this exact pile being built twice, once
  by somebody quoting the rule that caused it.

This is #45 in its sharpest form: *a suite testing a feature that filters
fixtures cannot name its subjects the way the filter matches.*

One lead, not yet followed: `app.add_project_alias` does **not** filter
fixtures, while `resolve_project_by_name` does. Whether resolution can reach
a fixture project through an alias is worth one query before any design is
chosen.

### What this means for the instruction "run the checklist one scenario at a time"

Steps 1-4 were followed and four live scenarios were run, one at a time,
with containment verified after each. Widening further is **not blocked on
safety** — it is blocked on validity, and running the remaining families
would produce numbers that look like findings and are not. CLAUDE.md's
most-used rule applies: validate the test before believing the finding.

Filed as [#295](https://github.com/granterogers/agentic.team.grant/issues/295) rather than fixed here. Provisioning a simulated world
into a shared production database is a phase with its own teardown proof,
not a checklist step, and §2 of the mission plus the parallel Basecamp
session make a migration the last resort rather than the first.
