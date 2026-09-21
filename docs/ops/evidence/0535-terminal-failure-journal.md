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
