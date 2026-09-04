# Phase 6 evidence — autonomy

**Date:** 2026-09-04 · **Database:** Supabase project `baujwlzcziasnfhhkchg`, PostgreSQL 17.6
**Reproduce:** `npm run verify:autonomy` (source: `scripts/verify/autonomy.ts`) · **27/27**, idempotent
**Also:** `npm run verify:jobs` covers capacity under concurrent load; `npx vitest run tests/briefings`

Phase 6's acceptance:

> limits hold under concurrent load and across restarts; "leave me alone today"
> persists as structured preference; Needs Me stays small.

The first two were already true before this phase and are cited rather than
re-derived: capacity is enforced **at dequeue** under an advisory lock (0006),
which is precisely what makes it survive a restart, and `verify:jobs`
demonstrates it. "Leave me alone today" is 0013 plus the deterministic parser
in `src/channels/preferences.ts`.

## Three properties this phase adds

**Autonomy is not authority.** A project at `act` still cannot reach a
policy-disabled tool or commit unreviewed output. Asserted by asking both
systems in one query rather than assumed from the fact that they are separate
tables. The app role has `SELECT` and nothing else on `autonomy_settings` — an
autonomy level an agent can raise is not a level — and a missing configuration
falls back to `suggest`, because absent config must never read as permission.

**Needs Me reports its overflow rather than truncating.** A list that silently
shows 7 of 40 looks healthy at exactly the moment it stops being useful. The
view returns everything, the cap belongs to whatever renders it, and
`app.needs_me_pressure()` returns the suppressed count so a failing filter is
visible. Ordering is overdue first, then work that is actually stopped — the
only place `work_can_continue` earns its column.

**A restart must not send a second morning briefing.** Recovery here is "read
state, continue", so a duty that crashed after sending and before recording
*will* be re-attempted. `(kind, scope_ref, for_date)` is unique and the insert
is `ON CONFLICT DO NOTHING`: uniqueness belongs to the index, because a
SELECT-then-INSERT loses exactly the race that happens here. `for_date` is
stored rather than derived — a briefing generated at 23:40 UTC may be
tomorrow's, and both directions are tested across timezones.

## Why briefings call no model

Every sentence in a briefing is load-bearing — it is the thing read to decide
what to do. A model-written briefing is therefore either unreviewed, and by §16
must not be relied on, which defeats its purpose; or reviewed, by somebody, at
07:00. Composed text sidesteps the question entirely: *"3 things need you, 1
overdue"* is a count, not a claim. §6's deterministic-first rule and §16's
review rule point the same way here, which is rare enough to be worth noting.

## The fixture leak, found by the feature that consumed it

The first real briefing reported **63 jobs in flight**. All of them were
debris: `purge:fixtures` archived fixture projects and left their jobs live, so
every verification run added a few more to a set that only grew.

This is worse than untidy in a specific way. Today, Needs Me, the briefings and
`project_attention()` all read live jobs, so fixture leakage does not clutter a
table — **it makes every summary in the system wrong**, quietly, in the
direction of "looks busy". Jobs are now terminated along legal transitions
before their project is archived, orphans from earlier runs are swept, and the
purge report shows live-job counts so the next leak is visible before something
else reads it.

Worth naming the pattern: the bug had existed for several phases and no test
caught it, because no test asked a question whose answer depended on the total
population. The feature that finally noticed was the first one that summarised
everything at once.

## Two of my own checks, fixed after they passed

- One compared a **project-scoped** view count against a **global** open count
  and printed "10 of 12" as though that were evidence of non-truncation. Two
  different populations; the arithmetic was meaningless.
- One carried the label *"a duty stops firing when its owner is deactivated"*
  while deactivating nothing. Doing it properly meant creating a fixture owner
  first — deactivating `chief-of-staff` to prove a query filter would have been
  the same mistake that left `gmail.send` enabled and moved
  `research-director`'s prompt.

## Live results

| group | check | outcome | |
|---|---|---|---|
| autonomy | the global default is the cautious end, not the permissive one | global=suggest | ✅ |
| autonomy | a project with no setting of its own inherits the global level | project=suggest | ✅ |
| autonomy | a project setting overrides global WITHOUT changing global | project=act global=suggest | ✅ |
| autonomy | an agent cannot raise its own autonomy level | Failed to run sql query: ERROR: 42501: permission denied for table autonomy_settings  | ✅ |
| autonomy | the autonomy history cannot be rewritten after the fact | Failed to run sql query: ERROR: 42501: public.autonomy_settings is append-only: UPDATE is never permitted (master spec § | ✅ |
| autonomy | autonomy at `act` does NOT unlock a policy-disabled tool | autonomy=act gmail.send allowed=false | ✅ |
| responsibilities | a never-run duty is due immediately | 1 due, key=duty:fixture-duty-mtmh04ea:496804 | ✅ |
| responsibilities | the idempotency key is stable within a period, so a re-fire collides | duty:fixture-duty-mtmh04ea:496804 == duty:fixture-duty-mtmh04ea:496804 | ✅ |
| responsibilities | a duty firing twice in one period collides instead of duplicating | Failed to run sql query: ERROR: 23505: duplicate key value violates unique constraint "jobs_one_live_per_idempotency_key" DETAIL:  | ✅ |
| responsibilities | a duty that just ran is not due again until its period elapses | 0 due | ✅ |
| responsibilities | a duty cannot be scheduled faster than the sync cadence | Failed to run sql query: ERROR: 23514: new row for relation "responsibilities" violates check constraint "responsibiliti | ✅ |
| needs me | ordering puts overdue first, then work that is actually stopped | overdue > blocked > informational | ✅ |
| needs me | when the list outgrows the cap, the overflow is reported rather than hidden | open=12 cap=7 suppressed=5 | ✅ |
| needs me | the view itself does NOT truncate - hiding items would hide the problem | view returns 12, 12 open, cap 7 | ✅ |
| needs me | resolved blockers leave the list | 0 remaining for this project | ✅ |
| today | live work appears in Today with a computed staleness, so nothing looks stuck silently | state=queued minutes_since_change=0 | ✅ |
| today | Today excludes finished work | 1 live row(s), states: queued | ✅ |
| responsibilities | a duty stops firing when its owner is deactivated | due with active owner: 1, after deactivating the owner: 0 | ✅ |
| briefings | a morning briefing is generated from live counts | 5 lines, 5 live job(s) | ✅ |
| briefings | a re-attempted duty does NOT send a second morning briefing | second attempt returned null (already exists), 1 row(s) stored | ✅ |
| briefings | the evening briefing on the same day is not blocked by the morning one | generated | ✅ |
| briefings | tomorrow's morning briefing is not blocked by today's | generated for 2026-09-05 | ✅ |
| briefings | a muted briefing is generated-and-suppressed, distinguishable from a crash | delivered_at=null reason=quiet_until is in the future (leave me a | ✅ |
| briefings | what a briefing said cannot be changed after the fact | Failed to run sql query: ERROR: 23514: a briefing's content cannot be changed after it is generated. Delivery fields may be update | ✅ |
| briefings | delivery CAN be recorded afterwards, so the body rule is a gate not a wall | delivered_to=telegram | ✅ |
| monitoring | project_attention reports facts per active project, not a score | 4 active project(s); columns: slug, open_blockers, live_jobs, stalled_jobs, has_brief, brief_is_stale | ✅ |
| monitoring | a project with live work and no brief is reported as exactly that | live_jobs=1 has_brief=false open_blockers=0 | ✅ |

## Known limitations

- **Briefings are generated but not yet delivered.** The `delivered_at` /
  `delivered_to` path is proved; nothing yet calls it on a schedule. That is
  Phase 7's delivery routing.
- **`for_date` needs a timezone from somewhere.** `localDate` takes one; the
  scheduler that will call it does not yet have a configured value for Grant.
- **`project_attention()` is a query, not a monitor.** Nothing yet runs it on a
  cadence and raises blockers from it; the responsibility row that would do so
  is expressible but not seeded.
