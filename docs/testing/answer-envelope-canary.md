# The answer envelope: what is built, what was measured, what it does not claim (#412)

**Status: IMPLEMENTED, provider path EXERCISED ONCE, NOT ENABLED anywhere. #412 is NOT structurally solved.**

## What exists

`src/providers/envelope.ts` and an opt-in `answerEnvelope` flag on `CompletionRequest`
(`src/providers/router.ts`). When a caller sets it, the router tells the model to put its finished reply between
`<answer>` and `</answer>`, returns ONLY what is inside, and treats a reply with no usable envelope (no tags, cut short,
empty) as no answer: the attempt is recorded as `malformed_response` and the router's own failover tries the next model.
That turns "recognise reasoning in an answer" (`deliberationLeak`, open-ended) into "find the answer" (closed). Nothing
outside the tags can reach a person, whatever shape it has.

`deliberationLeak` is unchanged and stays as the secondary tripwire.

## What is proved

* **Round-trip corpus (unit):** thirteen legitimate answers come out byte-for-byte as written, including code, a table, a
  list, HTML, a reply that talks about the tags themselves, a reply that quotes the closing tag, non-ASCII text and money,
  and "We need to check the policy with the accountant." (`tests/providers/envelope.test.ts`).
* **Everything outside the tags is dropped** (a plan before, working-out after, an imagined tool call, both), a **truncated**
  reply is not an answer, and an empty envelope is not an answer.
* **The router enforces it** where every call passes, fails over on a reply with no envelope and accounts for it, fails with a
  named error when every model ignores the format, and changes nothing when the flag is absent (the control).
* Sabotaged (deliver the raw content instead of the extracted answer): two router tests went red; restored, green.

## What was measured against the real provider (4 October 2026, the Sample's canary, 24 free-tier calls)

`npm run sample:envelope-canary`: twelve prompts of the shapes an answer takes, each asked through the real
`ProviderRouter` and the real model chain once as the office asks today and once with the envelope.

| | answered | first model usable | mean attempts | mean latency | flagged as working-out |
|---|---|---|---|---|---|
| today | 12/12 | 100% | 1.00 | 9.99 s | 0 |
| envelope | 12/12 | 100% | 1.00 | 10.21 s | 0 |

Every call was answered by `openai/gpt-oss-120b`. **The model followed the format on 12 of 12, with no extra attempts and no
visible latency cost.**

## What this does NOT show

* **Nothing about the leak itself.** The leak is rare (0 of 513 real model-written outputs open like working-out; one live
  case on 3 October) and 0 of 12 in either mode here, so this run could not have shown the envelope preventing one. It shows the
  envelope costs nothing measurable when the model is behaving.
* **Nothing about the fallback models.** The first model answered every call, so `qwen/qwen3.7-flash` and
  `mistralai/mistral-small-3.2-24b-instruct` were never asked. If they do not follow the format, enabling the envelope would
  turn a rate limit on the first model into a failed turn where today it is a degraded one.
* **One sample of 12 on a non-deterministic tier.** A measurement of compliance and cost, not proof of absence.
* **Real answering turns.** The canary sends a short system prompt and one question. Claire's real prompt is thousands of
  tokens of context and instructions, and a long prompt is where format instructions are most likely to be forgotten.

## Not wired, deliberately

No production call sets the flag. Turning it on for the answering call changes the contract for every office and every handler
that reads a model's plain text. The scoped path from the issue stands: enable `answerEnvelope` for the answering call on the
Sample only, run the session corpus and watch `inference_usage` for `malformed_response` per model, and widen only when the
fallback models have been measured too. A retry storm is the failure to watch for, so the first change to make once it is
wired is a ceiling on envelope retries per turn.

#412 stays open until the structural option is ENABLED and measured, or Grant accepts the heuristic guard as the boundary.
