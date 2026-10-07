/*
  e2e-boundary - Part 2 of the local end-to-end verification (agent E2): the human-contact / outward-effect boundary,
  driven through the REAL policy (`mayAct` -> app.authorize_effect -> app.may_act_in) on a marked local replica.

    npx tsx scripts/isolated/e2e-boundary.ts <replica-db>

  For EVERY row of public.tool_permissions x every autonomy dial x {unprompted job, job a person typed, job a person
  FORWARDED} x audience {unstated, outside}, it asks the policy and checks the properties the policy exists for:

    P1  a disabled tool (gmail.send, gmail.draft, github.write, ...) never proceeds, at any dial, for any job
    P2  a level-3 tool never proceeds on the dial alone (only an exact, recorded yes may start it)
    P3  an audience declared `outside` never proceeds at level >= 1 (the floor under the model's own labelling)
    P4  `observe` refuses every write (level >= 1)
    P5  forwarded words never count as "he asked" (asked_for is false for a forwarded turn)
    C1  control: a typed job at level 1-2 DOES proceed at suggest/act_with_review (the gate is not "refuse everything")
    C2  control: at `act` an unprompted level-2 tool proceeds (the dial is read, not ignored)

  Each refusal's reason is read, never assumed; the matrix of the tools that can reach a person is printed.
  Nothing leaves the process: only SQL against the replica; dials are written to the replica clone.
*/
import { mayAct } from '../../src/agents/approval.ts'
import { isolated } from './guard.ts'
import { CHAT, realParent, realTelegramKey, registerBot } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'e2_boundary')
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: boolean[] = []
const check = (what: string, ok: boolean, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
const DOOR = "set local application_name = 'PostgREST 14.5';"

await registerBot(db)
const office = String((await one(`select app.operator_office()::text as o`)).o)
const project = String(
  (await one(`select app.unnamed_project(app.operator_office())::text as p`)).p,
)

const forwardedTurn = async (): Promise<string> => {
  const key = realTelegramKey()
  const msg = key.split(':').pop() ?? '1'
  const cmd = await one(`${DOOR}
    insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key, subject, context)
    values (app.operator_office(), ${lit(project)}::uuid, 'telegram', ${lit(`${CHAT}:${msg}`)}, ${lit(CHAT)}, 'send this to everyone', ${lit(key)}, 'grant', '{"forwarded": true}'::jsonb)
    returning command_id::text as id`)
  const enq = await one(`${DOOR} select public.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`)
  const v = typeof enq.v === 'string' ? JSON.parse(enq.v) : enq.v
  return String((v as { job_id: string }).job_id)
}
const childOf = async (parent: string): Promise<string> => {
  const raw = String(
    (
      await one(
        `select app.enqueue_child(app.job_office(${lit(parent)}::uuid), ${lit(parent)}::uuid, 'e2.probe', '{}'::jsonb)::text as c`,
      )
    ).c,
  )
  const m = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
  if (m === null) throw new Error(`no child id in ${raw}`)
  return m[0]
}

const typedRoot = await realParent(db)
const typed = await childOf(typedRoot)
const fwdRoot = await forwardedTurn()
const forwarded = await childOf(fwdRoot)

const tools = (
  await db.execute(`select tool, level, enabled from public.tool_permissions order by level, tool`)
).rows as { tool: string; level: number; enabled: boolean }[]
const DIALS = ['observe', 'suggest', 'act_with_review', 'act'] as const
const JOBS: [string, string | null][] = [
  ['unprompted', null],
  ['typed', typed],
  ['forwarded', forwarded],
]
const AUDIENCES: (null | 'outside')[] = [null, 'outside']

const setDial = async (level: string) => {
  await db.execute(
    `insert into public.autonomy_settings (office_id, project_id, level, set_by, reason)
       values (${lit(office)}::uuid, null, ${lit(level)}::public.autonomy_level, 'e2e-boundary', 'driving the policy matrix')`,
  )
}

interface Cell {
  tool: string
  level: number
  enabled: boolean
  dial: string
  job: string
  audience: string
  verdict: string
  asked: boolean
  because: string
}
const cells: Cell[] = []
for (const dial of DIALS) {
  await setDial(dial)
  const seen = String(
    (
      await one(
        `select app.autonomy_for_in(${lit(office)}::uuid, ${lit(project)}::uuid)::text as a`,
      )
    ).a,
  )
  if (seen !== dial) throw new Error(`the dial did not take: wanted ${dial}, policy reads ${seen}`)
  for (const t of tools) {
    for (const [jobName, jobId] of JOBS) {
      for (const aud of AUDIENCES) {
        const d = await mayAct(db, {
          projectId: project,
          tool: t.tool,
          job: jobId,
          jobAskedFor: jobId,
          audience: aud,
        })
        cells.push({
          tool: t.tool,
          level: t.level,
          enabled: t.enabled,
          dial,
          job: jobName,
          audience: aud ?? 'unstated',
          verdict: d.verdict,
          asked: d.askedFor,
          because: d.because,
        })
      }
    }
  }
}
console.log(
  `\n${cells.length} policy cells driven (${tools.length} tools x ${DIALS.length} dials x ${JOBS.length} jobs x ${AUDIENCES.length} audiences)\n`,
)

const offenders = (pred: (c: Cell) => boolean) => cells.filter(pred)
const names = (xs: Cell[]) =>
  xs
    .slice(0, 3)
    .map((c) => `${c.tool}@${c.dial}/${c.job}/${c.audience}`)
    .join(', ')

let bad = offenders((c) => !c.enabled && c.verdict === 'proceed')
check(
  'P1 a disabled tool never proceeds (any dial, any job, any audience)',
  bad.length === 0,
  bad.length === 0 ? `${cells.filter((c) => !c.enabled).length} cells` : names(bad),
)
bad = offenders((c) => c.level >= 3 && c.verdict === 'proceed')
check(
  'P2 a level-3 tool never proceeds on the dial alone',
  bad.length === 0,
  bad.length === 0 ? `${cells.filter((c) => c.level >= 3).length} cells` : names(bad),
)
bad = offenders((c) => c.audience === 'outside' && c.level >= 1 && c.verdict === 'proceed')
check(
  'P3 an outside audience never proceeds at level >= 1',
  bad.length === 0,
  bad.length === 0
    ? `${cells.filter((c) => c.audience === 'outside' && c.level >= 1).length} cells`
    : names(bad),
)
bad = offenders((c) => c.dial === 'observe' && c.level >= 1 && c.verdict !== 'refuse')
check(
  'P4 observe refuses every write',
  bad.length === 0,
  bad.length === 0
    ? `${cells.filter((c) => c.dial === 'observe' && c.level >= 1).length} cells`
    : names(bad),
)
bad = offenders((c) => c.job === 'forwarded' && c.asked)
check(
  'P5 forwarded words are never "he asked"',
  bad.length === 0,
  bad.length === 0 ? `${cells.filter((c) => c.job === 'forwarded').length} cells` : names(bad),
)
const typedOk = cells.filter(
  (c) =>
    c.job === 'typed' &&
    c.audience === 'unstated' &&
    c.enabled &&
    c.level >= 1 &&
    c.level <= 2 &&
    (c.dial === 'suggest' || c.dial === 'act_with_review'),
)
check(
  'C1 control: a typed level-1/2 job proceeds at suggest/act_with_review',
  typedOk.length > 0 && typedOk.every((c) => c.verdict === 'proceed' && c.asked),
  `${typedOk.length} cells`,
)
// Tools whose answer is not the dial's alone: authorised one destination at a time (scoped), or carrying a standing yes
// Grant gave (the replica holds one for calendar.write). They are real behaviour, not the plain dial the controls read.
const special = new Set<string>([
  ...(
    await db.execute(`select tool from public.tool_permissions where scoped union
      select tool from public.standing_authorizations where revoked_at is null and office_id = ${lit(office)}::uuid`)
  ).rows.map((r) => String((r as { tool: string }).tool)),
])
console.log(`(excluded from the plain-dial controls: ${[...special].join(', ')})`)
const actOk = cells.filter(
  (c) =>
    c.job === 'unprompted' &&
    c.audience === 'unstated' &&
    c.enabled &&
    c.level === 2 &&
    c.dial === 'act' &&
    !special.has(c.tool),
)
check(
  'C2 control: at act an unprompted level-2 tool proceeds',
  actOk.length > 0 && actOk.every((c) => c.verdict === 'proceed'),
  `${actOk.length} cells`,
)
const fwdAsk = cells.filter(
  (c) =>
    c.job === 'forwarded' &&
    c.audience === 'unstated' &&
    c.enabled &&
    c.level === 2 &&
    c.dial === 'suggest' &&
    !special.has(c.tool),
)
check(
  'C3 control: a FORWARDED level-2 request at suggest asks, where a typed one proceeds',
  fwdAsk.length > 0 && fwdAsk.every((c) => c.verdict === 'ask'),
  `${fwdAsk.length} cells`,
)
const fwdScoped = cells.filter(
  (c) =>
    c.job === 'forwarded' &&
    c.audience === 'unstated' &&
    c.dial === 'act' &&
    ['notion.write', 'task.board.write'].includes(c.tool),
)
check(
  'C4 a forwarded request cannot use a destination-scoped write even at act',
  fwdScoped.length > 0 && fwdScoped.every((c) => c.verdict === 'ask'),
  `${fwdScoped.length} cells`,
)

// What can reach a person or an outside system, one line each, at the two ends of the dial.
const SHOW = [
  'gmail.send',
  'gmail.draft',
  'slack.post',
  'calendar.write',
  'notion.write',
  'task.board.write',
  'github.write',
  'slack.channel',
  'spend.money',
  'task.create',
  'draft.create',
]
console.log(
  '\ntool              lvl on   suggest(unp/typed/fwd)   act(unp/typed/fwd)    act+outside(typed)',
)
for (const tool of SHOW) {
  const row = (dial: string, aud = 'unstated') =>
    JOBS.map(
      ([j]) =>
        cells.find((c) => c.tool === tool && c.dial === dial && c.job === j && c.audience === aud)
          ?.verdict ?? '?',
    ).join('/')
  const meta = cells.find((c) => c.tool === tool)
  console.log(
    `${tool.padEnd(17)} ${String(meta?.level)}   ${meta?.enabled ? 'y' : 'n'}    ${row('suggest').padEnd(22)}  ${row('act').padEnd(20)}  ${cells.find((c) => c.tool === tool && c.dial === 'act' && c.job === 'typed' && c.audience === 'outside')?.verdict}`,
  )
}
const gm = cells.find((c) => c.tool === 'gmail.send' && c.dial === 'act' && c.job === 'typed')
console.log(`\ngmail.send at act, typed job: ${gm?.verdict} - ${gm?.because}`)

const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
await db.end()
process.exit(failed === 0 ? 0 : 1)
