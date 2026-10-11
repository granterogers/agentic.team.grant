# Hermes integration: free runtime feasibility

Fixed decision 3: **zero additional cost** — no paid models, hosting, subscriptions or unverified metered services. This file says what
that rules in, what it rules out, and what Grant has to choose. Vendor facts were read on 11 October 2026 from the sources at the end;
they change, so each is re-checked at decision time.

## 1. What has to run, and where it cannot

| Piece | Needs | Can it run in what the office already has? |
|---|---|---|
| Office-side changes (tables, `engine` function, MCP and worker changes) | Postgres + Edge | **Yes.** Supabase free tier; a few MB a month (`INTERFACE-CONTRACTS.md` §2) and ≤ ~180,000 edge invocations a month for one idle bridge at the 15 s floor, against 500,000 included |
| Hermes API server | A long-lived Python 3.11–3.14 process with SQLite, ~minutes per run **[SRC pyproject.toml:15; api_server.py]** | **No.** The worker is Supabase Edge: Deno, 150 s wall clock, 2 s CPU, 256 MB **[REPO docs/agent-runtime-assessment-2026-09-17.md §2]**. Vercel Hobby functions: 60 s. Neither runs Python for minutes, and Hermes is a full application (18,000 files in the checkout), not a function |
| The bridge | A long-lived Node process, outbound HTTPS only | Not in Edge for the same reason; it lives beside Hermes |

So the office side is free, and **Hermes plus its bridge need one always-on machine** (or one that is on while the person wants Hermes).

## 2. Hosting options

| Option | Cash cost | Conditions | Verdict |
|---|---|---|---|
| **A. A machine Grant already owns** (Mac, PC, a spare box), running Hermes + bridge, outbound only | **£0** | Hermes is available only while that machine is on and online. No account, no card, no inbound port (HD-3) | **Verified free, and the recommended start for beta.** The 17 Sep assessment rejected a home machine for the OFFICE because the office's reliability would depend on it. That objection does not apply here: Hermes is an optional, manually chosen engine, its absence is shown in the composer, and the team is unaffected |
| B. Google Cloud always-free e2-micro (1 shared vCPU, 1 GB RAM, US regions only, 744 h/month) | £0 within limits | Requires a Google Cloud billing account with a card; any other region, a bigger machine or egress beyond the allowance bills | **Possible, unproven.** 1 GB RAM for Python Hermes + Node bridge is [ASSUMPTION V7]; must be measured in M0. "Free within limits behind a card" is a metered service and needs Grant's explicit yes (G1) |
| C. Oracle Cloud always-free Ampere A1 | £0 within limits | Card required; the allowance was reported reduced in 2026 from 4 OCPU / 24 GB to 2 OCPU / 12 GB, with sources disagreeing on dates and enforcement | **Capacity is ample; the terms are moving.** Same G1 question as B, with more uncertainty |
| D. GitHub Actions `workflow_dispatch` | £0 within 2,000 min/month | **Forbidden by Grant's standing instruction** ("stop using github actions completely … for any process"); also cold-starts Hermes on every run | Rejected unless he reopens it |
| E. Fly.io wake-on-demand | ~$0.50–3.50/month **[REPO assessment §3D]** | paid | Rejected by fixed decision 3 |
| F. Modal / Daytona sandboxes | free monthly credits, then metered | metered | Rejected (unverified metered service) |
| G. Supabase Edge / Vercel | — | runtime limits above | Infeasible |

**Recommendation:** A for beta, because it is the only option that is free with no account, no card and no metered service, and its one
weakness (availability) is already handled honestly by the design. Revisit B or C only if beta shows Hermes is worth having always on.

## 3. Models

The office's certified chain is **paid** OpenRouter models funded by a budget (`gpt-oss-120b → qwen3.7-flash → mistral-small-3.2`, the
free tier last) **[REPO migrations/0396…:1-30; CLAUDE.md]**. Hermes must not draw on it.

| Constraint | Source | Consequence |
|---|---|---|
| Hermes refuses a model with less than **64,000** context for tool use | **[SRC agent/model_metadata.py:272; agent/conversation_loop.py:428-445]** | only free models with ≥ 64K context and tool calling qualify |
| Free models are `:free` slugs; 20 requests a minute; **50 a day** for accounts with under $10 lifetime purchases, **1,000 a day** otherwise; limits are **per account**, not per key; a negative balance returns 402 even on free models | vendor-adjacent sources below; verify against OpenRouter's limits page (V5) | a separate new account would allow only ~50 calls a day (a Hermes run is several calls). The practical route is a **second key on the office's existing account** (which has bought credit, so 1,000/day), shared with the office's own free-tier use |
| A key can carry its own credit limit | [ASSUMPTION V6], OpenRouter key settings | set the Hermes key's limit to **0** so a paid model is refused rather than billed; M0 proves it by asking for a paid model and observing the refusal |
| Hermes's auxiliary lane (compression, titles, background review) can call other providers | **[SRC agent/auxiliary_client.py:1-8]** | `auxiliary.free_only: true`, `background_review.enabled: false` (until M8b); M0 observes zero non-free calls (V8) |
| Hermes reports token usage, not always cost | **[SRC api_server_runs.py:80-86]** | the office records `cost_usd 0` with provider `hermes`; a zero-credit key makes any non-zero cost impossible rather than merely unrecorded |

Budget guard: `engine.hermes.daily_runs` (default 20 per office) keeps Hermes from consuming the shared 1,000-a-day free allowance the office
also relies on. At an estimated 5–15 model calls a run, 20 runs is 100–300 calls (V5 measures the real figure).

**Data policy:** free-model providers may log prompts. Whether project content may go to them is Grant's decision (G2), and the office's
paid chain may be on different terms.

## 4. Other free-tier effects on the office

- Edge invocations: claims every 15–60 s per bridge, heartbeats every 5 s only during a run. Well inside the allowance; the 429 on fast
  claims stops a misbehaving bridge from changing that.
- Database: three small tables; one indexed claim query per poll. The Supabase host has had stalls (`CLAUDE.md`, October incidents); the
  bridge backs off on 503 and never retries in a tight loop.
- No GitHub Actions, no new paid dependency, no new third-party account beyond (optionally) a cloud VM under G1.

## 5. Verdict

**Feasible at zero additional cost** with: Hermes on hardware Grant already has (A), a zero-credit second OpenRouter key on the existing
account restricted to `:free` models, the auxiliary lane free-only, and a daily run ceiling. Always-on hosting at zero cost is possible
only on a card-backed always-free cloud tier, which is Grant's call (G1). Nothing in the office side costs money.

## Sources (read 11 October 2026)

- OpenRouter limits, as summarised by third parties (OpenRouter's own page did not appear in search; verify there):
  [OpenRouter blog: free LLM APIs compared](https://openrouter.ai/blog/tutorials/free-llm-apis-compared/),
  [benchlm: OpenRouter free models](https://benchlm.ai/md/free-tier/openrouter.md),
  [TrueFoundry: OpenRouter rate limits](https://www.truefoundry.com/es/blog/openrouter-rate-limits-your-free-tier-depends-on-what-youve-already-paid),
  [Novita: free LLM API comparison 2026](https://blogs.novita.ai/free-llm-api-comparison-2026/)
- Oracle always-free reduction: [InfoQ](https://infoq.com/news/2026/07/oracle-cloud-free-tier-limits/),
  [terminalbytes](https://terminalbytes.com/oracle-cloud-free-tier-changes-2026),
  [fullmetalbrackets](https://fullmetalbrackets.com/blog/oci-free-tier-breakdown)
- Google Cloud always free: [freetier.co](https://freetier.co/articles/cloud-provider-free-tiers-2026) (secondary; verify on Google's
  free-tier page)
- Supabase and Vercel limits: `docs/agent-runtime-assessment-2026-09-17.md` §2 (read from vendor docs on 17 Sep 2026)
