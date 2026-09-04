# Phase 5 evidence — the agent engine

**Date:** 2026-09-04 · **Database:** Supabase project `baujwlzcziasnfhhkchg`, PostgreSQL 17.6
**Reproduce:** `npm run verify:agents` (source: `scripts/verify/agents.ts`) · **45/45**, idempotent across consecutive runs
**Unit tests:** `npx vitest run tests/agents tests/staff` — intent, router, quality gate, avatars

Phase 5's acceptance is four sentences and three of them say *cannot*:

> an output without `reviewer_status` **cannot reach `committed`**; material
> disagreement is surfaced rather than averaged away; duplicate-work avoidance
> is enforced by the router as a required query; ambiguous input produces a
> bounded investigation or a clarification, never an uncontrolled multi-agent
> workload.

Every *cannot* below is proved by **attempting it against the live database and
reading the refusal**. None is proved by asserting that a constraint exists.

## Where each criterion is enforced

| Criterion | Enforced by | Not by |
|---|---|---|
| Unreviewed output cannot commit | `app.enforce_review_gate()` trigger on `jobs` (0018) | a check in a worker |
| The review exemption is checkable | `app.enforce_deterministic_claim()` (0023) | trusting `outputs.deterministic` |
| Duplicate query is required | unforgeable `DuplicateScan` type + NOT NULL non-empty `subject_terms` (0020/0021) | calling the scan first by convention |
| Ambiguity stays bounded | `routing_decisions_unconfident_stays_small` (0020) | a prompt asking the model to be careful |
| Delegation cannot run away | `app.enforce_delegation_depth()` trigger on `jobs` (0020) | a depth counter in the enqueue path |
| Team shape is Grant's | `create_temporary_specialist` with `permanent` hard-coded, no table grant (0024) | a policy document |

## Four defects this phase, each found by the check failing

**1. A duplicate scan that could never match.** The first scan searched
`jobs.idempotency_key` with `ILIKE`. §6 derives that key from semantic inputs —
a hash — so the query could not have matched anything, ever. It would have
recorded a constraint-satisfying `none_found` for the life of the project and
reported clean. Fixed in 0021 by comparing subject terms, which also made the
blind spot reportable: `none_found` against 0 invisible jobs is not the claim it
is against 40.

**2. A safety check that performed the breach it was testing.** The check meant
to prove the app role cannot enable `gmail.send` ran through the Management API
as superuser, and its pass condition accepted a successful `UPDATE` as a pass.
It reported ✅ and left `gmail.send` **enabled**. The neighbouring check looked
like confirmation but was measuring the level-3 approval rule, which returns
`false` whether or not the tool is policy-disabled — a check that passes
identically in the safe and unsafe state. Restored in 0022. The check now runs
as `ai_team_app`, asks the discriminating question (refused **with** approval
granted), has a control proving it discriminates, and is backed by baseline
drift detection.

**3. The same class of mistake, two hours later, in another table.** The
prompt-versioning checks demonstrated on `research-director` and left a real
permanent role carrying a prompt written by a test. Repaired by 0025 as version
3 — append-only and no-going-backwards were not suspended for my mistake, so
version 2 remains in the history as what it was. The checks now use a fixture
specialist and assert the roster is unchanged before/after.

**4. A "must be refused" check with nothing to refuse.** The retroactive-exemption
check ran an `UPDATE` matching zero rows. A zero-row `UPDATE` succeeds, so it
reported "(no error)". Given a real row to refuse, and a confirmation that the
row is unchanged afterwards.

The recurring shape, now five phases deep: **a check whose result does not
depend on the thing under test is not a check.** It has appeared as a
hardcoded literal, as a wrong column, as a wrong role, as an over-broad pass
condition, and as an empty result set.

## The gap in §16 that 0018 left open

§16 defines the review exemption by *how* an answer was produced — *"because
that is checkable, whereas 'was it important?' is not"* — and two paragraphs
later says *"the gate cannot be bypassed by the caller."* 0018 satisfied the
first and broke the second: `outputs.deterministic` skipped review and nothing
checked it, so an agent could exempt its own inferred conclusion by writing
`true` into the field designed to make the exemption checkable.

0023 checks it. Two facts contradict a determinism claim: the output names a
model, or the job has inference usage recorded against its correlation id (§11
requires logging every attempt, failures included). The guarantee is
deliberately narrow — not *no inference happened*, since a job may hold both
mechanical and inferred outputs — but sufficient: a claim of exemption must
stay checkable from the record.

## Live results

| group | check | outcome | |
|---|---|---|---|
| review gate | a job with an unreviewed output cannot reach committed | Failed to run sql query: ERROR: 23514: job eab9990c-ead0-4f43-a67f-393e4781d24e cannot reach committed: 1 of 1 output(s) are unreviewed. §10: the comm | ✅ |
| review gate | the same job commits once the output is reviewed | state=committed | ✅ |
| review gate | a REJECTED output cannot be committed either | Failed to run sql query: ERROR: 23514: job e0acf9e3-1378-4f94-b33e-0144040467eb cannot reach committed: at least one output was REJECTED by review. Co | ✅ |
| failure injection | malformed output (blank body) is refused | Failed to run sql query: ERROR: 23514: new row for relation "outputs" violates check constraint "outputs_body_substantiv | ✅ |
| disagreement | approval WITH RESERVATIONS must say what they are | Failed to run sql query: ERROR: 23514: new row for relation "outputs" violates check constraint "outputs_reservations_ar | ✅ |
| failure injection | contradictory sources are surfaced verbatim, not averaged into one number | confidence=low status=approved_with_reservations contradictions recorded=true | ✅ |
| review gate | an output claiming determinism while naming a model is refused | Failed to run sql query: ERROR: 23514: output 4e874421-0f35-4efb-819c-d8eab59ceedb cannot be marked deterministic: it records model some/free-model. § | ✅ |
| review gate | a genuinely mechanical output IS allowed the exemption | deterministic outputs on a no-inference job: 1 | ✅ |
| review gate | the same claim is refused once the job has recorded inference usage | Failed to run sql query: ERROR: 23514: output cannot be marked deterministic: job 8aae8575-5e71-4803-9ddd-1d76a994f7c5 has 1 recorded inference attempt(s) against correla | ✅ |
| review gate | the exemption cannot be granted retroactively by an update | Failed to run sql query: ERROR: 23514: output cannot be marked deterministic: job 8aae8575-5e71-4803-9ddd-1d76 | still deterministic=false | ✅ |
| roster | the router's role constants still match the seeded staff | all eight match | ✅ |
| required query | a routing decision with NO duplicate search is refused | Failed to run sql query: ERROR: 23514: new row for relation "routing_decisions" violates check constraint "routing_decis | ✅ |
| required query | the first request finds nothing and is recorded as none_found | terms=[research competitor pricing enterprise tier] resolution=none_found blind spot=38 live job(s) | ✅ |
| required query | a differently-worded request for the same work FINDS the live job | matched 3 term(s): competitor, pricing, enterprise | ✅ |
| required query | the idempotency index could NOT have caught this (two live jobs, different keys) | 2 live job(s), 2 distinct key(s) | ✅ |
| required query | the duplicate is LINKED to the existing job rather than duplicated | resolution=linked_to_existing linked=580faef5 | ✅ |
| required query | claiming to have linked, without naming the job, is refused | Failed to run sql query: ERROR: 23514: new row for relation "routing_decisions" violates check constraint "routing_decis | ✅ |
| required query | proceeding past a near-duplicate without arguing for it is refused | Failed to run sql query: ERROR: 23514: new row for relation "routing_decisions" violates check constraint "routing_decis | ✅ |
| required query | a recorded routing decision cannot be rewritten afterwards | Failed to run sql query: ERROR: 42501: public.routing_decisions is append-only: UPDATE is never permitted (master spec § | ✅ |
| ambiguity | a contested reading produces a clarification and convenes NOBODY | intent=suggestion confident=false clarify=true roster=[] | ✅ |
| ambiguity | the database refuses a team convened on an unconfident reading | Failed to run sql query: ERROR: 23514: new row for relation "routing_decisions" violates check constraint "routing_decis | ✅ |
| ambiguity | a CONFIDENT request still gets a bounded roster, not a team | intent=assignment roster=[research-director] (1) | ✅ |
| failure injection | delegation is permitted down to the configured depth | depths reached: 1, 2, 3 | ✅ |
| failure injection | runaway delegation is refused one level past the cap | Failed to run sql query: ERROR: 23514: job cannot be created at delegation depth 4: the limit is 3. §9 caps delegation because delegation that spawns  | ✅ |
| failure injection | an INVENTED tool name fails closed rather than falling through | files.delete (not in the table) allowed=false | ✅ |
| failure injection | a forbidden DESTRUCTIVE tool is refused even with approval | db.delete (level 3, disabled) approved=true allowed=false | ✅ |
| failure injection | gmail.send is refused even WITH approval, which only a policy disable can do | tool_allowed('gmail.send', approved=true)=false | ✅ |
| failure injection | a tool that is NOT policy-disabled is allowed, so the check above discriminates | tool_allowed('calendar.write', approved=true)=true | ✅ |
| failure injection | the app role cannot grant itself the disabled tool | Failed to run sql query: ERROR: 42501: permission denied for table tool_permissions  | ✅ |
| failure injection | gmail.send is still disabled after the attempt | enabled=false | ✅ |
| failure injection | the live tool policy matches the seeded baseline (no silent drift) | 6 tool(s) checked, all as seeded | ✅ |
| staff builder | the app role CAN create a temporary specialist | staff_id=9bd76503 | ✅ |
| staff builder | a specialist with a non-reason for existing is refused | Failed to run sql query: ERROR: 23514: new row for relation "staff" violates check constraint "staff_temporary_is_justif | ✅ |
| staff builder | a specialist with no expiry is refused - that is a ninth permanent role | Failed to run sql query: ERROR: 23514: a temporary specialist must expire in the future (got <NULL>). §9 keeps the specialist set  | ✅ |
| staff builder | the app role cannot insert PERMANENT staff directly | Failed to run sql query: ERROR: 42501: permission denied for table staff  | ✅ |
| staff builder | a temporary specialist cannot be promoted to permanent | Failed to run sql query: ERROR: 23514: staff fixture-specialist-mtmfumys cannot be promoted from temporary to permanent. §21 reser | ✅ |
| staff builder | the specialist cap refuses the one past 3 | Failed to run sql query: ERROR: 23514: cannot create temporary specialist fixture-specialist-mtmfumys-over: 3 of 3 slots are alrea | ✅ |
| staff builder | expired specialists are swept inactive, not left for each caller to filter | expired 3, still active 0 | ✅ |
| prompt versioning | every permanent role's prompt_version resolves to real text | all 8 pointers resolve | ✅ |
| prompt versioning | every permanent role runs a prompt authored by a migration, not by a test | all 8 authored by migrations | ✅ |
| prompt versioning | pointing at a prompt version that does not exist is refused | Failed to run sql query: ERROR: 23503: staff fixture-promptsubject-mtmfumys cannot point at prompt version 7: no such version exis | ✅ |
| prompt versioning | the pointer moves once the version exists | prompt_version=2 | ✅ |
| prompt versioning | the pointer cannot go backwards - a pinned version must mean one thing | Failed to run sql query: ERROR: 23514: staff fixture-promptsubject-mtmfumys prompt_version cannot go backwards (2 -> 1). A pinned  | ✅ |
| prompt versioning | a published prompt version cannot be rewritten | Failed to run sql query: ERROR: 42501: public.staff_prompts is append-only: UPDATE is never permitted (master spec §6) H | ✅ |
| prompt versioning | this run left every permanent role exactly as it found it | unchanged: chief-of-staff=1,communications-director=1,finance-director=1,growth-director=1,operations-director=1,quality-director=1,research-director=3,strategy-director=1 | ✅ |

## Known limitations, stated rather than buried

- **The scan sees only routed jobs.** A job enqueued by a path that does not
  call the router has no subject terms and is invisible to duplicate detection.
  Reported per scan via `app.unrouted_live_jobs()` rather than papered over
  with a second, unreliable signal — mixing a reliable check with an unreliable
  one produces a check whose misses are unattributable.
- **Term matching is crude by design.** Lowercase, split on non-letters, drop
  stop words and anything under four characters. It is a net, not a search
  engine: a spurious candidate costs a human glance, a missed duplicate costs
  duplicated work.
- **`routing_decisions.roster` has no foreign key** to `staff`. Slugs are
  stable identity seeded by migration, and the row is read by humans after the
  fact, for whom a uuid says nothing. `verifyRosterMatchesDatabase` catches
  drift instead.
- **Layer 2 spend-cap backstop remains unproven** (parked; costs $5 to reach).
