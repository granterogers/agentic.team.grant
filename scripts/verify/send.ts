/**
 * Send an asset to the team with a NAMED action, and keep the thread.
 *
 *   npm run verify:send
 *
 * Issue #27, migrations 0313 and 0314.
 *
 * ## What this is instead of
 *
 * One button meaning "talk to the team about this", which opened the composer
 * with the item attached as a chip. Grant still typed the verb, every time, in
 * whatever words occurred to him, and the office recovered the intent by
 * reading a sentence. #27 names the actions instead and is explicit about what
 * each must produce: *"a typed job carrying the asset id, not a rendered
 * sentence."*
 *
 * ## The property that matters
 *
 * **The asset travels as facts, and the chain is stored.** A job whose
 * `pinned_config.context` holds `asset_id` needs nothing parsed out of English,
 * and `document -input_to-> job` plus the derived `job -produced-> document`
 * (0310) make #27's *"preserve the relationship between the source document,
 * agent job and resulting output"* a traversable fact rather than a
 * description.
 *
 * ## Real jobs, cancelled
 *
 * `send_to_agent` writes through `inbound_commands` like every other surface,
 * so `requested_by` comes out as `teamhq:grant` — correct, and therefore not a
 * fixture. They cannot be deleted (ADR-0022) so teardown cancels them and
 * unlinks the project, the way `verify:proposes` settled it.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'

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
const all = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const run = Math.random().toString(36).slice(2, 10)
const SLUG = `fixture-send-${run}`
const jobs: string[] = []

type Sent = {
  ok?: boolean
  job?: string
  action?: string
  about?: string
  said?: string
  error?: string
}
const send = async (
  kind: string,
  id: string,
  action: string,
  extra = 'null, null, null',
): Promise<Sent> => {
  const r = (
    await one(
      `select public.send_to_agent(${lit(kind)}, ${lit(id)}::uuid, ${lit(action)}, ${extra}) as r`,
    )
  ).r as Sent
  if (typeof r.job === 'string') jobs.push(r.job)
  return r
}

console.log(`\nverify:send — ${run}\n`)

let projectId = ''
let docId = ''
let otherId = ''

try {
  await one(`
    select app.hq_create_project(app.test_office(), ${lit(`Fixture send ${run}`)}, 'upload',
                                 ${lit(SLUG)}, ${lit(`Fixture send ${run}`)}, true) as r
  `)
  projectId = String(
    (await one(`select project_id::text as id from public.projects where slug = ${lit(SLUG)}`)).id,
  )
  const makeDoc = async (title: string): Promise<string> =>
    String(
      (
        await one(`
          insert into public.documents
            (project_id, connector, external_ref, title, doc_type, content,
             content_fingerprint, content_chars, fetched_at, origin)
          values (${lit(projectId)}::uuid, 'upload', ${lit(`${SLUG}-${title}`)},
                  ${lit(title)}, 'note', 'body',
                  encode(extensions.digest(${lit(`${SLUG}-${title}`)}, 'sha256'), 'hex'),
                  4, app.now_utc(), 'source')
          returning document_id::text as id
        `)
      ).id,
    )
  docId = await makeDoc('The brief')
  otherId = await makeDoc('The other brief')

  // =========================================================================
  console.log('the actions the specification names')

  const actions = await all(`select * from public.asset_actions()`)
  const names = actions.map((a) => String(a.action))
  check(
    'all six are defined as data, not as a case statement',
    names.join(', '),
    ['review', 'summarise', 'research', 'critique', 'extract_tasks', 'compare'].every((a) =>
      names.includes(a),
    ),
  )
  check(
    'and only Compare says it needs a second thing',
    actions
      .filter((a) => a.needs_two === true)
      .map((a) => String(a.action))
      .join(', ') || 'none',
    actions.filter((a) => a.needs_two === true).length === 1 &&
      actions.find((a) => a.needs_two === true)?.action === 'compare',
  )

  // =========================================================================
  console.log('\na named action becomes a job carrying the asset')

  const sent = await send('document', docId, 'review')
  check(
    'Review is accepted and answers with the job',
    JSON.stringify(sent).slice(0, 110),
    sent.ok === true,
  )

  const job = await one(`
    select j.pinned_config->'context' as ctx, j.pinned_config->>'instruction' as said,
           j.project_id::text as project, j.kind
      from public.jobs j where j.job_id = ${lit(String(sent.job))}::uuid
  `)
  const ctx = job.ctx as Record<string, unknown>
  check(
    'the job carries the asset as FACTS, not only as a sentence',
    JSON.stringify(ctx).slice(0, 120),
    ctx?.asset_id === docId && ctx?.asset_kind === 'document' && ctx?.action === 'review',
  )
  /*
    And a readable instruction as well, not instead. `enqueue_inbound` refuses a
    command with an empty instruction two lines in, and every handler and model
    downstream reads it — the context is so nothing has to recover a uuid by
    parsing English, not so the English goes away.
  */
  check(
    'and a sentence a person and a model can both read',
    String(job.said),
    String(job.said).includes('The brief') && String(job.said).startsWith('Review'),
  )

  /*
    The project is the ASSET'S, which `enqueue_inbound` did not do before 0313:
    it picked the most recently updated active project, so a Legacy Coaching
    document sent while another project happened to be touched more recently
    filed the job in the wrong place.
  */
  check(
    'and the job is filed against the project the asset belongs to',
    `${String(job.project) === projectId ? 'the right one' : 'THE WRONG PROJECT'}`,
    String(job.project) === projectId,
  )

  // =========================================================================
  console.log('\nsource, job and output are one chain')

  const fromDoc = await all(`select * from public.relations_of('document', ${lit(docId)}::uuid)`)
  const fromJob = await all(
    `select * from public.relations_of('job', ${lit(String(sent.job))}::uuid)`,
  )
  check(
    'the document says which job it went into',
    fromDoc
      .filter((e) => e.verb === 'input_to')
      .map((e) => `${String(e.direction)} ${String(e.other_kind)}`)
      .join(', ') || 'NOTHING',
    fromDoc.some((e) => e.verb === 'input_to' && e.other_id === sent.job),
  )
  check(
    'and the job says which document it came from, by name',
    String(fromJob.find((e) => e.verb === 'input_to')?.other_title ?? 'NO TITLE'),
    fromJob.some((e) => e.verb === 'input_to' && e.other_title === 'The brief'),
  )
  /*
    The other half needs no row: `job -produced-> document` is derived from
    `documents.produced_by_job` (0310), so the chain closes the moment the job
    writes something. Simulated here rather than run, because running it means
    a real model call — what is asserted is that the derived half APPEARS.
  */
  await db.execute(`
    update public.documents set produced_by_job = ${lit(String(sent.job))}::uuid
     where document_id = ${lit(otherId)}::uuid
  `)
  const closed = await all(
    `select * from public.relations_of('job', ${lit(String(sent.job))}::uuid)`,
  )
  check(
    'and once the job writes something, the whole chain is traversable',
    closed.map((e) => `${String(e.verb)}:${String(e.other_title)}`).join(', '),
    closed.some((e) => e.verb === 'input_to' && e.other_title === 'The brief') &&
      closed.some((e) => e.verb === 'produced' && e.other_title === 'The other brief'),
  )

  // =========================================================================
  console.log('\nand it refuses rather than guessing')

  const typo = await send('document', docId, 'revuew')
  check(
    'an action nobody defined is refused, naming it',
    JSON.stringify(typo),
    typo.ok === false && String(typo.error).includes('revuew'),
  )
  const lonely = await send('document', docId, 'compare')
  check(
    'Compare with nothing to compare against is refused, and says what it needs',
    JSON.stringify(lonely),
    lonely.ok === false && String(lonely.error).includes('second thing'),
  )
  const paired = await send('document', docId, 'compare', `null, ${lit(otherId)}::uuid, null`)
  check(
    'Compare with a second asset is accepted',
    JSON.stringify(paired).slice(0, 80),
    paired.ok === true,
  )
  const bothIn = await all(
    `select * from public.relations_of('job', ${lit(String(paired.job))}::uuid)`,
  )
  check(
    'and BOTH assets are recorded as inputs to that job',
    bothIn
      .filter((e) => e.verb === 'input_to')
      .map((e) => String(e.other_title))
      .join(' + '),
    bothIn.filter((e) => e.verb === 'input_to').length === 2,
  )
  const ghost = await send('document', '00000000-0000-0000-0000-000000000000', 'review')
  check(
    'and an asset that does not exist is refused rather than filed about nothing',
    JSON.stringify(ghost),
    ghost.ok === false && String(ghost.error).includes('no such document'),
  )
  const wrongKind = await send('unicorn', docId, 'review')
  check(
    'and a kind the office does not have is refused',
    JSON.stringify(wrongKind),
    wrongKind.ok === false && String(wrongKind.error).includes('unicorn'),
  )
} finally {
  console.log('\nteardown')
  if (jobs.length > 0) {
    await db.execute(`
      update public.jobs
         set state = 'cancelled', finished_at = app.now_utc(), project_id = null
       where job_id = any(array[${jobs.map((j) => `${lit(j)}::uuid`).join(',')}])
         and state not in ('complete', 'cancelled', 'failed')
    `)
  }
  if (projectId !== '') {
    await db.execute(`delete from public.relations where project_id = ${lit(projectId)}::uuid`)
    await db.execute(`
      update public.documents set produced_by_job = null, mirrors_document_id = null
       where project_id = ${lit(projectId)}::uuid
    `)
    await db.execute(`delete from public.documents where project_id = ${lit(projectId)}::uuid`)
    await db.execute(`delete from public.inbound_commands where origin_ref like ${lit('asset:%')}
                       and context->>'project_id' = ${lit(projectId)}`)
    /*
      EVERY job on the fixture project, not only the ones this file recorded.

      The list above holds the jobs the suite enqueued itself. The office
      spawns CHILDREN — and one of them survived, so `project_delete` refused
      (ADR-0022: a job can never be deleted) and the suite left an ACTIVE
      fixture project in Grant's list while reporting a teardown failure that
      read like the delete being broken.

      A suite owns everything on its own fixture project, including the work
      the office decided to do about it.
    */
    await db.execute(`
      update public.jobs
         set state = case when state in ('complete', 'cancelled', 'failed') then state
                          else 'cancelled' end,
             finished_at = coalesce(finished_at, app.now_utc()),
             project_id = null
       where project_id = ${lit(projectId)}::uuid
    `)
    await db.execute(`select app.project_delete(${lit(SLUG)}, true)`)
    /*
      And archived if it still cannot go — 0509's sentence is the honest
      outcome for a project holding history, and the END STATE is what a
      teardown is for.
    */
    await db.execute(`
      update public.projects set status = 'archived'
       where slug = ${lit(SLUG)} and status <> 'archived'`)
  }
  const live =
    jobs.length === 0
      ? 0
      : Number(
          (
            await one(`
              select count(*)::int as n from public.jobs
               where job_id = any(array[${jobs.map((j) => `${lit(j)}::uuid`).join(',')}])
                 and state not in ('complete', 'cancelled', 'failed')
            `)
          ).n,
        )
  const project = Number(
    (
      await one(
        `select count(*)::int as n from public.projects
          where slug = ${lit(SLUG)} and status <> 'archived'`,
      )
    ).n,
  )
  check(
    'teardown — no live jobs and nothing of this run in the project list',
    `${String(live)} live job(s), ${String(project)} project(s)`,
    live === 0 && project === 0,
  )
}

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
