/**
 * The same thing said on four surfaces is the same thing.
 *
 *   npm run verify:equivalence
 *
 * Issue #201's first section, and §22 B's standing requirement: the
 * semantically equivalent instruction through any surface *"must use the same
 * canonical command layer, same project state, same orchestration, same tools,
 * same persistence and same quality controls."*
 *
 * §5 says the same thing from the other end — a channel adapter may only
 * TRANSLATE. An adapter that decides is a bug, and the way that bug shows up is
 * as divergence: the same sentence typed in Slack and typed in the studio
 * producing two different shapes downstream.
 *
 * ## What is asserted, and what deliberately is not
 *
 * The PROPERTY, never the wording. #186 rewrote one provenance line and turned
 * eight checks red, every one of them asserting the words rather than the
 * thing the words carried. So this asserts that four surfaces agree with each
 * other — not that they produce any particular text — which is a check that
 * survives every rewording and fails on every real divergence.
 *
 * `origin_channel` is expected to DIFFER, obviously, and so is the reference
 * the message came in on. Everything else must match: the project it landed
 * in, that it made exactly one command row and one job, that the job is
 * attributed the same way, and that the reader shows it as one conversation
 * with the surface recorded.
 *
 * ## Driven through HTTP as well as the RPC
 *
 * #201 is explicit: *"driven through the HTTP layer, not the RPC — a public
 * wrapper that does not exist is the defect this catches."* `verify:search`
 * is the standing example: the RPC worked perfectly, had no public wrapper,
 * and nothing with a browser could call it while the suite reported NOT
 * CHECKED. The token is in the vault; there is no skip path here.
 *
 * ## No new project, and the reason is #45
 *
 * The reader under test filters `jobs.is_fixture`, so the jobs here must be
 * REAL — a fixture job is invisible to `conversation_history`, and the suite
 * would then pass by finding perfect agreement about nothing on all four
 * surfaces.
 *
 * Real jobs make a project permanent. `job_state_transitions` is append-only,
 * so a job can never be deleted, so `app.project_delete` refuses for ever
 * afterwards. The first draft created a project per run and its teardown
 * failed with "has 4 job(s)" — which is exactly #45's pile of thirty archived
 * debris projects being rebuilt by a suite quoting #45.
 *
 * So this creates NO project. It uses the reserved Unnamed one (0334), which
 * exists permanently and is designed for precisely this — Grant: *"you can just
 * create an untitled or undefined project. Stuff that's not a specific
 * project."* Nothing is left to tear down but the messages and the jobs, and
 * both are dealt with: messages deleted, jobs cancelled.
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
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const run = Math.random().toString(36).slice(2, 10)
/*
  A per-run tag, used in the origin refs and the dedupe keys so teardown can
  find exactly this run's rows and nothing else. Not a project name: this suite
  creates no project.
*/
const TAG = `equivalence-${run}`

/*
  The four surfaces a conversation can arrive on. `origin_channel` is
  constrained to exactly these — 0313 tried a fifth word for the web dashboard
  and was refused, because ADR-0019 changed which files serve it and not what
  the channel is called.
*/
const SURFACES = ['teamhq', 'slack', 'telegram', 'voice'] as const

// The same sentence, four times. Identical on purpose: divergence in what is
// SAID would confound divergence in how it is HANDLED.
const SAID = `Summarise where the interview corpus stands ${run}`

interface Landed {
  surface: string
  commandId: string
  jobId: string
  projectId: string
  kind: string
  requestedBy: string
  isFixture: boolean
}

let projectId = ''
const landed: Landed[] = []
const jobIds: string[] = []

try {
  console.log('\none dashboard project, four surfaces, the same sentence')

  projectId = String((await one(`select app.unnamed_project()::text as v`)).v ?? '')
  check(
    'the reserved Unnamed project is where they land',
    projectId === '' ? 'MISSING' : projectId.slice(0, 8),
    projectId !== '',
  )
  if (projectId === '') throw new Error('no project')

  for (const surface of SURFACES) {
    /*
      `origin_ref` is shaped per surface in production — a Slack ref is
      `channel:ts`, a Telegram ref is a chat id. The reference differs and the
      MESSAGE does not, which is exactly the distinction being tested: what an
      adapter translates versus what it must leave alone.
    */
    const ref = `${TAG}-${surface}`
    const cmd = String(
      (
        await one(`
          insert into public.inbound_commands
            (origin_channel, origin_ref, actor, instruction, dedupe_key, project_id)
          values (${lit(surface)}, ${lit(ref)}, 'grant', ${lit(SAID)},
                  ${lit(`${surface}:equivalence:${ref}`)}, ${lit(projectId)}::uuid)
          returning command_id as v`)
      ).v ?? '',
    )

    /*
      Through `app.enqueue_inbound`, never a hand-built job. 0336 exists
      because that function resolves the job's project independently of the
      command's, and a raw INSERT would test a path nothing uses and miss the
      disagreement entirely — which is the whole class of defect this suite is
      looking for.
    */
    const enq = (await one(`select app.enqueue_inbound(${lit(cmd)}::uuid) as v`)).v as {
      job_id?: string
      error?: string
    }
    const jobId = String(enq?.job_id ?? '')
    if (jobId !== '') jobIds.push(jobId)

    const row = await one(`
      select j.kind, j.requested_by, j.is_fixture, j.project_id::text as project
        from public.jobs j where j.job_id = ${lit(jobId)}::uuid`)

    landed.push({
      surface,
      commandId: cmd,
      jobId,
      projectId: String(row.project ?? ''),
      kind: String(row.kind ?? ''),
      requestedBy: String(row.requested_by ?? ''),
      isFixture: row.is_fixture === true,
    })
    check(
      `${surface} — the message becomes real work`,
      jobId === ''
        ? `REFUSED — ${String(enq?.error)}`
        : `job ${jobId.slice(0, 8)}, kind ${String(row.kind)}`,
      jobId !== '',
    )
  }

  // --- the equivalence itself ----------------------------------------------
  console.log('\nand the four agree with each other')

  /*
    Asserted as AGREEMENT, not against an expected value. A constant here would
    be a wording lock in a different costume: the day the office renames a job
    kind, a check that expects 'note' goes red on a correct change, while a
    check that expects the four to match keeps working and still catches the
    day one surface starts producing something else.
  */
  const kinds = new Set(landed.map((l) => l.kind))
  check(
    'every surface produces the same kind of job',
    [...kinds].join(', ') || 'none',
    kinds.size === 1,
  )

  const projects = new Set(landed.map((l) => l.projectId))
  check(
    'and lands it in the same dashboard project',
    projects.size === 1
      ? `all in ${[...projects][0]?.slice(0, 8) ?? ''}`
      : `DIVERGED: ${[...projects].join(', ')}`,
    projects.size === 1 && [...projects][0] === projectId,
  )

  /*
    `requested_by` is composed as `<origin_channel>:<subject>`, so it is
    EXPECTED to differ by surface — and its subject half is not. That
    distinction was learned expensively: `verify:addressing`'s header claimed
    its jobs were fixtures because the DEDUPE KEY began `verify:`, while
    `requested_by` was `voice:grant`, and 43 real jobs ran.
  */
  const actors = new Set(landed.map((l) => l.requestedBy.split(':').slice(1).join(':')))
  check(
    'and attributes it to the same person, whatever the surface',
    landed.map((l) => l.requestedBy).join(' · '),
    actors.size === 1,
  )

  const surfaces = new Set(landed.map((l) => l.surface))
  check(
    'while the surfaces themselves stay distinct',
    [...surfaces].join(', '),
    surfaces.size === SURFACES.length,
  )

  // --- and the reader shows one conversation -------------------------------
  const readBack = (
    await one(`
    select app.conversation_history(${lit(projectId)}::uuid, 100) as v`)
  ).v as {
    kind?: string
    body?: string
    surface?: string
  }[]

  const said = readBack.filter((m) => m.kind === 'said' && String(m.body ?? '').includes(run))
  check(
    'the conversation holds all four, as one thread',
    `${String(said.length)} of ${String(SURFACES.length)}`,
    said.length === SURFACES.length,
  )
  check(
    'and each one remembers which surface it came in on',
    said
      .map((m) => String(m.surface))
      .sort()
      .join(', '),
    new Set(said.map((m) => m.surface)).size === SURFACES.length,
  )
  check(
    'and says the same words on every one of them',
    `${String(new Set(said.map((m) => m.body)).size)} distinct bodies`,
    new Set(said.map((m) => m.body)).size === 1,
  )

  // --- through HTTP, which is where the wrapper defect lives ---------------
  /*
    #201: driven through the HTTP layer, not the RPC. `verify:search` is the
    standing example of why — the RPC was perfect, the public wrapper did not
    exist, and nothing with a browser could call it while the suite reported
    NOT CHECKED. There is no skip path here: the token is in the vault and this
    suite reads it from there.
  */
  const apiToken = String(
    (
      await one(
        `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token' limit 1`,
      )
    ).v ?? '',
  )
  check(
    'the page token is readable from the vault',
    apiToken === '' ? 'MISSING — the HTTP leg cannot run' : 'found',
    apiToken !== '',
  )
  if (apiToken !== '') {
    const url = `https://${process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'}.supabase.co/functions/v1/hq-api?section=conversation&id=${encodeURIComponent(projectId)}`
    const r = await fetch(url, { headers: { Authorization: `Bearer ${apiToken}` } })
    const body = (await r.json()) as { data?: { kind?: string; body?: string; surface?: string }[] }
    const overHttp = (body.data ?? []).filter(
      (m) => m.kind === 'said' && String(m.body ?? '').includes(run),
    )
    check(
      'and a browser sees the same four',
      `http ${String(r.status)}, ${String(overHttp.length)} messages`,
      r.ok && overHttp.length === SURFACES.length,
    )
    check(
      'with the same surfaces the database reports',
      overHttp
        .map((m) => String(m.surface))
        .sort()
        .join(', '),
      overHttp
        .map((m) => String(m.surface))
        .sort()
        .join(',') ===
        said
          .map((m) => String(m.surface))
          .sort()
          .join(','),
    )
  }
} finally {
  // --- teardown, asserted ---------------------------------------------------
  console.log('\nteardown')
  /*
    Jobs are cancelled, not deleted: `job_state_transitions` is append-only, so
    a job can never be removed, and cancelling is the teardown for one left
    QUEUED. `verify:import` learned the other half — cancelling a COMPLETE job
    is refused by `enforce_job_transition`, and rightly.
  */
  for (const jobId of jobIds) {
    await db
      .execute(
        `update public.jobs set state = 'cancelled' where job_id = ${lit(jobId)}::uuid and state = 'queued'`,
      )
      .catch(() => undefined)
  }
  await db
    .execute(
      `delete from public.inbound_commands where dedupe_key like ${lit(`%equivalence:${TAG}%`)}`,
    )
    .catch(() => undefined)

  /*
    Nothing to remove: the Unnamed project is reserved and permanent, and
    `app.project_delete` refuses it by design (0334) — which is the point of
    using it. The only debris a run can leave is its messages and its jobs, and
    both are handled above.
  */
  const stray = await one(
    `select count(*) as n from public.inbound_commands where dedupe_key like ${lit(`%equivalence:${TAG}%`)}`,
  )
  check(
    'teardown — no message of this run is left behind',
    `${String(stray.n)} left`,
    Number(stray.n) === 0,
  )
}

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
if (passed !== checks.length) process.exitCode = 1
