# Evidence — every terminal job failure leaves a durable trace (0535)

Run 21 September 2026 on branch `claude/production-reliability`.

## The defect, from canonical evidence

```
kind                       created_at                     state_reason
office.backup              2026-09-17 22:19:00.373454+00  recovery: 5 attempts exhausted while in running
```

Deliveries for that job: **0**. Impediments: **0**. Objects in the `backups`
bucket dated 17 September: **0**. Grant was not told.

Across 14 days of real traffic (`not is_fixture`, `not app.harness_job`):

| | |
|---|---|
| failed jobs | 56 |
| that produced a delivery | **0** |
| that recorded an impediment | 49 |
| that recorded nothing at all | 6 |

The six: `office.backup` (the one above), `notebook.collect_artifact`,
`office.instruction`, and three `knowledge.read_source`.

## Why the fix is a trigger

Six paths reach `failed`. Three write an impediment first because each was
caught individually (#211, #231). Three never did — and one of them is
`app.recover_stalled_jobs`, which is SQL and could not have been fixed by
being careful in `worker.ts`. One rule, six sites, three wrong is one
defective abstraction, not three defects.

## The drive — three controls

| Control | Asserts | Result |
|---|---|---|
| A | a job that fails with nothing recorded gains exactly one impediment, carrying the real reason, fingerprinted by kind, inheriting `is_fixture` | **1** |
| B | a job whose call site already wrote a better impediment is **not** duplicated | **1** |
| C | a transition that is not a failure records nothing | **0** |

```
DRIVE-RESULT PASS A=1 B=1 C=0
  fingerprint=[to finish office.backup]
  noticed=[the job machinery]
  fixture=t
  detail=[recovery: 5 attempts exhausted while in running]
```

Debris after the drive: `0` jobs matching the fixture requester. The drive
ends by raising, so the whole statement rolls back — jobs can never be
deleted, and a drive that committed would leave permanent fixtures in the
queue.

## The harness audit — proving the control can fail

§10 requires that a detector be shown to fail before its green is believed,
**and** that the sabotage be shown to have landed. Both were read back from
the database rather than assumed.

| Step | Command | Read back | Drive result |
|---|---|---|---|
| sabotage | `alter table public.jobs disable trigger jobs_journal_terminal_failure` | `tgenabled = D` | **`FAIL A: expected 1 impediment, got 0`** |
| restore | `alter table public.jobs enable trigger …` | `tgenabled = O` | **`DRIVE-RESULT PASS A=1 B=1 C=0`** |

The sabotage is deliberately **not** automated in `verify:journals`.
Disabling a trigger on `public.jobs` and then crashing would leave production
without the guard — the same shape as `verify:disconnect` deleting Slack's
token on every run, and `alter table … disable trigger` cannot be wrapped in
the statement that asserts against it.

## Regression

`npm run verify:journals`, in the gate. Its history half asserts a
**property** — no real job that reached `failed` after 0535 was applied may
have nothing recorded — rather than a count, which would go red on a bad
morning and green after a harness run.

---

# Evidence — a gateway 5xx is not an answer from Postgres

Found while running the neighbouring suites for 0535.

`verify:failures` died twice with `502 Bad gateway` — an HTML body from
Cloudflare, at two *different* call sites (line 121, then line 57). Six
single-statement probes taken a minute later all succeeded, so the API was
up; the suite makes many rapid sequential calls.

`ManagementApiExecutor.RETRY_ON` was `new Set([429, 503])`. **502 and 504
were raised immediately as though Postgres had answered** — which is exactly
what that code's own comment forbids: *"An infra failure must never enter a
measurement as data."*

It is not a test-only concern. `supabase/functions/worker/index.ts` line 264
falls back to this executor whenever the direct Postgres connection is
unavailable:

```ts
const db: SqlExecutor = direct ?? new ManagementApiExecutor(PROJECT_REF, ACCESS_TOKEN)
```

so a transient 502 in production **burns a job attempt**, and five burnt
attempts is a permanently failed job.

## The fix is a property, not a longer list

The two layers use disjoint status ranges: Postgres answers as a **400**
carrying a JSON `message`; anything **5xx** is the transport. So the
predicate is `status === 429 || status >= 500`.

## Controls — proved by sabotage

| Step | Read back | Result |
|---|---|---|
| sabotage: `return status === 429 \|\| status === 503` | line 133 read back changed | **3 failed / 3 passed** |
| restore: `return status === 429 \|\| status >= 500` | line 133 read back restored | **6 passed** |

The three that went red were the 502, the 504 and the attempt-ceiling test.
The three that stayed green were the throttle, the Postgres 400 and the 401 —
so the test discriminates rather than merely failing, which a sabotage that
turned everything red could not have shown.

`verify:failures` then passed **16/16**. Causation is not claimed — the
gateway may simply have recovered — but the behaviour is pinned by the unit
test either way.

---

# Evidence — why the backup was dying: a resumption was being counted as a retry

0535 made the death visible. This is the cause.

## The trend, from `public.jobs` itself

| date | slices used | worker deaths | rows in the database |
|---|---|---|---|
| 12–16 Sep | 1 | 0 | 35k → 78k |
| **17 Sep** | **5 — FAILED** | 4 | ~90k |
| 18 Sep | 2 | 1 | 107k |
| 19 Sep | 2 | 1 | 119k |
| 20 Sep | 2 | 1 | 135k |
| **21 Sep** | **3** | 2 | 135k |

The 17 September job has **zero rows in `job_steps`** — 0436's checkpointing
did not exist yet, so every attempt restarted from nothing and none of the
five finished. Checkpointing is why the 18th onwards succeed at all.

The 17 Sept transition log, in full:

```
22:19:00  queued  -> running    attempt 1  dequeued by edge-4ad731f3
22:24:00  running -> retrying   attempt 1  recovery: worker edge-4ad731f3 died holding this in running
22:24:01  retrying-> queued     attempt 1  requeued after retry
22:24:01  queued  -> running    attempt 2  dequeued by edge-5b9a43ef
22:30:21  running -> retrying   attempt 2  recovery: worker edge-5b9a43ef died holding this in running
   … three more, identically …
22:54:00  running -> failed     attempt 5  recovery: 5 attempts exhausted while in running
```

## The defect

`app.dequeue_job` does `attempt = attempt + 1` on every dequeue, and
`jobs.lease_seconds` is 300. An edge worker is killed by its runtime long
before a 122-table backup finishes. So `attempt` carries two meanings —
how many times the job FAILED, which is what a retry cap is for, and how many
times it was PICKED UP, which for a checkpointed job is just how far it got.

Two slices of headroom remained, with the work growing daily and nothing
anywhere watching the margin.

## The fix, and the two ways the obvious version was wrong

A slice is granted by **raising `max_attempts`**, not by ignoring it. The
first draft simply requeued and left the ceiling alone. It applied cleanly and
could never have worked:

1. `jobs_attempt_within_max` is `attempt <= max_attempts`, so the next
   `dequeue_job` would have raised a CHECK violation.
2. `app.requeue_retrying` only moves rows `where attempt < max_attempts`, so
   the job would have sat in `retrying` **for ever** — never requeued, never
   failed, invisible to every reading of the queue.

The second is worse than the defect being fixed: a backup that fails loudly
becomes one that silently stops. Both were found by **driving** the function;
reading the migration showed nothing. CLAUDE.md's recorded rule covers it
exactly — loosening a rule does not loosen the function that pre-checks it,
so grep for the other function that enforces the same thing.

## Controls

| Control | Asserts | Result |
|---|---|---|
| P | at the ceiling, having finished a checkpoint → resumes, ceiling raised | `retrying`, max_attempts 5 → **6** |
| round trip | `requeue_retrying` then `dequeue_job` actually take it | `queued` → **`running`** |
| N | at the ceiling, having finished nothing → still dies | **`failed`** |
| C | past `jobs.max_dequeues` while progressing → dies anyway | **`failed`** |

Three independent bounds, so nothing can run for ever: progress is monotonic,
an attempt that finishes nothing spends normally, and `jobs.max_dequeues`
(60) ends it regardless.

### Harness audit

| Step | Read back | Result |
|---|---|---|
| sabotage: `jobs.max_dequeues = 1` | value read back as `1` | **`RESUMES-FAIL a job that finished a checkpoint became [failed] instead of retrying`** |
| restore: `jobs.max_dequeues = 60` | value read back as `60` | **green** |

Debris after every run: `0` jobs. The drive ends by raising, so it rolls back
— and `app.recover_stalled_jobs()` is global by design, so wrapping the CALL
rather than the assertion is the only safe way to drive it.

`npm run verify:resumes`, in the gate. It prints the real backup's slice count
against its ceiling every run, because that margin is the thing nobody was
watching.
