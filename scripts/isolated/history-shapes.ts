/**
 * #381 — verify:history's corrected properties, on the replica.
 *
 *   npx tsx scripts/isolated/history-shapes.ts <replica-db>
 *
 * The same DO-block shape the suite now uses (a real-shaped turn, as the
 * production ingress, on a real project made in the block, rolled back), and
 * the declaration order it now follows.
 */
import { testOrigins } from '../verify/lib/test-origin.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'hist381')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: boolean[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}
type Msg = { body?: string; from?: string; surface?: string; backfilled?: boolean }
const inRollback = async (body: string): Promise<Record<string, unknown>> => {
  try {
    await db.execute(`do $x$
      declare c uuid; e jsonb; r jsonb; pr uuid; v jsonb;
      begin
        perform set_config('application_name', 'PostgREST 14.5', true);
        pr := (app.hq_create_project(${lit(`History real ${run}`)}, 'upload',
                 ${lit(`hreal-${run}`)}, ${lit(`History real ${run}`)}, true) ->> 'project_id')::uuid;
        ${body}
        raise exception 'ROLLED-BACK:%', r::text;
      end $x$`)
  } catch (error) {
    const text = String((error as Error).message)
    const at = text.indexOf('ROLLED-BACK:')
    if (at < 0) throw error
    const raw = text.slice(at + 'ROLLED-BACK:'.length)
    return JSON.parse(raw.slice(0, raw.lastIndexOf('}') + 1)) as Record<string, unknown>
  }
  throw new Error('did not raise')
}

// Declaration first, then work: accepted. Work first, then declaration: refused.
const mk = async (n: string) =>
  String(
    (
      (
        await one(
          `select app.hq_create_project(${lit(n)}, 'upload', ${lit(`${n}-ref`)}, ${lit(n)}, true) as v`,
        )
      ).v as { project_id: string }
    ).project_id,
  )
const o = await testOrigins(db, 'isolated:history')
const good = await mk(`Fixture conversation ${run}`)
await o.declare('teamhq', good)
await db.execute(`insert into public.jobs (correlation_id, project_id, kind, requested_by, idempotency_key)
  values (gen_random_uuid(), ${lit(good)}::uuid, 'verification.conversation', 'grant', ${lit(`h:${run}:1`)})`)
check('declared BEFORE work: the declaration is accepted', true, 'declared, then the job')
const bad = await mk(`Fixture conversation ${run} late`)
await db.execute(`insert into public.jobs (correlation_id, project_id, kind, requested_by, idempotency_key)
  values (gen_random_uuid(), ${lit(bad)}::uuid, 'verification.conversation', 'grant', ${lit(`h:${run}:2`)})`)
let refused = ''
try {
  await o.declare('teamhq', bad)
} catch (e) {
  refused = String((e as Error).message)
}
check(
  'control: declared AFTER work is refused (the first production run)',
  refused.includes('real work'),
  refused.split('\n')[0] ?? '',
)

// The suite's own turn is harness and hidden; the real-shaped one is shown.
await db.execute(
  `select app.say_in_project(${lit(good)}::uuid, ${lit(`Said from the studio ${run}`)}, 'research-director')`,
)
const own = ((
  await one(`select app.conversation_history(app.test_office(), ${lit(good)}::uuid, 100) as v`)
).v ?? []) as Msg[]
check(
  'the suite’s own studio turn is hidden (0602)',
  !own.some((m) => String(m.body).includes('Said from the studio')),
  `${String(own.length)} shown`,
)
const studio = await inRollback(`
  v := app.say_in_project(pr, ${lit(`Said for real from the studio ${run}`)}, 'research-director');
  e := app.say_in_project(pr, ${lit(`Addressed for real to nobody ${run}`)}, 'nobody-at-all');
  r := jsonb_build_object('origin', app.job_origin((v ->> 'job')::uuid), 'nobody_ok', e ->> 'ok',
                          'history', app.conversation_history(app.test_office(), pr, 100));`)
const h = (studio.history ?? []) as Msg[]
const said = h.find((m) => String(m.body).includes(`Said for real from the studio ${run}`))
check(
  'a real-shaped studio turn is trusted and shown, from Grant, on teamhq, not backfilled',
  studio.origin === 'trusted' &&
    said?.from === 'grant' &&
    said.surface === 'teamhq' &&
    said.backfilled === false,
  `origin=${String(studio.origin)} from=${String(said?.from)} surface=${String(said?.surface)} backfilled=${String(said?.backfilled)}`,
)
check(
  'and one addressed to nobody still arrives',
  studio.nobody_ok === 'true' &&
    h.some((m) => String(m.body).includes(`Addressed for real to nobody ${run}`)),
  `ok=${String(studio.nobody_ok)}`,
)
const left =
  await one(`select (select count(*) from public.projects where name = ${lit(`History real ${run}`)})::int as p,
  (select count(*) from public.inbound_commands where instruction like ${lit(`%for real%${run}`)})::int as c`)
check(
  'and nothing from the rolled-back block exists afterwards',
  Number(left.p) === 0 && Number(left.c) === 0,
  `projects=${String(left.p)} commands=${String(left.c)}`,
)
const sends = await one(
  `select count(*)::int as n from public.deliveries where created_at > app.now_utc() - interval '5 minutes'`,
)
check('and no delivery was made', Number(sends.n) === 0, `${String(sends.n)} deliveries`)
const failed = results.filter((x) => !x).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exit(failed === 0 ? 0 : 1)
