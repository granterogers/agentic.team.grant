/**
 * Does the specialist's contribution actually change the answer? (#318)
 *
 *   npm run delegation:delta
 *
 * The necessity measurement says 88% of Grant's real requests need nobody but
 * the Chief. The other half of #318 is whether collaboration, when it DOES
 * fire, alters the result — and that could not be measured on the fresh
 * two-domain material, because every fixture project is empty and every
 * contribution came back "I have no record". A measure that cannot establish
 * its own condition has to say so rather than print a number.
 *
 * So this seeds a contained project with documents that make the question
 * answerable, and then uses the A/B that now exists inside a single run:
 *
 *   A  the answerer's own output — what the office says WITHOUT the specialist
 *   B  the synthesis — what it says WITH them
 *
 * Both are real, both are from the same request, and nothing has to be
 * suppressed to get them. Judged by the comparer `verify:judge` calibrates,
 * blind, with the sides swapped, so a position bias reads as unscoreable
 * rather than as a result.
 *
 * ## Contained
 *
 * A fixture project, fixture documents, a `verify-` actor so every job is
 * generated harness traffic, and a teardown that asserts what it removed.
 * Nothing is written into a real project: CLAUDE.md records three
 * near-duplicate PDFs landing in Legacy Coaching from a harness that caused
 * real work, and this one causes real work by design.
 */

import '../src/safety/require-production-checks.ts'
import { ManagementApiExecutor, type SqlExecutor } from '../src/db/executor.ts'
import { direction, makeComparer } from '../src/eval/judge.ts'
import { ProviderRouter } from '../src/providers/router.ts'

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
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}

const orKey = String(
  (
    await one(`select coalesce(app.resolve_secret(secret_ref), '') as v from public.providers
                where provider = 'openrouter' and secret_ref is not null limit 1`)
  ).v ?? '',
)
const compare = makeComparer(new ProviderRouter(db, orKey))

const run = Date.now().toString(36)
const SLUG = `fixture-delta-${run}`
const THREAD = `delta-${run}`

/*
  The material. Invented — not one word of Grant's correspondence, his
  clients or his numbers, for the reason `verify:judge` gives about its own
  corpus: a fixture lives in the repository for ever and is read by people and
  by models. The SHAPE is what matters: facts that a finance reading and a
  strategy reading would each use differently.
*/
const DOCS: readonly { title: string; body: string }[] = [
  {
    title: 'Onboarding cost breakdown',
    body:
      'Onboarding a new account costs GBP 310 in staff time: 4 hours of setup at GBP 55 ' +
      'and 1.5 hours of training at GBP 60. Across 40 accounts a quarter that is ' +
      'GBP 12,400. Accounts that complete onboarding renew at 71 per cent; those that ' +
      'skip it renew at 44 per cent.',
  },
  {
    title: 'Competitor onboarding pricing',
    body:
      'Northwind charges GBP 500 as a one-off onboarding fee. Calloway includes ' +
      'onboarding free but requires a twelve-month contract. Pemberton charges ' +
      'GBP 250 and refunds it if the customer stays a year. Two of the three publish ' +
      'the fee on their pricing page.',
  },
  {
    title: 'Support load after onboarding',
    body:
      'Accounts that completed onboarding raise 2.1 support tickets in their first ' +
      'quarter. Accounts that did not raise 6.8. Each ticket costs about GBP 18 to ' +
      'handle.',
  },
]

console.log(`\n#318 — does the specialist change the answer?  (run ${run})\n`)

await db.execute(`
  insert into public.projects (name, slug, purpose, status)
  values (${lit(`Fixture delta ${run}`)}, ${lit(SLUG)},
          'measuring whether a second specialist changes the result', 'paused')`)
const project = String(
  (await one(`select project_id::text as v from public.projects where slug = ${lit(SLUG)}`)).v ??
    '',
)
/*
  Created PAUSED, then attached, then activated. ADR-0014 refuses an active
  project with no enabled attachment — "a project reads from and writes to
  somewhere real" — and the trigger says so by name, which is how this was
  found on the first run rather than by reading.
*/
await db.execute(`
  insert into public.project_attachments
    (project_id, connector, external_ref, display_name, role, enabled)
  values (${lit(project)}::uuid, 'upload', ${lit(`delta-${run}`)},
          ${lit(`Fixture delta ${run} uploads`)}, 'source', true)`)
await db.execute(
  `update public.projects set status = 'active' where project_id = ${lit(project)}::uuid`,
)

for (const d of DOCS) {
  await db.execute(`
    insert into public.documents
      (project_id, title, content, content_fingerprint, fetched_at, connector, origin,
       state, produced_by)
    values (${lit(project)}::uuid, ${lit(d.title)}, ${lit(d.body)},
            encode(extensions.digest(${lit(d.body)}, 'sha256'), 'hex'),
            app.now_utc(), 'upload', 'source', 'approved', 'the harness')`)
}
console.log(`  seeded ${String(DOCS.length)} documents in ${SLUG}`)

const ASK =
  'Work out what onboarding actually costs us per account and what the competitors ' +
  'charge for it, and on that basis tell me whether we should start charging for ours.'

const command = String(
  (
    await one(`
      insert into public.inbound_commands
        (origin_channel, origin_ref, actor, instruction, dedupe_key, project_id)
      values ('teamhq', ${lit(`${THREAD}:1`)}, ${lit(`verify-delta-${run}`)},
              ${lit(ASK)}, ${lit(`teamhq:delta:${THREAD}_one`)}, ${lit(project)}::uuid)
      returning command_id::text as v`)
  ).v ?? '',
)
const enq = (await one(`select app.enqueue_inbound(${lit(command)}::uuid) as v`)).v
const parsed = (typeof enq === 'string' ? JSON.parse(enq) : enq) as { job_id?: string }
const parent = String(parsed.job_id ?? '')
console.log(`  asked: ${ASK.slice(0, 66)}…`)

/* Wait for the parent AND for any synthesis it registered. */
let parentBody = ''
let synthBody = ''
for (let i = 0; i < 80; i += 1) {
  const row = await one(`
    select coalesce((select o.body from public.outputs o where o.job_id = ${lit(parent)}::uuid
                      order by o.created_at desc limit 1), '') as parent_body,
           coalesce((select so.body from public.branch_groups g
                       join public.jobs s on s.job_id = g.synthesis_job_id
                       join public.outputs so on so.job_id = s.job_id
                      where g.parent_job_id = ${lit(parent)}::uuid
                      order by so.created_at desc limit 1), '') as synth_body,
           app.obligation_state(${lit(parent)}::uuid)::text as obligation`)
  parentBody = String(row.parent_body ?? '')
  synthBody = String(row.synth_body ?? '')
  if (parentBody !== '' && synthBody !== '') break
  if (i % 10 === 9) console.log(`    …${String(row.obligation)}`)
  await new Promise((r) => setTimeout(r, 5_000))
}

const convened = Number(
  (
    await one(`select count(*)::int as v from public.jobs
                where parent_job_id = ${lit(parent)}::uuid and kind = 'office.instruction'`)
  ).v ?? 0,
)
console.log(`\n  convened ${String(convened)} specialist(s)`)
console.log(
  `  A (answerer alone) ${parentBody === '' ? 'NOTHING' : `${String(parentBody.length)} chars`}`,
)
console.log(
  `  B (with specialist)${synthBody === '' ? ' NOTHING' : ` ${String(synthBody.length)} chars`}`,
)

if (parentBody === '' || synthBody === '') {
  /*
    Said rather than scored. A delta over a missing side is not a small
    delta, it is no measurement — and a run that prints a number here would
    be the found-nothing shape reporting a perfect score.
  */
  console.log(
    `\n  INCONCLUSIVE — ${convened === 0 ? 'nothing was convened, so there is no B to compare' : 'one side never arrived'}. Nothing scored.\n`,
  )
} else {
  const then = await compare(ASK, parentBody, synthBody)
  const swapped = await compare(ASK, synthBody, parentBody)
  const verdict = direction(then, swapped)
  console.log(`\n  blind:   ${then?.better ?? '?'} — ${then?.reason.slice(0, 90) ?? ''}`)
  console.log(`  swapped: ${swapped?.better ?? '?'} — ${swapped?.reason.slice(0, 90) ?? ''}`)
  console.log(
    `\n  QUALITY DELTA: with the specialist is ${verdict === 'better' ? 'BETTER' : verdict === 'worse' ? 'WORSE' : verdict === 'unchanged' ? 'no different' : 'UNSCOREABLE (the judge reversed itself)'}\n`,
  )
}

/* Teardown, and it asserts what it removed (CLAUDE.md: a teardown that matches nothing looks like one that worked). */
await db.execute(`delete from public.documents where project_id = ${lit(project)}::uuid`)
await db.execute(`
  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
    state_reason = 'delta probe teardown'
   where (job_id = ${lit(parent)}::uuid or parent_job_id = ${lit(parent)}::uuid)
     and state not in ('complete', 'cancelled', 'failed')`)
await db.execute(`delete from public.inbound_commands where origin_ref like ${lit(`${THREAD}:%`)}`)
const left = await one(`
  select (select count(*)::int from public.documents where project_id = ${lit(project)}::uuid) as docs,
         (select count(*)::int from public.inbound_commands
           where origin_ref like ${lit(`${THREAD}:%`)}) as cmds`)
console.log(
  `  teardown: ${String(left.docs)} document(s) and ${String(left.cmds)} command(s) left behind` +
    `${Number(left.docs) === 0 && Number(left.cmds) === 0 ? '' : '  >>> DEBRIS'}`,
)
console.log(
  `  the project stays: it has gathered jobs, and a job can never be deleted — swept by check:leaks\n`,
)
