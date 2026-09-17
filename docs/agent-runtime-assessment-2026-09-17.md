# Where a browser and a computer can actually run, at £0

**17 September 2026 · Issues #16, #135, #261 · an assessment, not a plan**

Grant's instruction for these three was explicit: *"DO NOT SIMPLY LABEL THESE
'NEEDS BUDGET'."* So this is the work of finding out what is genuinely
impossible without money and what is merely unbuilt — and the answer is that
**most of the first useful slice is free, and the part that is not is smaller
and cheaper than the Issues imply.**

Nothing here has been purchased, deployed or enabled. Every number is either
measured on this system today or taken from a vendor's own documentation, and
each is marked.

---

## 1. The distinction that dissolves most of the problem

The three Issues read as asking for a machine. They are not, and separating the
two halves is the whole of this assessment:

| | What it means | What it costs |
|---|---|---|
| **Persistent STATE** | a logged-in session that survives; a working directory that is still there next Tuesday; a half-finished job that can be resumed | **£0.** Supabase Vault, Supabase Storage and Postgres already hold all three, and the office already uses them for exactly this |
| **Persistent COMPUTE** | a process that stays running between requests; a browser that stays open; a terminal you can come back to | **money, always**, because somebody is holding RAM for you while you are not using it |

Almost everything #16, #135 and #261 ask for is persistent STATE wearing the
language of persistent COMPUTE. *"A browser tab in every project"* does not
need a browser that stays open; it needs a **session that stays valid** and a
**picture of what happened**, both of which are rows and objects. *"Controlled
persistence between steps or resumptions"* (#261) is a checkpoint, which is a
row.

**The office already proves this.** `notebook.storage_state` is a Playwright
session jar in the Vault; `api/notebook.py` on Vercel drives a logged-in Google
session with it; the browser that established that session has been closed for
weeks and the session still works. That is the whole pattern, already in
production, on the free tier.

What genuinely needs compute is the **minutes during which something is
actually driving a page**. Those are measurable, and they are the thing to
shop for.

---

## 2. What this office already has, measured

| Runtime | Limit | Where the number comes from |
|---|---|---|
| **Supabase Edge (the worker)** | 150 s wall clock (free; 400 s paid), **2 s CPU**, 256 MB memory, 20 MB function | [Supabase docs](https://supabase.com/docs/guides/functions/limits), read 17 Sep 2026 |
| **Vercel Hobby functions** | **60 s** max duration, 1024 MB configured | `vercel.json` in this repo; [Vercel changelog](https://vercel.com/changelog/vercel-functions-for-hobby-can-now-run-up-to-60-seconds) |
| **Supabase Postgres** | 63 MB used of 500 MB | measured, 17 Sep 2026 |
| **Supabase Storage** | 115 MB used of 1 GB (`build` 60 MB, `backups` 45 MB, `avatars` 9.6 MB, `files` 1 MB) | measured |
| **GitHub Actions** | 2,000 min/month, **switched off by instruction** after 1,800 went to a five-minute cron | Grant, 8 Sep 2026; Issue #17 |
| **Real job load** | 3,438 jobs in 7 days | measured |

Two of these matter more than they look.

**The 2-second CPU limit on the edge worker** is the sharpest constraint in the
building and nothing in the repository says so. It is not a problem for what
the office does — the PDF writer added for #258 renders a three-page report in
a few milliseconds — but it rules out anything compute-heavy running *in the
worker*, permanently, on any plan.

**GitHub Actions is a decision, not a limit.** 2,000 free minutes a month of a
real Ubuntu VM, with a filesystem, a terminal and a browser, is sitting unused
because a five-minute cron burned 1,800 of them on nothing. `workflow_dispatch`
still exists. That is the single largest free compute resource this project
has, and it was switched off for a reason that does not apply to
job-triggered, bounded, on-demand work.

---

## 3. The candidates, with costs

### A. Cloudflare Browser Rendering — **free, and the finding of this assessment**

Available on the **Workers Free plan**: 10 browser-minutes per day, 3
concurrent browsers, one new instance every 20 seconds, 60-second timeout
([Cloudflare docs](https://developers.cloudflare.com/browser-rendering/platform/limits/),
read 17 Sep 2026).

Ten minutes a day sounds small until it is costed against the actual work.
#135's **gather** tier — open a page behind a login, read it, screenshot it,
bring it into the project — is five to fifteen seconds a page. Ten minutes is
**forty to a hundred and twenty page visits a day**, every day, for nothing.
That is not a toy allowance; it is more browsing than the office would do in a
normal week.

- **What it gives:** a real Chromium, Playwright-compatible, with the session
  jar sent in the request exactly as `api/notebook.py` already does.
- **What it does not give:** a filesystem, a terminal, anything over 60
  seconds, or a browser that stays open between jobs.
- **Cost to exceed it:** Workers Paid is $5/month, at which the daily cap goes
  and concurrency rises to 200.

### B. Vercel Hobby + a headless Chromium build — free, already deployed

Chromium can be bundled into a Vercel Python or Node function. The office
already runs Playwright-dependent code there. 60 seconds, 1 GB, no filesystem
that survives the request.

- **Honest objection:** the deployment size limit makes a Chromium bundle
  tight, and a cold start with a browser is slow enough that a 60-second budget
  becomes a 45-second budget. The existing `api/notebook.py` deliberately
  avoids Playwright for this reason.
- **Verdict:** a fallback, not a foundation. (A) is the same capability without
  the bundle fight.

### C. GitHub Actions, on `workflow_dispatch` only — free, switched off by choice

A full Ubuntu VM: filesystem, terminal, browsers preinstalled, up to 6 hours a
job, 2,000 minutes a month.

This is the **only free option that satisfies #261 as written** — browser plus
filesystem plus terminal plus working directory. The reason it is off is that a
schedule ate the allowance. A job-triggered dispatch with a hard monthly budget
(the office already has `app.may_act` and a token ceiling; a minute ceiling is
the same shape) does not have that failure mode.

- **Honest objection:** Grant's instruction was *"stop using github actions
  completely please, find another way to do thing… for any process."* That is
  unambiguous and this assessment does not overrule it — it records that the
  capability exists, is free, and is the cheapest path to #261, and that
  reopening it is **his decision, not an engineering one**.
- **Second objection, and it is real:** an Actions run is legible only through
  the Actions UI unless something streams progress back. #135 asks for
  screenshots and a Stop button. Both are buildable — the run posts to
  `hq-api` — but they are work, not a flag.

### D. Fly.io machines — cheap, not free

Measured from [Fly's pricing](https://fly.io/docs/about/pricing/), 17 Sep 2026:

| Shape | Always on | Stopped |
|---|---|---|
| shared-cpu-1x, 256 MB | $2.02/month | rootfs only, $0.15/GB/30 days |
| shared-cpu-1x, 512 MB | $3.32/month | " |
| shared-cpu-1x, 1 GB | $5.92/month | " |
| Volume | $0.15/GB/month | charged attached or not |

The interesting column is the second one. Fly bills **per second** and a
machine can be **stopped**, so a machine that wakes for a job and stops after
it costs its runtime plus a few pence of disk. At the office's real load — 3,438
jobs a week, of which a browser job would be a tiny fraction — a
wake-on-demand 512 MB machine with a 1 GB volume is realistically **well under
$1/month**, and its ceiling if something went wrong and it never slept is
$3.47.

This is the honest answer to "what does #261 cost": **about the price of a
coffee a month, with a worst case of three.**

### E. A machine at home — free, and rejected

Grant has computers. A self-hosted runner or a small always-on box is £0 in
cash and expensive in every other way: it is a thing that must be up, patched
and reachable, and it puts the office's reliability on his broadband. It is
also the opposite of *"reduce my dependence on… maintaining and extending the
system"*.

### F. Doing nothing — free, and the current state

The office cannot see Instagram, a supplier portal or a bank statement, and
will not be able to however many APIs it gains.

---

## 4. What the architecture should be, whatever gets paid for

This is the part that does not depend on the budget decision, and it is most of
the work.

```
  job (Postgres, canonical)
    │
    ├── a RUNTIME is a tool, not a second agent model
    │     app.staff_may_use / app.may_act decide, as they already do
    │
    ├── STATE lives where state already lives
    │     session jar   → Supabase Vault (as notebook.storage_state does)
    │     working files → Supabase Storage, keyed by project and job
    │     checkpoints   → a row (#263)
    │
    ├── COMPUTE is ephemeral and interchangeable
    │     Cloudflare Browser Rendering │ a Fly machine │ a dispatched runner
    │     chosen per job kind, swappable without touching anything above
    │
    └── LEGIBILITY is a row and an object, never a live connection
          each action → a row the studio reads
          each screenshot → an object in `build` (the bucket #59 already uses)
          Stop → a column the runtime polls, not a socket
```

Four properties fall out of it, and each is one of the Issues' own
requirements:

1. **The runtime is swappable.** Starting on Cloudflare's free tier and moving
   to Fly later is a handler change, because nothing above the line knows which
   ran.
2. **Stop works without a persistent connection.** A runtime that polls a
   `cancel_requested` column between steps can be stopped from a page, which is
   what #135 asks for and what a socket would make harder rather than easier.
3. **Resumption is free.** A job that checkpoints after each step (#263) can be
   killed by a 60-second timeout and continue in the next invocation. This is
   what makes a 60-second ceiling tolerable for a ten-minute task, and it is
   the reason **#263 should be built before any of this**, not after.
4. **Nothing new decides anything.** The runtime is a tool in
   `tool_permissions` with a `delivered_by`, so #64's capability brief tells an
   agent the truth about it and 0298's rule holds.

---

## 5. What to build first, at £0

In order, and none of it needs a decision from Grant:

1. **#263, durable checkpoints.** Named first deliberately: it is what makes
   every 60-second runtime usable, and it is entirely inside Postgres.
2. **`browser_sessions`, and the gather tier on Cloudflare's free plan.** A
   session per project in the Vault, a `browser.gather` job kind, ten free
   minutes a day, screenshots into `build`, documents into `documents` with
   provenance saying where they came from. This is #135's whole first half and
   it costs nothing.
3. **The Browser tab**, reading those rows. Sessions, last-alive, recent
   actions with screenshots, what was gathered, Stop.
4. **A minute ledger.** Whatever runs, meter it the way `inference_usage`
   meters tokens, so the second question about cost is answered with a number.

Only then is there a real decision to make, and it will be a small one.

---

## 6. What genuinely cannot be done for nothing

Stated precisely, because this is the half the instruction was about:

| Capability | Why free does not reach it | Cheapest honest price |
|---|---|---|
| **A terminal and a filesystem in the same place as the browser** (#261's core) | no free serverless runtime gives a durable writable disk; Cloudflare gives a browser, Vercel gives 60 s and /tmp | **Fly, ~$0.50–$3.50/month** wake-on-demand, or GitHub Actions at £0 if Grant reopens it |
| **More than ~10 browser-minutes a day** | Cloudflare's free cap | **Workers Paid, $5/month** |
| **A single task running longer than 60 s without checkpointing** | every free runtime's ceiling | free, if #263 is built — which is why #263 is first |
| **Anything that must hold a browser open across jobs** (a multi-step checkout, a long authenticated flow that breaks on re-entry) | free tiers all destroy the instance | **Fly, as above** |

The largest cost in all three Issues is not money. It is that **a browser
acting on Grant's accounts is the most dangerous capability the office will
ever hold**, and the gate, the dry run, the per-site grant and the screenshots
are most of the work whoever pays for the compute.

---

## 7. What Grant actually has to decide

Three things, and only three:

1. **May GitHub Actions be reopened for `workflow_dispatch` only, with a
   monthly minute ceiling enforced in the database?** It is free, it is the
   only free path to #261, and his instruction currently forbids it. A yes
   makes the whole of #261 cost nothing; a no makes it cost about a pound a
   month.
2. **Is roughly $0.50–$3.50 a month acceptable for a wake-on-demand Fly machine**
   if the answer to (1) is no? This would be the office's first paid
   dependency, and the ~£0/month constraint is his to relax.
3. **Gather first, act later — confirmed?** #135 proposes it and this
   assessment agrees emphatically. Reading pages behind a login has a small
   blast radius; posting as him does not, and the two should not ship together.

Nothing above needs an answer before the £0 work in §5 starts.
