# Final proof pass — 21 September 2026

Run against **HEAD `9b8e6af`** exactly, working tree clean. Verification
only: no feature work, no frontend, nothing deployed.

---

## 1. The complete 44-check gate, executed

Every one of the 44 checks in `scripts/e2e.ts`'s `GATE` array was run
individually against this HEAD, in twelve segments, with **real exit codes**
recorded to `results.tsv` as each finished. Nothing is inferred from an
earlier run.

Two suites were re-queued because my first segment runner truncated them at a
segment boundary rather than at their own allowance — a `124` in the table
below therefore means the suite genuinely overran, not that the harness cut
it off.

**41 of 44 green.** Notable tallies: `verify:mytasks` 89/89 (492 s),
`verify:history` 51/51, `verify:identity` 39/39, `verify:tasks-ui` 46/46,
`verify:connectors` 45/45, `verify:mail` 43/43, `verify:wrappers` 43/43,
`verify:knowledge` 39/39, `verify:proposes` 26/26, `verify:organising`
25/25, `verify:recovery` 25/25, `verify:dryrun` 25/25, `verify:knows` 25/25,
`verify:transport` 23/23, `verify:tasks` 24/24, `verify:security` 20/20,
`verify:stop` 19/19, `verify:recovers` 19/19, `verify:review` 17/17,
`verify:upload` 17/17, `verify:delegation` 17/17, `verify:artifact` 13/13,
`verify:handoff` 13/13, `verify:attests` 11/11, `verify:routing-breadth`
11/11, `verify:cross-interface` 10/10, `verify:unified` 10/10, plus
`verify:backups`, `verify:resumes`, `verify:journals`, `verify:schema`,
`verify:judge`, `verify:transitions`, `verify:reach`, `verify:drains`,
`check:icons`, `check:callers`, `check:pressable`, `check:tokens`,
`check:one-brain`, `check:reachable`.

### 2. The three reds, accounted for

**None of the three is caused by this branch's changes.** Two trace to
`0523`, which landed on 20 September from another workstream, and one to the
global autonomy default.

#### RED 1 — `check:leaks`: two harness deliveries reached Grant. REAL.

```
harness traffic that reached a real destination SINCE the guard: 2
```

Both at **21:09:28 tonight, during my gate run**, from `verify:history`:

| channel | target | state | message ref |
|---|---|---|---|
| telegram | `1386648496` (Grant's own chat) | **sent** | `1265` |
| slack | `C0C276SFM7D` | **sent** | `1790024968.041929` |

Body: *"I have no record of "wm1ghfjv" in our indexed data, and the files you
uploaded haven't been indexed yet…"* — a run token, on Grant's phone. This is
precisely the failure `0523` was written to prevent.

**Cause, proven not assumed.** `verify:history` enqueues through
`app.enqueue_inbound`, whose `origin_channel` is constrained to real
surfaces, so `requested_by` is `telegram:grant` **while the job runs**.
`app.deliverable_to` is evaluated inside `claim_delivery` at SEND time, sees
`harness_job = false`, and permits the send. The suite then rewrites
`requested_by = 'verify:history'` in teardown (`history.ts:982`), which makes
`is_fixture` generated true *retroactively* — which is why `check:leaks` can
see the escape afterwards and why the guard could not stop it.

The suite's own assertion, `no job of this run is still counted as something
Grant asked — 0 reading as real`, **passes**. It proves the attribution was
corrected; it cannot prove nothing was sent. `0523`'s own header names this
exact distinction: *"'clean now' and 'no synthetic side effect ever escaped'
are different claims, and only the first was being made."* Here it is again,
one layer deeper.

`verify:history` reported **51/51 and exit 0** while doing it.

**Not caused by this branch:** `scripts/verify/history.ts` and
`src/channels/delivery.ts` are byte-unchanged from main on this branch, and
none of migrations 0535–0540 alters `deliverable_to`, `claim_delivery`,
`harness_job`, `enqueue_inbound` or `test_destinations` (0537 only *reads*
`harness_job` inside `last_progress`).

**Why it stays red.** The counter is unwindowed —
`d.created_at > app.harness_guard_since()` — so it will read 2 for everyone
until the hole is closed and somebody decides deliberately what to do with
the two rows. **I did not delete them.** They are the only evidence the guard
has a hole, and deleting them would be exactly the "clean now" mistake the
guard exists to refuse.

#### RED 2 — `verify:artifact-slack` 12/14. Same guard, third instance.

Everything works — the job, the `artifact.report` child, a real 6,699-byte
PDF stored as a project document, and the citation. The two failures are that
**no message reached the fixture Slack channel**: only the two "has joined
the channel" system messages. The suite's own check confirms the traffic is
harness (`3 of 3`), so `deliverable_to` suppresses before the transport.

Same class as `verify:transport` (9 checks) and `verify:chaos` (1 check),
both fixed earlier in this run by registering the suite's own destination.
**Deliberately NOT fixed here**, for two reasons: this is a verification
pass, and unlike the other two this suite performs a *real Slack send* to a
channel it creates in Grant's workspace, so the change has a different risk
profile and deserves his eye. The fix is the same two lines — register
`slack / <the fixture channel>` in `public.test_destinations` at setup and
delete it in teardown.

#### RED 3 — `verify:collaborates`, exit 124, overran 540 s twice.

It does not fail; it waits. Both runs produced an `office.pursue` child that
ended **`paused: awaiting_approval: draft.create`** — the autonomy gate
correctly asking Grant. The global autonomy level is **`suggest`**, set by
migration 0027 on 4 September and never changed by a person, so at this level
the suite waits for a human approval that will never arrive unattended.

Pre-existing and unrelated to this branch: nothing here touches autonomy,
approvals or `office.pursue`.

### My own gate-run debris — swept, and only mine

The two `verify:collaborates` runs left draft tasks on Grant's list and
paused jobs; `verify:mytasks` left one task carrying a run token. **All were
created by my gate run**, all removed by id:

| | before | after |
|---|---|---|
| draft tasks from my `verify:collaborates` runs | 2 | **0** |
| `verify:mytasks` token task | 1 | **0** |
| paused `office.pursue` from those runs | 2 | **0** |

The Shadow Grant session's in-flight task (`teamhq:verify-shadow-bnhlk6sn`)
was **left alone** and cleared itself. `check:leaks` now reports every
sweepable class at 0 and is red for the two escaped sends alone.

---

## 3. What is and is not in the deployed worker / API

| Change | Lives in | Live now? |
|---|---|---|
| 0535 terminal-failure journal | DB trigger | **YES** — `tgenabled = O` |
| 0536 a resumption is not a retry | DB function | **YES** — `recover_stalled_jobs` contains the grant |
| 0537 `backup_health`, `last_progress`, `chores_for_backups`, `record_rehearsal` | DB | **YES** |
| 0538 `office_health` splice + progress index | DB | **YES** — both confirmed |
| 0540 credential pass delegates to the backup pass | DB | **YES** |
| `hq-api` worker kick | edge function | **YES** — deployed 18:47, re-proved tonight at **4 s** pickup |
| **`src/db/executor.ts` 5xx retry** | worker bundle + local scripts | **Scripts yes; WORKER NO** |
| **`src/handlers/chores.ts` backup pass** | worker bundle | **NO** — 0540 is why the pass still runs |

The worker is **v667, deployed 20:20 tonight by another session**. Neither
`origin/main` nor either sibling branch contains my `executor.ts` or
`chores.ts` changes — checked directly — so the deployed worker cannot have
them. **Nothing was deployed during this pass**, and the worker deliberately
was not: publishing this branch's `src/` would roll back newer Shadow Grant
work.

**Consequence to carry into integration:** a transient Management-API 5xx
still burns a job attempt in production until the worker is deployed from a
branch containing `executor.ts`'s `status >= 500`.

---

## 4. The alert path for a failed unattended backup — PROVEN, AND IT IS PULL-ONLY

Driven end to end: a real `office.backup` job, failed through
`app.recover_stalled_jobs()` with attempts exhausted exactly as 17 September
did, then the **deployed** hourly door (`app.chores_for_credentials`) run
against it.

```
ALERT-PROOF  state=failed
             impediments=1  [recovery: 5 attempts exhausted while in running]
             outputs=0
             DELIVERIES=0
             announce_flag=1
             chore=1  [Check why the nightly backup has not finished]
```

**So: if tonight's backup terminally fails, Grant receives no message of any
kind.** He finds out only by opening the dashboard.

- **Impediment** on the Governance page — a database record.
- **`backup_overdue: true`** in `app.office_health()` — a health field.
- **A chore on My Tasks**, "Check why the nightly backup has not finished" —
  in the product, but still a thing he must go and look at.
- **Zero deliveries.** No Telegram, no Slack, no email, no push.

The `announce: true` flag on the job is **inert**: the notifier delivers
OUTPUTS, a terminally failed job writes none, and it never reaches
`notifying` at all.

Every other candidate push path was checked and none carries it:

| Candidate | Carries a failed backup to Grant? |
|---|---|
| `office.chores` handler | **No** — `announce: false`, deliberately (hourly narration he asked twice not to receive) |
| `briefing.morning` (07:00, announces) | **No** — it contains no tasks or chores at all |
| `raise_proposals` → `office.propose` (announces) | **No** — it skips kind `not_capable`, which is what 0535 writes |
| Telegram pager | Used for job outputs; nothing consults chores |
| `instruction.ts` reading `my_tasks` | Only when Grant **asks**. Pull, not push. |

**Correction to my earlier report.** I wrote that the chore "reaches him".
That overstated it: it reaches his task list. The durable record and the
actionable, self-clearing, deduped chore are real and were the gap worth
closing first — but **there is no push, and I did not build one.**

**What would close it** (not done — verification pass): have the chores
handler set `announce: true` on the pass that RAISES a backup chore, and only
on that pass, so the first failure pages and the fiftieth hour does not. That
is a behavioural change in a handler that is not deployed, and the dedupe
judgement is Grant's — he has asked twice not to be narrated at.

---

## 5. Disaster recovery, restated conservatively

**The 9 m 46 s figure is DATABASE RESTORE TIME, not service recovery.** It is
the measured round trip for 153,259 rows across 122 tables — download,
checksum, decompress, load, verify — into a scratch schema, with the schema
already present. It is not an RTO.

Complete service recovery, counted honestly:

| Step | Cost | Automated? |
|---|---|---|
| Provision a Supabase project | minutes–hours | no |
| Apply **540 migrations** from git | minutes | `npm run migrate` |
| Load the newest archive | **9 m 46 s** measured | yes |
| **Re-enter 36 vault secrets by hand** | **hours, and gated on third parties** | **no** |
| Redeploy **8 edge functions** | minutes | per-function scripts |
| Re-create the pg_cron heartbeat | seconds | migration 0121 |
| Re-point Telegram/Slack webhooks, re-authorise Google OAuth | unbounded — depends on Grant and on providers | no |

**The dominant term is the vault.** The dump excludes the `vault` schema —
correctly — and `vault-export` has **never run**. So a restore yields a
working database that cannot talk to anything until 36 credentials are
re-entered, several of which need third-party consent flows.

### The scenario the backup does NOT cover

**There is no offsite copy.** The only backup is a private bucket **inside
the Supabase project it protects**. Therefore:

- **Logical corruption** — a bad migration, an accidental delete, a
  destructive function: **covered.** RPO ≈ 24 h (48 h observed once, on 17
  September). Restore time as above.
- **Loss of the Supabase project or account** — the failure a backup most
  exists for: **NOT COVERED. The backup is lost with it.** No stated RTO is
  meaningful for this case, because there is nothing to restore from.

Any RPO/RTO claim for this system must carry that sentence. The honest
summary is: *the office can recover from damaging its own data; it cannot
recover from losing its host.*
