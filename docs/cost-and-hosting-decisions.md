# Cost and hosting — corrected verdicts

**Date:** 2026-09-02
**Status:** answers to Grant's five questions. Decision-oriented; nothing here is chosen for you.

Three of my earlier conclusions were wrong. They are corrected below, with the
reasoning that produced the error stated plainly.

---

## 1. Vercel — corrected verdict

### Commercial use: I overstated this. Hobby is probably fine.

Current wording, verbatim, from **Fair Use Guidelines** (last updated
**2026-07-29**):

> **Hobby teams** are restricted to non-commercial personal use only. All
> commercial usage of the platform requires either a Pro or Enterprise plan.
>
> Commercial usage is defined as any Deployment that is used for the purpose of
> financial gain of **anyone** involved in **any part of the production** of the
> project, including a paid employee or consultant writing the code. Examples of
> this include, but are not limited to, the following:
>
> - Any method of requesting or processing payment from visitors of the site
> - Advertising the sale of a product or service
> - Receiving payment to create, update, or host the site
> - Affiliate linking is the primary purpose of the site
> - The inclusion of advertisements, including but not limited to online
>   advertising platforms like Google AdSense
>
> Asking for Donations fall under commercial usage.

**Applied to your actual case** — a personal, single-user, non-monetized tool:
**none of the five examples match.** No payments, no advertising, no
affiliate links, no donations, and you are not *receiving* payment to build it.
Every example concerns monetizing the deployment itself, not the subject matter
of private data held inside it.

**My error:** I quoted the broad definition clause and stopped, without testing
it against the enumerated examples or your stated facts. You were right to push
back — "manages some financial data" is not "used for the purpose of financial
gain."

**Residual ambiguity, stated honestly.** The clause *"financial gain of anyone
involved in any part of the production"* is broader than its examples, and
Vercel does not define where a private productivity tool sits. Vercel's own
remedy for this is explicit: *"If you are unsure whether or not your site would
be defined as commercial usage, please contact the Vercel Support team."*

> **Verdict: likely permissible, genuinely ambiguous at the margin.** A
> one-paragraph email to Vercel Support would settle it permanently and costs
> nothing. I recommend that over either assuming.

### Cron: unambiguous, and Hobby cannot do it

Verbatim from **Usage & Pricing for Cron Jobs** (last updated **2026-07-15**):

| | Cron jobs/project | **Minimum interval** | Scheduling precision |
|---|---|---|---|
| **Hobby** | 100 | **Once per day** | Per-hour (±59 min) |
| **Pro** | 100 | Once per minute | Per-minute |

> Hobby accounts are limited to cron jobs that run **once per day**. Cron
> expressions that would run more frequently will fail during deployment.
>
> Expressions like `0 * * * *` (per-hour) or `*/30 * * * *` (every 30 minutes)
> will fail deployment with the error: *Hobby accounts are limited to daily cron
> jobs. This cron expression would run more than once per day.*

So `*/10 * * * *` **fails at deploy time**. Not a judgement call.

### But this does not disqualify Vercel — you were right

**Vercel's cron limit constrains Vercel's own scheduler, not inbound HTTP.**
Nothing stops an external scheduler from calling a Vercel API route every ten
minutes. Verified free schedulers that can do this:

| Scheduler | Min interval | Cost | Role |
|---|---|---|---|
| **Cloudflare Workers Cron** | 1 min | $0 | **primary** |
| GitHub Actions schedule | 5 min | $0 (public repo) | fallback — note: auto-disabled after 60 days of repo inactivity |
| Supabase `pg_cron` + `pg_net` | 1 min | $0 | fallback, and doubles as DB keep-alive |
| cron-job.org | 1 min | $0 | last-resort external ping |

**Corrected verdict: Vercel Hobby is viable for the app.** Use it, and schedule
from a free external trigger. My earlier "disqualified on two grounds" was
wrong on the first ground and over-broad on the second.

---

## 2. Does anything genuinely require an always-on VM?

**No. Nothing does.** This was my clearest error, and it came from a
contradiction inside my own research that I failed to reconcile:

- My Notebook research established that `notebooklm-py` in master-token mode is
  **pure HTTP — no Playwright, no Chromium, no browser at runtime.**
- My hosting research was briefed on "browser-automation-based, may need
  Playwright" — a stale assumption I wrote before the Notebook finding landed —
  and duly recommended an Oracle VM to host a browser that is never launched.

Reconciled: the 10-minute Notebook sync is **a handful of HTTP calls finishing
in seconds**. That is a serverless function, not a persistent process.

**Verified tonight:** Vercel's Python runtime is **GA**, supports Python
**3.12 (default), 3.13, 3.14**, with FastAPI/Flask/Django presets and streaming
(docs last updated 2026-08-12). So the Python adapter can run on Vercel
alongside the frontend — one platform, no VM, no second provider.

**No Oracle VM. No Hetzner. Removed from the architecture.**

The only thing that would reintroduce a persistent container is if Gate 2 shows
master-token auth is unusable and we must fall back to browser-driven
automation. That is exactly the POC's job to decide, and per your instruction it
will not be assumed in advance.

**One thing to measure, not assume:** Hobby's fair-use guideline is *"Active CPU
up to 4 CPU-hrs"* per month. Active CPU measures real CPU time, not wall-clock
wait — and an HTTP-bound sync is nearly all waiting. 4,320 invocations/month sits
well inside the 1M invocation guideline. Should be comfortable, but it is a
number to measure in Phase 1 rather than trust.

---

## 3. Google AI Pro — what it actually buys

**You were right; I was wrong to call it mandatory.** I derived "8 agents can't
run on 50 chats/day" from an architecture where agents *converse with Notebook to
reason* — which is precisely the mistake you identified. Notebook is the
knowledge and artifact layer, not the inference engine.

### The design that fits the free tier

Notebook chat quota is only consumed by *asking Notebook questions*. It is not
consumed by reading source material. So:

1. **Pull each source's text once** via source fulltext/guide retrieval, and
   cache it in Postgres, fingerprinted.
2. **Agents reason over the cached text** using the normal inference provider.
   Zero Notebook quota.
3. **Reserve Notebook chats** for genuine cross-source synthesis where
   Notebook's own grounding beats ours — a handful per day, not hundreds.

Under that design, realistic usage is roughly **5–15 chats/day against a 50/day
limit**. Comfortable.

### Free tier vs Pro, honestly

| Capability | Free | Pro | Needed for V1? |
|---|---|---|---|
| Notebooks per user | 100 | 500 | **No** — 100 projects is plenty |
| **Sources per notebook** | **50** | 300 | ⚠️ **the real ceiling** |
| Chats/day | 50 | 500 | **No** — ~5–15/day under the design above |
| Deep Research | **10/month** | 20/day | **No** — use our own web research |
| Audio Overviews/day | 3 | 20 | **No** — voice notes use Chirp 3 TTS |
| Reports / Mind Maps/day | 10 | 100 | **No** — 10/day is ample |
| Watermark removal | No | No | n/a (Ultra only) |

**What Pro genuinely adds:** headroom on **sources per notebook** (50 → 300),
and Notebook-native Deep Research at usable volume.

**The 50-source ceiling is the only real constraint**, and it is not immediate —
it binds only once a single project accumulates 50 sources. Two mitigations
before paying: the free tier allows **100 notebooks**, so a large project can be
split across notebooks behind the adapter; and source retention can be curated
rather than accumulate indefinitely.

> **Verdict: Google AI Pro is OPTIONAL and deferred.** Start free. Revisit if and
> when a project approaches 50 sources or Notebook-native Deep Research proves
> genuinely better than ours. Reclassified from *mandatory* to *usage-dependent*.

---

## 4. Three inference configurations

Costs assume the researched workload: ~135 requests/day, ~2.4M tokens/day across
5 investigations with quality review. Addendum §8's consultation economics
reduces this materially — every avoided consultation is a request saved.

### Config A — genuinely free · **$0/month**

| | |
|---|---|
| Providers | OpenRouter `:free` (50 req/day), Gemini free, Cloudflare Workers AI, Groq free |
| Enforcement | `max_price` all-zero, `allow_fallbacks:false`, live free allow-list, cost circuit breaker |
| **Cost** | **$0**, no card, no one-off |

**Honest downsides:**

- **Request-starved.** Your OpenRouter key currently reports `is_free_tier: true`
  (verified tonight), which is the **50 requests/day** tier — against ~135
  needed. Requires throttling to roughly **1–2 investigations/day**.
- **Privacy is poor.** Google states free-tier content improves Google products
  and *"human reviewers may read, annotate, and process your API input and
  output"*. Many OpenRouter free endpoints exist *because* the provider harvests
  traffic — so `data_collection:"deny"` may empty the free registry.
- **Not suitable for confidential material.** Anything sensitive should be kept
  out, or routed to Config B.

**Use when:** the material is non-confidential and a slower, smaller team is
acceptable.

### Config B — privacy-preserving lowest cost · **~$3/month + $10 one-off** ⭐

| | |
|---|---|
| One-off | **$10** OpenRouter credit — unlocks **1,000 req/day** instead of 50 (**20× headroom**) |
| Model | `qwen3.7-flash` @ $0.03 / $0.13 per 1M, 1M context |
| Privacy | `data_collection: "deny"` enforced in the wrapper; no Gemini free tier |
| **Cost** | **≈ $2.83/month**, hard-capped |

**This is the best value in the whole analysis.** Roughly three dollars a month
buys 20× the request budget *and* removes the training/human-review exposure.
The $10 is a one-off, not recurring.

Every enforcement layer from the free-only design stays in place — a hard cap
means spend is bounded and never silent, which is what "never silently paid"
actually protects.

### Config C — premium · **~$8–32/month**

| | |
|---|---|
| Models | `deepseek-v4-flash` (~$4.36/mo) or `nemotron-3-super-120b` (~$8.25/mo) |
| Voice | + OpenAI Realtime `gpt-realtime-2.1-mini` ~$24/mo |
| **Cost** | **~$8/mo** inference-only, **~$32/mo** with voice |

**Use when:** analytical quality is worth more than the difference. Note the
jump from B to C is ~$5/month of inference — the expensive component is voice,
not thinking.

---

## 5. Voice — reclassified as optional premium

Per your instruction, OpenAI Realtime is **optional**, and the architecture stays
provider-agnostic behind a voice adapter. Model identifiers are configuration,
never hard-coded.

**Verified live tonight** against your OpenAI key: `gpt-realtime-2.1` and
`gpt-realtime-2.1-mini` are both present in the account's model list, alongside
the deprecated `gpt-realtime` / `gpt-realtime-mini`. That satisfies addendum §2's
requirement to confirm current models from the live API rather than from docs —
though it must be re-checked immediately before Gate 1.

| Option | Cost | Notes |
|---|---|---|
| **No voice for V1** | **$0** | Slack + Telegram + web. Voice deferred entirely. |
| Browser STT + our text agent + Chirp 3 TTS | **$0** | ⚠️ **UNVERIFIED** — see below |
| OpenAI Realtime `2.1-mini` | ~$24/mo | 30 min/day; sub-second, true barge-in |
| OpenAI Realtime `2.1` | ~$58/mo | premium |

> ⚠️ **The free voice path is not yet validated.** The research agent assigned to
> it was killed by the account spend limit before producing anything. I will not
> present an unverified $0 voice option as though it were real. Open questions:
> whether iOS Safari's `SpeechRecognition` supports continuous recognition,
> whether barge-in is achievable at all in a hand-rolled loop (it probably is
> not), and whether Gemini Live has a usable free tier. **Deferred to the Gate 1
> window.**

---

## 6. Costs, in the four classes you asked for

### Mandatory — **$0/month**

| Item | Cost |
|---|---|
| Supabase Free | $0 |
| Vercel Hobby (app + Python function) | $0 |
| External scheduler (Cloudflare/GitHub/pg_cron) | $0 |
| Cloudflare R2 backups | $0 |
| Slack Free | $0 |
| Telegram | $0 |
| Gemini Notebook Free | $0 |
| **Total mandatory** | **$0** |

**A fully working AI Team HQ costs nothing per month.** No mandatory
subscription exists.

### Optional

| Item | Cost | Buys |
|---|---|---|
| OpenRouter credit | **$10 one-off** | 50 → 1,000 req/day |
| Voice (Realtime mini) | ~$24/mo | live conversation |
| Google Cloud TTS | $0 | 1M chars/mo free |

### Usage-dependent

| Item | Trigger | Cost |
|---|---|---|
| Inference above free quota | >50 req/day | ~$3–8/mo |
| Supabase Pro | >500MB, or pausing becomes intolerable | $25/mo |
| Vercel Pro | Active-CPU guideline exceeded | $20/mo |

### Premium upgrades

| Item | Cost | Buys |
|---|---|---|
| Google AI Pro | ~$20/mo | 300 sources/notebook, Deep Research 20/day |
| Realtime full model | ~$58/mo | best voice |
| Stronger inference | ~$8/mo | better analysis |

---

## Revised monthly cost per configuration

| Configuration | Monthly | One-off |
|---|---|---|
| **A — free everything, no voice** | **$0** | $0 |
| **B — private inference, no voice** ⭐ | **~$3** | $10 |
| B + voice | ~$27 | $10 |
| C — premium inference + voice | ~$32 | $10 |
| C + Google AI Pro | ~$52 | $10 |

My earlier "~$54/month baseline" was the *top* row presented as the floor. The
actual floor is **$0**, and the recommended configuration is **~$3/month**.

---

## What I recommend, and what remains yours

**Recommended: Config B, no voice, Google AI Pro deferred → ~$3/month plus a $10
one-off.** It removes the privacy exposure that is the only serious objection to
free-only, buys 20× request headroom for the price of a coffee, and defers every
genuinely expensive decision until evidence justifies it.

Still yours to decide, and none blocks Phase 1:

1. **A, B, or C** for inference.
2. **Voice**: skip for V1, or fund ~$24/month — pending the unverified free path.
3. **Vercel Support email** to settle the Hobby ambiguity permanently.

---

## Corrections applied to Phase 0 documents

| Was | Now |
|---|---|
| Vercel disqualified on commercial-use grounds | Likely permissible; examples do not match your case |
| Vercel disqualified on cron | Cron limit is real, but irrelevant — schedule externally |
| Oracle Always Free VM required | **No VM required** — pure HTTP, Vercel Python function |
| Google AI Pro mandatory | **Optional**, usage-dependent on the 50-source ceiling |
| Baseline ~$54/month | **Floor $0**, recommended ~$3 |
| OpenAI Realtime assumed | Optional premium, behind a provider-agnostic adapter |
