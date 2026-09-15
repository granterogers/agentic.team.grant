# GREEN blocker ledger — Campaign Three

**Tracking:** #231 · **Live document.** One row per defect that stood between
the office and a defensible GREEN. Closed rows stay: a ledger that deletes what
it fixed cannot show anybody what kind of thing goes wrong here.

Columns are the campaign's own: **evidence** is what was observed, not what was
suspected; **canonical verification** is the thing that would go red if the fix
were reverted; **deployed** matters because a fix in the repository and not in
the running worker is the trap CLAUDE.md records twice.

---

## OPEN

### L18 · The unseen corpus has not been run

| | |
|---|---|
| **Blocker** | GREEN requires a corpus that is new, uninfluential, committed before running, and run against a frozen implementation. |
| **Evidence** | `scripts/sessions/unseen.ts` exists, 14 turns, committed unrun at `0848ddd`, which is also the freeze. `git diff 0848ddd HEAD -- src/` is empty. |
| **Root cause** | Not a defect. OpenRouter's daily free-model quota is exhausted (#239); the breaker reopens on the first real call. |
| **Fix or decision** | Wait for the UTC-midnight reset. No `src/` change may land before it runs, or the freeze is void. |
| **Status** | **OPEN — this is the only thing between here and a GREEN attempt.** |

### L19 · Saying which constraint was set aside is a coin flip

| | |
|---|---|
| **Blocker** | #242. The office drops a constraint it cannot satisfy and, half the time, does not say so. |
| **Evidence** | Same build, consecutive runs of the contradictions session: turn 2 named the standing rule once and silently overrode it the next time. |
| **Root cause** | The only invariant left with nothing but a prompt behind it. #229 measured that a pinned model at temperature 0 still moves. |
| **Fix or decision** | Deferred deliberately. The office already parses multi-clause requests (#60) and stores preferences as data, so both halves are machine-readable and the gate is writable — but it needs the retry loop, not a refusal. |
| **Status** | **OPEN**, and the honest reason GREEN would still carry a caveat. |

### L20 · Two provenance gaps, known and probed

| | |
|---|---|
| **Blocker** | A figure Grant floats in a *"suppose"* is his words, so it is grounded by construction and no text-comparison check can refuse it. And `assertsRecordsUnseen` switches off for a domain that WAS consulted, so one retrieved document licenses a total a handful of matches cannot support. |
| **Evidence** | Reasoned from the design, not yet observed. Both are turns in the unseen corpus (`laundering` 3, `partial-evidence` 1). |
| **Fix or decision** | Not fixed on purpose — fixing a suspected gap and then writing the test for it is the thing the brief rules out. Measure first. |
| **Status** | **OPEN, instrumented.** |

---

## CLOSED

### L1 · The office replaced five facts Grant had just stated

| | |
|---|---|
| **Evidence** | He wrote price, packaging, support, onboarding and contract length into one message; the answer gave £63.50 from an unrelated document, "dedicated 24/7 support", "month-to-month up to annual commitments". |
| **Root cause** | The prompt said documents were to be preferred, and ranked nothing above them. Meant as "prefer documents over what you merely know"; read as "over everything". |
| **Fix** | Precedence stated in full: documents beat general knowledge, and what Grant states beats both; where a document disagrees with him, say so. |
| **Regression** | Contradictions session turn 0 asserts `neverSays: ['63.50', '24/7']` — it can only go red on substitution. |
| **Canonical verification** | Session `contradictions` 4/4 through `inbound_commands`. |
| **Deployed** | Yes. |

### L2 · A calendar invented out of the office's own honest refusals

| | |
|---|---|
| **Evidence** | Two meetings with clock times, a due date and named agenda items, for a meeting that never happened — the agenda items being three baits it had truthfully denied four turns earlier. |
| **Root cause** | #243, and systemic. The context reaching the model is flat: a held row, a retrieved document, a fact Grant stated, a noun from a question and a sentence the office made up all arrive as undifferentiated dialogue. |
| **Fix** | `src/agents/provenance.ts`. Own prose is not provenance; record claims are checked per SOURCE; the handler is given canonical state so the invariant does not make the office mute. |
| **Regression** | `tests/agents/provenance.test.ts`, 51 cases — eight inequalities by name, nine domains, multi-turn contamination, 16 semantic neighbours caught and 16 honest ones untouched. |
| **Canonical verification** | Unit-level today; the session leg is in the unseen corpus (L18). Real-traffic exposure measured at 2/146, both correct refusals. |
| **Deployed** | Yes. |

### L3 · Teaching the office a preference failed silently

| | |
|---|---|
| **Evidence** | *"From now on keep every answer to a single short paragraph."* Understood, stored, `office.learned` recorded — then the job FAILED and Grant was told nothing. |
| **Root cause** | The confirmation claimed `deterministic_retrieval` on a correlation that had spent three model calls. #237 fixed this at one site and left four. |
| **Fix** | One `howComposed()` for every caller, so the next confirmation added cannot be the fifth. |
| **Canonical verification** | Session `contradictions` turns 1–3. |
| **Deployed** | Yes. |

### L4 · Three gates could end a turn with no answer and no trace

| | |
|---|---|
| **Evidence** | The coherence gate recorded an impediment; the output INSERT refusal did not; a handler that threw until its attempts ran out recorded nothing at all. Eighteen jobs failed in thirty minutes during the quota outage with nothing saying the office could not think. |
| **Fix** | `app.cannot` at both missing gates, terminal failures only. |
| **Canonical verification** | **Fired four times during the real outage**, not in a fixture: `job_impediments` carries four rows reading *"office.instruction ran out of attempts and produced nothing"*. |
| **Deployed** | Yes. |

### L5 · "That is not what I meant at all" replayed the rejected instruction

| | |
|---|---|
| **Evidence** | Answered *"Routed to Ruby. You asked for Ruby's input on the margin impact"* — the previous turn happening again, at the moment he said it was wrong. Reproduced twice on the same build. |
| **Root cause** | A contentless message resolved against the thread becomes the last instruction, and the last instruction is what is being rejected. The better the resolver, the more confidently it rebuilds the misunderstanding. |
| **Fix** | `rejectsWithoutSaying`, answered in code BEFORE the resolver, defined by stripping the rejection and counting what is left rather than enumerating replacements. |
| **Regression** | 5 unit cases with three controls. |
| **Canonical verification** | Session `corrections` 4/4. |
| **Deployed** | Yes. |

### L6 · A delegation's own content read as the message's mood

| | |
|---|---|
| **Evidence** | *"I need you to find out what they charge and then tell me what that means"* fired three intent rules, became "contested", and `routing_decisions_unconfident_stays_small` capped the roster at one person. |
| **Fix** | A delegation governs its span: below `assignment`, mood words inside delegated content do not argue for their class. Urgency untouched. |
| **Regression** | 6 unit cases including two position controls. |
| **Canonical verification** | Session `collaborates` 6/6 — four chains plus a three-specialist chain, with the minimum-necessary control. |
| **Deployed** | Yes. |

### L7 · The subject was looked up per message, not per clause

| | |
|---|---|
| **Evidence** | *"look at which channel is bringing people in and draft the note"* convened communications alone — "channel" is in the growth director's expertise and lost to a sentence mostly about writing. One answered clause also silenced the semantic reader on every other clause. |
| **Fix** | `clauses.ts`; one lookup per ask; the meaning-reader consulted per unanswered clause, bounded to two calls. |
| **Canonical verification** | `collaborates` 6/6; `verify:routing-heldout` unchanged at 21/28. |
| **Deployed** | Yes. |

### L8 · The intent ceiling was deciding who answers

| | |
|---|---|
| **Evidence** | Held-out acceptance traffic, twice in nine turns: announcement copy → growth, compliance audit → research. Both ranked correctly by Grant's own expertise columns and reordered by a hardcoded list. |
| **Fix** | The intersection is ordered by fit, not by the ceiling. The unconfident branch had been doing this all along. |
| **Regression** | `npm run verify:reach` — 9 cases, deterministic, no model. **Proved RED** by reverting the fix: 7/9, both cases named, exit 1. |
| **Canonical verification** | In the gate, first among the routing checks. |
| **Deployed** | Yes. |

### L9 · Claire counted as a convened specialist whenever nobody was convened

| | |
|---|---|
| **Evidence** | `routing_decisions.roster` stored `[who.slug, ...]`, and `who.slug` falls back to the Chief of Staff — in the column `npm run measure` counts from. |
| **Fix** | Store what `pickRoster` returned, which may legitimately be empty. |
| **Canonical verification** | `roster` session controls: `convenes: 0` holds for a pleasantry and for retrieval about the office. |
| **Deployed** | Yes. |

### L10 · A promise to contact people on a named channel

| | |
|---|---|
| **Evidence** | *"I'll post a quick question on #team-slack…"* — deliveries 0, consultations 0, child jobs 0. |
| **Root cause** | `claimsToHaveSent` deliberately exempts the future, because "I'll ask the team" is a plan §9's hand-off makes real. Naming a CHANNEL is what makes it unkeepable. |
| **Regression** | 7 unit cases, four of them controls. 0 false positives across 400 real outputs. |
| **Deployed** | Yes. |

### L11 · Three capabilities advertised to eight agents that nothing could reach

| | |
|---|---|
| **Fix** | `github.read`, `gmail.draft`, `note.create` disabled with reasons (0370). Disabled, never deleted, so #49 can propose them. |
| **Canonical verification** | `npm run matrix` — 96/96 applicable cells, negative control clean. |
| **Deployed** | Yes (migration). |

### L12 · Self-inflicted: the gate read £63.50 as a clock time

| | |
|---|---|
| **Evidence** | `fabricatedWhen`'s first draft refused a good monetisation answer four times. |
| **Fix** | The colon form is bounded to a real clock; the dot form requires am/pm. Missing a bare "9.30" is the cheap direction — a false refusal is every good answer that mentions a price. |
| **Regression** | 2 unit cases, one of them the price. |
| **Deployed** | Yes. |

### L13 · `verify:attests` asserted the mechanism and went red on an improvement

| | |
|---|---|
| **Evidence** | It checked `finalState === 'failed'`; #237's retry means a refused first attempt lands in `retrying`. |
| **Fix** | Assert the property — the fabrication does not become an answer — which the two checks either side already prove. |
| **Status** | 11/11. Sixth instance of this correction in CLAUDE.md. |

### L14 · Harness invisibility: a task created by a fixture job read as real

| | |
|---|---|
| **Fix** | 0369 — `app.task_add` marks a task from a harness job as harness traffic. Fourth instance of the family. |
| **Deployed** | Yes (migration). |

### L15 · The coverage model could not see the sessions that had executed

| | |
|---|---|
| **Fix** | `breadth` reads `.out/sessions.jsonl`, counting only completed turns, de-duplicated. |
| **Canonical verification** | 37/37 dimensions have at least one case; `monetisation`, the last empty one, closed by a held-out session. |

### L16 · The office could not say it was unable to think

| | |
|---|---|
| **Fix** | 0372 — `app.office_health().cannot_think` names any provider whose breaker is open, since when, next probe, and what it said. Harness probes excluded. |
| **Canonical verification** | Reported the live outage correctly while it was happening. |
| **Open child** | #240 — the studio does not draw it. |

### L17 · Self-inflicted, tooling: a regex written by a non-raw heredoc

| | |
|---|---|
| **Evidence** | Eight `\b` turned into U+0008. Invisible to the editor, `sed`, `git diff`, biome and tsc — and `JSON.stringify` prints it back as `\b`, so the debugging output confirms the pattern is correct. |
| **Fix** | `check:templates` refuses any stray control character repo-wide. **Proved red before it was believed.** |

---

## What each closed row would cost if the fix were reverted

Nothing in this ledger is closed on the strength of a code reading. Every row
names a check that turns red: a unit control, a session expectation, a verify
suite, or — for L4 — four rows in an append-only ledger written by a real
failure rather than a fixture.
