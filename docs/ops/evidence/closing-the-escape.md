# Closing the escape — 21/22 September 2026

Branch `claude/production-reliability`. Nothing here was deployed.

## 1. The invariant, and why the old guard could not hold it

> **Test / harness / synthetic traffic must never cross a real external
> side-effect boundary.**

`verify:history` sent a real Telegram message to Grant's own chat
(`message_id 1265`) and a real Slack message, while reporting **51/51,
exit 0**.

0523 exists to prevent exactly that. It could not, and the reason is one
sentence: **every input to its guard was a value the harness controls.**
`app.deliverable_to` asked `app.harness_job`, which was derived from
`jobs.is_fixture`, which is generated from `requested_by` — and a suite whose
job is to drive the real ingress looks real while it runs. The teardown then
rewrote the attribution, which made the escape visible *afterwards* and is why
`check:leaks` could see it at all.

The suite's own assertion — *no job of this run is still counted as something
Grant asked* — **passes**. It proves the attribution was corrected. It cannot
prove nothing was sent.

## 2. What cannot be faked: the door

Measured, not assumed:

```
usename         application_name
postgres        mgmt-api            <- every script, every suite, every session
authenticator   PostgREST 14.5      <- every real person's message
supabase_admin  pg_cron scheduler   <- the heartbeat
```

Every real inbound command is written by an edge function over PostgREST —
`telegram-webhook`, `slack-events` and `voice` POST to
`/rest/v1/inbound_commands`; `say_in_project`, `send_to_agent` and
`record_slack_history` are PostgREST RPCs. **Nothing in `src/` inserts that
table at all** — the worker only consumes it. A script has exactly one route
to this database and it announces itself.

**0541** stamps `inbound_commands.synthetic` from the door, deny by default,
and makes it immutable — mutation was the attack. **0542** carries the mark
down the lineage: a child from its parent, an inbound job from its command.
`app.harness_job` gains it as a third witness that can only ever EXCLUDE, so
nothing previously caught stops being caught.

### Two deliberate restraints

- **Jobs are not stamped by connection.** The worker falls back to the
  Management API when its direct Postgres connection is unavailable, and it
  calls several of the eleven SQL job creators. Stamping there would mean a
  degraded worker silently stopped delivering Grant's real answers — a worse
  failure, and a silent one.
- **The production-door list is `system_config` data.** If the vendor renames
  PostgREST, deny-by-default would stamp real traffic as synthetic. One
  statement widens it; no migration, no deploy.

## 3. The sabotage

`verify:escapes`, **13/13**. Every attempt runs through the real
`DeliveryService` with a transport that counts its own invocations, so
`transport invoked 0 times` is a claim about whether the sending code was
reached at all — not about a database column.

| Attempt | Result |
|---|---|
| Telegram, to **Grant's own chat**, Grant-like attribution | `suppressed`, **transport invoked 0 times** |
| Slack, to a **real app channel** | `suppressed`, **0 times** |
| after rewriting `requested_by` to look real | `suppressed`, **0 times** |
| clearing the mark directly | **refused by name** — *"synthetic is decided when the work is created and cannot be changed"* |
| a child of synthetic work | inherits; `suppressed`, **0 times** |
| a Slack-shaped actor | `suppressed`, **0 times** |
| **CONTROL** — a command through a production door | **not stamped**: the guard does not break real traffic |
| **CONTROL** — a permitted delivery | **`sent`, transport invoked 1 time** |

Without that last control every zero above would be meaningless: a guard that
refuses everything, including Grant's answers, would score perfectly.

### Proved by breaking it, twice

| Sabotage | Read back | Result |
|---|---|---|
| disable `inbound_commands_stamp_synthetic` | `tgenabled = D` | **escape reproduces: `outcome=sent, transport invoked 1 time(s)` to Grant's own chat and a real Slack channel** |
| restore | `tgenabled = O` | 13/13 |
| set `delivery.production_ingress` to `["%"]` | every door looks production | **`synthetic=false`, `harness_job=false`, `sent`, 1 time** |
| restore to `["PostgREST%"]` | | 13/13 |

### The real-world test

`verify:history` is **unchanged** — not whitelisted, not repaired, not relying
on teardown. It still passes **51/51**, and the escape count is **still 2,
newest still 21:09:28**. It escaped before; it cannot now.

**The two historical rows are preserved.** They are the only evidence the
guard ever had a hole, and deleting them to make a check green is the "clean
now" mistake 0523 was written about.

## 4. The backup alert, proved to Grant's phone

A terminally failed backup used to produce `impediments=1, chore=1,
DELIVERIES=0`.

**0543** pages from the **database** over `pg_net`, on its own `pg_cron`
schedule — invariant 14, and the point: an alert emitted by the worker goes
quiet exactly when the worker is what broke, and the 17 September failure
*was* the worker being killed five times.

Six scenarios in `verify:backups`, none of which sends anything —
`net.http_post` is transactional (measured: 0 rows to 1 inside a transaction,
back to 0 on rollback), so each drives the real function, asserts the real
request was enqueued to `api.telegram.org` with Grant's real chat id, and
rolls back:

| | |
|---|---|
| harness failure | **does not page**, no request enqueued |
| failure a later backup made good | **does not page** |
| real unrecovered terminal failure | **pages**, to his chat, naming the last good copy, the attempts, the reason and two commands |
| the same failure again | **already paged** — exactly once |
| another failed night inside 20 h | **cooling down** — no storm |
| a page that demonstrably **timed out** | **pages again** |

**0544 exists because the first real page was lost.** It timed out after
5000 ms on a cold DNS lookup — every other `net.http_post` here talks to
`*.supabase.co`, kept warm by the heartbeat, while Telegram is cold precisely
because the pager is rare — and the ledger recorded it as paged. The alert
built to survive the worker dying would itself have gone silent on first use.
So the timeout is 20 s, and **"already paged" now means a page that landed**:
the request id goes into the event and a prior attempt only silences the pager
if it is not known to have failed.

**Transport proved, not inferred.** Telegram answered
`200 {"ok":true,"result":{"message_id":1266}}` to a clearly-labelled test page
sent through the identical path. Grant has it.

Sabotage: `cron.unschedule('backup-pager')` → *"the pager runs on pg_cron —
NO SCHEDULE"*, red. Restored → green.

## 5. Disaster recovery — unchanged, and still limited

Nothing in this work improved DR. The limitations stand exactly as before:

- **No offsite backup.** The only copy is a private bucket inside the Supabase
  project it protects. Logical corruption is covered; **loss of the project is
  not — the backup goes with it, and no RTO figure applies.**
- **Vault recovery is not demonstrated.** `vault-export` has never run. A
  restore yields a working database with **36 credentials to re-enter by
  hand**, several behind third-party consent flows.
- **Full service RTO is not demonstrated.** 9 m 46 s is the DATABASE round
  trip for 153,259 rows. Complete recovery also needs a provisioned project,
  540 migrations, 8 edge functions, the pg_cron heartbeat, and three
  re-authorisations. That total has never been measured end to end.
