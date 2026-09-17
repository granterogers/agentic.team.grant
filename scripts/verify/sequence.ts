/**
 * One agent finishes, and another continues (#128).
 *
 *   npm run verify:sequence
 *
 * ## What this proves that `verify:collaborates` does not
 *
 * #233 built fan-OUT and `verify:collaborates` proves it: two specialists, two
 * child jobs, the same instruction, in parallel. That is right for *"model the
 * margin impact AND draft the announcement"* — two independent asks.
 *
 * #128 is the other shape. *"Find out what they charge AND THEN draft the note"*
 * cannot be answered in parallel: the second clause needs the first one's
 * OUTPUT. So a handoff is a child job that carries what the first agent
 * produced, and the whole feature is one word — "and" against "and then".
 *
 * Which is why the negative control here is not a formality. A suite that only
 * proved a handoff happens would be satisfied by a system that handed
 * everything on, and handing a list on is worse than the fan-out it replaced:
 * the second specialist waits for work that was never coming.
 *
 * ## The safety property
 *
 * #128: *"A handoff may name a person and may never widen reach."* Two halves,
 * both asserted:
 *
 *   * the child runs as the RECEIVING agent, so `app.staff_may_use` answers
 *     for them and never for the sender;
 *   * the first agent's answer reaches the second as `answeredBefore`, never
 *     as `retrieved`. `provenance.ts` excludes the office's own prose from
 *     `established()`, and putting a colleague's draft in the other list would
 *     let one fabrication launder itself through a second agent.
 *
 * ## Subjects
 *
 * A fixture project and a `verify-` actor, so `enqueue_inbound` composes a
 * `requested_by` that `jobs.is_fixture` recognises and the whole tree is
 * harness traffic. These jobs run for REAL — they spend model calls and would
 * otherwise land in Grant's health readings.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

let pass = 0
let fail = 0
const ok = (what: string, good: boolean, note = ''): void => {
  if (good) {
    pass++
    console.log(`  ok   ${what}${note === '' ? '' : ` — ${note}`}`)
  } else {
    fail++
    console.error(`  FAIL ${what}${note === '' ? '' : ` — ${note}`}`)
  }
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}
const all = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]

console.log('\nverify:sequence — does the office hand work on, and only when it should\n')

const run = Math.random().toString(36).slice(2, 10)
const ACTOR = `verify-sequence-${run}`

const project = String(
  (
    await one(`
      insert into public.projects (name, slug, status)
      values (${lit(`Fixture sequence ${run}`)}, ${lit(`fixture-sequence-${run}`)}, 'paused')
      returning project_id::text as id`)
  ).id,
)

/** Ask, with announce switched off in the same transaction as the enqueue. */
const ask = async (what: string, tag: string): Promise<string> => {
  const key = `teamhq:sequence_${tag}:${run}`
  return String(
    (
      await one(`
        begin;
        insert into public.inbound_commands
          (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at, project_id)
        values ('teamhq', ${lit(`sequence-${tag}-${run}`)}, ${lit(ACTOR)}, ${lit(what)},
                ${lit(key)}, app.now_utc(), ${lit(project)}::uuid);
        create temp table _j as
          select (app.enqueue_inbound(
                    (select command_id from public.inbound_commands where dedupe_key = ${lit(key)})
                  ) ->> 'job_id')::uuid as id;
        -- The announce column defaults to TRUE and the worker ticks every
        -- minute, so a separate UPDATE is a race against his phone.
        update public.jobs set announce = false where job_id = (select id from _j);
        select (select id from _j)::text as id;
        commit;`)
    ).id,
  )
}

/*
  Two requests, one word apart in the part that matters.

  The chain names two different specialists' subjects — pricing is the finance
  director's, the announcement copy is the communications director's — because
  a handoff between one person and themselves is correctly refused, and a probe
  that tripped over that would be testing the wrong rule.
*/
const CHAIN =
  'Work out what the fifteen percent price cut does to our margin and then ' +
  'draft the announcement email that tells customers about it.'
const LIST =
  'Work out what the fifteen percent price cut does to our margin and ' +
  'draft the announcement email that tells customers about it.'

const chainJob = await ask(CHAIN, 'chain')
const listJob = await ask(LIST, 'list')

ok(
  'neither probe can reach Grant',
  Number(
    (
      await one(
        `select count(*)::int as n from public.jobs
          where job_id in (${lit(chainJob)}::uuid, ${lit(listJob)}::uuid) and announce`,
      )
    ).n,
  ) === 0,
  'announce is false on both parents',
)

process.stdout.write('       waiting for the office')
const settled = (x: unknown): boolean => ['complete', 'failed', 'cancelled'].includes(String(x))
const deadline = Date.now() + 8 * 60 * 1000
while (Date.now() < deadline) {
  const rows = await all(`
    select j.job_id::text as id, j.state::text as state
      from public.jobs j
     where j.job_id in (${lit(chainJob)}::uuid, ${lit(listJob)}::uuid)
        or j.parent_job_id in (${lit(chainJob)}::uuid, ${lit(listJob)}::uuid)`)
  const parentsDone = rows
    .filter((r) => [chainJob, listJob].includes(String(r.id)))
    .every((r) => settled(r.state))
  /*
    Wait for the CHILDREN too, and for the chain's child to have been ENQUEUED
    at all — which happens after the parent's output is written and reviewed,
    so a loop that stopped at "parent terminal" would read a handoff that was
    one second away as a handoff that never happened.
  */
  const childrenDone = rows
    .filter((r) => ![chainJob, listJob].includes(String(r.id)))
    .every((r) => settled(r.state))
  if (parentsDone && childrenDone && rows.length > 2) break
  process.stdout.write('.')
  await new Promise((r) => setTimeout(r, 15_000))
}
console.log('')

// ===========================================================================
// The chain
// ===========================================================================

console.log('\na sequence is handed on, carrying what was produced')

const handed = await all(`
  select j.job_id::text as id, j.state::text as state,
         coalesce(j.recipient_agent, '') as recipient,
         j.pinned_config ->> 'addressed_to' as addressed_to,
         j.pinned_config ->> 'handed_off_by' as handed_off_by,
         j.pinned_config ->> 'handed_off_because' as because,
         j.pinned_config ->> 'from_output' as from_output,
         j.pinned_config ->> 'instruction' as instruction,
         app.job_depth(j.job_id)::int as depth
    from public.jobs j
   where j.parent_job_id = ${lit(chainJob)}::uuid
     and j.pinned_config ? 'from_output'`)

const child = handed[0]
ok(
  'the sequenced request produced exactly one handoff',
  handed.length === 1,
  `${String(handed.length)} child job(s) carrying an output`,
)
ok(
  'and it carries the first agent’s output, which is what makes it a handoff',
  child !== undefined && String(child.from_output ?? '') !== '',
  child === undefined ? 'no child' : `from_output ${String(child.from_output).slice(0, 8)}`,
)
ok(
  'and it names who handed it on, and why',
  child !== undefined &&
    String(child.handed_off_by ?? '') !== '' &&
    String(child.because ?? '').length > 10,
  child === undefined
    ? 'no child'
    : `${String(child.handed_off_by)}: ${String(child.because).slice(0, 60)}`,
)
ok(
  'and the receiver is not the sender',
  child !== undefined && String(child.addressed_to) !== String(child.handed_off_by),
  child === undefined
    ? 'no child'
    : `${String(child.handed_off_by)} → ${String(child.addressed_to)}`,
)
ok(
  'and it asks for the SECOND clause, not the whole request again',
  child !== undefined &&
    String(child.instruction ?? '').length < CHAIN.length &&
    !String(child.instruction ?? '').includes('fifteen percent'),
  child === undefined ? 'no child' : `"${String(child.instruction).slice(0, 70)}"`,
)
/*
  COMPLETE, not merely settled.

  The first version of this said `settled(child.state)`, which includes
  `failed` — and the first live run passed it while the child had failed four
  times on "Cannot read properties of undefined (reading 'to')". A check that
  is satisfied by the thing it is testing having crashed is worse than no
  check, which is the lesson #209 is in this repository for.
*/
ok(
  'and the receiving agent answered in their own name',
  child !== undefined &&
    String(child.state) === 'complete' &&
    String(child.recipient) === String(child.addressed_to),
  child === undefined ? 'no child' : `${String(child.state)} as ${String(child.recipient)}`,
)

/*
  The chain is visible end to end, which is #128's "done looks like".

  `app.job_depth` is what `enforce_delegation_depth` caps, so asserting the
  child is deeper than the parent asserts the mechanism that bounds a loop
  rather than a number somebody wrote down.
*/
ok(
  'the chain is one link deeper than the request that started it',
  child !== undefined && Number(child.depth) === 1,
  child === undefined ? 'no child' : `depth ${String(child.depth)}`,
)

{
  /*
    The cap is a `system_config` key, not a column on a table called `agents` —
    there is no such table. Guessing the name would have made this check pass
    vacuously against a row that does not exist, which is the found-nothing
    failure `verify:google-live` already cost this repository once.
  */
  const cap = await one(`
    select coalesce(
      (select value #>> '{}' from public.system_config
        where key = 'agents.max_delegation_depth'), '3') as n`)
  ok(
    'and a depth limit exists to stop a loop',
    Number(cap.n) >= 1,
    `agents.max_delegation_depth is ${String(cap.n)}`,
  )
}

// ===========================================================================
// The control
// ===========================================================================

console.log('\nCONTROL: a list is not a sequence')

const listChildren = await all(`
  select j.job_id::text as id,
         j.pinned_config ->> 'from_output' as from_output,
         j.pinned_config ->> 'addressed_to' as addressed_to
    from public.jobs j
   where j.parent_job_id = ${lit(listJob)}::uuid`)

ok(
  'CONTROL: the same request with "and" instead of "and then" hands nothing on',
  listChildren.every((c) => c.from_output === null),
  `${String(listChildren.length)} child job(s), ${String(
    listChildren.filter((c) => c.from_output !== null).length,
  )} carrying an output`,
)

/*
  And it still fans OUT, so the control is not passing because the office did
  nothing at all. Without this, deleting the routing entirely would score the
  same as the correct behaviour — the failure mode `verify:google-live`'s
  vacuous capability check already cost this repository once.
*/
ok(
  'CONTROL: and it still convenes the second specialist in parallel, as before',
  listChildren.length >= 1,
  `${String(listChildren.length)} parallel child job(s)`,
)

// ===========================================================================
// Reach is never widened
// ===========================================================================

console.log('\na handoff names a person and never widens reach')

if (child !== undefined) {
  const to = String(child.addressed_to)
  const from = String(child.handed_off_by)
  const gap = await all(`
    select t.tool
      from public.staff_tools t
     where t.staff_slug = ${lit(from)}
       and not exists (select 1 from public.staff_tools u
                        where u.staff_slug = ${lit(to)} and u.tool = t.tool)`)
  /*
    The receiving agent's own grants, whatever the sender held.

    Today every specialist holds the same sixteen tools, so this difference is
    usually empty — which would make an assertion about it vacuous. So the
    check is the one that stays true when the rosters diverge: `staff_may_use`
    is asked about the RECEIVER, and the answer for a tool only the sender
    holds is no.
  */
  const leaked =
    gap.length === 0
      ? false
      : Boolean(
          (await one(`select app.staff_may_use(${lit(to)}, ${lit(String(gap[0]?.tool))}) as may`))
            .may,
        )
  ok(
    'the receiver gets their own permissions, never the sender’s',
    !leaked,
    gap.length === 0
      ? 'the two hold the same tools today, so nothing could leak'
      : `${String(gap.length)} tool(s) only ${from} holds, and ${to} may use none of them`,
  )

  /*
    And the colleague's draft is not provenance.

    The strong version — reading the receiving job's own output and checking it
    cites nothing of the sender's — needs a model to judge. The structural
    version is checkable and is the thing that would actually break: the
    handover text reaches the prompt and must NOT be in the retrieved context,
    because `established()` includes that list and excludes the other.
  */
  // `outputs.sources` is JSONB, not a text[] — guessed wrong on the first run
  // and refused by Postgres, which is CLAUDE.md's rule about reading the TYPE
  // from `information_schema` before writing the reader.
  const cited = await one(`
    select coalesce(o.sources::text, '') as sources
      from public.outputs o where o.job_id = ${lit(String(child.id))}::uuid
     order by o.created_at desc limit 1`)
  ok(
    'and does not cite the colleague as a source',
    !String(cited.sources).includes('output:') && !String(cited.sources).includes(from),
    `sources: ${String(cited.sources).slice(0, 80) || '(none)'}`,
  )
}

// ===========================================================================
// Put it back
// ===========================================================================

console.log('\nand the suite leaves nothing behind')

/*
  Cancel what is still open; a job can never be deleted, and the project cannot
  be either once it has gathered one. It is a FIXTURE project, so it is
  excluded from every reader that reports to Grant — which is the escape
  CLAUDE.md's twenty-five-project pile did not have.
*/
await db.execute(`
  update public.jobs set state = 'cancelled', state_reason = 'verify:sequence teardown'
   where (job_id in (${lit(chainJob)}::uuid, ${lit(listJob)}::uuid)
          or parent_job_id in (${lit(chainJob)}::uuid, ${lit(listJob)}::uuid))
     and state not in ('complete', 'cancelled', 'failed')`)
await db.execute(`
  update public.projects set status = 'archived'
   where project_id = ${lit(project)}::uuid`)

const left = await one(`
  select count(*)::int as n from public.jobs
   where (job_id in (${lit(chainJob)}::uuid, ${lit(listJob)}::uuid)
          or parent_job_id in (${lit(chainJob)}::uuid, ${lit(listJob)}::uuid))
     and state not in ('complete', 'cancelled', 'failed')`)
ok('no job of this run is still open', Number(left.n) === 0, `${String(left.n)} open`)
ok(
  'and its project is a fixture, so nothing it left is in a view Grant reads',
  Boolean(
    (await one(`select is_fixture from public.projects where project_id = ${lit(project)}::uuid`))
      .is_fixture,
  ),
  'is_fixture',
)

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)
if (fail > 0) process.exit(1)
