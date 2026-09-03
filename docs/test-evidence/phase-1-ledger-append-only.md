# Phase 1 evidence — the event ledger is append-only

**Date:** 2026-09-03 · **Database:** Supabase project `baujwlzcziasnfhhkchg`, PostgreSQL 17.6
**Reproduce:** `npm run verify:ledger` (source: `scripts/verify/ledger.ts`)

Master spec §6 requires the ledger to be append-only *"enforced at the
database level ... A convention of immutability is not immutability."* This is
the demonstration, not an assertion: every forbidden operation is attempted
against the live database and required to fail with a specific SQLSTATE **and**
a message naming the thing under test.

## Why four layers

`REVOKE` alone leaves three holes, and each layer closes one:

| Hole | Closed by |
|---|---|
| `REVOKE` cannot restrain the table **owner**, and migrations run as the owner | layer 2, a row trigger that fires for every role |
| `TRUNCATE` bypasses row triggers entirely and is not `DELETE` | layer 3, a statement-level `BEFORE TRUNCATE` trigger |
| A future migration could re-`GRANT` by accident | layer 4 (no UPDATE/DELETE policy exists) and CI's `ledger/no-regrant-write` rule |

### ⚠️ Correction, 2026-09-03: what layer 4 does and does not buy

An earlier version of this document said `FORCE ROW LEVEL SECURITY` "subjects
the owner to the policies as well". **That is not true on this database.**
Measured:

```
rolname          rolsuper  rolbypassrls
postgres         false     TRUE
service_role     false     TRUE
supabase_admin   TRUE      TRUE
authenticator    false     false
```

`BYPASSRLS` overrides `FORCE`, so `postgres` reads every row regardless of
policy — confirmed directly with `SET LOCAL row_security = on`, which still
returned all 8 rows. Supabase grants `BYPASSRLS` to `postgres` and to
`service_role`, which is the concrete reason §15 calls the service-role key the
highest-blast-radius credential in the system.

**The append-only guarantee is unaffected**, and this is why the layering
matters rather than being belt-and-braces theatre: **layer 2, the row trigger,
is what actually restrains the owner**, and the table above shows it doing so —
`postgres` was refused with `42501: events is append-only`. Triggers are not
subject to `BYPASSRLS`.

So layer 4's real contribution is narrower than claimed: RLS constrains
`ai_team_app` and any future non-bypassing role, and the absence of an
UPDATE/DELETE policy means a mistaken re-`GRANT` still would not help them. It
is not what stops the owner. Stated precisely because a security control
credited with a property it does not have is worse than one honestly scoped.

## Result

| layer | attempt | outcome | |
|---|---|---|---|
| write path | INSERT via append_event() as the application role | succeeded, as required | ✅ |
| layer 1: REVOKE | UPDATE as the application role | refused with 42501: 42501: permission denied for table events | ✅ |
| layer 1: REVOKE | DELETE as the application role | refused with 42501: 42501: permission denied for table events | ✅ |
| layer 2: row trigger | UPDATE as the table owner (postgres) | refused with 42501: 42501: events is append-only: UPDATE on public.events is never permitted (master spec §6) | ✅ |
| layer 2: row trigger | DELETE as the table owner (postgres) | refused with 42501: 42501: events is append-only: DELETE on public.events is never permitted (master spec §6) | ✅ |
| layer 3: truncate trigger | TRUNCATE as the table owner | refused with 42501: 42501: events is append-only: TRUNCATE on public.events is never permitted (master spec §6) | ✅ |
| layer 4: RLS | row level security enabled and FORCED on public.events | enabled=true forced=true | ✅ |
| layer 4: RLS | no UPDATE or DELETE policy exists, so a re-GRANT would still be refused | 0 such policies | ✅ |
| undo | first compensating event for the original | succeeded, as required | ✅ |
| undo | second compensating event for the SAME original (Undo pressed twice) | refused with 23505: 23505: duplicate key value violates unique constraint "events_one_compensation_per_event" | ✅ |
| write boundary | reversible = true with no reversal_method | refused with 23514: 23514: new row for relation "events" violates check constraint "events_reversal_method_iff_reversible" | ✅ |
| write boundary | a 1001-character rationale (chain-of-thought would not fit either) | refused with 23514: 23514: new row for relation "events" violates check constraint "events_rationale_is_a_summary" | ✅ |
| write boundary | a free-form action_type ("Did Some Stuff") | refused with 23514: 23514: new row for relation "events" violates check constraint "events_action_type_format" | ✅ |
| write boundary | an unknown actor_kind ("robot") | refused with 23514: 23514: new row for relation "events" violates check constraint "events_actor_kind_known" | ✅ |
| result | the event under test is unchanged after every attempt | actor = "phase-1-verification" | ✅ |

15/15 checks passed

## A false pass found and fixed on the way

The first run of this script reported **14/15**, and two of those fourteen
passes were wrong.

`ai_team_app` was created `NOLOGIN` in migration 0001, on the reasoning that a
role with no password has no credential to leak and `SET LOCAL ROLE` would be
enough to test its grants. But `SET ROLE` requires the session to be a **member**
of the target role, so both layer-1 attempts failed with:

```
42501: permission denied to set role "ai_team_app"
```

That is `insufficient_privilege` — the same SQLSTATE a refused `UPDATE` returns.
The harness matched on SQLSTATE alone, so it counted two setup failures as proof
that the ledger refused a write it had never been asked to perform.

Two fixes, both of which outlive this script:

1. Migration `0004_role_membership.sql` grants `ai_team_app` to `postgres`, so
   enforcement can be tested **as the role it restrains** from a session that has
   no password for it. This gives nothing away: `postgres` owns the tables and
   can already do strictly more.
2. `failsWith()` now requires an expected **phrase** as well as a SQLSTATE. Layer
   1 must say `permission denied for table events`; layer 2 must say
   `append-only`. That is what separates "the ledger refused the write" from
   "the test could not set itself up".

> A check that fails for the wrong reason and reports success is worse than no
> check, because it is counted as evidence.
