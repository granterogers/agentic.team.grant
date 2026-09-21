# Operational runbook

What to do when something has gone wrong, in the order to do it. Written for
Grant and for whoever picks this up after a compaction. Every command here was
run during the 21 September reliability run and its output is real.

**First, always: ask the office what it thinks.**

```bash
npm run qq -- "select jsonb_pretty(app.office_health(24))"
```

That one reading now answers finished / failed / in flight / stalled /
waiting-with-an-age / open provider breakers / budget holds / **backup age**
/ **last proven restore** / **when work last actually moved**.

---

## 1. "I sent a message and nothing came back"

```bash
npm run qq -- "select jsonb_pretty(app.last_progress())"
```

- `minutes_since_dequeue` small and `runnable_now` 0 → the queue is drained
  and the office is idle. Your message never arrived; look at the channel.
- `runnable_now` > 0 and `minutes_since_dequeue` large → **the worker is not
  consuming.** Go to §2.
- Both small → it was picked up. Find the job:

```bash
npm run q -- "select job_id, state, attempt, max_attempts, left(state_reason,80) from public.jobs where kind='office.instruction' order by created_at desc limit 5"
```

A `failed` job now always carries an impediment (0535) — that is the sentence
saying why, and it is on the Governance page:

```bash
npm run q -- "select needed, detail, noticed_by, created_at from public.job_impediments order by created_at desc limit 5"
```

## 2. The worker is not consuming

The chain is `pg_cron -> app.kick_worker() -> the worker function`. Check it
**in that order**, and do not believe the cron log on its own.

```bash
# Is the schedule there and firing?
npm run q -- "select jobname, schedule, active from cron.job"
npm run q -- "select status, count(*), max(start_time) from cron.job_run_details group by status"

# Did HTTP actually leave? THIS is the one that matters -- kick_worker()
# returns null SILENTLY when its secret is missing and the cron log says
# "succeeded, 1 row" either way.
npm run q -- "select status_code, count(*), max(created) from net._http_response group by status_code"

# Is the secret there?
npm run q -- "select name from vault.secrets where name = 'worker.kick_secret'"
npm run q -- "select key from public.system_config where key = 'db.project_ref'"
```

Then the function itself, which answers a GET with its configuration:

```bash
curl -s https://baujwlzcziasnfhhkchg.supabase.co/functions/v1/worker \
  -H "Authorization: Bearer <worker.kick_secret>" | python3 -m json.tool
```

If the schedule is gone: re-apply `migrations/0121_the_queue_gets_a_heartbeat.sql`.
If the secret is gone: restore it, and note that **every job in the building
stops** when a vault reference dangles — `app.resolve_secret` raises `23503`
on a ref that resolves to nothing.

## 3. A job is stuck, or work is not moving

```bash
npm run verify:drains          # the queue is actually moving
npm run q -- "select * from app.jobs_waiting(15)"    # a PERSON has not been answered
npm run q -- "select * from app.jobs_stuck_queued()" # a DUTY is behind its schedule
```

Those two are different questions and the office has words for both. To
recover abandoned work by hand:

```bash
npm run q -- "select * from app.recover_stalled_jobs()"
```

A job that ran out of wall clock while making checkpoint progress is now
granted another slice rather than spending a retry (0536); one that finished
nothing still dies after five.

## 4. The backup

```bash
npm run qq -- "select jsonb_pretty(app.backup_health())"
```

| Reading | Meaning | Do this |
|---|---|---|
| `backup_overdue: true` | no finished backup in 36 h | §4a |
| `rehearsal_overdue: true` | no restore proven in 8 days | `npm run backup:rehearse` |
| `partial_uploads` > 0 | an upload stopped halfway | look at the last `office.backup` job |
| `offsite: false` | **always true today** | Grant's decision — see §7 |
| `vault_exported: false` | **a restore yields an EMPTY vault** | Grant's decision — see §7 |

Both overdue conditions raise a chore on My Tasks by themselves, hourly, and
clear themselves. You should not normally have to look.

### 4a. The nightly backup is not finishing

```bash
npm run q -- "select created_at, state, attempt, max_attempts, left(state_reason,90) from public.jobs where kind='office.backup' order by created_at desc limit 5"
npm run verify:resumes    # prints the slice count against the ceiling
npm run backup:now        # take one now, watching
```

### 4b. Restoring for real

1. Apply the migrations from git — **the archive carries rows and a column
   list, not DDL.**
2. Load the newest archive. `npm run backup:rehearse` is the proof it works
   and it restores into a scratch schema; a real restore points the same code
   at the real target.
3. **Re-enter every credential by hand.** The dump excludes the `vault`
   schema, correctly, and `vault-export` has never run.

Measured RTO for the data round trip: **9 min 46 s** for 153,259 rows across
122 tables. RPO: ~24 h by design, 48 h observed once.

## 5. A credential is dead

```bash
npm run audit:credentials      # WORKING / UNVERIFIED / DEAD, not "present"
npm run q -- "select service, credential, state, action from public.connection_health order by state"
```

A dead credential with an owner and an action raises a chore automatically.
One marked `parked` deliberately does not — Grant asked for Groq, OpenAI and
OpenRouter to be left alone.

## 6. The office cannot think

```bash
npm run q -- "select provider, state, opened_at, next_probe_at, left(last_error,120) from public.provider_health where state='open'"
npm run verify:fallback
```

An open breaker appears as `cannot_think` in `office_health`. It reopens on a
probe by itself. A daily free-model quota is the usual cause and it resets.

## 7. The two things only Grant can do

Neither is a defect and both are reported in every `backup_health()` read
rather than discovered during a recovery.

**An offsite copy.** The only backup is a private bucket in the same Supabase
project it protects. It survives losing the code, this machine and every
other vendor account; it does not survive losing the project. A Cloudflare R2
free-tier bucket (10 GB, £0) would close it.

**The vault export.** `vault-export` is `enabled = false` and has never run,
so a restore yields a working database with no credentials. Grant chose that
deliberately — each run puts an encrypted copy of every credential in a
Telegram chat. To switch it on:

```sql
update public.responsibilities set enabled = true where slug = 'vault-export';
```

## 8. Before believing anything is broken

Three of this repository's most expensive mistakes were reporting harness
traffic to Grant as the office failing. Check whose work it is first:

```bash
npm run q -- "select job_id, kind, requested_by, is_fixture, app.harness_job(job_id) from public.jobs where state='failed' order by created_at desc limit 10"
npm run check:leaks
```

`is_fixture` is generated from `requested_by`; `app.harness_job()` also asks
whether the PROJECT is a fixture. A row that is real by both is Grant's.
