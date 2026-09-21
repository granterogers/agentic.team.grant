# Evidence — end-to-end latency, and the kick the dashboard never had

21 September 2026, branch `claude/production-reliability`.

## The measurement nobody had taken

`verify:latency` reported **`a Telegram message is answered inside a minute — 227s ❌`**
while Slack answered in 19.9s. Same office, same worker, same model.

The first reading of production traffic looked catastrophic — Telegram
pickups averaging **921 s** and reaching **2,686 s** — and it was wrong.
Every slow "telegram" job was `verify:progress` harness traffic, cancelled by
its own teardown:

```
created              st         pickup_s  reason
2026-09-20 11:13:21  cancelled  2686      verify:progress teardown
2026-09-20 11:13:59  cancelled  2686      verify:progress teardown
2026-09-20 11:14:59  cancelled  2639      verify:progress settled mid-pass…
```

`verify:progress` drives `app.enqueue_inbound` with a real-looking actor, so
`requested_by` is `telegram:<id>`, `is_fixture` is generated FALSE, and
`app.harness_job()` also says false because the project is real. **It is the
sixth instance of the trap CLAUDE.md records for `verify:addressing` (43
jobs), `gate-3` (27), `verify:history` (61) and `verify:transport` (29), and
nobody had caught it.** It was polluting a latency measurement, which is
precisely the harm that file warns about.

Re-measured with CLAUDE.md's own structural test for real traffic — it came
through a real channel **and its answer was actually delivered to somebody** —
over fourteen days of `office.instruction`:

| channel | n | pickup p50 | pickup max | e2e p50 | e2e p95 | e2e max |
|---|---|---|---|---|---|---|
| telegram | 44 | **1 s** | 1,490 s | **22 s** | 339 s | 1,567 s |
| voice | 29 | 41 s | 129 s | 62 s | 124 s | 137 s |
| slack | 18 | 4 s | 205 s | 21 s | 146 s | 234 s |
| **teamhq** | 2 | **46 s** | 52 s | 72 s | 75 s | 75 s |

Telegram's median pickup is **one second**. The webhook kick works, and
"pretty much instant" is achieved on the surface Grant complained about.

## The defect: the third door was never given the kick

```
telegram-webhook   kicks the worker   -> median pickup  1s
slack-events       kicks the worker   -> median pickup  4s
hq-api             DOES NOT KICK      -> median pickup 46s
voice              does not kick      -> median pickup 41s
```

`slack-events`' own comment records this being found and fixed once already:
*"Slack never did, so a message typed in the office waited for the next
pg_cron tick."* And Grant's words in the same comment: *"I need any messages
that I send either in Telegram or in Slack to be responded to within, say, a
minute."*

**`hq-api` is the third door and it was never done** — so the web dashboard,
the surface Grant reads the office on, was the slowest one to answer him.
Same rule, same fix, third place: CLAUDE.md's *when two functions do the same
thing, grep for the other one.*

## The fix

`hq-api` now kicks after **any successful POST**, not for a named list of
actions. That is a property rather than an enumeration: a GET is a read and
can never enqueue, a POST is a write and might, and a list of the actions
that happen to enqueue today is a list the next action added will not be on.
An unnecessary kick costs one invocation that finds an empty queue; a missing
one costs Grant a minute.

`WORKER_URL` and `WORKER_KICK_SECRET` were already set project-wide by the
Telegram and Slack deploys, so no deploy-script change was needed. A missing
secret degrades to *late*, never to *lost* — pg_cron is still behind it.

## Measured through the DEPLOYED gateway

`hq-api` **v669 ACTIVE**. Probe: `POST /hq-api` with `action: say`, then poll
`job_state_transitions` for the move into `running`.

| probe | pickup |
|---|---|
| 1 (cold worker) | **12 s** |
| 2 | **4 s** |
| 3 | **8 s** |

Median ~8 s against a 46 s baseline. Not Telegram's 1 s — a pass does
recovery and duty work before it dequeues, and the first probe paid a cold
start — but comfortably inside Grant's minute and about six times better.

### The probe could not reach Grant, and that was proved rather than assumed

Aimed at an **existing** fixture project that already carries jobs, because a
project that has gathered a job can never be deleted and a new one would be
permanent debris. All three probe jobs: `harness_job = true`, **zero delivery
rows** — 0523's default-deny in action. The two left retrying were settled;
nothing is queued.

## Deployment policy

Only the `hq-api` edge function was deployed. `npm run deploy:hq` also
publishes the Vercel page, and this branch's `web/studio` is main's version
while `claude/basecamp-team-hq` has unmerged frontend work — publishing from
here could have rolled their deployment back. Run with `VERCEL_TOKEN=`
unset, which the script handles explicitly: *"endpoint deployed, page
skipped."*

## A mistake of mine, reported rather than buried

Checking whether `VERCEL_TOKEN` was set, I wrote
`echo "VERCEL_TOKEN set? [${VERCEL_TOKEN:-UNSET}]"`, which **prints the value
when it is set**. A live Vercel token was therefore printed into this
session's terminal output.

- It reached **no file, no commit, no evidence document and no log in the
  repository** — verified by `grep -rl` across the working tree and the
  scratchpad, and `npm run check:secrets` is clean over 1,445 files.
- It exists in this session's transcript.
- **ACTION FOR GRANT: rotate the Vercel token** at
  <https://vercel.com/account/tokens> — delete the current one, create a
  replacement, and update it wherever the environment supplies it. The value
  is deliberately not repeated anywhere in this repository.

The correct idiom, used everywhere else in this run, tests presence without
printing: `[ -n "$X" ] && echo set || echo unset`. **Never expand a
secret-bearing variable into output, even to check whether it exists.**
