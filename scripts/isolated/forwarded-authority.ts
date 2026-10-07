/**
 * #397 (Run 5, 0624) - forwarded content is content, not intent.
 *
 *   npx tsx scripts/isolated/forwarded-authority.ts <replica-db>
 *
 * The real `app.may_act`: a job Grant started is "asked for" and proceeds at level 1-2; the same job when the turn
 * was FORWARDED text is not, and asks. His own words, a duty, a legacy job and a standing authorization are the
 * controls that prove the change bought no precision loss.
 */
import { isolated } from './guard.ts'
import { realTurn } from './fixtures-approvals.ts'
import { registerBot } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'fwd624')
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
await registerBot(db)
const project = String(
  (await one(`select app.unnamed_project(app.operator_office())::text as p`)).p,
)

const turn = async (context: Record<string, unknown>) =>
  (await realTurn(db, { channel: 'telegram', text: 'file this for me', context })).job
const child = async (parent: string) =>
  String(
    (
      await one(
        `select app.enqueue_child(app.job_office(${lit(parent)}::uuid), ${lit(parent)}::uuid, 'verify.ask', '{}'::jsonb)::text as c`,
      )
    ).c,
  ).match(/[0-9a-f-]{36}/)?.[0] as string
const verdict = async (job: string | null, tool = 'notebook.write') => {
  const v = (
    await one(
      `select app.may_act(${lit(project)}::uuid, ${lit(tool)}, ${job === null ? 'null' : `${lit(job)}::uuid`})::text as v`,
    )
  ).v
  return JSON.parse(String(v)) as { verdict: string; asked_for?: boolean }
}

const typed = await turn({})
const fwd = await turn({ forwarded: true })
const typedKid = await child(typed)
const fwdKid = await child(fwd)
const fwdGrand = await child(fwdKid)

let v = await verdict(typedKid)
check(
  'his own words: work he started proceeds without asking (level 2, prompted)',
  v.verdict === 'proceed' && v.asked_for === true,
  JSON.stringify(v),
)
v = await verdict(fwd)
check(
  'a FORWARDED turn is not asked-for: the same action asks',
  v.verdict === 'ask' && v.asked_for !== true,
  JSON.stringify(v),
)
v = await verdict(fwdKid)
check('and so does work it handed on', v.verdict === 'ask', v.verdict)
v = await verdict(fwdGrand)
check('to any depth', v.verdict === 'ask', v.verdict)
check(
  'the forwarded root itself reads forwarded, his own does not',
  (
    await one(
      `select app.job_forwarded(${lit(fwdGrand)}::uuid) as f, app.job_forwarded(${lit(typedKid)}::uuid) as g`,
    )
  ).f === true && (await one(`select app.job_forwarded(${lit(typedKid)}::uuid) as g`)).g === false,
  'true/false',
)
v = await verdict(null)
check('no job is unprompted (unchanged)', v.verdict === 'ask', v.verdict)
// a legacy job: no stored origin, so it reads as it always did
const legacy = String(
  (
    await one(`insert into public.jobs (office_id, kind, requested_by, project_id, idempotency_key, correlation_id)
    values (app.operator_office(), 'verify.ask', 'teamhq:verify-fwd', app.unnamed_project(app.operator_office()), 'fwd-' || gen_random_uuid(), gen_random_uuid()) returning job_id::text as id`)
  ).id,
)
await db
  .execute(`update public.jobs set origin_command_id = null where job_id = ${lit(legacy)}::uuid`)
  .catch(() => undefined)
v = await verdict(legacy)
check(
  'a job with no stored turn (legacy) keeps its old reading: asked-for',
  v.asked_for === true,
  JSON.stringify(v),
)
// a standing authorization still upgrades a forwarded job, as any explicit yes does
// Through the product's writer, with no swallowed error: a standing yes that was never written would make the
// check below fail for the wrong reason rather than vacuously pass.
await db.execute(
  `select app.grant_standing(app.operator_office(), 'notebook.write', ${lit(project)}::uuid, 'forwarded proof', 'grant', null)`,
)
v = await verdict(fwdKid)
check(
  'an explicit standing authorization is untouched by a forwarded turn',
  v.verdict === 'proceed',
  JSON.stringify(v),
)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1
