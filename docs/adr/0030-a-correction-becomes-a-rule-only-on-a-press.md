# ADR-0030 — A correction becomes a standing rule only on a press

**Status:** accepted · 16 September 2026 · Issue #147 · migrations 0390–0393

## Context

Grant's own statement of the gap, from #136:

> *"When a reply is wrong Grant says so and the next reply is better. NOTHING
> GENERALISES."*

There are dozens of corrections on record. Each one improved exactly one reply
and then evaporated. #147 is his first pick from #136 and his reason for it was
that it turns work he has already done into permanent improvement, which no
other item on that list does.

`readTeaching` already handles the case where he states a rule *as* a rule —
*"from now on, always put the summary last"* — and stores it outright, because
he has said it is standing. That is the minority. The majority is a correction
that fixes this answer and says nothing at all about the next one.

Two ways to close the gap were available and only one of them is safe.

## Decision

### 1. A correction is recognised deterministically, never by a model

`src/agents/correction.ts` reads three signals that cost nothing: the message
FOLLOWS an answer, it is SHORT, and it is corrective in FORM — either it opens
with a rejection or it carries a contrast.

No model call decides whether something is a correction. The expensive
direction of being wrong here is the **false positive**: offering to turn an
ordinary instruction into a permanent rule is the office being obtuse in a way
he notices every single time. A deterministic reader is one that can be made
quieter by a test rather than by a prompt.

The two signals do not carry equal weight and therefore do not share a length
ceiling. An opening rejection is positional — *"no,"* at the front of a message
can hardly be anything else — so it may carry a couple of sentences. A contrast
word cannot: *"rather than"* is ordinary English in the middle of ordinary long
requests, so a contrast-only correction must be short (90 characters) for the
contrast to mean anything. The alternative was a list of verbs that open a
request, and a list of permitted values fails by refusing to speak.

### 2. The drafted rule is his words, framed — never a rewrite

The office's contribution is *"From now on, "*. The rest of the sentence is
his, with the rejection stripped.

A model could write a nicer rule and could also write a rule that says
something he did not. Since the issue requires the drafted text to be **visible
verbatim before acceptance**, a slightly stiff sentence he can read and decline
is strictly better than a fluent one he has to trust.

### 3. Nothing is stored until he presses

`app.propose_standing_rule` writes an OFFER. `app.decide_suggestion` is the only
path by which `app.learn` is called for one, and it is reachable only from the
Governance page. A rule inferred from a short message must not silently change
how the office behaves for ever.

The answer he is already reading carries the offer — an offer on a page he has
to go and find is not an offer — and the press happens on the page, where every
other accept-or-decline in this office lives.

### 4. Offered once per class, and a decline is durable

The dedupe key is the normalised rule text, matched regardless of state. Two
corrections about the same thing, worded differently, collapse to one offer; a
declined rule never comes back. This is #49's last box, applied to a different
kind of row.

### 5. An offer may only promise what the press can perform

This is the rule the other four rest on, and every one of the four defects
found while building it was a violation of it:

| | What disagreed |
|---|---|
| 0391 | the decision wrote `accepted` / `declined`; the table allows `open \| acted \| dismissed \| stale` |
| 0392 | `app.learn` returns JSONB and the press assigned it to a `uuid` |
| 0392 | the offer accepted a scope of `agent`; `lesson_scope` has `staff` |
| 0393 | the offer stored three targets; `lessons_scope_matches_target` permits exactly one |

Each would have appeared to Grant as a press that did nothing, weeks later, on
a feature whose entire point is one press. None was visible from reading the
migration — all four were found by `verify:rules` driving the real function.

So: whatever the offer will accept, the suite drives end to end through BOTH
halves. Reading the two lists and comparing them by eye is precisely how they
came to differ.

## Consequences

- `readCorrection` runs on every instruction turn that follows an answer, at no
  token cost.
- A rule offered and declined cannot be offered again in the same words. He can
  correct differently and the office can propose a new one.
- `suggestions.offer_kind` is now exposed to the page as `offer` (0391), so the
  studio can tell a decision from a note. Drawing Accept on a note would put a
  control in front of him that performs nothing.
- `app.propose_standing_rule` refuses the `kind` scope although `lesson_scope`
  has it: a kind-scoped lesson needs a `job_kind` and an offer carries no way
  to say one. Offer only what the press can perform.

## Alternatives rejected

**A model deciding what is a correction.** Cheaper to write, impossible to
constrain, and it fails in the expensive direction. Also a token cost on every
turn to answer a question three regexes answer.

**A model drafting the rule.** Rejected under §3 above: he would be approving a
sentence the office wrote about what he meant, rather than the thing he said.

**Storing the rule on detection and letting him retract it.** This is how the
office would acquire rules nobody chose. Retraction is the remedy for a rule
that has stopped being right, not for one that was never agreed.
