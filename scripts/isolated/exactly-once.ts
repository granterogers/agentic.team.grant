/**
 * Run 2 (D8): an effect the office performs is performed once, whatever interrupts it.
 *
 *   npx tsx scripts/isolated/exactly-once.ts <replica-db>
 *
 * The REAL `runSteps` and `app.step_begin` against the replica. The "external system" is a counter
 * in a scratch table, so what happened outside the office is a fact the test can read back:
 *   - a step that acts outside and is interrupted is PARKED for reconciliation, never re-run;
 *   - once a person reconciles it, it is skipped and still ran once;
 *   - a step that acts only inside the office IS safe to repeat (the control: the park is not
 *     "refuse everything");
 *   - two workers racing on the same step run the effect once;
 *   - a resume under different code does not skip and does not redo.
 * Approval-specific cases (duplicate answer, racing answers, restart after approval, a changed
 * action) are proved by approval-execution.ts, approval-race.sh and authority.ts.
 */
import { runSteps } from '../../src/jobs/checkpoint.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'once')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
await db.execute(
  `create table if not exists public.once_effects (id bigserial primary key, label text not null)`,
)
const performed = async (label: string) =>
  Number(
    (await one(`select count(*)::int as n from public.once_effects where label = ${lit(label)}`)).n,
  )
const job = async (): Promise<string> => {
  const p = String((await one(`select app.unnamed_project(app.test_office())::text as p`)).p)
  return String(
    (
      await one(`insert into public.jobs (office_id, kind, requested_by, project_id, idempotency_key, correlation_id)
        values (app.test_office(), 'office.pursue', 'duty:exactly-once-proof', ${lit(p)}::uuid, 'eo-' || gen_random_uuid(), gen_random_uuid())
        returning job_id::text as id`)
    ).id,
  )
}
const effectStep = (label: string, kind: 'external' | 'local', crashAfter = false) => ({
  name: `s:${label}`,
  effect: kind,
  run: async () => {
    await db.execute(`insert into public.once_effects (label) values (${lit(label)})`)
    if (crashAfter) throw new Error('worker died after acting')
    return { outcome: { did: label } }
  },
})

// 1. interrupted external step
{
  const j = await job()
  const label = `ext-${run}`
  const first = await runSteps(db as never, j, 'code-1', [
    effectStep(label, 'external', true),
  ]).catch(() => 'crashed')
  const second = await runSteps(db as never, j, 'code-1', [effectStep(label, 'external')])
  check(
    'an interrupted EXTERNAL step is parked for reconciliation, not run again',
    first === 'crashed' &&
      typeof second === 'object' &&
      second.kind === 'paused' &&
      second.pause.reason === 'needs_reconciliation' &&
      (await performed(label)) === 1,
    `performed ${String(await performed(label))}, ${typeof second === 'object' ? second.kind : second}`,
  )
  await db.execute(
    `update public.job_steps set finished_at = now(), outcome = '{"did":"reconciled"}'::jsonb where job_id = ${lit(j)}::uuid and step = ${lit(`s:${label}`)}`,
  )
  const third = await runSteps(db as never, j, 'code-1', [effectStep(label, 'external')])
  check(
    'once a person reconciles it the step is skipped, and it ran exactly once',
    typeof third === 'object' && third.kind === 'done' && (await performed(label)) === 1,
    `performed ${String(await performed(label))}`,
  )
}
// 2. control: a local step is safe to repeat
{
  const j = await job()
  const label = `loc-${run}`
  await runSteps(db as never, j, 'code-1', [effectStep(label, 'local', true)]).catch(
    () => 'crashed',
  )
  const again = await runSteps(db as never, j, 'code-1', [effectStep(label, 'local')])
  check(
    'control: an interrupted step that acts only inside the office is run again',
    typeof again === 'object' && again.kind === 'done' && (await performed(label)) === 2,
    `performed ${String(await performed(label))}`,
  )
}
// 3. a finished step is never run twice, however often the job is resumed
{
  const j = await job()
  const label = `fin-${run}`
  for (let i = 0; i < 4; i += 1)
    await runSteps(db as never, j, 'code-1', [effectStep(label, 'external')])
  check(
    'a finished external step is skipped on every later resume',
    (await performed(label)) === 1,
    `performed ${String(await performed(label))}`,
  )
}
// 4. two workers racing on the same step
{
  const j = await job()
  const label = `race-${run}`
  const both = await Promise.allSettled([
    runSteps(db as never, j, 'code-1', [effectStep(label, 'external')]),
    runSteps(db as never, j, 'code-1', [effectStep(label, 'external')]),
  ])
  check(
    'two workers racing on one external step perform it once',
    (await performed(label)) === 1,
    `performed ${String(await performed(label))}; ${both.map((b) => b.status).join('/')}`,
  )
}
// 5. code changed while it waited
{
  const j = await job()
  const label = `code-${run}`
  await runSteps(db as never, j, 'code-1', [effectStep(label, 'external')])
  const changed = await runSteps(db as never, j, 'code-2', [effectStep(label, 'external')])
  check(
    'a resume under different code neither skips nor redoes: it parks',
    typeof changed === 'object' &&
      changed.kind === 'paused' &&
      changed.pause.reason === 'checkpoint_stale' &&
      (await performed(label)) === 1,
    `performed ${String(await performed(label))}`,
  )
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1
