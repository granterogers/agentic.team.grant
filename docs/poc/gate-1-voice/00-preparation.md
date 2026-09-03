# Gate 1 — voice POC

**Prepared:** 2026-09-03 · **Status:** ⛔ **BLOCKED on funding (D3)**

> ## The account has no OpenAI credits
>
> Grant ran the POC on 2026-09-03 at 19:08. It got further than any automated
> check could:
>
> ```
> minted ephemeral credential for gpt-realtime-2.1-mini   (token mint 1689 ms)
> Error: SDP exchange failed: 429
>   "You have no credits remaining. Add credits to continue using the API"
> ```
>
> **Everything on our side worked.** The page served, the microphone was
> requested, the server minted a real ephemeral credential in 1.7 s, and the
> browser reached OpenAI. OpenAI refused at the point where the session would
> begin costing money.
>
> Confirmed independently of voice: a plain `chat/completions` call with
> `max_tokens: 1` returns the same `429 insufficient_quota` /
> `credit_balance_exhausted`. So this is an **account billing state**, not a
> Realtime problem, not an SDP problem, and not a bug in the page.
>
> **This is decision D3** — *"Voice for V1: skip, or fund ~$24/mo"* — arriving
> as a bill rather than as a question. Gate 1 cannot run at all until the
> account is funded at https://platform.openai.com/settings/organization/billing/.
> Nothing else is blocked by it: voice is the only thing in this build that
> uses OpenAI.

## What this cost the credential audit, and the lesson

`docs/credential-status.md` recorded `OPENAI_API_KEY` as **✅ WORKING**, with
the detail *"124 models, 10 realtime-capable"*. Every word was true. The key
authenticates, and listing models is a real call that really succeeded.

But listing does not **transact**, and Realtime voice has **no free tier** — so
for the only purpose this key serves, "WORKING" was wrong.

This is the **fourth** time this build has recorded a credential as fine when
it was not, and it is the same error one level deeper:

| # | what was recorded | what was true |
|---|---|---|
| 1 | `GOOGLE_CLIENT_ID` "present" | an empty string |
| 2 | `SUPABASE_DB_URL` "set" | its password had never authenticated |
| 3 | `SLACK_SIGNING_SECRET` "placeholder" | empty |
| 4 | `OPENAI_API_KEY` "WORKING" | authenticates, but cannot pay |

The first three were *presence* read as *working*. This one is *authenticates*
read as *can transact*. The general form: **a probe that only reads cannot
speak for a capability that only writes.**

The audit now has a fifth state, `💳 NO_QUOTA`, and probes OpenAI with a
one-token transacting call. It is deliberately not `❌` — the credential is
fine, the wallet is empty, and the fix is a payment rather than a rotation.
Sending someone to rotate a working key is its own kind of wasted afternoon.

The probe costs **nothing** while the account is unfunded, because the 429
arrives before any work is done. Once funded it is about **$0.000001** per run —
stated in the code rather than hidden, because a paid call from an automated
audit should be a quantified decision.

---

## When the account is funded

Everything below was verified before handing the POC over and still stands.
Press *Start talking* again; no redeploy is needed.

> §13: *"Claude must prepare the test but must never mark subjective acceptance
> PASS before Grant has actually performed it."*

This document records everything that could be verified without Grant, and
states plainly what cannot.

## The POC

**→ `https://ai-team-hq-voice-agentic-team-grant.vercel.app`**

> ⚠️ **The first URL handed over was broken**, and Grant found it: it served
> `content-type: text/plain`, so Safari showed the page source as a text file.
> Supabase forces `text/plain` on every response it serves —
> [ADR-0011](../../adr/0011-supabase-cannot-serve-html.md). The page now lives
> on Vercel; the mint endpoint stays on Supabase, where JSON is unaffected.

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
