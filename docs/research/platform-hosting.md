# Phase 0 — Platform, Hosting, Scheduling & Durable-Job Substrate

**Research date: 2 September 2026.** Every figure below was fetched live from the
vendor's own docs/pricing page on that date. Anything that could not be confirmed
from a first-party source is marked **UNVERIFIED** with a note on what was tried.

Constraint being tested: an always-on multi-agent system, 24/7, surviving restarts,
strongly preferring free tiers.

---

## Verdict / recommended stack

| Layer | Recommendation | Cost | Why / key caveat |
|---|---|---|---|
| Postgres + auth + realtime | **Supabase Free** | $0 | 500 MB DB, 5 GB egress. **Pauses after ~1 week of no user DB activity** and has **zero automated backups** — both must be actively mitigated (external keep-alive ping + own `pg_dump`). |
| Scheduling (10 min) | **Cloudflare Cron Triggers** (primary) → **GitHub Actions schedule on a public repo** (fallback) | $0 | CF: minute granularity, 5 crons/account free, 15 min max scheduled-handler runtime. Doubles as the Supabase keep-alive pinger. GH Actions: 5 min minimum, explicitly "can be delayed", auto-disabled after 60 days of repo inactivity. |
| Next.js app (API routes: OpenAI ephemeral tokens, Telegram/Slack webhooks) | **Cloudflare Workers via `@opennextjs/cloudflare`** | $0 | 100k req/day free, commercial use permitted. Hard constraint: **10 ms CPU per invocation on Free** — fine for I/O-bound token minting and webhook ingest, risky for heavy SSR. **Vercel Hobby is disqualified: it forbids all commercial use.** |
| Long-running Python worker (Playwright/Chromium, every ~10 min) | **Oracle Cloud Always Free ARM VM** (2 OCPU / 12 GB / 200 GB / 10 TB egress) | $0 | Only genuinely-free always-on container/VM host left. Caveats: A1 capacity is often unobtainable, and **idle instances are reclaimed** (7-day 95th-pct CPU/network/memory all <20%). Fallback: **Hetzner CAX11 €5.99/mo**. |
| Durable job queue | **`pgmq` (Supabase Queues)** for transport **+ your own `job_runs` table keyed on an idempotency key** for effect-level exactly-once | $0 | pgmq gives visibility-timeout at-least-once + archive; it does **not** do dedup, so the idempotency key is yours to own. Hand-rolled `FOR UPDATE SKIP LOCKED` remains a legitimate alternative. |
| Off-site backup target | **Cloudflare R2** (10 GB-month, 1M Class A, 10M Class B, **egress free**) | $0 | Backblaze B2 (10 GB free, 3× egress) is the fallback. |

**Is a genuinely $0 24/7 deployment achievable?** Yes — Cloudflare Workers + OCI
Always Free VM + Supabase Free + R2 + Cloudflare Cron composes to $0/month with no
sleep and no request-scoped compute limits on the worker. It is achievable but
**fragile in three specific places**: Supabase inactivity pausing, Supabase's total
absence of backups on Free, and OCI's idle-reclamation + A1 capacity lottery.

**Realistic cost floor if free tiers prove insufficient: $31.53/month** (Supabase Pro
+ Hetzner CAX11), rising to **$51.53/month** if Cloudflare's 10 ms CPU ceiling forces
the app onto Vercel Pro. Itemised below.

---

## 1. Supabase Free tier

Source: <https://supabase.com/pricing> (fetched 2026-09-02)

| Resource | Free plan |
|---|---|
| Database size | **500 MB** (shared CPU, 500 MB RAM) |
| Egress | **5 GB** + 5 GB cached egress |
| MAU | **50,000** |
| File storage | **1 GB** |
| Realtime concurrent peak connections | **200** |
| Realtime messages / month | **2 million** |
| Edge Function invocations | **500,000** |
| Active projects | **max 2** |
| Log retention | 1 day |
| Automated backups | **None** |

### Pausing (critical)

- Pricing page, verbatim: **"Free projects are paused after 1 week of inactivity."**
  (<https://supabase.com/pricing>)
- Production-readiness guide, verbatim: **"We may pause applications on the Free Plan
  that exhibit low activity in a 7-day period to save on server resources"** and
  *"Upgrade to Pro to guarantee that we won't pause your project for inactivity."*
  (<https://supabase.com/docs/guides/platform/going-into-prod>)
- Project-pausing doc, verbatim: **"A Free plan project is considered inactive if it
  does not receive sufficient user database activity over the past week"** and
  **"Typically a few user requests to the database each day over the previous week is
  enough to keep the project from being paused."** A paused project can be restored
  from the dashboard **for up to 1 year** and returns to its previous state including
  data and configuration.
  (<https://supabase.com/docs/guides/platform/free-project-pausing>)

**What counts as activity:** the official wording is *"user database activity"* /
*"user requests to the database"*. It is therefore externally-originated API/DB
traffic. **Whether an internal `pg_cron` job counts is not addressed anywhere in
Supabase's own docs — treat it as NOT counting.** Multiple third-party write-ups
assert internal `pg_cron` does not prevent a pause, but that is **UNVERIFIED**
against a first-party source (searched supabase.com docs for a plan-level statement;
none exists). Design accordingly: the keep-alive ping must arrive from **outside** the
project (Cloudflare Cron → PostgREST/Edge Function), which the architecture already
provides.

### Backups on Free

Verbatim from <https://supabase.com/docs/guides/platform/backups>: *"We automatically
back up all Pro, Team, and Enterprise Plan projects on a daily basis."* Free plan
projects get **no daily backups and no PITR**; the doc explicitly instructs Free users
to *"regularly export their data using the Supabase CLI `db dump` command."* PITR is a
Pro+ add-on at **$0.137/hr (~$100/mo) for 7 days**, $0.274/hr (~$200/mo) for 14 days,
$0.55/hr (~$400/mo) for 28 days.

### Cheapest paid tier

**Pro — $25/month** (<https://supabase.com/pricing>). What it changes: **never
paused**; **7 days of daily backups**; 8 GB DB (vs 500 MB); 250 GB egress (vs 5 GB);
100 GB file storage (vs 1 GB); 100k MAU; 7-day log retention; email support; includes
**$10/month of compute credits** which covers one Micro instance.

---

## 2. `pg_cron`, `pg_net`, Supabase Cron & Queues on Free

- **Supabase Cron** is a first-party Postgres Module wrapping **`pg_cron`**: *"a
  Postgres Module that simplifies scheduling recurring Jobs with cron syntax and
  monitoring Job runs inside Postgres."* Jobs can run *"anywhere from every second to
  once a year"*, and can run SQL/plpgsql with zero network latency **or make an HTTP
  request such as invoking a Supabase Edge Function**.
  (<https://supabase.com/docs/guides/cron>)
- **`pg_net`** is available and is the documented async-HTTP mechanism. Limits:
  default request timeout **2,000 ms**, responses retained in `net._http_response` for
  **6 hours**, designed for **up to 200 requests/second**, JSON bodies only, no
  PATCH/PUT, and the response tables are **unlogged** (not crash-durable). The docs
  explicitly show the `pg_cron` + `pg_net` combination to *"schedule regular calls with
  up to a minute precision to endpoints."*
  (<https://supabase.com/docs/guides/database/extensions/pg_net>)
- **Supabase Queues** is *"a Postgres-native durable Message Queue system with
  guaranteed delivery"* built on the **`pgmq`** extension, with *"exactly-once delivery
  within a customizable visibility window"* and optional archival. Enabled by turning
  on the `pgmq` extension under Integrations (requires Postgres ≥ 15.6.1.143), then
  creating queues in the dashboard. Consumable via direct Postgres clients or, after
  opting in to *"Expose Queues via PostgREST"*, via the Data API through the
  `pgmq_public` schema.
  (<https://supabase.com/docs/guides/queues>,
  <https://supabase.com/docs/guides/queues/quickstart>)

**Free-tier availability:** No plan gating for `pg_cron`, `pg_net`, `pgmq`, Supabase
Cron or Supabase Queues appears anywhere in Supabase's extension, cron, queues or
pricing documentation — they are project-level Postgres extensions, and neither the
pricing table nor the feature docs list them as paid-plan features. An explicit
first-party sentence saying "available on Free" **does not exist**, so strictly this is
**UNVERIFIED** (checked /pricing, /docs/guides/cron, /docs/guides/queues,
/docs/guides/queues/quickstart, /docs/guides/database/extensions,
/docs/guides/database/extensions/pg_net; searched for plan-availability statements).
Practical reading: yes, all four work on Free.

**Can scheduled work run entirely inside Postgres?** Technically yes — `pg_cron` +
`pg_net` + `pgmq` is a complete in-database scheduler/queue. But on the Free plan it is
**not a safe 24/7 substrate**, because when the project pauses, the database stops and
`pg_cron` stops with it, and internal cron activity is not credited as the "user
database activity" that prevents pausing. In-Postgres scheduling must therefore be
paired with an external heartbeat.

---

## 3. Hosting the Next.js app

### Vercel Hobby — **disqualified for commercial use**

Sources: <https://vercel.com/docs/limits/fair-use-guidelines>,
<https://vercel.com/docs/plans/hobby>, <https://vercel.com/docs/limits>

Typical monthly usage guidelines (Hobby): Fast Data Transfer **up to 100 GB**; Fast
Origin Transfer **up to 10 GB**; Active CPU **up to 4 CPU-hrs**; Provisioned Memory
**up to 360 GB-hrs**; Function Invocations **up to 1M**; Image transformations up to
5K; image cache reads 300K / writes 100K.

General limits (Hobby): **200 projects**, **100 deployments/day**, **100 builds/hour**,
**build time per deployment 45 min**, **1 concurrent build**, 2 build vCPUs / 8 GB
build memory / 32 GB disk, 50 domains per project, **1 hour of runtime logs**.
Function max duration on Hobby is **300 s (5 min)** on the current Fluid-compute
model; legacy (pre-2025-04-23, non-Fluid) projects are capped at **60 s** on Hobby.
Proxied-request timeout 120 s on every plan.

Commercial-use text, verbatim: **"Hobby teams are restricted to non-commercial
personal use only. All commercial usage of the platform requires either a Pro or
Enterprise plan. Commercial usage is defined as any Deployment that is used for the
purpose of financial gain of anyone involved in any part of the production of the
project, including a paid employee or consultant writing the code."** Asking for
donations also counts. Also: *"Vercel does not support connecting a project on your
Hobby team to Git repositories owned by Git organizations."*

**Consequence for this project:** an internal business system built by a paid employee
is squarely inside Vercel's definition of commercial usage. **Vercel Hobby cannot be
used.** Pro is **$20 per developer seat/month**.

Additional disqualifier for the scheduler role: **Hobby cron jobs are limited to once
per day**, with **±59 minutes** of scheduling imprecision; a `*/10 * * * *` expression
**fails at deployment time**. Pro allows once-per-minute with per-minute precision.
(<https://vercel.com/docs/cron-jobs/usage-and-pricing>)

### Cloudflare Workers / Pages — **recommended**

Sources: <https://developers.cloudflare.com/workers/platform/pricing/>,
<https://developers.cloudflare.com/workers/platform/limits/>,
<https://developers.cloudflare.com/pages/platform/limits/>

| Limit | Free | Paid ($5/mo min) |
|---|---|---|
| Requests | **100,000/day** | 10M/mo included, then $0.30/M |
| CPU time per invocation | **10 ms** | 5 min max (30 s default); 30M CPU-ms/mo included, then $0.02/M |
| Subrequests per invocation | **50** | 10,000 |
| Worker script size (gzipped) | **3 MB** | 10 MB |
| Cron Triggers per account | **5** | 250 |
| Scheduled-handler max duration | **15 min** | 15 min |
| Workers per account | 100 | 500 |
| Workers KV | 100k reads/day, 1k writes/day, 1k deletes/day, 1k list/day, 1 GB stored | usage-based |
| Pages builds | **500/month, 1 concurrent**, 20 min build timeout, 20,000 files/site, 25 MiB max file | higher |

Bandwidth on Workers/Pages is **not metered** (requests are the meter). Duration is
not billed on HTTP requests — only CPU time.

**Commercial use:** the Workers pricing and limits docs contain **no prohibition** on
commercial use, in contrast to Vercel's explicit ban, and Cloudflare's free developer
platform is widely used commercially. An explicit first-party "commercial use is
allowed" sentence was **not found** — **UNVERIFIED** (checked Workers pricing, Workers
limits, Pages limits; the general self-serve ToS restriction that matters is on serving
disproportionate volumes of large non-HTML content, not on commerciality).

**Suitability for the required API routes:** good. Minting OpenAI ephemeral tokens and
receiving Telegram/Slack webhooks are network-I/O-bound; **time spent awaiting the
network does not count as CPU time**, so the 10 ms CPU budget is realistic for these
handlers. Risks: the **50-subrequest/invocation** cap on Free, and heavy React SSR
plausibly exceeding 10 ms CPU per render.

**OpenNext / `@opennextjs/cloudflare` readiness:** the adapter now supports **all minor
and patch versions of Next.js 16 and the latest minors of Next.js 14 and 15** (Next.js
14 support ends Q1 2026). **ISR, PPR, middleware, image optimization, App Router,
Route Handlers, SSG/SSR and the Node.js runtime are all supported**; the notable
remaining gap is **Node Middleware** (the Next.js 15.2 feature). The docs do not print
a formal "GA" badge — **UNVERIFIED** as an explicit GA declaration — but the feature
matrix is production-grade. Watch the **3 MiB gzipped Worker size limit on Free**, which
is the practical ceiling for a Next.js bundle.
(<https://opennext.js.org/cloudflare>)

### Netlify — **not recommended (credit model is hostile to this workload)**

Sources: <https://www.netlify.com/pricing/>,
<https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/>

Netlify moved to a **credit** model. **Free plan = 300 credits/month, a hard limit
with no option to purchase more.** Conversion rates:

| Resource | Credits |
|---|---|
| Production deploy | **15 credits each** |
| Compute (Functions, preview servers, Agent Runners, Database) | **10 credits per GB-hour** |
| Bandwidth | **20 credits per GB** |
| Web requests (edge functions included here) | **2 credits per 10,000** |
| AI inference | 180 credits per $1 of model usage |
| Form submissions, deploy previews, branch deploys | free |

Build minutes and function invocations are **no longer separate metrics** under the
credit model. When the balance is exhausted: *"all of your web projects (sites/apps)
are paused and visitors to your web projects will find a `Site not available` page at
each of your web project's URLs."* Next paid tier: **Personal, $9/month, 1,000
credits**.

**Why this kills it:** 20 production deploys/month = 300 credits = the entire free
allowance, before a single request is served. Third-party summaries still quote "100 GB
bandwidth / 300 build minutes / 125,000 function invocations" for Free — that is the
**pre-credit** structure and is **not** what the current first-party docs describe.
Netlify's own support forums additionally show a July–September 2026 cluster of Free-plan
accounts stuck on "operational credits" with production deploys blocked despite unused
credits (<https://answers.netlify.com/t/free-plan-stuck-on-operational-credits-despite-0-300-credits-used/167778>).

**Winner for this app: Cloudflare Workers (OpenNext).** It is the only one of the three
with a free tier that permits commercial use, does not sleep, and offers
minute-granularity cron on the free plan.

---

## 4. Hosting the long-running Python / Playwright worker

| Platform | Genuinely free in Sept 2026? | Long-running container? | Headless Chromium? | Sleeps/idles? |
|---|---|---|---|---|
| **Oracle Cloud Always Free** | **Yes** | Yes — a real VM | Yes | No, but **idle reclamation applies** |
| **Google Cloud Run** | Yes, but **request-scoped** free tier | Services are request-scoped (60 min max request); Jobs up to 168 h | Yes (custom container) | Scales to zero; min-instances is billable |
| **GCP Compute Engine e2-micro** | **Yes** (1 VM, always free) | Yes | Technically, but 1 GB RAM is very tight | No |
| **Fly.io** | **No — free tier REMOVED** | Yes | Yes | Auto-stop/start optional |
| **Railway** | **No — only a one-time $5 trial credit** | Yes | Yes | No (stopped services cost nothing) |
| **Render** | Yes for web services/static, **but background workers and cron jobs are NOT available on free** | Free web services only | Yes | **Spins down after 15 min idle** |
| **Hetzner Cloud** | No (cheap, not free) | Yes | Yes | No |

### Oracle Cloud Always Free — recommended primary

Source: <https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm>

- **Ampere A1 (ARM): 1,500 OCPU-hours + 9,000 GB-hours per month**, i.e. **2 OCPUs and
  12 GB of memory** run continuously for a whole month, free, forever.
- **2 × AMD `VM.Standard.E2.1.Micro`** instances per tenancy.
- **200 GB total block volume** storage in the home region.
- **10 TB/month outbound data transfer.**
- **Idle reclamation:** Oracle may reclaim an Always Free compute instance if, over a
  **7-day period**, *all* of: 95th-percentile CPU utilisation **< 20%**, network
  utilisation **< 20%**, and (A1 shapes only) memory utilisation **< 20%**.

**Recent change worth knowing:** the A1 Always Free allowance was **halved from 4
OCPU/24 GB to 2 OCPU/12 GB effective 15 June 2026**, with instances above the new limit
terminated from 18 August 2026, and with no public announcement from Oracle
(<https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/>). Pay-as-you-go
tenancies reportedly retain 4 OCPU/24 GB free — **UNVERIFIED** against Oracle's own
docs. The current 2 OCPU/12 GB figure **is** first-party.

2 OCPU / 12 GB is comfortably enough for headless Chromium plus a Python worker. A
10-minute Playwright cycle plausibly keeps 95th-percentile CPU above 20%, but it is not
guaranteed — mitigate deliberately (see Risks).

### Google Cloud Run

Source: <https://docs.cloud.google.com/free/docs/free-cloud-features>,
<https://docs.cloud.google.com/run/quotas>

Always Free: **2 million requests/month**, **360,000 GB-seconds of memory**, **180,000
vCPU-seconds of compute**, **1 GB outbound data transfer from North America/month**.
The free-tier page states the limits **apply to request-based billing**; instance-based
billing (i.e. `min-instances` / always-allocated CPU, which is what an always-on worker
needs) is described separately and is **not** covered. Whether **Cloud Run jobs** usage
draws on the same free tier is **UNVERIFIED** — the always-free page does not mention
jobs, and repeated fetches of `cloud.google.com/run/pricing` returned truncated content
from which the free-tier section could not be read verbatim (tried both
`cloud.google.com/run/pricing` and `docs.cloud.google.com/run/pricing`; the latter
301s back to the former). **Per-unit tier-1 CPU-second / GiB-second prices: UNVERIFIED
for the same reason.**

Limits that do matter and are verified: **max request timeout 60 minutes** for
services; **max job task timeout 168 hours (7 days)**, or 1 hour with GPUs; instances
auto-restart after **7 days** of continuous execution.

Budget arithmetic for a 10-minute cadence: 4,320 runs/month. 180,000 vCPU-s ÷ 4,320 =
**~41 vCPU-seconds per run** at 1 vCPU; 360,000 GB-s ÷ 4,320 = **~83 GB-s per run**,
i.e. ~41 s at 2 GiB. A Chromium cold start plus navigation can plausibly fit in ~40 s,
but there is no headroom. Viable as a **fallback**, not a primary.

### Fly.io — free tier removed

Fly's own pricing page documents **no free allowance**; the cheapest compute is
`shared-cpu-1x` 256 MB at **$0.00000078/second ≈ $2.02/month** (Amsterdam), egress
**$0.02/GB** in NA/EU, inbound free. The page mentions a "Free Trial" without terms and
"first 10 single-hostname certificates are free"
(<https://fly.io/docs/about/pricing/>). Third-party sources date the removal of free
allowances for new organisations to **7 October 2024**, with legacy Hobby/Launch/Scale
customers grandfathered — the *date* is **UNVERIFIED** first-party, but the *absence*
of a free tier is verified from Fly's own pricing page.

### Railway — no free tier

Free Trial is *"a one-time grant of $5 in credits… expires in 30 days"*. **Hobby is
$5/month including $5 of monthly usage credits.** Rates: **RAM $0.00000386/GB-s (~$10
per GB/month)**, **CPU $0.00000772/vCPU-s (~$20 per vCPU/month)**. Services do not
sleep; stopped services cost nothing. (<https://railway.com/pricing>)

A 2 GB / 1 vCPU always-on worker ≈ $40/month of usage against a $5 credit — Railway is
the most expensive option here for a 24/7 worker.

### Render — free tier exists but excludes exactly what we need

Source: <https://render.com/docs/free>

- **750 free instance hours per workspace per calendar month**, no rollover.
- Free tier covers **web services, static sites, Postgres, Key Value** — *"Background
  workers and cron jobs do not support free instances."*
- Free web services **spin down after 15 minutes without inbound traffic**; spin-up
  takes ~1 minute.
- Free Postgres: **1 GB fixed storage, expires 30 days after creation** + 14-day grace
  period. One free Postgres and one free Key Value per workspace. Free Key Value does
  not persist across restarts. Free web services cannot use persistent disks.
- Included outbound bandwidth and build-pipeline minutes exist but the doc does not
  state the quantities — **UNVERIFIED**.

Cheapest paid: third-party sources say **$7/month** for an always-on web service and
**$1/month** for cron jobs — **UNVERIFIED** first-party, because
`render.com/pricing` returned only navigation chrome on fetch.

### Hetzner — cheapest credible paid fallback

Prices increased **15 June 2026, 08:00 CEST**
(<https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/>):

| Plan | New price (excl. VAT) | Was |
|---|---|---|
| **CX23** (Germany/Finland, x86) | **€5.49/mo** | €3.99 |
| **CAX11** (Germany/Finland, ARM) | **€5.99/mo** | €4.49 |
| CAX21 (ARM) | €10.49/mo | €7.99 |
| CPX11 (USA) | €17.49/mo | €5.99 |
| CPX22 (DE/FI) | €19.49/mo | €7.99 |

Included traffic is 20 TB on these shared-vCPU plans per Hetzner's plan pages; the
price-adjustment doc says nothing about traffic changes. Exact vCPU/RAM/disk specs and
the IPv4 surcharge amount were **not** obtainable from Hetzner's own pages on fetch
(<https://www.hetzner.com/cloud/> renders its price table client-side) — **specs and
IPv4 surcharge: UNVERIFIED**.

**Recommendation: OCI Always Free ARM VM as primary, Hetzner CAX11 (€5.99/mo, ARM,
Germany/Finland) as the paid fallback.** Both give you a real always-on Linux box where
Playwright/Chromium, systemd supervision and crash recovery behave normally — which is
worth more here than any request-scoped platform.

---

## 5. Scheduler — triggering work every 10 minutes

| Option | Free? | Minimum interval | Reliability caveats |
|---|---|---|---|
| **Cloudflare Cron Triggers** | Yes — **5 per account** on Free | **1 minute** (5-field cron) | 15 min max scheduled-handler duration; 10 ms CPU on Free; **no first-party statement about delivery guarantees or delay** (UNVERIFIED) |
| **GitHub Actions `schedule`** | Free & unmetered **on public repos**; private repos draw on 2,000 min/mo (Free) / 3,000 (Pro, Team) | **5 minutes** | *"The `schedule` event can be delayed during periods of high loads… High load times include the start of every hour."* **"In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days."** Only runs on the **default branch**. |
| **Google Cloud Scheduler** | **3 jobs/month free per billing account**, then **$0.10/job/month**; executions are not billed | 1 minute | Free tier is per *billing account*, not per project; paused jobs still count |
| **Supabase Cron (`pg_cron`)** | Yes (no plan gating documented) | **1 second** | **Dies when a Free project pauses**, and its own activity does not credibly prevent that pause |
| Vercel Cron on Hobby | n/a | **once per day**, ±59 min | Disqualified: `*/10 * * * *` fails deployment; Hobby forbids commercial use |

Sources: <https://developers.cloudflare.com/workers/configuration/cron-triggers/>,
<https://developers.cloudflare.com/workers/platform/limits/>,
<https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows>,
<https://docs.github.com/en/billing/concepts/product-billing/github-actions>,
<https://cloud.google.com/scheduler/pricing>, <https://supabase.com/docs/guides/cron>,
<https://vercel.com/docs/cron-jobs/usage-and-pricing>

GitHub Actions arithmetic: a 10-minute cadence is **4,320 runs/month**. GitHub bills
per minute rounded up, so even 1-minute jobs consume **4,320 minutes** — well past the
2,000-minute Free allowance. **On a private repo this is not free** ($0.006/min for
Linux 2-core → ~$14/month beyond the allowance). On a **public** repo standard runners
are free, but the 60-day inactivity auto-disable then becomes a live failure mode.

**Primary: Cloudflare Cron Triggers.** Free, minute-precision, 5 triggers, runs in the
same Worker as the app, and the same invocation can both enqueue the 10-minute job row
in Postgres **and** issue the Supabase keep-alive request that prevents the Free-tier
pause. 4,320 invocations/month is negligible against 100,000 requests/day.

**Fallback: GitHub Actions `schedule` on a public repo** (`*/10 * * * *`), whose only
job is to POST an enqueue request. Guard it with a scheduled dummy commit or a
calendar reminder so the 60-day inactivity disable never fires, and accept that
firing times drift, especially on the hour.

**Third line of defence:** a `systemd` timer on the always-on worker VM, since we
already pay $0 for a machine that never sleeps. Make it a watchdog: if no job has been
enqueued in N minutes, enqueue one. Idempotency keys (§6) make the resulting duplicate
triggers harmless — which is the whole point of designing the queue first.

---

## 6. Durable job queue on Postgres

### What `pgmq` gives you

Sources: <https://github.com/pgmq/pgmq>, <https://supabase.com/docs/guides/queues>,
<https://supabase.com/docs/guides/queues/pgmq>

- Functions exposed: `send()` / `send_batch()` (with optional delay), `read()` /
  `read_with_poll()`, `pop()`, `archive()`, `delete()`, `set_vt()`.
- **Visibility timeout semantics:** `read()` makes a message invisible for `vt`
  seconds; if the consumer does not `delete()` or `archive()` it within that window it
  **reappears for another consumer**. That is precisely **at-least-once delivery with
  crash recovery** — a worker that dies mid-job releases its message automatically when
  the vt expires. `pop()` gives at-most-once and should not be used here.
- pgmq markets this as *"guaranteed 'exactly once' delivery of messages to a consumer
  within a visibility timeout"* — read that carefully: it means no two consumers see the
  message concurrently, **not** that a message is processed exactly once across
  retries.
- **Archive** tables (prefixed `a_`) retain processed messages for audit and replay.
- *"No background worker or external dependencies, just Postgres SQL objects."*
- Latest release visible on the repo: **v1.10.0** (release date not shown —
  **UNVERIFIED**).
- **Message deduplication / idempotency keys are not a pgmq feature** — not mentioned
  in the repo README or the Supabase docs. Whether pgmq uses `FOR UPDATE SKIP LOCKED`
  internally is not stated in its README either (**UNVERIFIED**; its behaviour is
  consistent with it).

### `SELECT … FOR UPDATE SKIP LOCKED`

PostgreSQL's own docs, verbatim: *"With `SKIP LOCKED`, any selected rows that cannot be
immediately locked are skipped. Skipping locked rows provides an inconsistent view of
the data, so this is not suitable for general purpose work, but can be used to avoid
lock contention with multiple consumers accessing a queue-like table."*
(<https://www.postgresql.org/docs/current/sql-select.html>)

### Recommendation

**Use `pgmq` (Supabase Queues) as the transport, and own idempotency yourself in a
separate table.** Concretely:

1. `pgmq.send()` the job, with the **idempotency key inside the message payload**.
2. A `job_runs` table with `idempotency_key text PRIMARY KEY`, plus `state`, `attempts`,
   `started_at`, `finished_at`, `result`, `last_error`, and a resume cursor column for
   multi-step browser work.
3. The worker `read()`s with a `vt` comfortably longer than the worst-case run, then
   `INSERT … ON CONFLICT (idempotency_key) DO NOTHING` into `job_runs`. Zero rows
   inserted and state already terminal → `archive()` the message and stop. That single
   unique index is what converts pgmq's at-least-once delivery into
   **effect-level exactly-once**.
4. On success `archive()`; on failure let the vt lapse (automatic retry) and cap
   `attempts` to move the job to a dead-letter queue.
5. Persist the resume cursor on every step so a crash mid-browser-session resumes
   rather than restarts.

**Why pgmq over hand-rolling:** it is already installed on Supabase, is dashboard-
observable, and gets visibility-timeout/archive semantics right — the parts people
usually get wrong. **When hand-rolling is preferable:** if you need priorities,
scheduled-for timestamps, per-job backoff, arbitrary indexed job columns, or want a
single table you fully control with no extension dependency, a
`SELECT … FROM jobs WHERE state='pending' AND run_after <= now() ORDER BY priority,
run_after FOR UPDATE SKIP LOCKED LIMIT 1` loop is a well-trodden, fully-supported
Postgres pattern and Postgres's own docs bless it for exactly this. Both are correct;
pgmq is less code, hand-rolled is more expressive. **Do not run both.**

One free-tier consequence either way: **the 500 MB database size and 1-day log
retention** mean the archive table needs a retention policy from day one.

---

## 7. Free off-site backup destination for nightly `pg_dump`

| Destination | Free storage | Free egress | Operation limits |
|---|---|---|---|
| **Cloudflare R2** | **10 GB-month** (Standard class only) | **Free — all egress from R2 is free**, including S3 API, Workers API and public domains | **1M Class A + 10M Class B requests/month** free; then $4.50/M and $0.36/M; storage $0.015/GB-mo |
| **Backblaze B2** | **First 10 GB always free** | **3× monthly average stored data**, then $0.01/GB; unlimited free egress via partner CDNs | Class A/B/C API calls free; Class D $0.004/10,000 with first 2,500/day free |
| **GitHub release assets** | No stated total limit — *"There is no limit on the total size of a release, nor bandwidth usage"* | Same statement covers bandwidth | **Each file must be under 2 GiB**; up to **1,000 assets per release** |
| **Google Drive** | **15 GB** shared across the whole Google account | Not published as a quota | API quotas apply |

Sources: <https://developers.cloudflare.com/r2/pricing/>,
<https://www.backblaze.com/cloud-storage/pricing>,
<https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases>,
<https://one.google.com/about/plans>

**Recommendation: Cloudflare R2.** Zero egress cost makes *restore* free, which is the
operation you actually care about under stress; 10 GB holds months of compressed dumps
of a database capped at 500 MB; the S3-compatible API works from any `pg_dump | aws s3
cp` pipeline; and it keeps the stack on one vendor already in use for hosting and cron.
Set a lifecycle rule to expire old dumps so you never cross 10 GB.

**Fallback: Backblaze B2** (10 GB free, 3× egress allowance) — a genuinely different
vendor, which is the right property for a backup of a Supabase project. **Do not use
GitHub release assets** for database dumps: attractive quotas, but they are public on a
public repo and the wrong tool for data with any confidentiality.

Whether GitHub release-asset storage counts against repository/LFS quotas is
**UNVERIFIED** (the about-releases page does not say).

---

## Cost floor

Realistic minimum monthly spend, itemised, if each free tier proves insufficient.

### Tier 0 — all free tiers hold ($0/month)

| Layer | Choice | Cost |
|---|---|---|
| Postgres/realtime | Supabase Free + external keep-alive | $0 |
| App + API routes | Cloudflare Workers Free (OpenNext) | $0 |
| Scheduler | Cloudflare Cron Triggers (Free, 5 triggers) | $0 |
| Worker VM (Playwright) | OCI Always Free A1, 2 OCPU / 12 GB | $0 |
| Queue | pgmq inside Supabase | $0 |
| Backups | Cloudflare R2 Free (10 GB, free egress) | $0 |
| **Total** | | **$0.00** |

### Tier 1 — the two most likely failures, fixed ($31.53/month)

| Item | Trigger for the spend | Cost |
|---|---|---|
| **Supabase Pro** | 500 MB DB or 5 GB egress exceeded, or pausing/no-backups judged unacceptable. Buys: never paused, 7-day daily backups, 8 GB DB, 250 GB egress, $10 compute credit | **$25.00** |
| **Hetzner CAX11** (ARM, DE/FI) | OCI A1 capacity unobtainable, or the instance is reclaimed as idle | **€5.99 ≈ $6.53** |
| **Total** | | **≈ $31.53** |

### Tier 2 — Cloudflare's 10 ms CPU ceiling also bites ($51.53/month)

| Item | Trigger | Cost |
|---|---|---|
| Supabase Pro | as above | $25.00 |
| Hetzner CAX11 | as above | ≈$6.53 |
| **Vercel Pro** (1 developer seat) | Next.js SSR exceeds 10 ms CPU/invocation on Workers Free, and Hobby is barred for commercial use. Also unlocks per-minute cron | **$20.00** |
| **Total** | | **≈ $51.53** |

Cheaper alternative to Tier 2's Vercel line: **Cloudflare Workers Paid at $5/month**
(10M requests, 30M CPU-ms, 5-minute CPU ceiling, 10 MB script) — which would put the
total at **≈ $36.53/month** and is the better first move. Vercel Pro at $20 is only
justified if OpenNext turns out to be the blocker rather than CPU time.

**Headline: $0/month is achievable; $31.53/month is the realistic floor once you
insist on backups and a guaranteed-unpaused database; $36.53/month buys away the
last CPU-time risk.**

EUR→USD converted at ~1.09 on 2026-09-02; treat as approximate.

---

## Risks

1. **Supabase Free pausing is the single largest availability risk.** One week without
   *user* database activity and the project stops — and internal `pg_cron` almost
   certainly does not count. Mitigation: the Cloudflare cron already runs every 10
   minutes; have it hit PostgREST (not just the queue) so real API traffic is recorded
   daily, and alert if it fails twice consecutively. $25/month removes the risk
   entirely.
2. **Zero backups on Supabase Free.** A dropped table on Free is unrecoverable —
   Supabase's own remedy is "run `db dump` yourself". The nightly `pg_dump` → R2 job is
   therefore **not optional**, and it must be monitored, restore-tested, and its
   failures alerted on. Pro buys only 7 days of dailies; PITR is a ~$100/month add-on.
3. **OCI Always Free is the least contractually stable component.** Oracle **halved**
   the A1 allowance on 15 June 2026 with no announcement and terminated over-limit
   instances from 18 August 2026. A1 capacity in free tenancies is frequently
   unobtainable ("out of host capacity"). And **idle reclamation** can take the VM if
   7-day 95th-pct CPU, network and memory all stay under 20% — a bursty 10-minute job
   may not clear that bar. Mitigations: keep the VM's own metrics deliberately above
   the threshold, keep infrastructure as code so rebuilding elsewhere is hours not
   days, and hold Hetzner CAX11 as a costed fallback.
4. **Cloudflare Free's 10 ms CPU per invocation** and **50 subrequests per invocation**
   are hard walls, not soft guidance. Token minting and webhook ingest fit; SSR of a
   complex dashboard might not. Also the **3 MiB gzipped Worker size limit** on Free is
   a real Next.js bundle constraint. $5/month lifts all three.
5. **Vercel Hobby is legally unusable here**, and this is easy to trip over
   accidentally. Anyone deploying a "quick preview" to a personal Hobby account for
   this project is in breach of Vercel's fair-use terms.
6. **GitHub Actions is a weak scheduler**: 5-minute floor, explicitly documented
   delays under load (worst at the top of every hour), default-branch-only, and
   **auto-disabled after 60 days of public-repo inactivity**. Acceptable as a
   redundant trigger behind idempotency keys; unacceptable as the only trigger.
7. **Duplicate and out-of-order triggers are certain**, not hypothetical, once two or
   three schedulers overlap. The `job_runs` unique index on the idempotency key is what
   makes that safe — build it before the second scheduler exists, not after.
8. **`pg_net` is beta, has a 2-second default timeout, and stores responses in unlogged
   tables**. Do not make it the durable link in any chain; use it to *nudge*, and let
   pgmq own durability.
9. **Netlify's credit model and its current billing bugs** make it unsuitable — 20
   production deploys exhausts the free month, and Free-plan accounts are visibly stuck
   in "operational credits" states on Netlify's own forums as of September 2026.
10. **Free tiers are being withdrawn, fast.** Fly.io removed theirs (Oct 2024),
    Railway's is a 30-day $5 trial, Render excludes background workers and cron from
    free, Hetzner raised prices up to ~3× in June 2026, and Oracle halved its ARM
    allowance in the same month. Assume at least one component of a $0 stack changes
    terms within 12 months and keep every layer replaceable.
11. **Unverified figures to re-check before committing:** free-tier eligibility of
    Cloud Run *jobs* and Cloud Run's tier-1 per-unit prices; Render's paid prices and
    free bandwidth/build-minute quantities; Hetzner's entry-plan specs and IPv4
    surcharge; explicit first-party statements on Supabase free-tier extension
    availability, `pg_cron`-as-activity, and Cloudflare commercial use.

---

## Sources

All fetched 2 September 2026.

**Supabase**
- <https://supabase.com/pricing>
- <https://supabase.com/docs/guides/platform/free-project-pausing>
- <https://supabase.com/docs/guides/platform/going-into-prod>
- <https://supabase.com/docs/guides/platform/backups>
- <https://supabase.com/docs/guides/cron>
- <https://supabase.com/docs/guides/queues>
- <https://supabase.com/docs/guides/queues/quickstart>
- <https://supabase.com/docs/guides/queues/pgmq>
- <https://supabase.com/docs/guides/database/extensions>
- <https://supabase.com/docs/guides/database/extensions/pg_net>

**Vercel**
- <https://vercel.com/docs/limits>
- <https://vercel.com/docs/limits/fair-use-guidelines>
- <https://vercel.com/docs/plans/hobby>
- <https://vercel.com/docs/cron-jobs/usage-and-pricing>

**Cloudflare**
- <https://developers.cloudflare.com/workers/platform/pricing/>
- <https://developers.cloudflare.com/workers/platform/limits/>
- <https://developers.cloudflare.com/workers/configuration/cron-triggers/>
- <https://developers.cloudflare.com/pages/platform/limits/>
- <https://developers.cloudflare.com/r2/pricing/>
- <https://opennext.js.org/cloudflare>

**Netlify**
- <https://www.netlify.com/pricing/>
- <https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/>
- <https://answers.netlify.com/t/free-plan-stuck-on-operational-credits-despite-0-300-credits-used/167778>

**Google Cloud**
- <https://docs.cloud.google.com/free/docs/free-cloud-features>
- <https://docs.cloud.google.com/run/quotas>
- <https://cloud.google.com/run/pricing> (free-tier section not extractable — see §4)
- <https://cloud.google.com/scheduler/pricing>

**Oracle Cloud**
- <https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm>
- <https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/> (third-party, for the June 2026 halving)

**Other compute**
- <https://fly.io/docs/about/pricing/>
- <https://railway.com/pricing>
- <https://render.com/docs/free>
- <https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/>
- <https://www.hetzner.com/cloud/>

**GitHub**
- <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows>
- <https://docs.github.com/en/billing/concepts/product-billing/github-actions>
- <https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases>

**Queue substrate**
- <https://github.com/pgmq/pgmq>
- <https://www.postgresql.org/docs/current/sql-select.html>

**Backup targets**
- <https://www.backblaze.com/cloud-storage/pricing>
- <https://one.google.com/about/plans>
