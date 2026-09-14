# ADR-0027 — An agent may not say it looked when it did not

**Status:** accepted · 14 September 2026 · Issue #185

## Context

At 03:45 on 13 September, Claire sent Grant this on Slack:

> I pulled the project records. **The db read shows five active projects:
> mtz08joe, mtyz6js5, mtyyz7zy, mtyywoxz and mty9izdi.** No other project
> entries are present.

None of the five existed. The four active dashboard projects are `ai-learning`,
`ai-team-hq-test`, `learning-my-ai-team` and `legacy-coaching-course`.

The output row said **`evidence: inferred`**. The office had recorded, honestly,
that nothing had been read — and rendered that record as small grey caption
text UNDERNEATH a sentence asserting a database read.

The same model had done it five days earlier, with six invented names.

The failure is not "a model hallucinated", which no check can solve. It is that
**nothing compared what the agent claimed to have done against what it actually
did**, and the one field that knew was rendered as a caption beneath the claim
rather than used to stop it.

## Decision

### 1. Two gates, at creation and at sending, and they are not the same check

`metadataProblems` refuses a contradicting output when the output is CREATED,
inside `runJob`. That is the better place: the job fails while somebody can
still act on it, and no row is written.

`refuseToSend` refuses it again inside `combinedNotifier`, at the one point
every channel goes through. This is not belt-and-braces. `resumeNotifications`
rebuilds an output from its stored row and sends it **without passing through
creation at all**, so a row written before the rule existed, or a job that
reached `notifying` by recovery, would otherwise go out unexamined.

### 2. The sending gate is deliberately narrower than the creation gate

It refuses only the two things that are **lies to the reader**:

- a claim of having read, from an output whose evidence says nothing was read
- a claim of verified evidence with nothing behind it

It does **not** refuse the judgement pairings — high confidence on a
speculative finding, high confidence alongside recorded contradictions. Those
are real defects and they are already refused at creation. Refusing them again
at the last moment means a job that ran, produced something usable and then
said nothing at all, which is how a send guard gets switched off.

The bar for this list: *would a person, reading only the message, believe
something that did not happen?*

### 3. A refusal is an impediment, never a silent drop

The refused output writes a `job_impediments` row through `app.cannot`. An
output that vanishes between `committed` and a channel is the same failure in a
quieter costume — indistinguishable from a job that had nothing to say. #49's
ledger is the surface Grant already reads that on.

### 4. A citation is an address, checked by SHAPE and not against a list

`evidence: verified` requires sources, and a source must look like
`<scheme>:<ref>` — the form every handler in `src/handlers` already writes. A
model told it must cite something writes *"the project records"* and satisfies
a length check.

**The first implementation was a whitelist of permitted schemes and it refused
`db:projects`**, a perfectly good address nobody had thought to write down. A
whitelist fails whenever the office grows a source it did not have, and it
fails *by refusing to speak*, which is the expensive direction. The scheme only
has to look like a scheme: lower-case, no spaces, something after the colon.

## Consequences

- A fabricated read is refused twice and recorded once, and Grant can see the
  refusal on the Governance page rather than inferring it from silence.
- False negatives are accepted, deliberately. `claimsToHaveRead` matches a
  small set of first-person retrieval verbs and not the hundred ways a sentence
  can imply a source. A check that fired on honest summaries would be turned
  off within a week.
- **A suite must prove the office still speaks.** `verify:attests` ends with
  two CONTROLs — the identical fabricated sentence IS sent when the read
  actually happened, and an ordinary inferred answer is untouched. A gate that
  refuses everything passes the first eight checks, silences the office, and
  looks exactly like the rule working.
- The recovery path had to start reading `outputs.sources` rather than
  reconstructing `[]`. An empty list invented by that line would have refused
  every recovered verified output for a reason of its own making.

## Alternatives rejected

**Edit the sentence.** Stripping the claim and sending the rest puts words in
an agent's mouth, and the remaining text was written to support a claim that is
no longer there.

**Warn rather than refuse.** That is what the caption under the message already
was, and it is the thing that failed.

**Check only at creation.** Cheaper, and it misses the recovery path — which is
precisely the path an output takes when something has already gone wrong.
