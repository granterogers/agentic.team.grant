/**
 * Run 2 (D1): characterise the authority paths BEFORE consolidating them.
 *
 *   npx tsx scripts/isolated/authority-characterization.ts <replica-db>
 *
 * What the office decides today about "may this effect happen?" and "has it been
 * approved?", read from the REAL `mayAct`, `governOutward`, `compile` and the
 * blocker functions against an isolated replica. Every check either PINS
 * behaviour that must survive the consolidation, or is labelled KNOWN GAP and
 * pins a behaviour Run 2 exists to change: when a gap is closed its check flips
 * and is rewritten as the property, never deleted.
 */
import { mayAct } from '../../src/agents/approval.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'authchar')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
const project = async (label: string): Promise<string> =>
  String(
    json(
      (
        await one(`select app.hq_create_project(${lit(`Authority ${label} ${run}`)}, 'upload', ${lit(`authority-${label}-${run}`)},
          ${lit(`Authority ${label} ${run}`)}, true) as v`)
      ).v,
    ).project_id,
  )
const setDial = (p: string, level: string) =>
  db.execute(
    `insert into public.autonomy_settings (project_id, level, set_by, reason) values (${lit(p)}::uuid, ${lit(level)}, 'grant', 'characterisation')`,
  )
const job = async (p: string, by: string, kind = 'office.instruction'): Promise<string> =>
  by.startsWith('telegram:')
    ? // a person's work is a child of a real adapter turn: a root that only NAMES him is unknown provenance
      (String(
        (
          await one(
            `select app.enqueue_child(${lit(await realParent(db))}::uuid, ${lit(kind)}, '{}'::jsonb, interval '0', true, ${lit(p)}::uuid)::text as id`,
          )
        ).id,
      ).match(/[0-9a-f-]{36}/)?.[0] ?? '')
    : String(
        (
          await one(`insert into public.jobs (kind, requested_by, project_id, idempotency_key, correlation_id)
        values (${lit(kind)}, ${lit(by)}, ${lit(p)}::uuid, 'ac-' || gen_random_uuid(), gen_random_uuid())
        returning job_id::text as id`)
        ).id,
      )

// ---- the matrix, through the real caller ---------------------------------
const TOOLS = { read: 'db.read', write: 'task.create', outward: 'notion.write' } as const
const EXPECT: Record<string, Record<keyof typeof TOOLS, string>> = {
  observe: { read: 'proceed', write: 'refuse', outward: 'refuse' },
  suggest: { read: 'proceed', write: 'proceed', outward: 'ask' }, // 0612
  act_with_review: { read: 'proceed', write: 'proceed', outward: 'ask' },
  act: { read: 'proceed', write: 'proceed', outward: 'proceed' },
}
for (const [level, want] of Object.entries(EXPECT)) {
  const p = await project(level)
  await setDial(p, level)
  for (const [kind, tool] of Object.entries(TOOLS) as [keyof typeof TOOLS, string][]) {
    const d = await mayAct(db as never, { projectId: p, tool })
    check(
      `matrix: ${level} x ${kind} (${tool})`,
      d.verdict === want[kind],
      `${d.verdict} - ${d.because.slice(0, 60)}`,
    )
  }
}
{
  const p = await project('reg')
  await setDial(p, 'act')
  const off = await mayAct(db as never, { projectId: p, tool: 'gmail.send' })
  check(
    'a level-3 tool that is switched off is refused even at act',
    off.verdict === 'refuse',
    off.because.slice(0, 70),
  )
  const unknown = await mayAct(db as never, { projectId: p, tool: `not.a.tool.${run}` })
  check(
    'an unknown capability is refused',
    unknown.verdict === 'refuse',
    unknown.because.slice(0, 70),
  )
}

// ---- asked-for uplift and standing authority ------------------------------
{
  const p = await project('asked')
  await setDial(p, 'suggest')
  const person = await job(p, 'telegram:grant1')
  const duty = await job(p, 'duty:isolated-ac')
  const asked = await mayAct(db as never, {
    projectId: p,
    tool: 'notion.write',
    jobAskedFor: person,
  })
  const unprompted = await mayAct(db as never, {
    projectId: p,
    tool: 'notion.write',
    jobAskedFor: duty,
  })
  check(
    'outward work a person asked for proceeds below level 3; a duty of the same kind still asks',
    asked.verdict === 'proceed' && asked.askedFor && unprompted.verdict === 'ask',
    `${asked.verdict}/${unprompted.verdict}`,
  )
  const internal = await mayAct(db as never, {
    projectId: p,
    tool: 'task.create',
    jobAskedFor: duty,
  })
  check(
    'internal office work proceeds at suggest even for a duty (0612)',
    internal.verdict === 'proceed',
    internal.verdict,
  )
}
{
  const p = await project('standing')
  await setDial(p, 'suggest')
  await db.execute(
    `select app.grant_standing('notion.write', ${lit(p)}::uuid, 'characterisation', 'grant', null)`,
  )
  const up = await mayAct(db as never, { projectId: p, tool: 'notion.write' })
  check(
    'a standing authorization upgrades ask to proceed',
    up.verdict === 'proceed' && up.standing !== null,
    up.verdict,
  )
  await setDial(p, 'observe')
  const still = await mayAct(db as never, { projectId: p, tool: 'notion.write' })
  check(
    'but never refuse: observe plus a live standing row still refuses',
    still.verdict === 'refuse',
    still.verdict,
  )
}

/*
  The three KNOWN GAP checks that stood here (a specialist's grant not consulted,
  a decline not remembered, a tick answering as nobody) were flipped by 0611 and
  live on as properties in scripts/isolated/authority.ts.
*/

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1
