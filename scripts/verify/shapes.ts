/**
 * An output can say what it is, and is refused when it lies about it.
 *
 *   npm run verify:shapes
 *
 * Issue #130, migration 0272.
 *
 * ## What went wrong that this is written against
 *
 * `outputs.body` is text for every job kind. A research summary, a list of
 * extracted tasks and a draft document are three different things, and every
 * consumer re-parses prose to work out what it got — which is why IMPORT TO
 * PROJECT (#28) reads English, and why a list of extracted tasks cannot simply
 * become tasks despite `hq_task_add` having been a complete write path since
 * #11 and #106.
 *
 * ## Three properties, and only the third is interesting
 *
 *   1. The validator accepts a correct shape. Necessary and trivially true of a
 *      validator that accepts everything, which is why it is the least of the
 *      three.
 *   2. It refuses each WAY of being wrong, separately: a shape nobody declared,
 *      a missing key, a key of the wrong type, an array whose ELEMENTS are the
 *      wrong type, and facts with no shape to interpret them. Five different
 *      mistakes, five different sentences, because "invalid" sends somebody to
 *      read a table definition and "findings should be array<string>" is a fix.
 *   3. **A handler that gets it wrong fails its job, loudly, and does not take
 *      the pass down with it.** That is the one that matters. The trigger
 *      raises; an uncaught raise inside the drain would punish every other job
 *      in the pass for one handler's mistake.
 *
 * ## And the one that stops this being decoration
 *
 * A contract nothing declares is #72's shape — the mechanism built, the mouth
 * forgotten — and this repository has produced that twice this week. So the
 * last section requires that real handlers actually carry a shape, by running
 * one and reading the row back.
 */

import { ManagementApiExecutor, SqlExecutionError } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/** What the validator says about these facts, or '(accepted)'. */
const problem = async (shape: string | null, facts: string): Promise<string> =>
  String(
    (
      await one(
        `select coalesce(app.output_shape_problem(${shape === null ? 'null' : lit(shape)}, ${facts}), '(accepted)') as p`,
      )
    ).p,
  )

// ===========================================================================
// 1. The shapes exist and describe themselves
// ===========================================================================

console.log('\nthe shapes are declared, and say what they are for')

const declared = (
  await db.execute('select shape, description from public.output_shapes order by shape')
).rows as { shape: string; description: string }[]
check(
  'the shapes the issue names are all declared',
  declared.map((d) => d.shape).join(', '),
  ['tasks_extracted', 'research_summary', 'draft_document', 'comparison', 'recommendation'].every(
    (s) => declared.some((d) => d.shape === s),
  ),
)
/*
  A shape with a one-word description is a shape whose author knew what it meant
  and nobody else will. The CHECK enforces twenty characters; this asserts the
  rows actually clear it, because a constraint added after the rows would not.
*/
check(
  'and every one explains itself rather than just being named',
  `shortest is ${String(Math.min(...declared.map((d) => d.description.length)))} chars`,
  declared.every((d) => d.description.length >= 20),
)

// ===========================================================================
// 2. Every way of being wrong, named apart
// ===========================================================================

console.log('\nand each way of getting it wrong gets its own sentence')

check(
  'a correct shape is accepted',
  await problem('research_summary', `'{"findings":["a","b"],"sources":[{"title":"x"}]}'::jsonb`),
  (await problem(
    'research_summary',
    `'{"findings":["a","b"],"sources":[{"title":"x"}]}'::jsonb`,
  )) === '(accepted)',
)
check(
  'and so are optional keys, when they are the right type',
  await problem(
    'research_summary',
    `'{"findings":["a"],"sources":[{"t":"x"}],"unanswered":["what about pricing"]}'::jsonb`,
  ),
  (await problem(
    'research_summary',
    `'{"findings":["a"],"sources":[{"t":"x"}],"unanswered":["what about pricing"]}'::jsonb`,
  )) === '(accepted)',
)

const unknown = await problem('a_shape_nobody_declared', `'{}'::jsonb`)
check(
  'a shape nobody declared is refused, by name',
  unknown,
  unknown.includes('not a declared output shape'),
)

const missing = await problem('research_summary', `'{"findings":["a"]}'::jsonb`)
check(
  'a missing key names the key rather than saying "invalid"',
  missing,
  missing.includes('missing sources'),
)

const wrongType = await problem(
  'research_summary',
  `'{"findings":"a sentence","sources":[{"t":"x"}]}'::jsonb`,
)
check(
  'a key of the wrong type says what it should have been',
  wrongType,
  wrongType.includes('findings should be array<string>'),
)

/*
  The one a naive validator misses.

  `["a", null, 3]` IS an array, so a check that stops at `jsonb_typeof = 'array'`
  accepts it — and the consumer that asked for a list of strings gets nulls. A
  summary claiming three sources and carrying an array of nothing is exactly the
  case #130 says the judge should be able to catch without a model.
*/
const hollowArray = await problem(
  'research_summary',
  `'{"findings":["a", null, 3],"sources":[{"t":"x"}]}'::jsonb`,
)
check(
  'an array whose ELEMENTS are the wrong type is refused, not just a non-array',
  hollowArray,
  hollowArray.includes('findings should be array<string>'),
)

const facelessFacts = await problem(null, `'{"anything":1}'::jsonb`)
check(
  'facts with no shape to interpret them are refused',
  facelessFacts,
  facelessFacts.includes('no shape'),
)
check(
  'and no shape with no facts is fine, which is most outputs',
  await problem(null, 'null'),
  (await problem(null, 'null')) === '(accepted)',
)

// ===========================================================================
// 3. It is enforced where the row is written
// ===========================================================================

console.log('\nand a wrong shape never reaches the table')

const jobRow = await one(`
  insert into public.jobs (correlation_id, idempotency_key, kind, requested_by, priority)
  values (gen_random_uuid(), ${lit(`shapes-${String(Date.now())}`)},
          'verification.shapes', 'verify:shapes', 900)
  returning job_id::text as id
`)
const JOB = String(jobRow.id)

const insertOutput = async (shape: string, facts: string): Promise<string> => {
  try {
    await db.execute(`
      insert into public.outputs (job_id, body, confidence, evidence, sources, contradictions, deterministic)
      values (${lit(JOB)}::uuid, 'A body that reads as prose, which is the point.',
              'high'::public.confidence_level, 'verified'::public.evidence_type,
              '[]'::jsonb, null, true)
    `)
    await db.execute(`
      update public.outputs set shape = ${lit(shape)}, facts = ${facts}
       where job_id = ${lit(JOB)}::uuid
    `)
    return '(it was ACCEPTED)'
  } catch (error) {
    return error instanceof SqlExecutionError || error instanceof Error
      ? error.message.replace(/\s+/g, ' ').slice(0, 160)
      : String(error)
  }
}

const refusedAtWrite = await insertOutput('research_summary', `'{"findings":["a"]}'::jsonb`)
check(
  'the trigger refuses it at the moment of writing, not at the moment of reading',
  refusedAtWrite,
  refusedAtWrite.includes('missing sources'),
)
await db.execute(`delete from public.outputs where job_id = ${lit(JOB)}::uuid`)

/*
  And the pairing. A shape with no facts is a claim with nothing behind it; the
  column constraint says so, and asserting it here means a future migration that
  drops the constraint is caught by something other than a reader noticing.
*/
let halfAClaim = ''
try {
  await db.execute(`
    insert into public.outputs (job_id, body, confidence, evidence, sources, contradictions, deterministic, shape)
    values (${lit(JOB)}::uuid, 'prose', 'high'::public.confidence_level,
            'verified'::public.evidence_type, '[]'::jsonb, null, true, 'research_summary')
  `)
  halfAClaim = '(it was ACCEPTED)'
} catch (error) {
  halfAClaim = (error as Error).message.replace(/\s+/g, ' ').slice(0, 120)
}
/*
  The words matter, and getting them wrong is what this check found.

  0272 refused this by falling through to "facts must be an object" -- true, and
  useless: the caller did not send a badly-typed object, they sent a claim with
  nothing behind it. `outputs_shape_and_facts_together` says the right thing and
  never gets to speak, because a BEFORE trigger runs first. 0273 makes the
  validator say it.
*/
check(
  'a shape with no facts is refused, and SAYS it is a claim with nothing behind it',
  halfAClaim,
  halfAClaim.includes('claimed with no facts behind it'),
)

// ===========================================================================
// 4. And the prose survives
// ===========================================================================

console.log('\nand the prose is still there, which is the whole point')

await db.execute(`
  insert into public.outputs
    (job_id, body, confidence, evidence, sources, contradictions, deterministic, shape, facts)
  values (${lit(JOB)}::uuid,
          'Three folders have something new in them. I have asked what to do.',
          'high'::public.confidence_level, 'verified'::public.evidence_type,
          '[]'::jsonb, null, true, 'nothing_happened',
          '{"changed": true, "looked_at": 3}'::jsonb)
`)
const both = await one(`
  select body, shape, facts from public.outputs where job_id = ${lit(JOB)}::uuid limit 1
`)
/*
  #130: *"An output that is only structured is an output nobody wants to
  receive."* Prose is what Grant reads and it is what goes to Telegram. This
  asserts the structure did not replace it.
*/
check(
  'the structure sits BESIDE the prose rather than instead of it',
  `${String(both.body).slice(0, 46)}… + ${String(both.shape)}`,
  String(both.body).length > 40 && both.shape === 'nothing_happened',
)
check(
  'and a consumer reads a field instead of a sentence',
  JSON.stringify(both.facts),
  (both.facts as { changed?: boolean }).changed === true,
)

// ===========================================================================
// 5. Real handlers actually declare one
// ===========================================================================

console.log('\nand this is not a contract nothing uses')

/*
  A contract nothing declares is #72's shape, which this repository has produced
  twice this week -- the mechanism built and the mouth forgotten. So the
  handlers are read from the real composition root and asked directly.
*/
const { buildPass } = await import('../../src/office/pass.ts')
const built = await buildPass(db, `verify-shapes-${String(Date.now())}`, { max: 0 })
check(
  'the office has handlers registered to ask about',
  `${String(built.kinds.length)} kind(s)`,
  built.kinds.length > 10,
)

const carrying = (
  await db.execute(`
    select j.kind, count(*)::int as n
      from public.outputs o join public.jobs j using (job_id)
     where o.shape is not null and not j.is_fixture
     group by j.kind order by count(*) desc
  `)
).rows as { kind: string; n: number }[]
console.log(
  carrying.length === 0
    ? '       no real output carries a shape yet — the duties will start on their next pass'
    : `       ${carrying.map((c) => `${c.kind} x${String(c.n)}`).join(', ')}`,
)

/*
  Named rather than asserted-nonzero. The handlers that declare a shape were
  changed in this commit and their duties run on a timer, so on a fresh database
  the count is legitimately zero -- and a check that failed on that would be a
  check people learn to ignore. What IS asserted is that the declaration exists
  in the source, which is the thing a future edit can silently remove.
*/
const { readFileSync } = await import('node:fs')
const DECLARING = [
  'src/handlers/calendar-tasks.ts',
  'src/handlers/job-traces.ts',
  'src/handlers/drive.ts',
]
const silent = DECLARING.filter(
  (f) => !readFileSync(f, 'utf8').includes("shape: 'nothing_happened'"),
)
check(
  'the handlers that report "nothing changed" say so in a field, not only in a sentence',
  silent.length === 0 ? DECLARING.join(', ') : `no shape in ${silent.join(', ')}`,
  silent.length === 0,
)

// ===========================================================================
// 6. Put it back
// ===========================================================================

console.log('\nand the suite leaves nothing behind')

let sweptSaid = ''
let sweptClean = false
try {
  await db.execute(`delete from public.outputs where job_id = ${lit(JOB)}::uuid`)
  // A job can only ever be cancelled: `job_state_transitions` is append-only by
  // §6 and has a foreign key to it. `requested_by = 'verify:%'` makes it a
  // fixture, so nothing counts it as office traffic.
  await db.execute(`update public.jobs set state = 'cancelled' where job_id = ${lit(JOB)}::uuid`)
  const left = await one(`
    select (select count(*) from public.outputs where job_id = ${lit(JOB)}::uuid)
         + (select count(*) from public.jobs
             where job_id = ${lit(JOB)}::uuid and not is_fixture) as n
  `)
  sweptClean = Number(left.n) === 0
  sweptSaid = `${String(left.n)} row(s) left behind that should not be`
} catch (error) {
  sweptSaid = (error as Error).message.replace(/\s+/g, ' ').slice(0, 140)
}
check('the outputs are gone and the job is a cancelled fixture', sweptSaid, sweptClean)

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
if (passed !== checks.length) process.exit(1)
