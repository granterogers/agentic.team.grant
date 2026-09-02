# Feasibility validation

**Date:** 2026-09-02
**Status:** Phase 0 deliverable, per spec §32 (First Action)
**Method:** every named technology checked against current official
documentation. Evidence and source URLs in `docs/research/`.

---

> ### ⚠️ Superseded in part — read this first
>
> Grant's decisions and the Feasibility Audit Addendum (both 2026-09-02) revise
> parts of this document. Where they conflict, **they win**. Canonical:
> **`AI_TEAM_HQ_MASTER_SPEC.md`**; corrections in
> **`docs/cost-and-hosting-decisions.md`**.
>
> | This document said | Now |
> |---|---|
> | A1 iOS voice — open decision | **DECIDED**: foreground/screen-on is sufficient. No native iOS app. |
> | A2 inference — recommend capped $10/mo | **NOT accepted.** Three configs offered (A $0 / B ~$3 / C ~$8–32); Grant chooses. |
> | A4 Google AI Pro **required** | **Wrong — it is OPTIONAL.** Notebook is the knowledge layer, not the inference engine. |
> | Vercel disqualified | **Not disqualified.** Hobby is likely permissible; cron limit bypassed by external scheduler. |
> | Oracle Always Free VM required | **No VM required at all.** |
> | Baseline ~$54/mo | **Mandatory $0/mo**; recommended ~$3/mo. |
> | Slack: 3–5 separate staff apps | **ONE shared app for V1** (addendum §3). |
> | "four gates" | **FIVE gates** (addendum §4). |

## Overall verdict

**AI Team HQ is buildable substantially as specified.** No part of the design is
impossible. The architecture — canonical command layer, two sources of truth,
append-only ledger, durable jobs, provider abstraction — is sound and needs no
structural change.

Four assumptions do not survive contact with current reality. One is a product
decision only Grant can make; three have clear verified replacements.

| # | Assumption | Verdict | Resolution |
|---|---|---|---|
| **A1** | Mobile PWA supports continuous voice like ChatGPT Voice (§9) | ❌ **Invalid on iOS** | ✅ **RESOLVED** — Grant accepted foreground/screen-on. No native iOS app. Gate 1 amended. |
| **A2** | Free-tier-only secondary inference (§3, §11, principles 7–8) | ⚠️ **Fails on data terms, not cost** | ⏳ **OPEN** — three configs offered (A $0 / B ~$3 / C ~$8–32). Grant chooses; recommendation not accepted. |
| **A3** | `gpt-realtime` / `gpt-realtime-mini` (§3) | ❌ **Deprecated** | `gpt-realtime-2.1-mini`. Mechanical fix. |
| **A4** | Consumer Gemini Notebook tier is adequate (§3, §5) | ✅ **Adequate after redesign** | ~~Pro required~~ **wrong.** Cache source text; ~5–15 chats/day vs 50 limit. Pro deferred. |

Plus corrections that are mechanical rather than decisions: Socket Mode is
unsuitable, GitHub Models is retired, and the realtime token-minting endpoint
changed. (~~Vercel is unusable~~ — **retracted**; see the banner above.)

---

## 1. A1 — iOS voice is the one genuine product problem

**This is the most important finding in Phase 0**, because it is the only one
where the spec asks for something that cannot be delivered as described, and no
amount of engineering fixes it.

§9 specifies: Grant opens Team HQ on mobile, presses **Talk to Team**, *"browser
remains open"*, and converses naturally for 20+ minutes (Gate 1).

What actually happens on iOS:

- WebKit stops microphone capture when a **home-screen web app** leaves the
  foreground. The documented remedy is `UIBackgroundModes: audio` in
  `Info.plist` — **available only to native apps**, and a PWA cannot declare it.
  WebKit bug 226620 is closed as `CONFIGURATION CHANGED` on exactly this basis.
- A 2024 report on that bug states mic capture works in a **Safari tab** but
  fails in the **installed PWA**. So installing to the home screen makes this
  *worse*, which inverts the usual PWA assumption.

**Foreground, screen-on conversation works.** Gate 1's 20-minute test is passable
with the phone awake and the tab in front. What does not work is pocketing the
phone or locking the screen mid-conversation — which is what "talk naturally to
your Chief of Staff" implies in practice.

### Options

| Option | Consequence |
|---|---|
| **(a) Accept the limit** | Voice is a screen-on, in-app experience. Cheapest, ships now, and Gate 1 still passes. Telegram voice notes cover the away-from-screen case, which §18 already provides for. |
| **(b) Native shell later** | A thin native wrapper around the web app declaring the audio background mode. Real but deferrable scope; the web app stays the product. |
| **(c) Telephony** | Grant *calls* the team. Sidesteps browser audio entirely, adds per-minute cost and a new integration. |

**Recommendation: (a) now, (b) as a documented Phase 8+ option.** Building a
native shell in Phase 3 to satisfy Gate 1 would violate the spec's own
sequential-build discipline by pulling unplanned platform work into a POC gate.
Ship the honest web experience, and let real usage decide whether locked-screen
voice is worth a native app.

Gate 1's acceptance criteria should be amended to say **"foreground, screen-on"**
explicitly, so it tests something achievable rather than failing on a known
platform limit.

---

## 2. A2 — free-only inference fails, but not for the expected reason

Principles 7–8 require free-only secondary providers and no silent paid usage.
The spec anticipated **cost** as the constraint. It is not.

**The quota math works.** OpenRouter meters `:free` models by *requests*
(20 RPM / 1,000 RPD), not tokens. A realistic day — 5 investigations, agent
turns plus quality review, ~135 requests and ~2.4M tokens — fits with **7.4×
request headroom**.

**Two things break it:**

1. **Data terms.** Google states free-tier content is used to improve Google
   products and that *"human reviewers may read, annotate, and process your API
   input and output"* (except EEA/CH/UK). Many OpenRouter `:free` endpoints
   exist *because* the provider harvests the traffic — so setting
   `data_collection: "deny"` may **empty the free registry**. For a system
   handling private business strategy, this is disqualifying on its own.
2. **The 1,000 RPD tier requires a $10 lifetime credit purchase.** At the
   no-purchase tier of 50 RPD, the plan misses by 2.7×. So **the guarantee
   cannot rest on a zero balance** — there will be spendable credit on the
   account, which is precisely the condition principle 8 worries about.

Every other free provider is a rounding error, not a fallback: Groq free is
200k tokens/day with an **8,000 TPM ceiling that makes a single 35k-token
summarization impossible at any volume**; SambaNova allows 20 requests/day per
model; Cerebras replaced its free tier with a 30-day trial.

**The paid floor is trivially small.** At this volume: `qwen3.7-flash`
**$2.83/mo**, `deepseek-v4-flash-latest` **$4.36/mo**,
`nemotron-3-super-120b-a12b` **$8.25/mo**.

### Recommendation

**Adopt a hard-capped ~$10/month secondary budget. Keep every enforcement layer
the free-only rule implied.**

This honours what principle 8 is actually protecting — *never silently* spend —
while dropping a $0 target that costs more in privacy and reliability than the
few dollars it saves. The enforcement machinery is what matters, and it is
unchanged:

- `provider.max_price` with `allow_fallbacks: false` — documented to **prevent
  execution** when unmet, not merely derank.
- A dedicated API key with a hard `limit`, as an out-of-band backstop.
- Allow-list rebuilt from live `/api/v1/models`, router blacklist, and a
  post-response `usage.cost > 0` circuit breaker.
- All injected by the HTTP wrapper, never by callers.

**If Grant prefers strict $0**, it remains achievable — but the system must then
accept Google-tier data terms or a much weaker model mix, and should not be
given confidential material. That trade should be explicit, not discovered later.

Two live hazards found, worth stating because both are silent:

- **`openrouter/auto:free` still charges.** `:free` on a router is a no-op.
  `openrouter/free` is the only safe router.
- **`allow_fallbacks` defaults to `true` and `data_collection` defaults to
  `"allow"`.** Both defaults are wrong for this system.

**Remove GitHub Models from the spec** — fully retired 2026-07-30.

---

## 3. A3 — realtime model names are dead

| Spec says | Reality |
|---|---|
| `gpt-realtime` | deprecation-announced 2026-07-20, **removed from API 2027-01-20** |
| `gpt-realtime-mini` | same; already flagged "(Deprecated)" in the catalog |
| `gpt-4o-realtime-preview` | **shut down 2026-05-07** |

Current: **`gpt-realtime-2.1`** and **`gpt-realtime-2.1-mini`** (released
2026-07-06), both GA, both 128k context / 32k max output.

**Recommendation: `gpt-realtime-2.1-mini` as default**, full model for flows
needing stronger instruction-following. Benchmark both per Gate 1, as the spec
requires — but on the current models.

**Cost, verified twice against the official pricing table** (search results for
this are self-contradictory, having conflated the text and audio rows — use the
official table only):

| | 30 min/day |
|---|---|
| `gpt-realtime-2.1-mini` | **~$24/mo** |
| `gpt-realtime-2.1` | **~$58/mo** |

**Prompt caching is load-bearing.** Realtime is stateful and re-sends
accumulated context — ~1.2M tokens/day here, nearly all cache hits at $0.30–0.40
per 1M. Uncached, the full model would run ~$1,158/mo: a **20× blowup**. Any
cost model ignoring caching is wrong by more than an order of magnitude.

Two further corrections: token minting is now
**`/v1/realtime/client_secrets`** (`ek_` prefix, default TTL 600s, range
10–7200) with SDP exchange at **`/v1/realtime/calls`** — anything citing
`/v1/realtime/sessions` is stale. And the **session cap is 60 minutes, not 30**.

A point in WebRTC's favour beyond latency: it gets **automatic server-side
truncation of unplayed audio on interruption**, which WebSocket clients must
hand-roll via `conversation.item.truncate`. §3's WebRTC choice is correct.

---

## 4. A4 — the Notebook free tier cannot run this team

The approach itself is **valid and better-supported than expected**.
`notebooklm-py` is actively maintained (v0.8.1, 2026-08-14, ~2 releases/month,
MIT) and has a **master-token auth mode purpose-built for unattended headless
servers**: one human sign-in good for months, self-healing on expiry, **pure
HTTP with no Chromium**. That directly satisfies Gate 2's auth-refresh
requirement and *relaxes* the hosting requirement the spec implied.

Every Gate 2 operation is supported. NotebookLM is now named **Gemini Notebook**.

**But the free tier allows 50 chats/day, 3 audio overviews/day, and Deep
Research 10 per *month*.** Against 8 agents, 10-minute polling and up to 5
investigations/project/day, that is one busy afternoon. Deep Research at 10/month
makes a "Research Director" role nominal.

**Google AI Pro (500 chats/day, 20 Deep Research/day, 300 sources/notebook) is a
functional prerequisite** — a recurring cost the spec does not acknowledge.

Two secondary consequences:

- **No live usage counters exist.** Google exposes static plan limits only, so
  Notebook quota in the §12 dashboard **must** be locally accounted and labelled
  "estimated". §12 permits this; it is now mandatory. Read `AccountLimits.tier`
  at startup and derive budgets from the detected tier rather than hard-coding.
- **Artifact quotas change without notice** — documented precedent: on
  2025-11-25 infographics and slide decks went to 0 for free users with no doc
  update. So artifact generation must be **best-effort and never in a critical
  path**.

**Accepted risks, which Grant should see plainly:** this automates a consumer
Google product through undocumented endpoints. No stability guarantee, no
deprecation notice, no SLA. I found no authoritative Google ToS statement either
permitting or prohibiting it. §4's dedicated account contains the blast radius —
and there is a second, non-obvious reason for it: **that account must not be
browsed interactively while the worker runs**, or it rotates the worker's session
out from under it. That is a correctness argument, not just a security one.

The mitigation the spec already mandates is the right one: the adapter boundary.
It now has a **real migration target** — an official Gemini Notebook Enterprise
REST API exists — so the boundary is concrete rather than speculative.

---

## 5. Mechanical corrections

**Vercel is unusable on two independent grounds.** Its commercial-use
prohibition covers *"any Deployment used for the purpose of financial gain of
anyone involved… including a paid employee or consultant writing the code"*, and
**Hobby cron is capped at once per day** (±59 min) — `*/10 * * * *` fails at
deploy time. Either alone disqualifies it.

Netlify is also out: Free is 300 credits/month and **a production deploy costs
15**, so ~20 deploys exhaust the month before serving a request.

**Socket Mode is unsuitable.** It needs a persistently connected process, which
the chosen edge host cannot provide, and Slack recommends HTTP for production
anyway. Use the HTTP Events API; never request `connections:write`.

**`.secrets.local` does not exist in this project** and should not be
reintroduced. The spec removed it; the cloud environment's Environment variables
and API credentials replace it.

**Supabase Free has no backups whatsoever** — Supabase's own remedy is to run
`db dump` yourself. §24's nightly offsite dump is therefore **mandatory
infrastructure**, not prudence.

---

## 6. What validated cleanly

Worth stating, since most of the spec came through intact:

- **Canonical command layer** (§CMCA) — sound, and the cross-interface
  acceptance test is mechanisable as an automated equality assertion.
- **Two sources of truth** (§6) — correct, and the Notebook's fragility makes
  Supabase's authority more important, not less.
- **Append-only ledger and compensating-action rollback** (§21) — sound. Undo
  idempotency should be structural, keyed on the original `event_id`, not
  guarded in the Telegram handler, because Telegram *will* redeliver: its entire
  documented retry contract is one sentence with no retry count, backoff or
  ordering guarantee.
- **Durable job states** (§22) — sound. Postgres `SKIP LOCKED` is explicitly
  blessed by Postgres' own docs for queue tables. Note **pgmq's "exactly once"
  is scoped to the visibility timeout, not across retries**, and it has no
  dedup — the idempotency key is ours to own either way.
- **Eight Slack identities are possible.** Free allows 10 app installs including
  custom apps. Caveat: `username`/`icon_url` overrides still work but are
  **cosmetic only** — an overridden identity is not mentionable, not DM-able,
  and absent from the member list. Hence the tiered approach in the research.
- **Eight Telegram bots are fine**, and better than Slack for identity. Bot API
  9.4 (2026-02-09) added `setMyProfilePhoto`, so **only `/newbot` remains
  manual** — the spec's claim that avatars need BotFather is stale.
- **Free TTS is genuinely available.** Google Cloud TTS Chirp 3: HD gives
  **1M chars/month free perpetually**, 30 distinct `en-US-Chirp3-HD-*` voices,
  first-party terms, and emits `OGG_OPUS` natively so `sendVoice` needs **zero
  transcoding**. Fallback: Kokoro-82M, Apache-2.0, self-hosted.
  `edge-tts` was **rejected**, not caveated — it reverse-engineers a private
  Microsoft endpoint and Microsoft's own guidance says commercial use that way
  violates its terms. Piper also lost its former standing: relicensed GPL-3.0,
  and its docs state it is *"intended for personal use and text to speech
  research only"*.
- **A $0 24/7 deployment is achievable** — Vercel Hobby (app + Python sync
  function) or Cloudflare Workers, plus Supabase Free, an external free
  scheduler, and Cloudflare R2 for backups. **No VM.** Two remaining
  fragilities: Supabase pausing after ~1 week without *user* database activity,
  and Supabase's absent backups on Free.

---

## 7. Total realistic running cost

The spec never states a budget, so this is the number to react to:

| Item | Monthly |
|---|---|
| OpenAI Realtime — **optional premium** | $0 or ~$24 |
| ~~Google AI Pro~~ — **optional, deferred** | $0 |
| Secondary inference (Config A/B/C) | $0 / ~$3 / ~$8 |
| Hosting / DB / storage / backups | $0 |
| **Mandatory total** | **$0** |
| Recommended (private inference) | **~$3** + $10 one-off |

Strict-$0 secondary inference saves ~$10 and costs data privacy. Dropping voice
to text-only saves ~$24. Neither is recommended; both are available.

---

## 8. Open items carried into implementation

Honest list of what is *not* settled, so nothing is built on a false sense of
resolution:

1. **iOS voice product decision** (A1) — blocks Gate 1's acceptance wording.
2. **$0 versus hard-capped inference** (A2) — blocks the Phase 2 provider
   registry defaults.
3. **Async realtime tool-call wire mechanics** — behaviour confirmed in
   OpenAI's developer notes, absent from the reference guide. Verify empirically
   in Gate 1 before designing around it. Bears on how voice tools enqueue work
   without blocking.
4. **Gemini free-tier rate limits** — Google removed the published tables and
   they are now login-gated in AI Studio. Deliberately left UNVERIFIED rather
   than filled from third-party blogs, several of which cite non-existent
   models.
5. **Whether `data_collection: "deny"` empties the OpenRouter free registry** —
   untested, and the most likely way A2's free-only path fails in practice.
   Cheap to test in Phase 2 and should be tested first.
6. **iOS 26 PWA audio regressions** — multiple credible user reports, no Apple
   confirmation. Gate Phase 1 on a real-device smoke test.
7. **Notebook write-back reversibility per artifact type** — needs confirming
   before any write-back is offered with an Undo button.
8. **Echo cancellation on iOS** — the practical make-or-break for barge-in
   quality, untested. If the assistant interrupts itself, barge-in feels broken
   even when the API is behaving.

---

## Evidence

| Document | Covers |
|---|---|
| `docs/research/notebook-automation.md` | Gemini Notebook, `notebooklm-py`, quotas, auth |
| `docs/research/openai-realtime.md` | models, WebRTC, pricing, iOS constraints |
| `docs/research/platform-hosting.md` | Supabase, hosting, scheduling, queues, backups |
| `docs/research/slack-telegram.md` | Slack/Telegram identity, limits, TTS |
| `docs/research/secondary-inference.md` | free-tier inference, enforcement, token budget |
| `docs/research/claude-code-capabilities.md` | build-environment capabilities, secret stores |
| `docs/design/core-invariants.md` | command layer, ledger, jobs, quality gate |
| `docs/design/slack-app-lifecycle.md` | Slack app automation, config-token rotation |
