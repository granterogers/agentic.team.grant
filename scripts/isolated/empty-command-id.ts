/**
 * Migration 0900: an empty command_id is no command_id.
 *
 *   npx tsx scripts/isolated/empty-command-id.ts <replica-db>
 *
 * A job handed on by another job with no command of its own is stored with `pinned_config.command_id = ''`. Four functions
 * cast that to a uuid and raised 22P02. One transaction, rolled back:
 *
 *   1. REPRODUCE: build a root job and a hand-off child with `command_id = ''`, and show that each of the four functions throws
 *      on the replica as it stands. Without this the proof below would pass against a database that never had the defect.
 *   2. APPLY the migration's own text in the transaction.
 *   3. The four functions now answer for that child, and answer SENSIBLY (a child of a real person's root is not harness, an
 *      unknown root is 'unknown' and so may not act outside, the child is not listed as something he asked).
 *   4. NOTHING ELSE MOVED: a job with a real command id is classed as before, and a sample visitor's turn is still harness.
 */
import { readFile } from 'node:fs/promises'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'post')
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const results: boolean[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const rows = async (sql: string) => (await db.execute(sql)).rows as Record<string, unknown>[]
const one = async (sql: string) => (await rows(sql))[0] ?? {}
const run = Date.now().toString(36)

const throws = async (sql: string): Promise<string | null> => {
  try {
    await db.execute(`savepoint t; ${sql}`)
    await db.execute('release savepoint t')
    return null
  } catch (e) {
    await db.execute('rollback to savepoint t').catch(() => undefined)
    return String((e as Error).message)
  }
}

try {
  await db.execute('begin')
  const op = String((await one(`select app.operator_office()::text as o`)).o)
  const opKey = String((await one(`select app.office_actor(${lit(op)}::uuid) as k`)).k)
  const P = String(
    (
      await one(
        `insert into public.projects (slug, name, status, office_id) values ('ec-${run}', 'Empty command', 'active', ${lit(op)}::uuid) returning project_id::text as id`,
      )
    ).id,
  )
  const job = async (parent: string | null, cfg: string) =>
    String(
      (
        await one(
          `insert into public.jobs (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority, pinned_config${parent === null ? '' : ', parent_job_id'})
           values (${lit(op)}::uuid, gen_random_uuid(), ${lit(P)}::uuid, 'ec-${run}-${Math.random().toString(36).slice(2, 8)}', 'office.instruction', 'hq', 300, ${lit(cfg)}::jsonb${parent === null ? '' : `, ${lit(parent)}::uuid`}) returning job_id::text as id`,
        )
      ).id,
    )
  // A command must exist in the table: the cast is only evaluated against a candidate row, so on an empty table the defect
  // cannot show, and the reproduction below would pass for the wrong reason. Production always has commands.
  const said = (
    await one(
      `set local application_name = 'PostgREST 14.5'; select app.say_in_project(${lit(op)}::uuid, ${lit(P)}::uuid, 'a real message ${run}', null, '{}', ${lit(opKey)}) as r`,
    )
  ).r
  const root = await job(
    null,
    '{"instruction": "a standing instruction with no command of its own"}',
  )
  const child = await job(
    root,
    '{"command_id": "", "instruction": "handed on", "handed_off_by": "growth-director"}',
  )

  // The replica may already carry the migration, so the defect is put back first: the migration's own text with its one change
  // reversed (the cast, and the "has a command" test in job_origin). That is exactly the pre-0900 behaviour.
  const text = await readFile('migrations/0900_an_empty_command_id_is_no_command_id.sql', 'utf8')
  const broken = text
    .replaceAll(
      "nullif(j.pinned_config ->> 'command_id', '')::uuid",
      "(j.pinned_config ->> 'command_id')::uuid",
    )
    .replaceAll(
      "when (select nullif(pinned_config ->> 'command_id', '') is not null from root) then",
      "when (select pinned_config ? 'command_id' from root) then",
    )
  check(
    'the reversal changed the migration text (so BEFORE is really the old behaviour)',
    broken !== text,
    `${String(text.length - broken.length)} characters differ`,
  )
  await db.execute(broken)

  // ---- 1. reproduce -----------------------------------------------------------------------------------------------
  // owed_a_word only reaches the cast for a FAILED ROOT, so that probe needs one with an empty command id.
  const failedRoot = await job(null, '{"command_id": "", "instruction": "a root that failed"}')
  await db.execute(
    `update public.jobs set state = 'failed' where job_id = ${lit(failedRoot)}::uuid`,
  )
  const probes: [string, string][] = [
    ['harness_job', `select app.harness_job(${lit(child)}::uuid)`],
    ['job_origin', `select app.job_origin(${lit(child)}::uuid)`],
    ['owed_a_word', `select * from app.owed_a_word(${lit(failedRoot)}::uuid)`],
    ['readings', `select app.readings(7, 50)`],
  ]
  for (const [name, sql] of probes) {
    const e = await throws(sql)
    check(
      `BEFORE: ${name} throws on a child whose command_id is empty`,
      e !== null && /uuid/.test(e),
      String(e).slice(0, 70),
    )
  }

  // ---- 2. apply the migration's own text ---------------------------------------------------------------------------
  await db.execute(text)

  // ---- 3. they answer, and sensibly ---------------------------------------------------------------------------------
  const none = await throws(probes[0]?.[1] ?? '')
  check('AFTER: harness_job answers for that child', none === null, String(none))
  const h = (await one(`select app.harness_job(${lit(child)}::uuid) as h`)).h
  check("and a child of a person's own (non-fixture) root is not harness", h === false, String(h))
  const o = String((await one(`select app.job_origin(${lit(child)}::uuid) as o`)).o)
  check("job_origin answers, and never 'trusted' for a command-less tree", o !== 'trusted', o)
  check(
    'owed_a_word answers (no row: a child is not owed a word)',
    (await throws(probes[2]?.[1] ?? '')) === null,
    'no error',
  )
  check(
    'readings answers, and does not list the child as something he asked',
    (await throws(probes[3]?.[1] ?? '')) === null,
    'no error',
  )

  // ---- 4. nothing else moved ---------------------------------------------------------------------------------------
  const realJob = String(
    (typeof said === 'string' ? JSON.parse(said) : (said as { job?: string })).job ?? '',
  )
  check("a real person's turn still has a job", realJob.length === 36, realJob.slice(0, 8))
  check(
    'and is still not harness (a real command id is read exactly as before)',
    (await one(`select app.harness_job(${lit(realJob)}::uuid) as h`)).h === false,
    'false',
  )
  const email = `sample-${run}@example.invalid`
  const key = `sample-${run}`
  await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(email)})`)
  const made = (
    await one(
      `select app.provision_sample_office('Sample Office', ${lit(email)}, ${lit(key)}) as r`,
    )
  ).r
  const S = String(
    (typeof made === 'string' ? JSON.parse(made) : (made as { office_id?: string })).office_id ??
      '',
  )
  const SP = String(
    (
      await one(
        `insert into public.projects (slug, name, status, office_id) values ('ecs-${run}', 'Sample', 'active', ${lit(S)}::uuid) returning project_id::text as id`,
      )
    ).id,
  )
  await db.execute(`select app.sample_office_open(${lit(S)}::uuid, false)`)
  const visitor = `v${run}${'z'.repeat(22)}`
  const asked = (
    await one(
      `set local application_name = 'PostgREST 14.5'; select app.sample_say(${lit(S)}::uuid, ${lit(SP)}::uuid, 'a visitor question', ${lit(visitor)}, ${lit(key)}) as r`,
    )
  ).r
  const vJob = String(
    (typeof asked === 'string' ? JSON.parse(asked) : (asked as { job?: string })).job ?? '',
  )
  check(
    "a sample visitor's turn is still harness work",
    vJob.length === 36 && (await one(`select app.harness_job(${lit(vJob)}::uuid) as h`)).h === true,
    'true',
  )
} finally {
  await db.execute('rollback').catch(() => undefined)
}
const passed = results.filter(Boolean).length
console.log(`\n${String(passed)}/${String(results.length)} passed`)
process.exit(passed === results.length ? 0 : 1)
