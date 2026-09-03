# POC gates

§13 defines five gates and is explicit about what evidence means:

> A gate is **not** PASS because code ran once. Store under `docs/poc/gate-N-*/`:
> date, environment, exact model/provider versions, test cases, automated test
> output, failure tests, screenshots or video, measured latency, measured cost,
> known limitations, and an explicit PASS/FAIL with reasoning.

## Status

| gate | subject | verdict | evidence |
|---|---|---|---|
| 1 | Voice | ✅ **PASS** — accepted by Grant | [evidence](gate-1-voice/00-preparation.md) |
| 2 | Notebook | ✅ **PASS** — 34/34 | [evidence](gate-2-notebook/00-evidence.md) |
| 3 | Telegram | ✅ **PASS** — 12/12 | [evidence](gate-3-telegram/00-evidence.md) |
| 4 | Slack | ✅ **PASS** — 19/19 | [evidence](gate-4-slack/01-evidence.md) |
| 5 | Inference failover | ✅ **PASS** — 17/17 | [evidence](gate-5-inference-failover/00-evidence.md) |

```
npm run poc:gate-2    # prints "Gate 2 is NOT passed" every run
npm run poc:gate-3
npm run poc:gate-4
npm run poc:gate-5
```

## All five gates pass

Gate 1 rests on Grant's own judgement, which §13 requires and which no
automated check can supply. The other four are reproducible:

```
npm run poc:gate-2    # 34/34, live against NotebookLM
npm run poc:gate-3    # 12/12, live Telegram webhook and bot
npm run poc:gate-4    # 19/19, live Slack workspace
npm run poc:gate-5    # 17/17, $0.00 spent
```

## The thing worth reading these for

Between them, the gates found **eleven defects and seven checks that passed for
the wrong reason**. The false passes are recorded in the evidence
documents alongside the real results, because the recurring failure in this
build has not been code that does not work — it has been *checks that reported
success without having tested anything*:

- a hardcoded `true` in an assertion, printing a `403` HTML error page as a pass
- a rate-limit check that never reached the rate limit
- a "Slack history destroyed" check that left a message behind, because thread
  replies do not appear in channel history
- `ok: false` from an API read, whose absent `messages` key made `.length` zero
  and satisfied a "no error thrown" assertion
- a Notebook liveness check that declared a freshly minted, library-verified
  credential dead — and cost a burned single-use token to learn it
- a failed check labelled BLOCKED rather than FAILED, conflating "we could not
  test this" with "this test failed"
- earlier in the build, a `SET ROLE` failure returning the same SQLSTATE as the
  refusal it was meant to be testing

The rule the evidence now states plainly: **a check whose expected value is a
literal is not a check**, and every assertion must derive its boolean from the
thing it claims to measure.
