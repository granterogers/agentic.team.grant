# ADR-0052 — The turn is one immutable value

**Status:** accepted (Architecture Run 1).

## Context
`office.instruction` held one turn in several textual forms (raw, cleaned,
kept-after-retraction, the resolver's model paraphrase) and every reader chose
one by hand. Readers that PERMIT things (plan, link, page, task, standing rule,
call-off, another go) sometimes read the paraphrase, so a model rewrite could
authorise an action he never asked for. Nothing in the types stopped it.

## Decision
- `src/agents/turn.ts`: `buildTurn` returns a frozen `Turn`
  (`said`, `cleaned`, `kept`, `withdrawn`, `answer`, `resolved`, `rewritten`,
  `isBranch`, `addressedTo`). `HumanWords` and `Paraphrase` are branded types;
  `resolved` is a `Paraphrase` and is for routing and prompts only.
- `src/agents/entitled.ts`: every consequence-bearing reader is reached only
  through `entitled.*`, which takes `HumanWords`. A `@ts-expect-error` test and
  an import-barrier test keep it so.
- `src/agents/gates.ts`: explicit early-gate precedence — an answer to a waiting
  question, then rejection, then close (only when nothing is waiting).
- A leading bare yes/no is peeled only when a question is waiting; the remainder
  is `kept` and is processed, and an unactionable remainder is named, never lost.

## Consequences
Model paraphrase can still choose WHO answers; it can never decide WHAT was
asked. `understand()` now reads `turn.kept`. Moving `understand` earlier than
the early returns was deliberately NOT done (it would add a model call to turns
that today need none); recorded as engineering debt.
