# Gate 5 — secondary inference failover

**Verdict: PASS** · 17/17 automated checks · reproduce with `npm run poc:gate-5`

| | |
|---|---|
| Date | 2026-09-03 |
| Environment | Supabase project `baujwlzcziasnfhhkchg`, PostgreSQL 17.6, Node 22.22.2 |
| Provider | OpenRouter, `https://openrouter.ai/api/v1` |
| Model that served the live call | `cohere/north-mini-code:free` |
| Allow-list size at run time | 5 usable of 21 probed |
| Measured cost of the entire run | **$0.00** (`usage 0 → 0` on OpenRouter's own key endpoint) |
| Latency | not measured — irrelevant to this gate |

## What the gate asks for

> Test: valid free model · 429 · outage · malformed response · provider
> disabled · all free providers exhausted · **a paid model accidentally returned
> by model discovery** · **router receives a model without verified free
> status**
>
> Acceptance: no paid call, non-urgent work queues, blocked urgent work raises a
> blocker, local usage records stay correct. **Enforced by deterministic code,
> not by a prompt.**

The script is organised as those eight cases in that order, followed by the four
acceptance clauses, so the evidence maps onto the requirement rather than onto
whatever was convenient to test.

## Results

```
| # | check | outcome | |
|---|---|---|---|
| 1 | valid free model | cohere/north-mini-code:free cost=0 7+29tok content="ready" | ✅ |
| 2 | 429 on non-urgent work | rate_limited/transient -> retry | ✅ |
| 3 | provider outage on non-urgent work | transport_error/transient -> retry | ✅ |
| 3b | the same outage on URGENT work raises a blocker | transport_error/transient -> blocker | ✅ |
| 4 | malformed (non-JSON) response | malformed_response/transient -> retry | ✅ |
| 5 | provider disabled empties the allow-list without deleting a model | usable 5->0->5, model rows 21->21 | ✅ |
| 6 | all free providers exhausted is systemic, so it pages rather than spinning | unavailable/systemic -> blocker | ✅ |
| 7a | a paid model marked usable by discovery never reaches the allow-list | status=usable in registry: yes; on the allow-list: no; router: PaidCallPreventedError | ✅ |
| 7b | and the pricing check refuses it even when the allow-list does contain it | refusing to call gate5/fake-paid-model: free_only is set and pricing is prompt=0 | ✅ |
| 8 | an unverified model is refused, by name or by absence | openai/gpt-4o-mini=PaidCallPreventedError openrouter/auto=PaidCallPreventedError nobody/never-probed=PaidCallPreventedError | ✅ |
| A1 | no money was spent by any of the above | usage 0 -> 0 | ✅ |
| A2 | every attempt that reached the provider was recorded, successes and failures alike | malformed_response:estimated=1 ok:authoritative=1 rate_limited:estimated=1 transport_error:estimated=2 unavailable:estimated=1 (total 6, expected 6) | ✅ |
| A3 | not one usage row records a charge | 0 rows with cost_usd > 0 | ✅ |
| A4 | no figure claims to be authoritative without the provider having reported it (§11) | 0 such rows (a CHECK constraint makes this impossible) | ✅ |
| A5 | blocked work raised structured blockers, each with its consequences and options | 2 blockers, all fields populated: true | ✅ |
| A6 | the non-urgent job raised exactly one blocker, and only for the systemic failure | 1 (its 429, outage and malformed cases queued silently) | ✅ |
| A7 | a usage figure cannot be quietly rewritten | the trigger refused the UPDATE | ✅ |

17/17 checks passed · usage rows added: 6 · open blockers before: 0 · usage rows before: 12
```

## Method, and what is real

The router is the production router. The database is the production database.
The only substitution is `fetch`, and only for the three cases that require the
provider to misbehave on demand — there is no way to ask OpenRouter for a 429, a
socket failure, or an HTML error page. Cases 1, 5, 6, 7 and 8 use the live
provider or need no request at all.

**Spend is read from OpenRouter's own `/key` endpoint before and after**, not
from our accounting. Using our records to prove our records would be circular:
the whole question is whether local usage records are correct, so the
independent figure has to come from the counterparty.

Two real jobs are created, priority 100 and priority 5. The acceptance sentence
draws its distinction between urgent and non-urgent work, and one job could only
have demonstrated half of it. Case 3b is deliberately the *same failure* as case
3 against the other job: the input is identical and only the urgency differs, so
the difference in outcome cannot be attributed to anything else.

## The urgency boundary is configuration

`jobs.urgent_priority_max = 20`, in `system_config`, with
`self_adjustable = false`. §4 requires this kind of threshold to be
configuration rather than a constant, and the `false` is a separate decision: a
system able to widen its own definition of "urgent" can talk itself into paging
Grant about anything. `decide()` takes the boundary as an argument, so the unit
tests move it and observe the classification move with it — the value is not
baked into the logic that reads it.

## What the run found that the tests had not predicted

**Case 7 was contained one layer earlier than the assertion expected.** The
premise is that model discovery wrongly marks a paid model usable, so the test
inserts a genuinely paid model with `status = 'usable'` and a recorded
successful probe — the strongest form of the mistake, where the registry itself
vouches for the model. The assertion expected it to appear on the allow-list and
be refused at the call site.

It never appeared on the allow-list. `public.usable_models` requires zero
pricing *in addition* to `status = 'usable'` whenever the provider is
`free_only`, so the bad row was excluded by the allow-list's own definition.

That is a better outcome than the test predicted, and it would have been easy to
relabel the check and move on. It is recorded because a stronger-than-expected
result still means the test was measuring the wrong thing, and case 7 as written
would then have rested entirely on one SQL predicate. It is now two checks:
**7a** the view excludes it, and **7b** the pricing guard refuses it *even when
handed an allow-list that does contain it*. If the view's pricing clause is ever
relaxed, 7b still fails closed.

**A2 initially failed on arithmetic, not on behaviour.** It asserted seven usage
rows; six is correct — cases 1, 2, 3, 3b, 4 and 6 reach the provider and record,
while 5, 7 and 8 are refused before a request exists. An inference that never
happened is not usage. The count is now exact rather than `>=`: a `>=` would
have passed and hidden the fact that the expectation was wrong.

## The one asymmetry worth stating plainly

A *systemic* refusal raises a blocker **even when the job is not urgent**. That
is the opposite of how the queue-versus-page rule reads at first glance, and it
is the case that matters most:

- A `PaidCallPreventedError` means an enforcement layer refused the call. A
  retry meets the same refusal, for the same reason, forever.
- Treating it as transient would leave the job cycling through `retrying`,
  draining its retry budget, and would absorb a **defect report** as "provider
  trouble".

So `classifyFailure` splits failures by whether waiting can plausibly help, not
by how they look in a stack trace. `PaidCallPreventedError` and
`NoUsableModelError` are systemic; breaker-open, 429, malformed JSON, empty
completion and transport failures are transient.

Unrecognised errors default to **transient**. That direction is deliberate: an
unknown provider hiccup is not evidence that a human must be woken, and §12's
"this prevents random agent messages from becoming the approval system" rules
out over-paging as firmly as it rules out a missing blocker. Urgent work still
raises a blocker on a transient failure, so nothing that genuinely cannot wait
is left waiting.

## Local usage records

`public.inference_usage` records every attempt that reached the provider,
failures included — a 429 is usage information even though it produced no
tokens. Two constraints do the work that a convention would not:

- `inference_usage_authoritative_needs_provider_figure` — a row may only claim
  `provenance = 'authoritative'` if `provider_reported_cost is not null`. §11's
  "never present estimated quota as authoritative" is therefore not a rule
  someone has to remember. Observed classification in this run:
  `ok:authoritative`, everything else `estimated`.
- The table is **append-only**, enforced by the same trigger as the event
  ledger (check A7 proves the `UPDATE` is refused). A corrected figure must be a
  new row. Without this, "local usage records stay correct" is unfalsifiable —
  any figure could be made correct after the fact.

`CALCULATED` is deliberately never emitted. It requires "a known quota plus
complete local accounting", and OpenRouter's free tier publishes no per-model
quota, so claiming it here would be precisely the error §11 warns about.

## Blockers

`public.blockers` carries every field §12 names, and the ones that are not
genuinely optional are `NOT NULL` — including `work_can_continue`, the field
that decides triage, and `consequences_of_delay`. §12's reason is explicit:
*"this prevents random agent messages from becoming the approval system."* A
blocker without its consequences is a random agent message wearing a table row,
so the schema refuses it rather than trusting each producer.

The two blockers raised in this run differ on exactly that field. The urgent
transient failure sets `work_can_continue = true` — one urgent job waiting does
not stop anything else, and saying so is what keeps it from reading as a
system-wide alarm. The systemic failure sets `false`, because it affects every
job that needs inference.

## Known limitations

1. **Layer 2 — the hard spend cap — remains unproven by experiment.** The key
   reports `limit: 5`, and proving the cap actually stops a call at the ceiling
   would cost $5. Layers 1, 3 and 4 are proven; layer 2 is configured and
   asserted. Recorded here rather than counted as evidence.
2. **Only one provider is live.** OpenRouter is the only registered free
   provider with probed models, so "all free providers exhausted" is
   demonstrated by exhausting the one that exists. Adding Gemini as a second
   free provider would strengthen the failover claim from *refusal* to
   *substitution*; today the router refuses correctly rather than switching.
3. **The 429 is synthetic.** Its shape matches OpenRouter's documented error
   envelope, and classification matches on the code rather than the wording so
   it survives a wording change, but no real 429 has been observed from this
   provider.
4. **`retry` and `queue` are dispositions, not yet executed transitions.** The
   policy returns them and the evidence shows the correct one being chosen; the
   worker loop that applies them to a job's state is Phase 3. The job engine's
   `retrying → queued` path is separately proven in `npm run verify:jobs`.

## Files

| | |
|---|---|
| `migrations/0012_blockers_and_usage.sql` | `inference_usage`, `blockers`, the provenance enum, the urgency boundary |
| `src/inference/policy.ts` | classification and disposition — pure, no I/O |
| `src/inference/record.ts` | writing usage and blockers |
| `tests/inference/policy.test.ts` | 14 unit tests, the disposition table |
| `scripts/poc/gate-5.ts` | this evidence run |
