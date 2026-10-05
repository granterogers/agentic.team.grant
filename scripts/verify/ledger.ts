/**
 * Demonstrate — not assert — that the event ledger is append-only.
 *
 * Phase 1's acceptance criteria require `UPDATE`/`DELETE` on `events` to fail
 * *at the database level*. This script proves it against the live database by
 * attempting each forbidden operation and requiring it to fail with the
 * expected SQLSTATE. A test that only checks the happy path would pass against
 * a ledger with no protection at all.
 *
 *   npm run verify:ledger
 *
 * Safe to re-run: everything it writes is inside one project it creates and
 * leaves behind, and the ledger is append-only so nothing can be cleaned up
 * anyway — which is itself the point.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor, SqlExecutionError } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

interface Check {
  readonly layer: string
  readonly what: string
  readonly outcome: string
  readonly passed: boolean
}
const checks: Check[] = []

/** Require a statement to succeed. */
async function succeeds(layer: string, what: string, sql: string): Promise<void> {
  try {
    await db.execute(sql)
    checks.push({ layer, what, outcome: 'succeeded, as required', passed: true })
  } catch (error) {
    checks.push({
      layer,
      what,
      outcome: `FAILED but should have succeeded: ${(error as Error).message.trim()}`,
      passed: false,
    })
  }
}

/**
 * Require a statement to fail, with a specific SQLSTATE **and** a specific
 * phrase in the message.
 *
 * The SQLSTATE alone is not enough, and this script proved it: `SET ROLE
 * ai_team_app` failed with 42501 (`insufficient_privilege`) because the session
 * was not a member of that role, so two tests of the ledger's UPDATE/DELETE
 * grants never reached an UPDATE or a DELETE — and were counted as passes.
 *
 * Requiring the message to name the thing under test is what distinguishes
 * "the ledger refused the write" from "the test could not set up". A check that
 * fails for the wrong reason and reports success is worse than no check.
 */
async function failsWith(
  layer: string,
  what: string,
  sql: string,
  sqlstate: string,
  expectedPhrase: string,
): Promise<void> {
  try {
    await db.execute(sql)
    checks.push({ layer, what, outcome: 'SUCCEEDED — it must not have', passed: false })
    return
  } catch (error) {
    const message = error instanceof SqlExecutionError ? error.message : String(error)
    const firstLine = (message.split('\n')[0] ?? '').replace(
      /^Failed to run sql query: ERROR:\s*/,
      '',
    )
    const codeMatched = message.includes(sqlstate)
    const phraseMatched = message.toLowerCase().includes(expectedPhrase.toLowerCase())

    if (codeMatched && phraseMatched) {
      checks.push({
        layer,
        what,
        outcome: `refused with ${sqlstate}: ${firstLine.slice(0, 105)}`,
        passed: true,
      })
    } else if (!codeMatched) {
      checks.push({
        layer,
        what,
        outcome: `wrong SQLSTATE (expected ${sqlstate}): ${firstLine.slice(0, 95)}`,
        passed: false,
      })
    } else {
      checks.push({
        layer,
        what,
        outcome: `right code, wrong cause — expected the message to mention "${expectedPhrase}": ${firstLine.slice(0, 80)}`,
        passed: false,
      })
    }
  }
}

const runId = Date.now().toString(36)
const correlation = (await db.execute('select gen_random_uuid() as id')).rows[0]?.id as string

// ---------------------------------------------------------------------------
// Setup: a project and one real event, written through the intended boundary.
// ---------------------------------------------------------------------------
await db.execute(`
  with created as (
    insert into public.projects (slug, name)
    values ('ledger-proof-${runId}', 'Ledger proof ${runId}')
    returning project_id
  )
  -- 0067: an active project must be attached to something real, and this one
  -- defaults to active. One statement, so the deferred constraint sees both.
  insert into public.project_attachments
    (project_id, connector, external_ref, display_name, role)
  select project_id, 'upload', 'fixture', 'Verification fixture', 'source' from created
`)

const eventId = (
  await db.execute(`
  select app.append_event(p_office => app.test_office(),
    p_correlation_id => '${correlation}'::uuid,
    p_actor_kind     => 'system',
    p_actor          => 'phase-1-verification',
    p_trigger        => 'manual_verification',
    p_action_type    => 'ledger.proof_written',
    p_reversible     => true,
    p_reversal_method => 'append a compensating event',
    p_rationale_summary => 'Proving append-only enforcement at the database level.'
  ) as event_id
`)
).rows[0]?.event_id as string

console.log(`event under test: ${eventId}\n`)

// ---------------------------------------------------------------------------
// The write path must work. An unwritable ledger is not append-only, it is
// broken — and would make every check below pass for the wrong reason.
// ---------------------------------------------------------------------------
await succeeds(
  'write path',
  'INSERT via append_event() as the application role',
  `set local role ai_team_app;
   select app.append_event(p_office => app.test_office(),
     p_correlation_id => '${correlation}'::uuid,
     p_actor_kind => 'agent', p_actor => 'verifier',
     p_trigger => 'manual_verification', p_action_type => 'ledger.app_role_append',
     p_reversible => false
   )`,
)

// ---------------------------------------------------------------------------
// Layer 1 — REVOKE (§6's verbatim requirement)
// 42501 = insufficient_privilege
// ---------------------------------------------------------------------------
await failsWith(
  'layer 1: REVOKE',
  'UPDATE as the application role',
  `set local role ai_team_app;
   update public.events set actor = 'tampered' where event_id = '${eventId}'`,
  '42501',
  'permission denied for table events',
)
await failsWith(
  'layer 1: REVOKE',
  'DELETE as the application role',
  `set local role ai_team_app;
   delete from public.events where event_id = '${eventId}'`,
  '42501',
  'permission denied for table events',
)

// ---------------------------------------------------------------------------
// Layer 2 — the row trigger, which binds the OWNER as well
//
// This is the layer that matters most, because REVOKE cannot restrain the
// owner and migrations necessarily run as the owner.
// ---------------------------------------------------------------------------
await failsWith(
  'layer 2: row trigger',
  'UPDATE as the table owner (postgres)',
  `update public.events set actor = 'tampered' where event_id = '${eventId}'`,
  '42501',
  'is append-only',
)
await failsWith(
  'layer 2: row trigger',
  'DELETE as the table owner (postgres)',
  `delete from public.events where event_id = '${eventId}'`,
  '42501',
  'is append-only',
)

// ---------------------------------------------------------------------------
// Layer 3 — TRUNCATE, which bypasses row triggers entirely
// ---------------------------------------------------------------------------
// Two checks, not one, because two independent mechanisms now refuse this and
// only one of them is the layer under test.
//
// A plain TRUNCATE has been refused with 0A000 - "cannot truncate a table
// referenced in a foreign key constraint" - ever since 0011 gave
// `inbound_commands` a reference to `events`. The refusal is real, so the
// property held; but Postgres rejects BEFORE the statement trigger runs, so
// the trigger stopped being exercised and nobody noticed. The check reported a
// wrong SQLSTATE, which is how it was eventually found.
//
// That is worth stating plainly: a second mechanism arriving in front of the
// one under test silently retires the test, while the suite stays green on the
// property. Layers are good; a layered test that cannot tell which layer
// answered is not.
await failsWith(
  'layer 3: truncate trigger',
  'TRUNCATE as the table owner (refused by the FK reference, before the trigger)',
  'truncate table public.events',
  '0A000',
  'cannot truncate a table referenced in a foreign key constraint',
)

// And now the trigger itself, with CASCADE to get past the foreign key so the
// BEFORE TRUNCATE trigger is actually reached.
//
// Wrapped in a transaction that ROLLS BACK. If the trigger fires, the
// statement raises and the transaction aborts - the normal path. If the
// trigger were broken, CASCADE would truncate the ledger and everything
// referencing it, and the rollback is what stops a test of a safety property
// from being the thing that destroys the data. Verified beforehand that this
// executor honours an explicit rollback.
await failsWith(
  'layer 3: truncate trigger',
  'TRUNCATE ... CASCADE, inside a rolled-back transaction, so the trigger is reached',
  'begin; truncate table public.events cascade; rollback;',
  '42501',
  'is append-only',
)

// The rollback did what it says: the ledger is still there.
const ledgerIntact = await db.execute('select count(*)::int as n from public.events')
checks.push({
  layer: 'layer 3: truncate trigger',
  what: 'the ledger still exists after the CASCADE attempt',
  outcome: `${String(ledgerIntact.rows[0]?.n)} event(s) present`,
  passed: Number(ledgerIntact.rows[0]?.n) > 0,
})

// ---------------------------------------------------------------------------
// Layer 4 — RLS enabled AND forced
// ---------------------------------------------------------------------------
const rls = (
  await db.execute(`
  select relrowsecurity as enabled, relforcerowsecurity as forced
  from pg_class where oid = 'public.events'::regclass
`)
).rows[0]
checks.push({
  layer: 'layer 4: RLS',
  what: 'row level security enabled and FORCED on public.events',
  outcome: `enabled=${String(rls?.enabled)} forced=${String(rls?.forced)}`,
  passed: rls?.enabled === true && rls?.forced === true,
})

const writePolicies = (
  await db.execute(`
  select count(*)::int as n from pg_policies
  where schemaname = 'public' and tablename = 'events' and cmd in ('UPDATE','DELETE')
`)
).rows[0]
checks.push({
  layer: 'layer 4: RLS',
  what: 'no UPDATE or DELETE policy exists, so a re-GRANT would still be refused',
  outcome: `${String(writePolicies?.n)} such policies`,
  passed: writePolicies?.n === 0,
})

// ---------------------------------------------------------------------------
// Undo is idempotent by construction (§6)
//
// 23505 = unique_violation. The second compensation collides on the index
// rather than being caught by a guard in a handler, which is the requirement:
// duplicate Telegram callbacks can be genuinely concurrent.
// ---------------------------------------------------------------------------
await succeeds(
  'undo',
  'first compensating event for the original',
  `select app.append_event(p_office => app.test_office(),
     p_correlation_id => '${correlation}'::uuid,
     p_actor_kind => 'user', p_actor => 'grant',
     p_trigger => 'undo_pressed', p_action_type => 'ledger.proof_reversed',
     p_reversible => false,
     p_compensates_event_id => '${eventId}'::uuid
   )`,
)
await failsWith(
  'undo',
  'second compensating event for the SAME original (Undo pressed twice)',
  `select app.append_event(p_office => app.test_office(),
     p_correlation_id => '${correlation}'::uuid,
     p_actor_kind => 'user', p_actor => 'grant',
     p_trigger => 'undo_pressed_again', p_action_type => 'ledger.proof_reversed',
     p_reversible => false,
     p_compensates_event_id => '${eventId}'::uuid
   )`,
  '23505',
  'events_one_compensation_per_event',
)

// ---------------------------------------------------------------------------
// Write-boundary constraints
// 23514 = check_violation
// ---------------------------------------------------------------------------
await failsWith(
  'write boundary',
  'reversible = true with no reversal_method',
  `select app.append_event(p_office => app.test_office(),
     p_correlation_id => '${correlation}'::uuid,
     p_actor_kind => 'agent', p_actor => 'verifier',
     p_trigger => 'manual_verification', p_action_type => 'ledger.bad_reversibility',
     p_reversible => true
   )`,
  '23514',
  'violates check constraint',
)
await failsWith(
  'write boundary',
  'a 1001-character rationale (chain-of-thought would not fit either)',
  `select app.append_event(p_office => app.test_office(),
     p_correlation_id => '${correlation}'::uuid,
     p_actor_kind => 'agent', p_actor => 'verifier',
     p_trigger => 'manual_verification', p_action_type => 'ledger.long_rationale',
     p_reversible => false,
     p_rationale_summary => repeat('x', 1001)
   )`,
  '23514',
  'violates check constraint',
)
await failsWith(
  'write boundary',
  'a free-form action_type ("Did Some Stuff")',
  `select app.append_event(p_office => app.test_office(),
     p_correlation_id => '${correlation}'::uuid,
     p_actor_kind => 'agent', p_actor => 'verifier',
     p_trigger => 'manual_verification', p_action_type => 'Did Some Stuff',
     p_reversible => false
   )`,
  '23514',
  'violates check constraint',
)
await failsWith(
  'write boundary',
  'an unknown actor_kind ("robot")',
  `select app.append_event(p_office => app.test_office(),
     p_correlation_id => '${correlation}'::uuid,
     p_actor_kind => 'robot', p_actor => 'verifier',
     p_trigger => 'manual_verification', p_action_type => 'ledger.bad_actor',
     p_reversible => false
   )`,
  '23514',
  'violates check constraint',
)

// ---------------------------------------------------------------------------
// The original event is untouched after every attempt above
// ---------------------------------------------------------------------------
const survived = (
  await db.execute(`
  select actor, rationale_summary is not null as has_rationale
  from public.events where event_id = '${eventId}'
`)
).rows[0]
checks.push({
  layer: 'result',
  what: 'the event under test is unchanged after every attempt',
  outcome: `actor = ${JSON.stringify(survived?.actor)}`,
  passed: survived?.actor === 'phase-1-verification',
})

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const failed = checks.filter((c) => !c.passed)
console.log(`| layer | attempt | outcome | |`)
console.log(`|---|---|---|---|`)
for (const c of checks) {
  console.log(`| ${c.layer} | ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
}
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)

if (failed.length > 0) {
  console.error(`\n${failed.length} CHECK(S) FAILED`)
  process.exit(1)
}
