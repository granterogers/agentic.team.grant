# Shadow Grant — the human behavioural simulation harness

**The question this exists to answer:**

> *Could Grant use this office naturally, without learning how the software
> wants to be spoken to?*

Not "do the tests pass". A corpus of sentences the product was tuned on
answers nothing, and §23 of the brief says in its first line that success is
not all green.

The mission is stored verbatim at
[`docs/spec/shadow-grant-simulation-2026-09-21.md`](../spec/shadow-grant-simulation-2026-09-21.md).
The honest starting position is
[`BASELINE-2026-09-21.md`](BASELINE-2026-09-21.md).

---

## The commands

| | |
|---|---|
| `npm run shadow:baseline` | the whole corpus through a door, scored on seven dimensions |
| `npm run shadow:baseline -- --heldout` | the frozen corpus nobody has read |
| `npm run shadow:baseline -- --seed 77` | a fresh corpus nobody has seen |
| `npm run shadow:baseline -- --family task.indirect` | one defect class |
| `npm run shadow:grant` | a bounded working session, ending in plain English |
| `npm run shadow:grant -- --persona dictates` | the same session as a voice-note user |
| `npm run shadow:preferences` | §9's eleven steps, reported as a chain |
| `npm run shadow:variance` | how much a baseline percentage is actually worth |
| `npm run shadow:sabotage` | break every detector, require each to go red |
| `npm run shadow:freeze -- --check` | has the generator changed under the corpus? |
| `npm run shadow:channels` | every generated message through the real Telegram adapter |
| `npm run shadow:intake` | turn something odd into permanent coverage, in two minutes |

None of them fails a build. They report. §18's deliverable is *"the
trustworthy testing system and honest baseline"*, and a baseline that exited
non-zero would make somebody's first instinct to get it green.

---

## How a message is made

Nothing is stored as a sentence. A scenario is composed, and every input is
recorded so it regenerates exactly:

```
goal family  x  persona  x  channel  x  messiness  x  structure  x  seed
    66             4          4         seeded        5 operators
```

- **`src/simulation/goals.ts`** — 66 families across the eleven blocks the
  brief names. A family is a KIND of thing a person wants, not a sentence.
- **`src/simulation/persona.ts`** — four people, as dispositions rather than
  prompts. `PRECISE` is the control: if a scenario fails for her it is not a
  messiness defect, and without that nothing is attributable.
- **`src/simulation/roughen.ts`** — surface messiness that is strictly
  meaning-preserving.
- **`src/simulation/compose.ts`** — the structural mutations that *do* change
  meaning, so they live where the hidden intent can be updated in the same
  breath.
- **`src/simulation/arcs.ts`** — ten multi-turn conversations, where the
  turns could not be shuffled without changing what a correct answer is.

### The line between the last two matters most

`roughen` may not change what is being asked. `compose` may, and always
updates the recorded intent when it does. An operator that appended *"actually
forget that"* while leaving the intent expecting the task would report the
office failing for doing exactly the right thing — silently, on a fraction of
seeds.

---

## The wall

`src/simulation/isolation.ts`. Everything reaching the office goes through
`sealed()`, which throws rather than scoring, because a run in which hidden
intent leaked is not a run whose other numbers mean anything.

Two detectors, because a leak arrives two ways and each is invisible to the
other's check: a field riding along on a spread object carries no suspicious
string, and a goal description concatenated into a message has no suspicious
field.

**Not a leak, deliberately:** a withdrawn clause and a negative constraint.
*"Book the room, actually forget that"* contains its own cancellation — the
person said it. A detector that flagged those would be red on every correct
scenario in two whole families.

---

## Two doors, and one of them is honest about being shut

`src/simulation/transport.ts`.

**`comprehension`** drives the product's own pure comprehension layer — the
modules that decide what a sentence is asking for before any model is called.
Not a mock. No credentials, no network, no database, no cost. It can answer
whether a request was recognised, whether the clauses were seen, whether a
standing instruction was registered, and whether a task would actually be
filed.

**`canonical`** is the live inbound door. It reports itself unreachable when
`SUPABASE_ACCESS_TOKEN` is unset rather than throwing, so a run in an
environment without credentials produces an honest UNREACHED report instead of
a crash.

### `unreached` is a verdict, not a blank

Three of the seven dimensions — did the row appear, did the prose read well,
did the goal complete — cannot be seen from the offline door and are reported
as unmeasured. A blank where a verdict belongs reads as a pass.

`agency` is mostly unreached for a better reason: **whether to ask is not
decided in the comprehension layer.** `classifyIntent` is confident that
*"can you pull the numbers on the review"* is a question and has no opinion on
WHICH review — project resolution decides that, in the database. Every family
declares what it actually turns on (`comprehension` · `referent` · `history` ·
`execution`) and the evaluator refuses to score past the door it is using.

---

## Reading a result

Seven dimensions, never averaged. An office that understands perfectly, acts
correctly and lies about what it did scores two-thirds on a weighted average
and is a product nobody can use.

Thirteen hard failures are listed individually and never folded into anything.

**And the percentages are worth less than they look.** `npm run
shadow:variance` measures the spread across seeds: it is about 13 points, on a
corpus that is fully deterministic and calls no model. That is the draw, not
noise in the product — but it means any claim of an improvement smaller than
the spread is a claim about which seed was run.

---

## The rule that governs every fix

> **A failed sentence is evidence, not a vocabulary request.**

If *"make me a note to call Kevin"* fails and *"remind me"* works, the finding
is *indirect future-action intent*. Classify the family, generate unseen
siblings, fix the class. Adding the phrase to a pattern teaches the office
that sentence and leaves the next variant broken — and makes this harness
measure its own influence.

Three corpora exist to keep that honest:

1. **development** — seed 1, tuned against by definition.
2. **frozen held-out** — seed 20260921, fixed before any fix, **not read**.
   `npm run shadow:freeze -- --check` says whether the generator has changed
   under it, which is the only thing that makes two runs comparable.
3. **fresh seeded** — `--seed` anything, on every serious run.

---

## Trusting the instrument

`npm run shadow:sabotage` breaks each detector, proves the break landed,
requires red, restores, requires green, and verifies the file came back
identical.

Proving the sabotage LANDED is half the tool. While this harness was being
built, two sabotages silently failed to apply and *"the check did not fire"*
read exactly like *"the check works"* — once on a safety detector. A sabotage
that cannot show it changed the file is `INCONCLUSIVE`, never a pass.

On its first run it found three real gaps, including a guard that had no test
at all because it had been verified by hand.

**Of the six failure classes in the first baseline, three were defects in the
evaluator rather than the product.** That ratio is normal, and CLAUDE.md calls
validating the test before believing the finding its most-used rule.

---

## When Grant reports something odd

```
npm run shadow:intake
```

Two minutes, in his own five classifications. It writes a sanitised record and
a ready-to-paste goal family with two deliberate TODO siblings, because a
family with one member is a phrase list with extra steps.

It exists to make the right thing cheaper than the wrong one. If filing a
finding properly costs twenty minutes and pasting the phrase into a regex
costs two, the regex wins.

---

## Where the live door goes

Everything above runs with no credentials. With `SUPABASE_ACCESS_TOKEN` set,
`--live` selects the canonical door, and the work to finish it is bounded and
named:

- `canonicalDoor().ask` currently throws. It should enqueue through
  `public.inbound_commands` → `app.enqueue_inbound` exactly as
  `scripts/sessions/run.ts` does — including `announce = false`, which is what
  stops synthetic traffic reaching a real person.
- The three unreached dimensions then become answerable from canonical state:
  the task row, the delivery, the job's terminal state.
- **Do not import `scripts/sessions/run.ts`.** It calls `process.exit(2)` at
  module scope when the token is unset, so importing it would kill every run
  in an environment without one.
- §2's safety rules apply in full the moment that door opens: fixture
  identities, `is_fixture` attribution corrected in teardown, and
  `npm run check:leaks` counting whatever new class the run creates.
