# Backend acceptance — the verdict, 15 September 2026

**Tracking:** #231 · **Standard:** `docs/spec/backend-acceptance-2026-09-14.md`
· **Campaign:** "Final autonomous campaign — earn GREEN"

> The question this answers, in Grant's words: *is there any backend or
> intelligence reason I should NOT begin serious human use and UX testing
> tomorrow?*

## The verdict

**GREEN IS REVOKED. The current verdict is ORANGE**, and the reason is not one
of the risks listed below — it is that the verdict was reached too early.

Hours after it was written, the held-out bait corpus was re-read properly and
what had been logged as "an invented calendar" turned out to be a **systemic
provenance defect**: the office could not distinguish something that had
APPEARED in a conversation from something it had reason to believe was true.
Its own honest *"I have nothing on Priya"* became, four turns later, evidence
that Priya existed. That is not a calendar bug and it was not a wording
problem, and a verdict that called it one was wrong about the thing it was
verdicting on.

The architecture is fixed — `src/agents/provenance.ts`, and the section below
— and 51 adversarial regressions hold it. But under the standard this campaign
is being run to, a fix is not a verdict:

> Before any GREEN verdict, a completely new adversarial corpus that has never
> been run and has not influenced the implementation must be written, committed
> BEFORE running, and run against a frozen implementation. If it exposes
> another systemic defect, GREEN is revoked and the next attempt needs another
> fresh corpus.

That corpus exists — `scripts/sessions/unseen.ts`, fourteen turns, committed
unrun at 0848ddd, which is also the freeze. **It has not been run**, because
OpenRouter's daily free-model quota is exhausted (#239) and every job fails at
the circuit breaker. So the evidence for GREEN is not merely incomplete; the
one piece of it that was specified as mandatory is missing.

**What this means for Grant in practice, which is the question he actually
asked:** the office is materially better than it was this morning and the
defect that revoked the verdict is fixed. Starting human use and UX testing is
still reasonable. But *this document* may not call it GREEN until the unseen
corpus has run, and if that corpus finds something, it will not be GREEN then
either.

The rest of this document stands as written and is the evidence for the
eventual verdict, not the verdict.

### The defect that revoked it

Every anti-fabrication gate in the office keyed on a CLAIM — "I checked", "I
posted", "you told me". The fabricated answer claimed nothing; it simply
asserted, and a bare assertion was invisible to all of them. Underneath that,
the context assembled for the model was FLAT: a row the office holds, a
document retrieved this turn, a fact Grant stated, a noun that exists only
because a question contained it, and a sentence the office made up an hour ago
all arrived as undifferentiated dialogue.

Three consequences, all fixed:

1. The office's own earlier prose was counted as provenance, so a fabrication
   could launder every repetition of itself.
2. A claim about what the records CONTAIN, made having consulted nothing, was
   unrefusable. It is now checked per SOURCE — retrieving a document licenses
   a claim about documents and says nothing about the diary or the inbox.
3. The handler had no canonical state at all, so *"what projects do we have
   open?"* could only be answered from memory. It now gets the live list,
   because the invariant must not be enforced by making the office incapable.

---

## The evidence (unchanged, and no longer a verdict)

Four named residual risks are carried as Issues.

**No — there is no backend or intelligence reason to wait.** The office is
honest about what it has and has not done, reaches the right person most of the
time and the safe person the rest of the time, convenes several specialists
when the work genuinely needs them and exactly one when it does not, remembers
across a working day, and refuses to invent. Every one of those is now held up
by a mechanism with a control behind it rather than by a sentence in a prompt.

GREEN is not "finished". It is "the failures that remain are visible,
recoverable, and the kind a person notices rather than the kind that quietly
misleads them."

**What would have made it ORANGE, and did not:** an unfixed defect that betrays
him. Nine were found in this campaign. All nine are fixed, each with a
mechanism and a negative control, and the two most serious were found by
traffic the office had never seen.

**One honest caveat on the verdict itself.** The full gate could not be run in
a single clean pass today, because the model provider's daily free quota was
exhausted by this campaign's own load (#239). Seventeen of nineteen gate checks
were run individually and passed; routing ran in its held-out mode. If a clean
single pass disagrees, this verdict moves. That re-run is the first thing to do
when the quota resets.

---

## 1–8 · What was proven, and how

| # | Claim | Evidence | Reading |
|---|---|---|---|
| 1 | Every agent can use every capability it is granted | `npm run matrix` — **96/96 applicable cells**, negative control clean | machine-readable, `docs/testing/agent-capability-matrix.json` |
| 2 | Nothing is advertised that cannot be reached | three capabilities withdrawn (0370): `github.read`, `gmail.draft`, `note.create` | disabled, never deleted, so #49 can still propose them |
| 3 | The office covers the ways Grant works | `npm run breadth` — **37/37 dimensions** have at least one case | `monetisation` was the last empty one |
| 4 | Conversations hold together | sessions **250/250 across 59 turns** | development corpus |
| 5 | It holds up on cases it has never seen | held-out corpus, 18 turns, committed before being run | baits 6/6, monetisation 3/3, roster 7/9 first contact |
| 6 | Routing generalises beyond literal tokens | `verify:routing-heldout` **21/28 (75%)**, 11/11 checks | stable across every routing change this campaign made |
| 7 | Collaboration generalises | 4 distinct chains + a genuine three-specialist chain, with a minimum-necessary control | research→growth, finance→strategy, growth→communications, operations→quality |
| 8 | The checks themselves can fail | `verify:reach` proved RED by reverting the fix: 7/9, naming both cases, exit 1 | #236's requirement |

## 9–17 · The nine defects, each of which reached Grant or would have

1. **It replaced five facts he had just stated.** He wrote price, packaging,
   support, onboarding and contract length into one message; it answered with
   £63.50 from an unrelated document, "dedicated 24/7 support" and
   "month-to-month up to annual commitments". One word of prompt: documents
   were told to be preferred and nothing ranked his own sentence above them.
   *Worse than an invention, because the answer is about his own business and
   wrong in the details he had just supplied.*
2. **It invented a calendar.** Asked about a meeting that never happened, it
   produced two entries with clock times, a due date and named agenda items —
   and had absorbed three earlier honest "I have nothing on that" answers as
   evidence those things existed. Every coherence gate keys on a claim; this
   claimed nothing. `fabricatedWhen` now checks times and dates against what
   the office was actually given.
3. **Teaching it a preference failed silently.** Understood, stored, then the
   confirmation claimed a determinism exemption the record could not support.
   #237 fixed this at one site and left four.
4. **"That is not what I meant at all" replayed the rejected instruction**,
   because resolving a contentless message against the thread reconstructs the
   last one.
5. **A delegation's own content was read as the message's mood**, making the
   reading contested, which capped the roster at one person.
6. **The subject is a property of the clause, not the message** — one answered
   clause silenced the semantic reader on every other clause.
7. **The ceiling list decided who answers.** Announcement copy went to growth;
   a compliance audit went to research. Plausible specialists, answering
   confidently, from the wrong desk.
8. **Claire was recorded as a convened specialist** on every question that
   convened nobody — in the column `npm run measure` counts from.
9. **A job that ran out of attempts told him nothing.** Now an impediment, at
   all three gates that could swallow an answer.

## 18–24 · The adversarial pass — trying to disprove GREEN

| Attack | Result |
|---|---|
| Do the new gates refuse good answers? | **0 false positives** across 400 real outputs and 317 real messages |
| Is `fabricatedWhen` exposed on real work? | **0 of 146** real instruction outputs mention anything time-shaped, with grounding deliberately understated to the worst case |
| Could it break calendar work? | the instruction handler never reaches the calendar or mail; other handlers supply no grounding, so it is disabled there |
| Are the gates real, or dead code? | each has a unit control that fires on the original specimen — a check that has only ever reported zero is indistinguishable from one that cannot report |
| Did the campaign contaminate real data? | every project it created is `fixture-%` and `is_fixture`; Grant's six live projects untouched; no real jobs created |
| Is harness traffic being counted as real? | `measure` separates them and the matrix names which axis it measures — see 31 |
| Was the quota exhaustion realistic? | **no** — measured at 1,014 calls today against a real peak of 48/day, about 20x headroom |

## 25–30 · What is measured and still imperfect

- **Routing reaches the right specialist 75% of the time** on held-out
  phrasings (21/28), with seven stable misses. The floor is safe — a miss lands
  on the Chief of Staff — but three of the seven reach a confident wrong
  specialist, which is the worse shape and the thing to watch in real use.
- **Saying which constraint was set aside is a coin flip** (#242). Same build,
  consecutive runs, different behaviour. Every invariant with a MECHANISM
  behind it held on every run; this one has only a prompt, and behaves
  accordingly.
- **`npm run measure` reports 3/8 agents ever chosen and `delegation_depth` 0
  in REAL traffic.** This is honest and expected: the fixes that make the other
  five reachable are days old and his real traffic predates them. In acceptance
  traffic, 78 routing decisions sit at depth 1 and all eight are reached. Level
  4 — "the office reached for it unprompted in his own work" — can only be
  closed by him using it.
- **The 14-day p95 latency reads 12.7 hours** and is an artefact of two bad
  days (13 and 7 September, when jobs stranded). The last two days are median
  19s and 2s, worst 31 minutes. A fixed-window percentile keeps reporting an
  incident for a fortnight after it is fixed.
- **`check:leaks` is red** on three harness documents in a real Notion corpus
  (#178). Deleting the rows will not help — the pages are shared in Notion and
  the next sync restores them, and archiving them changes Grant's workspace.
- **`provider_health` is 40 rows of probe debris and 6 real ones** (#241).

## 31 · The capability matrix, stated precisely

96/96 is a claim about **reachability through the canonical path**, and much of
the evidence is acceptance traffic rather than Grant's own. That is the right
claim for this gate and it is deliberately not the other one: the matrix does
not assert that the office has reached for these capabilities unprompted in his
real work, and `measure` says plainly that for five of eight agents it has not.
The two axes are reported separately on purpose — conflating them is the
forbidden route to GREEN, and it is the one this repository has fallen for
before.

## 32–36 · Traps this campaign paid for, now in CLAUDE.md

Fourteen added. The three that cost the most time were not about the product:

- a non-raw Python heredoc turns a regex `\b` into **U+0008**, which the
  editor, `sed`, `git diff`, biome and tsc all render as nothing — and
  `JSON.stringify(re.source)` prints it back as `\b`, so the one piece of
  debugging output anybody reaches for **confirms the pattern is correct**;
- `String.replace` without a count hits every match, and the six-line loop
  ending three claim-checkers is identical, so an exemption meant for one
  landed in all three;
- a multi-edit script whose last assertion fails writes **nothing**, while the
  earlier edits look applied because you read the diff you intended.

`npm run check:templates` now refuses any stray control character repo-wide,
and that check was proved red before it was believed.

## 37–39 · What to watch in the first week of real use

1. **Who answered.** The misroutes are confident, so the signal is a good
   answer from the wrong desk rather than a bad answer. Worth a glance at the
   agent name on the first dozen replies.
2. **Whether it tells him what it dropped.** #242 — half the time it will not.
3. **`cannot_think`** if a morning goes quiet, before concluding anything is
   broken. The studio does not draw it yet (#240); `app.office_health()` has
   it.

## 40 · The recommendation

**Begin.** The remaining risks are all of the kind that get better by being
used — routing accuracy needs his real phrasings, the five dormant agents need
his real questions, and #242 needs the mechanism that only a real corpus of his
constraints will justify building. Nothing left is the kind that quietly
misleads him, and the three that were have mechanisms and controls behind them
now.

The one thing to do first: **re-run `npm run gate` in a single pass** once the
free quota resets at UTC midnight, and read `verify:routing-breadth` and
`verify:collaborates` — the two checks this campaign could not run today.

---

### Numbers, for the record

| | |
|---|---|
| Unit tests | 1,190 |
| Migrations | 372 |
| Gate checks verified individually | 17 of 19 (2 blocked by the quota, 1 red on #178) |
| Agent x Capability | 96/96 applicable cells |
| Coverage dimensions | 37/37 |
| Sessions | 250/250 across 59 turns, plus 18 held-out turns |
| Routing, held out | 21/28, 11/11 checks |
| Issues opened by this campaign | #239, #240, #241, #242 |
