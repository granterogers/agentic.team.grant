# Gate 1 — voice POC, prepared and awaiting Grant

**Prepared:** 2026-09-03 · **Status:** ⏸ **awaiting subjective acceptance**

> §13: *"Claude must prepare the test but must never mark subjective acceptance
> PASS before Grant has actually performed it."*

This document records everything that could be verified without Grant, and
states plainly what cannot.

## The POC

**→ `https://baujwlzcziasnfhhkchg.supabase.co/functions/v1/voice`**

Open it in **Safari on the iPhone**. Press *Start talking*, allow the
microphone, and speak. Headphones are recommended for the interruption test;
one pass on speaker is worth doing deliberately, because echo cancellation on
iOS is listed in the master spec's own known-unknowns as untested.

## Verified before handing it over

| Check | Result |
|---|---|
| `gpt-realtime-2.1` and `gpt-realtime-2.1-mini` present on this account | ✅ both |
| Mint endpoint is `POST /v1/realtime/client_secrets` | ✅ returns `ek_…`, 35 chars |
| SDP exchange endpoint is `/v1/realtime/calls` | ✅ used by the page |
| The permanent key is **absent** from the mint response | ✅ asserted at deploy time |
| The permanent key is **absent** from the served page | ✅ asserted at deploy time |
| Deployed and live | ✅ `voice-token` v1, `voice` v1, both ACTIVE |

The last two are asserted by the deploy script itself, which aborts rather than
publishing if the key appears in either — §12 requires that *"the browser never
receives the permanent API key"*, and a check that runs on every deploy is worth
more than a note saying it was checked once.

### §13's model re-verification, done

§13 requires re-checking model names against the live API *immediately before*
Gate 1. Done, and it found two models the master spec does not mention:

```
gpt-realtime            (deprecated, removal 2027-01-20 — STILL LISTED)
gpt-realtime-1.5
gpt-realtime-2
gpt-realtime-2.1        ← current full
gpt-realtime-2.1-mini   ← current mini, this POC's default
gpt-realtime-2025-08-28
gpt-realtime-mini       (deprecated — STILL LISTED)
gpt-realtime-mini-2025-12-15
gpt-realtime-translate  ← not in the spec
gpt-realtime-whisper    ← not in the spec
```

`gpt-4o-realtime-preview` is gone, as the spec predicted. The two deprecated
identifiers are **still listed**, which is precisely why §4 forbids hard-coding
them: a constant would keep working right up until it silently did not. The
model is read from `VOICE_MODEL`, and the deploy script refuses to publish if it
is not present on the account.

## What only Grant can judge

Automated tests cannot answer any of these, and §13 says so:

- **Naturalness** — a conversation, or dictation to a machine?
- **Latency** — the page measures it; what matters is whether it *feels* like a pause
- **Interruption** — talk over it mid-sentence. Clean stop, or does it talk through you?
- **Echo** — one pass on speaker. Does it hear itself?
- **Voice quality** — pleasant for twenty minutes, or grating after two?

**20+ minutes is the requirement and it cannot be delegated.**

The page measures and displays: mint time, time to first audio, per-reply
latency (last and median), interruption count, and session duration. On *Stop*
it prints a one-line summary to paste back here.

## Cost — shown before enabling, per §2.8

Rates from OpenAI's pricing documentation, 2026-09-03, per 1M tokens:

| Model | Audio in | Audio out | Text in | Text out |
|---|---|---|---|---|
| `gpt-realtime-2.1-mini` | $10 | $20 | $0.60 | $2.40 |
| `gpt-realtime-2.1` | $32 | $64 | $4.00 | $24.00 |

**A 20-minute session on mini: roughly $0.15–$0.60.**

Classified **ESTIMATED**, not CALCULATED, per §11's usage provenance rule, and
the range is wide for a specific reason worth understanding: a Realtime session
**accumulates context**, so every turn resends the conversation so far as input
tokens. Cost therefore grows faster than linearly with session length, and a
per-minute figure understates a long conversation. The assumption behind the low
end is ~10 audio tokens per second with Grant and the model each speaking about
40% of the time.

**I will report the measured cost after the session** by reading the usage API,
which is what §13 actually asks for. Until then the number above is an estimate
and is labelled as one.

D3 — *voice for V1: skip, or fund ~$24/month* — is still Grant's open decision.
This POC exists to inform it, not to pre-empt it. One session costs cents; the
$24/month figure is about sustained daily use.

## Known limitation, deliberate and bounded

Both endpoints are **unauthenticated**. Grant opens the page in Safari with no
Supabase session, so there is no session to check. Anyone with the URL can mint
a credential and spend money.

Acceptable for a POC on an unadvertised URL. **Not acceptable beyond it**, and
tracked in `docs/parked/phase-2-hardening.md` rather than left implicit. The fix
is a short-lived signed link or a shared secret in the query, neither of which
belongs in a test whose purpose is to find out whether voice is worth having at
all.
