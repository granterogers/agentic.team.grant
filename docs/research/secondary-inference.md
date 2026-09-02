# Secondary Inference Layer — Phase 0 Feasibility Research

**Researched:** 2026-09-02. All figures fetched live from official sources on that date unless marked
UNVERIFIED. Provider free tiers change without notice — re-verify before any spending decision.

---

## Verdict

**PARTIALLY VIABLE — and not for the reason you'd expect.**

Three separate findings, in order of how much they should change the plan:

1. **The quota arithmetic works.** A realistic day (5 autonomous investigations, ~8 agents,
   ~2.4M input + ~250k output tokens across ~135 requests) fits inside OpenRouter's free-model
   allowance, because OpenRouter caps free models by **requests** (20 RPM / 1,000 RPD), not by
   tokens. No other free provider can absorb this volume: Groq free is capped at 200,000 tokens/day
   and 8,000 TPM, Cerebras at 1M tokens/day (and is now a 30-day trial, not a free tier),
   Cloudflare at ~375k input tokens/day on a 70B model, SambaNova at 20 requests/day per model.
2. **The 1,000 RPD tier requires a $10 lifetime credit purchase.** At 50 RPD (the un-purchased
   tier) the plan does *not* fit — 135 requests/day exceeds it by 2.7x. So the free-only plan
   still requires putting $10 of spendable balance on the account, which means the no-paid-spend
   guarantee **cannot** rest on a zero balance. It must rest on a per-key spend limit plus
   `provider.max_price`.
3. **The decisive problem is not cost, it is data.** Google states plainly that free-tier Gemini
   content is used to improve Google products and that "human reviewers may read, annotate, and
   process your API input and output." OpenRouter will only route to logging/training providers
   when the account's training toggle is on — and many `:free` endpoints exist precisely because
   the provider is harvesting the traffic. For a system handling private business data, "free tier"
   and "your data is not used for training" are close to mutually exclusive.

**And the paid floor is nearly free anyway.** At the day's volume, `qwen/qwen3.7-flash`
($0.03/$0.13 per M) costs **~$0.10/day, ~$3.20/month**; `deepseek-v4-flash-latest`
($0.05/$0.16) costs ~$0.16/day. A hard-capped $10/month budget buys a
non-training, non-rate-limited, non-churning provider set. The engineering effort required to
make free-only reliable is worth far more than $10/month.

**Recommendation:** keep the "never silently spend" rule (it is a good rule), implement it with
the enforcement mechanism below, but set the default budget to a **hard-capped small paid
allowance** rather than $0. Free models become the opportunistic first choice, not the only choice.

---

## 1. OpenRouter free models — current state

### The `:free` suffix

Still current and still the mechanism. `:free` is a **distinct model ID**, not a modifier — the
paid and free variants of the same underlying model are separate endpoints that "can differ in
rate limits, upstream provider routing, and data-handling terms." Sending to the non-suffixed ID
puts you on the paid path.
Source: <https://openrouter.ai/docs/guides/routing/model-variants/free>

There is also a **`openrouter/free` "Free Models Router"** (added ~Feb 2026): "a router that
selects free models at random from the models available on OpenRouter. The router smartly filters
for models that [match your request's needs]." 200k context, `pricing.prompt` and
`pricing.completion` both `"0"`.
Source: `GET https://openrouter.ai/api/v1/models`, id `openrouter/free`

### Free models available right now

Fetched live from `GET https://openrouter.ai/api/v1/models` on 2026-09-02: **423 models total,
18 with a `:free` suffix**, all with `pricing.prompt == "0"` and `pricing.completion == "0"`:

| Model ID | Context |
|---|---|
| `thinkingmachines/inkling:free` | 1,048,576 |
| `thinkingmachines/inkling-small:free` | 1,048,576 |
| `minimax/minimax-m3:free` (text+image+video in) | 1,048,576 |
| `nvidia/nemotron-3.5-lightning:free` | 1,000,000 |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 1,000,000 |
| `dots-studio/dots-3-note-preview:free` | 512,000 |
| `nvidia/nemotron-3-super-120b-a12b:free` | 262,144 |
| `google/gemma-4-31b-it:free` | 262,144 |
| `google/gemma-4-26b-a4b-it:free` | 262,144 |
| `inclusionai/ling-3.0-flash-fin:free` | 262,144 |
| `poolside/laguna-s-2.1:free` | 262,144 |
| `poolside/laguna-xs-2.1:free` | 262,144 |
| `cohere/north-mini-code:free` | 256,000 |
| `z-ai/glm-5.2:free` | 256,000 |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 256,000 |
| `minimax/minimax-m2.7:free` | 196,608 |
| `nvidia/nemotron-3.5-content-safety:free` | 128,000 |
| `liquid/lfm-2.5-2.6b:free` | 65,536 |

Note the churn: none of these IDs existed a year ago. **The registry must be built from the live
API, never hardcoded.**

### Rate limits on free models

Verified against the official limits doc:

- **20 requests per minute**, for all free variants.
- **50 requests per day** for accounts with **less than $10 in lifetime credit purchases**.
- **1,000 requests per day** for accounts with **$10 or more purchased (lifetime)**.

So yes — the 50/day vs 1,000/day rule at a **$10 lifetime purchase** threshold **still holds
exactly as remembered**, with the current numbers being 20 RPM / 50 RPD / 1,000 RPD.

No documented per-day *token* cap on free models — only the request caps.

Source: <https://openrouter.ai/docs/api_reference/limits>

---

## 2. Can OpenRouter guarantee no paid spend?

There is **no single account-level "free models only" switch.** The guarantee has to be assembled.
Ranked by how hard each mechanism actually is:

### Mechanism A — `provider.max_price` (the real in-band hard guarantee)

`provider.max_price` is an object: `{ prompt, completion, request?, image? }`, in dollars per
million tokens. Critically, the docs state that **`max_price` prevents the request from executing
if it cannot be met**, unlike the performance thresholds (`preferred_min_throughput`,
`preferred_max_latency`) which merely deprioritize non-compliant endpoints.

Setting every field to `0` therefore means: no endpoint that would charge anything can serve the
request; the request fails instead. This is the closest thing to a real guarantee.

```json
{
  "model": "z-ai/glm-5.2:free",
  "provider": {
    "max_price": { "prompt": 0, "completion": 0, "request": 0, "image": 0 },
    "allow_fallbacks": false
  }
}
```

Source: <https://openrouter.ai/docs/features/provider-routing>

Full current provider-routing parameter set (verified 2026-09-02): `provider.sort`
(`"price" | "throughput" | "latency"`, or `{by, partition}`), `provider.order` (string[]),
`provider.allow_fallbacks` (bool, default **true**), `provider.only` (string[]),
`provider.ignore` (string[]), `provider.max_price` (object), `provider.quantizations` (string[]),
`provider.zdr` (bool), `provider.require_parameters` (bool), `provider.data_collection`
(`"allow" | "deny"`, default **`"allow"`**), `provider.enforce_distillable_text` (bool),
`preferred_min_throughput`, `preferred_max_latency`.

Note the two dangerous defaults: **`allow_fallbacks` defaults to `true`** and
**`data_collection` defaults to `"allow"`**. Both must be set explicitly.

### Mechanism B — per-key spend limit (the backstop)

API keys accept a `limit` field: "spending limit for the API key in USD," plus `limit_reset`
(`daily | weekly | monthly | null`) and `include_byok_in_limit`. When usage reaches the limit the
key stops working until reset. The docs do not state whether `0` is accepted, so set a token
value such as `0.01` with `limit_reset: "monthly"` — any accidental paid route then dies rather
than accumulating.
Source: <https://openrouter.ai/docs/api-reference/api-keys/create-api-key>

This — not the balance — is the load-bearing backstop, because the $10 lifetime purchase needed
for the 1,000 RPD tier leaves spendable balance on the account.

### Mechanism C — a zero balance is NOT sufficient, and is actively risky

A **zero** balance is fine for free models (free models are usable with a $0 balance and no card).
But a **negative** balance produces 402 Payment Required **even on free models**: "If your account
has a negative credit balance, you may see [402] errors, including for free models."

So the failure mode is clean (402, not a charge) — but the balance is not a guarantee, because
free-model access itself breaks if the balance ever goes negative. Keep balance ≥ $0 and never
enable auto-top-up.
Source: <https://openrouter.ai/docs/api_reference/limits>

### Mechanism D — things that will silently charge you (do not use)

OpenRouter's own support article documents the trap directly: **`openrouter/auto:free` still
charges.** Adding `:free` to a *router* does nothing — `:free` only works on a specific model ID.
The Auto Router picks from its full set, paid models included, and bills you. Being charged for
`openrouter/auto` or `openrouter/auto:free` is "expected behavior, not a billing error."
Source: <https://openrouter.zendesk.com/hc/en-us/articles/51679572756123-I-used-openrouter-auto-free-or-auto-and-still-got-charged>
(403s to automated fetch; content verified via search-result excerpts and the docs above.)

Therefore: never `openrouter/auto`, never `openrouter/auto-beta`, never `openrouter/fusion`,
never a `models[]` fallback array containing a non-`:free` ID, never `route: "fallback"`.
`openrouter/free` (the Free Models Router) is the safe router; `openrouter/auto:free` is not.

---

## 3. Programmatic remaining-quota information

Both endpoints exist and return `401` unauthenticated (probed live 2026-09-02), confirming they
are live and key-gated.

### `GET https://openrouter.ai/api/v1/key`

Returns, per the limits doc: `limit` (credit cap on the key, `null` if unlimited),
`limit_remaining`, `limit_reset`, `usage` (all-time credits used), `usage_daily`, `usage_weekly`,
`usage_monthly`, `is_free_tier` (whether the user has purchased credits), BYOK usage fields, and
the key's label.

**This is the authoritative source for `is_free_tier`** — which is exactly the flag that tells the
dashboard whether the account is on 50 RPD or 1,000 RPD.

### `GET https://openrouter.ai/api/v1/credits`

Returns total credits purchased and total usage; balance = `total_credits - total_usage`.
Present and key-gated, though not documented on the limits page.

### Rate-limit headers

When **OpenRouter itself** (not an upstream provider) enforces the limit, the error response
carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`, plus `Retry-After`
when the provider suggests retry timing.

**Important limitation for the dashboard:** these headers appear on the *error* response, not on
successful calls. So remaining **requests-per-day** cannot be read authoritatively while things
are working — it must be counted client-side and reconciled against `X-RateLimit-Remaining` when
a 429 arrives. What *is* authoritative at any time: dollars spent (`usage_daily`) and tier
(`is_free_tier`).

Source: <https://openrouter.ai/docs/api_reference/limits>

---

## 4. Google Gemini free tier

### Which models have a free tier

Verified from the pricing page: **Gemini 3.8 Flash, 3.7 Flash, 3.6 Flash, 3.5 Flash,
3.5 Flash-Lite, 3.1 Flash-Lite, 2.5 Pro, 2.5 Flash, 2.5 Flash-Lite, Gemini Robotics ER 1.6
Preview, and the Gemini Embedding models** all show free-tier input/output.
Source: <https://ai.google.dev/gemini-api/docs/pricing>

Representative paid prices (per 1M tokens, in/out): Gemini 3.8 Flash **$0.75 / $3.75**;
Gemini 3.5 Flash **$1.50 / $9.00**; Gemini 3.5 Flash-Lite **$0.30 / $2.50**;
Gemini 3.1 Flash-Lite **$0.25 / $1.50**.

### Exact free-tier RPM / TPM / RPD — **UNVERIFIED**

**Google no longer publishes per-model free-tier rate limits.** The official rate-limits page
(fetched and scraped raw, last-updated stamp `2026-09-02 UTC`) now says only: *"Rate limits depend
on a variety of factors (such as your usage tier) and can be viewed in Google AI Studio"* and
*"Specified rate limits are not guaranteed and actual capacity may vary."* The only per-model
tables remaining on the page are **Batch enqueued tokens** by tier — and the Free tier has no
Batch table at all.

What I tried: WebFetch of `ai.google.dev/gemini-api/docs/rate-limits` (twice, different prompts);
raw `curl` + tag-strip of the same page to rule out JS-rendered tables (106KB of HTML, no free-tier
RPM/TPM/RPD table present); WebSearch, which returned only third-party blogs whose figures I will
not repeat — several of them do not even know the current model names, and the live pricing page
confirms models they claim don't exist. The real numbers are behind a login at
<https://aistudio.google.com/rate-limit>.

What the page *does* verify:

- The three dimensions are RPM, TPM (input), RPD. Limits are **per project, not per API key**.
  RPD quotas reset at **midnight Pacific**.
- Free tier qualification: "Active project or free trial." Free tier has **no** spend-based rate
  limit and **no** billing tier cap (Tier 1 = $250 cap, Tier 2 = $2,000, Tier 3 = $20,000+).
- Tier thresholds: Tier 1 = link an active billing account; Tier 2 = paid $100 + 3 days from first
  payment; Tier 3 = paid $1,000 + 30 days.
- Preview and experimental models have more restrictive limits.

Source: <https://ai.google.dev/gemini-api/docs/rate-limits>

### Regional availability

The free tier is not universally available. The Gemini API terms state: *"If you're in the
European Economic Area, Switzerland, or the United Kingdom, the terms under 'How Google uses Your
Data' in 'Paid Services' apply to all Services, including Google AI Studio and unpaid quota in the
Gemini API"* — i.e. EEA/CH/UK users get paid-tier data protections on the free tier.
Separately, the API is only offered in an enumerated list of countries and territories; the
available-regions page does **not** break availability down by tier
(<https://ai.google.dev/gemini-api/docs/available-regions>). Per-tier regional availability
outside EEA/CH/UK: **UNVERIFIED**.

### Data-usage caveat — the disqualifier for private business data

Directly from the terms, **Unpaid Services**:

> "Google uses the content you submit to the Services and any generated responses to provide,
> improve, and develop Google products and services"

> "Human reviewers may read, annotate, and process your API input and output."

Versus **Paid Services**:

> "Google doesn't use your prompts (including associated system instructions, cached content, and
> files such as images, videos, or documents) or responses to improve our products"

Source: <https://ai.google.dev/gemini-api/terms>

**Consequence:** unless the deployment is in the EEA, Switzerland, or the UK, routing private
business data through the Gemini free tier means submitting it for product improvement and
possible human review. This is a hard blocker, independent of quota. Gemini free tier should be
restricted to non-confidential work (public source material, synthetic tests) or used only on a
billed project.

---

## 5. Groq free tier

**Still free as of September 2026** — the rate-limits console doc has a live "Free Plan Limits"
tab, alongside Developer and Enterprise offerings.

Current **Free Plan** limits:

| Model | RPM | RPD | TPM | TPD |
|---|---|---|---|---|
| `openai/gpt-oss-120b` | 30 | 1,000 | 8,000 | 200,000 |
| `openai/gpt-oss-20b` | 30 | 1,000 | 8,000 | 200,000 |
| `qwen/qwen3.6-27b` | 30 | 1,000 | 8,000 | 200,000 |
| `groq/compound` | 30 | 250 | 70,000 | — |
| `groq/compound-mini` | 30 | 250 | 70,000 | — |
| `meta-llama/llama-prompt-guard-2-22m` | 30 | 14,400 | 15,000 | 500,000 |
| `meta-llama/llama-prompt-guard-2-86m` | 30 | 14,400 | 15,000 | 500,000 |
| `whisper-large-v3` | 20 | 2,000 | — | — |
| `canopylabs/orpheus-v1-english` | 10 | 100 | 1,200 | 3,600 |
| `canopylabs/orpheus-arabic-saudi` | 10 | 100 | 1,200 | 3,600 |

Source: <https://console.groq.com/docs/rate-limits>

**Two dealbreakers for this workload:**

1. **200,000 tokens/day** on the useful models is ~8% of a realistic day's 2.4M.
2. **8,000 TPM** means a single 35k-token source-summarization request **cannot be made at all** —
   one request exceeds the per-minute token budget. Groq free is structurally unable to do
   long-context summarization.

Groq free is only usable for **short, high-frequency, mechanical calls** (classification, routing,
extraction on small inputs) — a real but narrow role.

Groq paid prices (per 1M in/out): `openai/gpt-oss-120b` **$0.15 / $0.60**;
`openai/gpt-oss-20b` **$0.075 / $0.30**; both 131k context. Production models also include
`llama-3.3-70b-versatile` and `llama-3.1-8b-instant` (131k). Whisper Large V3 $0.111/hour,
Turbo $0.04/hour.
Source: <https://console.groq.com/docs/models>

---

## 6. Other free inference providers

| Provider | Current free allowance (verified) | Production-usable? |
|---|---|---|
| **Cloudflare Workers AI** | **10,000 Neurons/day at no charge**, on both Free and Paid Workers plans. Resets 00:00 UTC. Beyond that, **$0.011 / 1,000 Neurons**. Some premium models (Kimi K2.6, GLM-5.2/5.3, DeepSeek V4 variants) **require a paid billing method** and are not in the free allowance. Source: <https://developers.cloudflare.com/workers-ai/platform/pricing/> | **Partially.** Convert to tokens: `@cf/meta/llama-3.1-70b-instruct-fp8-fast` = 26,668 neurons/M input, 204,805 neurons/M output → 10k neurons ≈ **375k input tokens/day** or 49k output. `@cf/meta/llama-3.2-1b-instruct` = 2,457/M in, 18,252/M out → ≈ **4.07M input tokens/day**. Genuinely free forever, no card, but the capable models exhaust the allowance fast. Good overflow tier for classification. |
| **Cerebras** | **No standing free tier any more** — the pricing page now offers "**$5 in free credits after making an account**," access to all Cerebras models. Free Trial rate limits: `gpt-oss-120b` and `gemma-4-31b` at **5 RPM / 30,000 TPM / 1M TPH / 1M TPD**. Developer (pay-as-you-go, from $10) removes hourly/daily caps: `gpt-oss-120b` 1,000 RPM / 1M TPM. Sources: <https://www.cerebras.ai/pricing>, <https://inference-docs.cerebras.ai/support/rate-limits> | **No, as a free tier.** 1M TPD is the second-best free token allowance found, but it is a **trial credit, not a renewing free tier**. Do not architect around it. Excellent *cheap paid* option. |
| **SambaNova Cloud** | Free Tier (applies when **no payment method is linked**): **20 RPM / 20 RPD / 200,000 TPD**, per model, on `DeepSeek-V3.1`, `DeepSeek-V3.2`, `Meta-Llama-3.3-70B-Instruct`, `gpt-oss-120b`, `gemma-4-31B-it`. Developer Tier: 60 RPM / 12,000 RPD (Llama-3.3-70B: 240/48,000), 20M tokens/day across all models. Source: <https://docs.sambanova.ai/docs/en/models/rate-limits> | **Marginal.** The 200k TPD per model × 5 models ≈ 1M tokens/day is useful, but **20 requests per day per model** (~100 total) caps it hard. Only viable for a few large-batch summarization calls per day. |
| **Mistral La Plateforme** | A free "Experiment" tier reportedly still exists (no card required, rate-limited access to all models). **Exact limits UNVERIFIED.** What I tried: `docs.mistral.ai/deployment/laplateforme/tier/` → 404; WebSearch returned only third-party sources that themselves say "Mistral no longer publishes exact free-tier rate numbers publicly — check Admin Console → Limits." One source claims ~1B tokens/month and another claims ~1 RPM; these are irreconcilable and I will not record either as fact. | **Unknown.** Do not include in the registry until limits are read from the account console. |
| **Together AI** | Marketing says "Start for free, scale on demand." The pricing page lists exactly one model at **$0.00 in / $0.00 out — Ternary Bonsai 27B** — with no stated rate limits, and no documented free tier or signup credit. `api.together.xyz/models` carries no pricing. Sources: <https://www.together.ai/pricing>, <https://api.together.xyz/models> | **No.** No documented, dependable free allowance. Exclude. |
| **GitHub Models** | **RETIRED.** "GitHub Models has been fully retired. The playground, model catalog, inference API, and bring your own key (BYOK) are no longer available to any customer" — **fully retired as of July 30, 2026.** Migration path: Azure AI Foundry. Source: <https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models> | **No — service no longer exists.** Remove from any plan that mentions it. |
| **Hugging Face Inference Providers** | Monthly credits: **Free users $0.10** ("subject to change"), **PRO $2.00**, **Team/Enterprise $2.00 per seat**. No markup over provider list price. Credits do **not** apply when using a custom provider key. Source: <https://huggingface.co/docs/inference-providers/pricing> | **No.** $0.10/month is roughly 3M tokens of the very cheapest model — i.e. about one day, once. Not a tier, a demo. |
| **Cohere** | **Trial keys: 20 requests/minute across all Chat models, and 1,000 API calls per month** (this monthly cap also applies to production keys on newer Chat model variants). Production keys: 500 RPM on Command A / R+ / R / R7B / North Mini Code. Source: <https://docs.cohere.com/docs/rate-limits> | **No.** 1,000 calls/month ≈ 33/day, well under the ~135/day need. Note: the rate-limits page does **not** state a non-commercial restriction on trial keys — the widely-repeated claim that trial keys are non-commercial is **UNVERIFIED** from this page; check the Cohere ToS before relying on either reading. |
| **Vercel AI Gateway** | Every team account gets a free tier of AI Gateway Credits covering "a subset of models, not the full catalog," rate-limited per model below paid levels, returning `429` on exceed. **Exact free credit amount: UNVERIFIED** — the pricing page describes the free tier without stating the dollar figure. Critical caveat: "Once you purchase credits, your account transitions to the paid tier and **the monthly free credit no longer applies**." Zero markup on tokens. `budgets` exist for team/project/key/member spend caps. Source: <https://vercel.com/docs/ai-gateway/pricing> | **Unknown amount, but structurally sound.** Worth a slot as a secondary aggregator *if* the free credit is material — and its per-key budgets are a genuine enforcement primitive. Verify the amount in-console first. |
| **NVIDIA NIM (build.nvidia.com)** | Referenced by third-party comparisons as no-card free access with a credit allowance. **UNVERIFIED** — not checked against build.nvidia.com in this pass. | Unknown. |

---

## Recommended provider registry (priority order)

Assumes the enforcement mechanism below is in place. "Trust" = confidence the allowance still
exists in 90 days.

| # | Provider | Route | Free allowance | Role | Data-safe for private business data? | Trust |
|---|---|---|---|---|---|---|
| 1 | **OpenRouter (`:free` variants)** | `openrouter.ai/api/v1`, ID must end `:free`, `max_price` all-zero, `allow_fallbacks:false` | 20 RPM / 1,000 RPD (needs $10 lifetime purchase); **no token/day cap** | Primary for everything — the only free source that can absorb the token volume | **Conditional** — requires `data_collection:"deny"`; expect this to eliminate many `:free` endpoints (see Risks) | Medium — model roster churns monthly, so build from the live API |
| 2 | **OpenRouter (cheap paid, hard-capped)** | same, `max_price` set to a real ceiling, per-key `limit` | n/a — ~$3–10/month at this volume | The recommended actual default: `qwen/qwen3.7-flash`, `deepseek-v4-flash-latest`, `nemotron-3-super-120b-a12b` | Yes (paid endpoints, `zdr:true` available) | High |
| 3 | **Groq (Free Plan)** | `console.groq.com/openai/v1` | 30 RPM / 1,000 RPD / **8,000 TPM** / 200,000 TPD | **Short-input mechanical work only.** 8k TPM makes long-context impossible | Verify Groq's data terms separately — UNVERIFIED here | High — stable, long-running free plan |
| 4 | **Cloudflare Workers AI** | Workers AI REST / binding | 10,000 Neurons/day (≈4.07M input tok/day on a 1B model, ≈375k on a 70B) | Cheap classification and embedding overflow; small-model bulk work | Cloudflare data terms UNVERIFIED here | High — genuinely renewing, no card |
| 5 | **SambaNova (Free Tier)** | `api.sambanova.ai` | 20 RPM / **20 RPD per model** / 200,000 TPD per model, 5 models | A handful of big summarization calls per day; useful precisely because the per-request token budget is large and the request count is tiny | UNVERIFIED | Medium |
| 6 | **Cerebras (paid Developer)** | `api.cerebras.ai` | $5 trial credits only; free tier is gone | Burst speed when latency matters; treat as paid | UNVERIFIED | Medium |
| 7 | **Google Gemini free tier** | `generativelanguage.googleapis.com` | Exact RPM/TPM/RPD **UNVERIFIED** (login-gated in AI Studio) | **Non-confidential material only** — public sources, synthetic tests, evals | **NO** outside EEA/CH/UK — content used to improve Google products, human reviewers may read it | Medium |
| — | Vercel AI Gateway | — | amount UNVERIFIED | Candidate secondary aggregator; verify credit in-console | Yes (ZDR available, Pro+) | Unknown |
| — | Mistral / NVIDIA NIM | — | UNVERIFIED | Do not register until limits are read from the console | Unknown | Unknown |
| ✗ | GitHub Models | — | **Retired 2026-07-30** | Remove from the plan | — | — |
| ✗ | Hugging Face Inference | — | $0.10/month (Free) | Not a tier | — | — |
| ✗ | Cohere trial | — | 1,000 calls/month | Under the daily need | — | — |
| ✗ | Together AI | — | one $0 model, no documented tier | Exclude | — | — |

---

## Enforcement mechanism for the no-paid-spend rule

The rule cannot be enforced by one setting. Implement **all seven layers**; each catches a
different failure. Layers 3 and 4 are the ones that actually hold.

**1. Account posture (OpenRouter).**
Purchase exactly **$10** once, to unlock 1,000 RPD. Then: **auto-top-up OFF**, no stored card
beyond that purchase, balance never allowed negative (a negative balance 402s even free models).
Accept explicitly that this leaves ~$10 of spendable balance — the balance is *not* the guarantee.

**2. Dedicated, spend-capped API key.**
Create the agent key with `limit: 0.01`, `limit_reset: "monthly"`,
`include_byok_in_limit: true`. This caps total possible loss at one cent per month regardless of
any bug above it. (`0` is not documented as valid; `0.01` is the safe token value. If `0` is
accepted in practice, use it.) Never let the agents use a key without a `limit`.

**3. Per-request price ceiling — the hard in-band guarantee.**
Every single request, no exceptions, sends:

```json
"provider": {
  "max_price":      { "prompt": 0, "completion": 0, "request": 0, "image": 0 },
  "allow_fallbacks": false,
  "data_collection": "deny"
}
```

`max_price` is documented to **prevent execution** when unmet, rather than deranking. This must be
injected by the HTTP client wrapper, not by callers — no agent code should be able to omit it.
`allow_fallbacks` defaults to `true` and `data_collection` defaults to `"allow"`, so both must be
stated. Add `"zdr": true` for paid routes.

**4. Model allow-list, rebuilt from the live API.**
On boot and every N hours, `GET /api/v1/models`; admit an ID only if
`pricing.prompt === "0" && pricing.completion === "0"`. Assert membership at call time and reject
locally — never let a model string reach the wire unchecked. Rationale: today's 18 free IDs share
no names with last year's; a hardcoded list becomes a list of paid models.

**5. Router blacklist.**
Hard-reject these at the client, with a comment citing the support article:
`openrouter/auto`, `openrouter/auto-beta`, `openrouter/auto:free`, `openrouter/fusion`,
`openrouter/pareto-code`, `openrouter/bodybuilder`. Also reject any request carrying a `models[]`
fallback array whose entries are not all `:free`, and any `route: "fallback"`.
`openrouter/free` (the Free Models Router) is the one router that is safe.
Reason: **`openrouter/auto:free` charges you.** `:free` on a router is a no-op.

**6. Post-response cost assertion.**
Read `usage.cost` off every completion (or `GET /api/v1/generation`). If it is `> 0`: log loudly,
trip a circuit breaker that disables the provider for the process lifetime, and surface it in the
dashboard. A charge that reaches this layer means layers 3–5 have a hole; the system must stop
rather than continue.

**7. Dashboard reads authoritative numbers, not estimates.**
Poll `GET /api/v1/key` (cache ≥30–60s) for `usage_daily`, `usage`, `limit`, `limit_remaining`,
`is_free_tier` — `is_free_tier` is what determines whether the 50 or 1,000 RPD ceiling applies,
so read it rather than assuming. Poll `GET /api/v1/credits` for `total_credits - total_usage`.
Capture `X-RateLimit-Limit / -Remaining / -Reset` and `Retry-After` from **429 responses** and
reconcile against the client-side request counter — remaining RPD is not readable on success, so
the counter is primary and the headers are the correction.

**Non-OpenRouter providers.** Groq free plan: no card on file. Cloudflare: keep Workers AI on a
plan with no billing method, or accept the $0.011/1,000-neuron overage risk knowingly. SambaNova:
**do not link a payment method** — linking one is precisely what moves the account off the free
tier. Vercel: set per-key `budgets`, and note that purchasing credits permanently ends the free
monthly credit. Gemini: use a project with **no billing account** if free-tier limits are wanted —
but see the data caveat, which is the stronger reason to avoid it for private data.

---

## Token budget arithmetic

### A realistic day, built up explicitly

Per investigation, ~8 agents, one quality review:

| Stage | Calls | Input/call | Output/call | Input | Output |
|---|---|---|---|---|---|
| Source ingestion / summarization | 1 | 35,000 | 3,000 | 35,000 | 3,000 |
| Agent turns (8 agents × ~3 turns) | 24 | 15,000 | 1,500 | 360,000 | 36,000 |
| Quality review / critique | 2 | 20,000 | 3,000 | 40,000 | 6,000 |
| **Per investigation** | **27** | | | **435,000** | **45,000** |

Five investigations per day:

- **~135 requests/day**
- **~2,175,000 input tokens/day**
- **~225,000 output tokens/day**
- **~2.4M total tokens/day**, ~72M/month

(35k input per agent turn is conservative-low: it assumes summaries are shared rather than each
agent re-reading raw sources. If agents re-read source material, multiply input by 2–3x and the
conclusion below gets sharper, not softer.)

### Against each free quota

| Provider | Daily free capacity | Covers the day? |
|---|---|---|
| **OpenRouter `:free`** | 1,000 requests (no token cap) — need 135 | **Yes, 7.4x headroom on requests.** At 50 RPD (no $10 purchase): **no — need 2.7x the allowance** |
| **Groq free** | 200,000 tokens/day; **8,000 TPM** | **No — 8% of need**, and the 8k TPM ceiling makes a 35k-token call impossible at any volume |
| **Cerebras trial** | 1,000,000 tokens/day | ~42% of need — and it is a 30-day $5 trial, not a tier |
| **Cloudflare Workers AI** | ~375k input tok/day (70B) or ~4.07M (1B) | ~15% on a capable model; the 1B figure is fine for classification only |
| **SambaNova free** | 1M tokens/day across 5 models, but **100 requests/day total** | Token budget covers ~42%; the request cap allows only a handful of the 135 calls |
| **Gemini free** | UNVERIFIED (login-gated) | Cannot be stated. Also data-disqualified for private data |
| **HF free** | $0.10/month | ~0% |

**Conclusion:** exactly one free source can carry this workload — OpenRouter's `:free` variants,
and only on the 1,000 RPD tier. Everything else is a supplement measured in single-digit
percentages. A free-only design is therefore a **single-point-of-failure design** on a tier whose
model roster turns over every few months and whose endpoints are best-effort.

### The cheapest credible paid floor

Same 2.175M input + 225k output per day, at prices fetched live from
`GET https://openrouter.ai/api/v1/models` on 2026-09-02 (USD per 1M tokens):

| Model | In | Out | Context | $/day | $/month |
|---|---|---|---|---|---|
| `ibm-granite/granite-4.0-h-micro` | $0.017 | $0.112 | 131k | $0.062 | **$1.87** |
| `mistralai/mistral-nemo` | $0.019 | $0.030 | 131k | $0.048 | **$1.44** |
| `qwen/qwen3.7-flash` | $0.030 | $0.130 | 1M | $0.094 | **$2.83** |
| `openai/gpt-oss-120b` | $0.037 | $0.170 | 131k | $0.119 | **$3.57** |
| `~deepseek/deepseek-v4-flash-latest` | $0.050 | $0.160 | 1.31M | $0.145 | **$4.36** |
| `google/gemma-4-26b-a4b-it` | $0.070 | $0.340 | 262k | $0.229 | **$6.86** |
| `z-ai/glm-5.3-flash` | $0.075 | $0.250 | 1.31M | $0.219 | **$6.56** |
| `nvidia/nemotron-3-super-120b-a12b` | $0.085 | $0.400 | 1M | $0.275 | **$8.25** |
| `minimax/minimax-m3` | $0.300 | $1.200 | 1M | $0.923 | **$27.68** |
| `z-ai/glm-5.3` | $1.400 | $4.400 | 1.31M | $4.035 | **$121.05** |
| `google/gemini-3.8-flash` | $0.750 | $3.750 | 1M | $2.475 | **$74.25** |
| `anthropic/claude-haiku-4.5` | $1.000 | $5.000 | 200k | $3.300 | **$99.00** |

**The realistic paid floor is $3–9 per month** for a mixed registry
(`qwen3.7-flash` for classification, `deepseek-v4-flash-latest` or `glm-5.3-flash` for
summarization, `nemotron-3-super-120b-a12b` for reasoning). Even a wasteful 3x on the token
estimate lands under $30/month.

**This is the finding that should drive the decision.** The product rule "never *silently* spend
money" is sound and worth engineering for. The rule "spend $0 on secondary inference" costs more
in reliability and privacy than it saves in dollars — the amount saved is about the price of one
coffee per month. Set the default budget to a hard-capped $10/month with all seven enforcement
layers still in place (they are what makes the spend *never silent*), and treat free models as the
opportunistic first attempt with paid as the announced, capped, logged fallback.

---

## 8. Model recommendations by role

Prices per 1M tokens, from the live OpenRouter models API, 2026-09-02.

### (a) Long-context source summarization (20–50k tokens of source material)

- **Free first choice: `minimax/minimax-m3:free`** — 1,048,576 context, text+image+video input,
  supports `tools` / `response_format` / `structured_outputs`. Paid equivalent is $0.30/$1.20, so
  the free variant is a real capability, not a toy.
- **Free alternate: `nvidia/nemotron-3.5-lightning:free`** (1,000,000 ctx) or
  **`thinkingmachines/inkling:free`** (1,048,576 ctx).
- **Paid floor: `~deepseek/deepseek-v4-flash-latest`** — **$0.05 / $0.16**, 1,310,720 context.
  Cheapest million-token-class model in the catalog.
- **Paid step-up: `z-ai/glm-5.3-flash`** — **$0.075 / $0.25**, 1,310,720 context.
- **Do not use Groq here** — 8,000 TPM cannot pass a 35k-token prompt.

### (b) Analytical reasoning and critique (the quality-review agent)

- **Free first choice: `z-ai/glm-5.2:free`** — 256,000 ctx, native reasoning
  (`reasoning`, `reasoning_effort`), `structured_outputs`, `tools`. Design Arena agent Elo 1209
  (agentic game dev, rank 9) / 1263 (fullstack, rank 16). Paid equivalent $0.966/$3.036, so the
  free variant is the single best value in the free set.
- **Free alternate: `nvidia/nemotron-3-ultra-550b-a55b:free`** (1M ctx; paid $0.625/$3.125).
- **Paid floor: `nvidia/nemotron-3-super-120b-a12b`** — **$0.085 / $0.40**, 1M ctx,
  reasoning enabled by default with `low`/`medium` efforts. Artificial Analysis intelligence
  index 25.7 / coding 37.7 / **agentic 8.8** — that low agentic score is the caution: fine as a
  critic reading a finished draft, weak as a tool-driving agent.
- **Paid step-up when critique quality actually matters: `z-ai/glm-5.3`** — $1.40/$4.40 — or
  `moonshotai/kimi-k2-thinking` at $0.60/$2.50. Reserve for the final review pass only; at ~4
  calls/day a step-up model costs cents.

### (c) Cheap mechanical classification (routing, tagging, extraction)

- **Free first choice: `google/gemma-4-26b-a4b-it:free`** — 262,144 ctx (paid $0.07/$0.34).
- **Free alternate: `liquid/lfm-2.5-2.6b:free`** — 65,536 ctx, smallest and fastest.
- **Groq free is genuinely good here:** `openai/gpt-oss-20b`, 30 RPM / 1,000 RPD, 8k TPM — small
  inputs are exactly what that TPM ceiling permits.
- **Cloudflare free is also good here:** `@cf/meta/llama-3.2-1b-instruct` at 2,457 neurons/M
  input gives ~4M input tokens/day inside the 10,000-neuron allowance.
- **Paid floor: `qwen/qwen3.7-flash`** — **$0.03 / $0.13**, 1,000,000 ctx. Best
  price-to-context ratio in the catalog.
- **Absolute cheapest: `ibm-granite/granite-4.0-h-micro`** — **$0.017 / $0.112**, 131k ctx.

---

## Risks

1. **Free-only is a single-point-of-failure design.** Only OpenRouter `:free` can carry the token
   volume. If those endpoints are saturated (429/503 are routine on free capacity), the entire
   8-agent workforce stalls — there is no second free provider with the throughput to take over.
2. **`data_collection: "deny"` may empty the free registry.** Many `:free` endpoints exist because
   the provider harvests the traffic; OpenRouter "will not route to [logging] providers unless the
   model training toggle is switched on." Setting `data_collection:"deny"` and leaving the training
   toggle off is *correct* for private business data — and may leave very few free models
   reachable. **This combination is untested and must be measured before committing.** It is the
   most likely way the plan fails.
3. **Gemini free tier is data-disqualified.** Free-tier content is used to improve Google products
   and "human reviewers may read, annotate, and process your API input and output," except in the
   EEA, Switzerland, and the UK. Do not route private business data through it.
4. **The $10 purchase is unavoidable and leaves spendable balance.** 50 RPD does not fit the
   workload; 1,000 RPD requires $10 lifetime credits. The no-paid-spend guarantee therefore rests
   on the per-key `limit` and `max_price`, not on an empty wallet. If either is omitted from a code
   path, that $10 is reachable.
5. **`openrouter/auto:free` silently charges.** Documented by OpenRouter support as expected
   behavior. Any developer who reaches for "auto but free" will spend money. Enforce the router
   blacklist in code, not in a README.
6. **Free model IDs churn fast.** All 18 current `:free` IDs are recent; none match last year's
   names. A hardcoded registry silently degrades into either 404s or, worse, paid IDs.
7. **Gemini free-tier limits are unpublishable.** Google removed the per-model free-tier
   RPM/TPM/RPD tables and now says limits "are not guaranteed and actual capacity may vary." No
   dashboard can show authoritative Gemini free quota without scraping a logged-in AI Studio page.
8. **Remaining-RPD is not readable on success.** `X-RateLimit-*` appears only on limit errors, so
   the dashboard's request counter is an estimate between 429s. Label it as such; only dollar usage
   and `is_free_tier` are authoritative at all times.
9. **Providers are retiring free tiers.** GitHub Models fully retired 2026-07-30. Cerebras replaced
   its free tier with a 30-day $5 trial requiring a verified payment method. Assume any free tier
   in this document can vanish within a quarter, and that the registry needs a monthly re-audit.
10. **Free-tier quality is not free-tier-shaped.** `nemotron-3-super-120b-a12b` scores 8.8 on
    agentic index — cheap models that summarize acceptably can be materially worse at multi-turn
    tool use, which is exactly what an 8-agent workforce does. Budget for a paid model on the
    critique/final-review path even if everything else stays free.

---

## Sources

All fetched 2026-09-02.

**OpenRouter**
- Limits, free-model rate limits, 402 behavior, `/api/v1/key`, rate-limit headers — <https://openrouter.ai/docs/api_reference/limits> and <https://openrouter.ai/docs/api-reference/limits>
- Provider routing (`max_price`, `only`, `sort`, `allow_fallbacks`, `data_collection`, `zdr`) — <https://openrouter.ai/docs/features/provider-routing>
- `:free` variant semantics — <https://openrouter.ai/docs/guides/routing/model-variants/free>
- Model routing / Auto Router — <https://openrouter.ai/docs/features/model-routing>
- API key creation fields (`limit`, `limit_reset`, `include_byok_in_limit`) — <https://openrouter.ai/docs/api-reference/api-keys/create-api-key>
- Privacy and logging / training toggle — <https://openrouter.ai/docs/features/privacy-and-logging>, <https://openrouter.ai/docs/faq>
- `openrouter/auto:free` still charges — <https://openrouter.zendesk.com/hc/en-us/articles/51679572756123-I-used-openrouter-auto-free-or-auto-and-still-got-charged>
- Live model list, free-model IDs, and all per-model prices — `GET https://openrouter.ai/api/v1/models`
- Endpoint existence probes (401 unauthenticated) — `GET https://openrouter.ai/api/v1/key`, `GET https://openrouter.ai/api/v1/credits`

**Google Gemini**
- Rate limits, usage tiers, spend-based limits, batch tables (no free-tier RPM/TPM/RPD table) — <https://ai.google.dev/gemini-api/docs/rate-limits>
- Free-tier model list and paid prices — <https://ai.google.dev/gemini-api/docs/pricing>
- Data use, unpaid vs paid, human review, EEA/CH/UK exception — <https://ai.google.dev/gemini-api/terms>
- Available regions (no per-tier breakdown) — <https://ai.google.dev/gemini-api/docs/available-regions>

**Groq**
- Free plan rate limits per model — <https://console.groq.com/docs/rate-limits>
- Models and paid prices — <https://console.groq.com/docs/models>

**Other providers**
- Cloudflare Workers AI pricing, 10,000 neurons/day, per-model neuron rates — <https://developers.cloudflare.com/workers-ai/platform/pricing/>
- Cerebras pricing ($5 trial credits) — <https://www.cerebras.ai/pricing>
- Cerebras rate limits by tier — <https://inference-docs.cerebras.ai/support/rate-limits>
- SambaNova free/developer tier limits — <https://docs.sambanova.ai/docs/en/models/rate-limits>
- Hugging Face Inference Providers pricing/credits — <https://huggingface.co/docs/inference-providers/pricing>
- Cohere trial vs production rate limits — <https://docs.cohere.com/docs/rate-limits>
- Vercel AI Gateway pricing, free tier, budgets — <https://vercel.com/docs/ai-gateway/pricing>
- GitHub Models retirement — <https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models>
- Together AI pricing — <https://www.together.ai/pricing>, <https://api.together.xyz/models>

**Marked UNVERIFIED in this document**
Gemini free-tier RPM/TPM/RPD (login-gated in AI Studio); Gemini per-tier regional availability
outside the EEA/CH/UK statement; Mistral La Plateforme free-tier limits (docs URL 404s, official
figures no longer published); Vercel AI Gateway free credit dollar amount; NVIDIA NIM free
allowance; Cohere trial-key commercial-use restriction; Groq / Cloudflare / SambaNova data-training
terms.
