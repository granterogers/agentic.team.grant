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
import { governOutward, mayAct } from '../../src/agents/approval.ts'
import { isolated } from './guard.ts'

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
  String(
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
  suggest: { read: 'proceed', write: 'ask', outward: 'ask' },
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
    tool: 'task.create',
    jobAskedFor: person,
  })
  const unprompted = await mayAct(db as never, {
    projectId: p,
    tool: 'task.create',
    jobAskedFor: duty,
  })
  check(
    'work a person asked for proceeds below level 3; a duty of the same kind still asks',
    asked.verdict === 'proceed' && asked.askedFor && unprompted.verdict === 'ask',
    `${asked.verdict}/${unprompted.verdict}`,
  )
  const outward = await mayAct(db as never, {
    projectId: p,
    tool: 'notion.write',
    jobAskedFor: person,
  })
  check(
    'and a person asking is consent for an outward (level 2) write too - the plan step deliberately withholds it',
    outward.verdict === 'proceed',
    outward.verdict,
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

// ---- KNOWN GAP 1: a specialist's grant is not consulted when a step runs ---
{
  const staff = String(
    (await one(`select slug from public.staff where slug <> 'chief-of-staff' limit 1`)).slug,
  )
  await db.execute(
    `delete from public.staff_tools where staff_slug = ${lit(staff)} and tool = 'task.create'`,
  )
  const may = (await one(`select app.staff_may_use(${lit(staff)}, 'task.create') as m`)).m
  const p = await project('staffgap')
  await setDial(p, 'act')
  const d = await mayAct(db as never, { projectId: p, tool: 'task.create' })
  check(
    'KNOWN GAP staff_may_use: the specialist has NO grant, yet the policy answers proceed and no caller can pass the specialist',
    may === false && d.verdict === 'proceed',
    `staff_may_use=${String(may)}, may_act=${d.verdict}`,
  )
}

// ---- KNOWN GAP 2: a decline is not remembered by the caller that asked -----
{
  const p = await project('decline')
  await setDial(p, 'suggest')
  const ask = async () => {
    const j = await job(p, 'duty:isolated-decline', 'google.write_calendar_tasks')
    return governOutward(db as never, {
      jobId: j,
      projectId: p,
      tool: 'notion.write',
      summary: 'The copy is behind',
      detail: '1. Update "A"',
      empty: false,
      agent: 'operations-director',
    })
  }
  const first = await ask()
  await db.execute(
    `select app.hq_answer_blocker(${lit(String(first.blocker))}::uuid, 'No, leave it', 'grant')`,
  )
  const second = await ask()
  check(
    'KNOWN GAP durable refusal: after "No, leave it" the next run asks the same question again',
    first.blocker !== null && second.blocker !== null && second.blocker !== first.blocker,
    `${String(first.blocker).slice(0, 8)} then ${String(second.blocker).slice(0, 8)}`,
  )
}

// ---- KNOWN GAP 3: ticking the to-do answers the question as nobody ---------
{
  const p = await project('tick')
  const j = await job(p, 'telegram:grant-tick')
  await db
    .execute(
      `update public.jobs set state = 'running', started_at = now() where job_id = ${lit(j)}::uuid`,
    )
    .catch(() => undefined)
  const b = String(
    (
      await one(`insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay,
          approval_options, originating_agent, work_can_continue, standing_tool, standing_option)
        values (${lit(p)}::uuid, ${lit(j)}::uuid, 'Characterise the tick', 'characterising the tick door', 'Nothing happens until somebody answers this question.',
          array['Yes, keep doing it without asking me', 'No, leave it'], 'chief-of-staff', false,
          'notion.write', 'Yes, keep doing it without asking me') returning blocker_id::text as id`)
    ).id,
  )
  await db.execute(
    `update public.tasks set state = 'done' where satisfies_blocker = ${lit(b)}::uuid`,
  )
  const after = await one(
    `select state::text as s, resolution as r from public.blockers where blocker_id = ${lit(b)}::uuid`,
  )
  const standing = await one(
    `select count(*)::int as n from public.standing_authorizations where tool = 'notion.write' and project_id = ${lit(p)}::uuid`,
  )
  check(
    'KNOWN GAP task-tick: the tick resolves the question with NO principal named in the resolution',
    after.s === 'resolved' && !/answered by/.test(String(after.r)),
    String(after.r),
  )
  check(
    'KNOWN GAP task-tick: and it never runs what answering promises (no standing row written)',
    Number(standing.n) === 0,
    `${String(standing.n)} standing rows`,
  )
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1
