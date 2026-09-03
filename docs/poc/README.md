# POC gates

§13 defines five gates and is explicit about what evidence means:

> A gate is **not** PASS because code ran once. Store under `docs/poc/gate-N-*/`:
> date, environment, exact model/provider versions, test cases, automated test
> output, failure tests, screenshots or video, measured latency, measured cost,
> known limitations, and an explicit PASS/FAIL with reasoning.

## Status

| gate | subject | verdict | evidence |
|---|---|---|---|
| 1 | Voice | ⛔ **BLOCKED** — OpenAI account has no credits (D3) | [prep](gate-1-voice/00-preparation.md) |
| 2 | Notebook | ⛔ **BLOCKED** — 17 proven, 16 need a Google account | [evidence](gate-2-notebook/00-evidence.md) |
| 3 | Telegram | ✅ **PASS** — 12/12 | [evidence](gate-3-telegram/00-evidence.md) |
| 4 | Slack | ✅ **PASS** — 19/19 | [evidence](gate-4-slack/01-evidence.md) |
| 5 | Inference failover | ✅ **PASS** — 17/17 | [evidence](gate-5-inference-failover/00-evidence.md) |

```
npm run poc:gate-2    # prints "Gate 2 is NOT passed" every run
npm run poc:gate-3
npm run poc:gate-4
npm run poc:gate-5
```

## What each of the two unfinished gates needs

**Gate 1** needs the OpenAI account funded, and *then* 20+ minutes of Grant's
time. The page is live at
`https://ai-team-hq-voice-agentic-team-grant.vercel.app` and works: it minted a
real ephemeral credential in 1.7 s and reached OpenAI, which refused with
`credit_balance_exhausted` at the point the session would start costing money.
That is decision **D3** — *"Voice for V1: skip, or fund ~$24/mo"* — arriving as
a bill rather than a question. §13 is explicit that the judgement itself cannot
be delegated:

> Claude must prepare the test but must never mark subjective acceptance PASS
> before Grant has actually performed it.

**Gate 2** needs a dedicated Google account and one interactive sign-in to mint
the Notebook master token. Both are human-only. Nothing else about Gate 2 is
Grant's; the sixteen blocked items are all automatable once the token exists.

## The thing worth reading these for

Between them, the three passing gates found **eight defects and five checks that
passed for the wrong reason**. The false passes are recorded in the evidence
documents alongside the real results, because the recurring failure in this
build has not been code that does not work — it has been *checks that reported
success without having tested anything*:

- a hardcoded `true` in an assertion, printing a `403` HTML error page as a pass
- a rate-limit check that never reached the rate limit
- a "Slack history destroyed" check that left a message behind, because thread
  replies do not appear in channel history
- `ok: false` from an API read, whose absent `messages` key made `.length` zero
  and satisfied a "no error thrown" assertion
- earlier in the build, a `SET ROLE` failure returning the same SQLSTATE as the
  refusal it was meant to be testing

The rule the evidence now states plainly: **a check whose expected value is a
literal is not a check**, and every assertion must derive its boolean from the
thing it claims to measure.
