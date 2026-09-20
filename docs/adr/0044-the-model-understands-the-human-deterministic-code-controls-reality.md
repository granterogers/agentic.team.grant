# ADR-0044 — The model understands the human; deterministic code controls reality

**Status:** accepted · 20 September 2026 · #282 ·
`src/agents/understand.ts`, `src/handlers/instruction.ts`, `src/agents/extract.ts`

## The question this answers

> Is the Agentic Team asking deterministic TypeScript heuristics to understand
> too much natural human language before a capable LLM has resolved what Grant
> actually means?

**Yes, and it was measured rather than asserted.** Every action decision in
`handlers/instruction.ts` — a task, a preference, a document, a page fetch, an
extraction, a follow-up change — was made by regex between lines 2296 and 2723.
The first model call that could have understood the sentence was at 3238.
Meaning was decided by pattern matching and a model was then asked to write the
reply about it.

Over a 24-case corpus of spoken requests, written before anything ran:

| | |
|---|---|
| the deterministic cascade | **11 / 24** |
| one semantic pass in front of it | **24 / 24** |

The forensic detail that settles it: `clauses.split` ALREADY returned the right
clauses for both production anchors, and nothing downstream read them. The
splitter was right and its answer was thrown away. That is an architecture
problem, not a missing phrase, and CLAUDE.md records eight separate occasions
of a regex being widened to cover one more way of speaking.

## What was NOT true

The hypothesis also supposed the channels might have grown independent
natural-language brains. They have not. Telegram text, Telegram voice, Slack
and Team HQ all converge on one
`inbound_commands → enqueue_inbound → office.instruction` path, so **one
interpreter placed in that path fixes every door at once**, and §5's rule that
an adapter may only translate is intact.

## The decision

    THE MODEL UNDERSTANDS THE HUMAN. DETERMINISTIC CODE CONTROLS REALITY.

`understand()` rewrites one messy utterance into N clean standalone requests
and says which were abandoned. **It decides nothing.** The existing
deterministic cascade — good at a single clean request, and carrying every
permission, capability, provenance, idempotency and approval guard the office
has — then executes each one exactly as it does today.

Four consequences, each enforced somewhere rather than written down and hoped
for:

1. **A reading is a description of an utterance, never a right to write a
   row.** The recognisers still decide. `firstOf` hands each of them one clean
   request instead of a paragraph of speech; every writer downstream is
   unchanged.
2. **The model's `kind` is used in ONE direction: to subtract.** `MAY_ACT`
   keeps a clause read as a standing instruction or a question away from the
   writers, and `HIS_OWN` keeps a clause read as work for the office off
   Grant's personal list. Neither can cause an action; both can only decline
   one. Where they are wrong the turn answers in prose, which is today's
   behaviour for anything nobody recognised.
3. **Every failure path returns the whole utterance as one reading** — no
   provider, invalid JSON, an ungrounded rewrite, a shape that does not
   validate. That is precisely the current behaviour, so the change cannot be
   worse than the status quo.
4. **A rewrite must be GROUNDED in what he said.** It may drop filler and
   abandoned clauses and resolve pronouns; it may not introduce a subject.
   An invented request is the one failure mode that would be worse than the
   defect being fixed, so it falls back rather than acting.

## Two guards, one defect — and only the real sentence found the second

Anchor A is *"I've told you to always give your information in the form of
clear bullet points. Also, I want you to tell me what my current tasks are."*
The preference was stored and the turn RETURNED; the question vanished.

Splitting the clauses was not enough, and neither was fixing the early return
in the teaching path. `confirmation !== null` short-circuits the WHOLE
answering path — no retrieval, no mail, no capability sheet, no model call —
and returns the confirmation as the entire reply. Correct for a turn that is
only an action; exactly wrong for a turn that is an action AND a question.

So **an action taken must not swallow a question asked**. `answering` is one
boolean read by all fourteen gates, because CLAUDE.md records what a list
assembled twice costs.

The first fix was present, compiled, unit-tested and inert. `verify:anchors`
drives the real sentence through the real path and found it in one run.

## A question needs canonical state, or the honest answer is the useless one

This handler supplied documents, mail and the project spine and **nothing at
all about `public.tasks`**. Enforcing provenance without that would have made
"what are my current tasks" unanswerable, which is the failure the brief names
by name: do not solve fabrication by making the office incapable. `taskSpine`
is `projectSpine`'s argument applied to his own list — stated as a fact, never
as an instruction, because a negative imperative beside the data it is about
invites a model to over-obey it.

## Where the deterministic layer was genuinely too narrow

Anchor B's surviving clause — *"Scan the entirety of the X and create
appropriate tasks for me to review"* — was claimed by none of the four
extraction shapes and fell through to `taskRequest`, which filed ONE personal
task called "appropriate tasks for me to review": the delegation performed as
its own title.

That is not a case for a bigger dictionary. It is a general shape — a verb of
READING a source, the source, and a verb of MAKING several tasks out of it —
and it is recognised as one, with six controls asserting that reading without
making tasks, a prohibition, and a single personal to-do are all still
declined.

## What this costs

A model call in front of every non-trivial message: mean 9.2s, slowest 24.8s on
`openai/gpt-oss-120b`. That is why the fast path exists — a short single-clause
message short-circuits entirely and is scored, in the harness, on what actually
happens to it rather than on a kind the fast path never produces.

## How it can be reversed

Delete the `understand()` call. `requests` becomes `[instruction]`, `firstOf`
becomes a direct call, `alsoAsked` becomes false, and every line below is what
it was. The layer was built so that its absence is the old behaviour rather
than a broken one.
