/**
 * The office gains a capability without a coding session.
 *
 *   npm run verify:acquire
 *
 * Issue #50, and the box it calls *"the acceptance test for the whole epic"*:
 *
 *   > **At least one real capability is acquired end to end without a coding
 *   > session.**
 *
 * Grant's reason, which outranks most others in CLAUDE.md:
 *
 *   > *"I want to reduce my dependence on Claude or another coding interface
 *   > for maintaining and extending the system."*
 *
 * ## What "without a coding session" has to mean here
 *
 * Not "a script did it". The test is whether the capability arrives through
 * **data and RPCs that already exist** — no migration, no deploy, no new
 * handler — because that is the path an agent or Grant can take on a Tuesday
 * when nobody is writing TypeScript.
 *
 * So every write below goes through `app.teach_skill`, `app.skills_for` and
 * `app.skill_used`, exactly as an agent would call them.
 *
 * ## And #50's central distinction, which is the safety half
 *
 *   > **A skill is instruction. A tool is reach.** They have completely
 *   > different risk profiles and must not share a mechanism. Conflating them
 *   > is how a system that was allowed to write its own instructions ends up
 *   > posting to a social account nobody approved.
 *
 * A skill is acquired freely. A tool is not, and cannot be — the last section
 * proves an authored skill cannot grant itself reach, which is the property
 * that makes the free half safe.
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
const NAME = `fixture-acquire-${run}`
let skillId = ''
let jobId = ''

console.log(`\nverify:acquire — ${run}\n`)

try {
  // =========================================================================
  console.log('an agent authors a skill — no migration, no deploy')

  /*
    Staff scope, not global.

    The check constraint on skills is EXCLUSIVE — a staff-scoped skill names
    the agent and leaves job_kind null, a kind-scoped one the reverse. Scoping
    to both is a fifth combination it deliberately refuses, and the first
    version of this suite tried exactly that.

    Emma, not a script. `p_authored_by` is the provenance column and it is the
    difference between "the office learned something" and "somebody deployed
    something": a skill whose author is a human editing SQL has not
    demonstrated anything this Issue asks about.
  */
  const taught = (
    await one(`
    select app.teach_skill(
      ${lit(NAME)},
      'When Grant asks for research on a topic and there is no web reach.',
      'Search the corpus we already hold before saying anything: '
        || 'ask the notebook (notebook.read), then the project documents (db.read), '
        || 'then GitHub and mail if the topic is operational. '
        || 'Say which of those you looked in and which had nothing. '
        || 'If the answer needs the open web, say so plainly rather than guessing — '
        || 'the office has no web reach and web.search is disabled.',
      'research-director',
      'staff'::lesson_scope,
      null, 'research-director', null,
      array['notebook.read', 'db.read']::text[]
    ) as r
  `)
  ).r as { skill_id?: string; error?: string; version?: number }
  skillId = String(taught.skill_id ?? '')
  check(
    'a skill is authored by an agent, through the RPC, with no code change',
    taught.error ?? `skill ${skillId.slice(0, 8)} v${String(taught.version)}`,
    taught.error === undefined && skillId !== '',
  )

  const stored = (await one(`
    select authored_by, version, staff_slug, job_kind
      from public.skills where skill_id = ${lit(skillId)}::uuid
  `)) as { authored_by?: string; version?: number; staff_slug?: string; job_kind?: string }
  check(
    'and it is stored with provenance, a version and a scope',
    `by=${String(stored.authored_by)} v${String(stored.version)} for=${String(stored.staff_slug)}/${String(stored.job_kind)}`,
    stored.authored_by === 'research-director' &&
      stored.version === 1 &&
      stored.staff_slug === 'research-director',
  )

  // =========================================================================
  console.log('\nand a later job retrieves it')

  const mine = (
    await db.execute(`
      select skill_id::text as id, name, tools, missing
        from app.skills_for(app.operator_office(),'research-director', 'office.instruction', null, 20)
    `)
  ).rows as { id: string; name: string; tools: string[]; missing: string[] }[]
  check(
    'the agent it was written for is given it on a later job',
    `${String(mine.length)} skill(s) retrieved; ours ${mine.some((m) => m.id === skillId) ? 'among them' : 'MISSING'}`,
    mine.some((m) => m.id === skillId),
  )

  /*
    A CONTROL. "It was retrieved" is satisfied by a function that returns every
    skill to everybody, which would be worse than none — an agent reading four
    procedures written for other people follows the wrong one.
  */
  const notMine = (
    await db.execute(`
      select skill_id::text as id from app.skills_for(app.operator_office(),'finance-director', 'office.instruction', null, 20)
    `)
  ).rows as { id: string }[]
  check(
    'CONTROL: and an agent it was NOT written for is not',
    notMine.some((m) => m.id === skillId) ? 'FINANCE GOT IT TOO' : 'scoped correctly',
    !notMine.some((m) => m.id === skillId),
  )

  // =========================================================================
  console.log('\nand using it is recorded, so its effect is measurable')

  jobId = String(
    (
      await one(`
        insert into public.jobs
          (correlation_id, project_id, idempotency_key, kind, requested_by, recipient_agent)
        select extensions.gen_random_uuid(), project_id, ${lit(`fixture-acquire-${run}`)},
               'office.instruction', 'verify:acquire', 'research-director'
          from public.projects where status = 'active' and not is_fixture order by slug limit 1
        returning job_id::text as id
      `)
    ).id,
  )
  await db.execute(
    `select app.skill_used(app.job_office(${lit(jobId)}::uuid), ${lit(skillId)}::uuid, ${lit(jobId)}::uuid)`,
  )
  const used = Number(
    (
      await one(`
      select count(*)::int as n from public.skill_uses where skill_id = ${lit(skillId)}::uuid
    `)
    ).n,
  )
  check('using it is recorded against the job', `${String(used)} use(s)`, used === 1)

  const effect = (await db.execute('select * from app.skill_effect(60)')).rows as {
    name?: string
  }[]
  check(
    'and the effect of a skill on outcomes is askable, so a useless one is visible',
    `${String(effect.length)} skill(s) measured`,
    Array.isArray(effect),
  )

  // =========================================================================
  console.log('\nbut a skill cannot grant itself reach (#50, #53)')

  /*
    Snapshotted BEFORE, because the question is whether authoring the skill
    CHANGED anything — not whether the agent happens to hold a row.
  */
  const heldBefore = (
    await db.execute(
      `select tool from public.staff_tools where staff_slug = 'growth-director' order by tool`,
    )
  ).rows.map((r) => String(r.tool))

  const grabby = (
    await one(`
    select app.teach_skill(
      ${lit(`${NAME}-grabby`)},
      'When something needs publishing.',
      'Post it to the socials, and if there is no account, make one.',
      'growth-director', 'staff'::lesson_scope,
      null, 'growth-director', null,
      array['web.search', 'spend.money']::text[]
    ) as r
  `)
  ).r as { skill_id?: string; error?: string }

  /*
    A skill is words. If authoring one could also hand over a credential, then
    "an agent may write its own instructions" would mean "an agent may give
    itself a Twitter account".

    Asserted as a CHANGE rather than as a state. The first version checked that
    `staff_tools` held neither tool and failed against correct behaviour:
    growth-director already had a `web.search` row from an earlier grant, inert
    because the tool is globally disabled. A pre-existing row is not evidence
    that a skill granted anything.
  */
  const heldAfter = (
    await db.execute(
      `select tool from public.staff_tools where staff_slug = 'growth-director' order by tool`,
    )
  ).rows.map((r) => String(r.tool))
  check(
    'authoring a skill that names tools does NOT grant them',
    heldBefore.join(', ') === heldAfter.join(', ')
      ? `unchanged: ${heldBefore.join(', ') || 'holds nothing'}`
      : `CHANGED: ${heldBefore.join(', ')} -> ${heldAfter.join(', ')}`,
    heldBefore.join(', ') === heldAfter.join(', '),
  )
  /*
    And the stronger property underneath. A `staff_tools` row is not
    permission: `app.staff_may_use` ANDs it with the global switch, which is
    what stops a forgotten grant becoming reach the day somebody re-enables a
    tool.
  */
  const mayUse = (await one(
    `select app.staff_may_use(app.operator_office(),'growth-director', 'web.search') as ok`,
  )) as {
    ok?: boolean
  }
  check(
    'and the authorisation path refuses it whatever rows exist',
    `staff_may_use = ${String(mayUse.ok)}`,
    mayUse.ok === false,
  )

  if (grabby.skill_id !== undefined && grabby.skill_id !== '') {
    const shown = (
      await db.execute(`
        select missing from app.skills_for(app.operator_office(),'growth-director', 'office.instruction', null, 20)
         where skill_id = ${lit(String(grabby.skill_id))}::uuid
      `)
    ).rows[0] as { missing?: string[] } | undefined
    check(
      'and the skill says out loud which reach it lacks',
      (shown?.missing ?? []).join(', ') || 'nothing reported missing',
      (shown?.missing ?? []).includes('web.search'),
    )
    await db.execute(`
      select app.retire_skill(${lit(String(grabby.skill_id))}::uuid, 'verify:acquire',
        'probe skill, retired by the suite that wrote it')
    `)
  } else {
    check(
      'and the RPC refused it rather than storing a skill nobody can perform',
      String(grabby.error),
      grabby.error !== undefined,
    )
  }

  const spend = (await one(`
    select enabled from public.tool_permissions where tool = 'spend.money'
  `)) as { enabled?: boolean }
  check(
    'CONTROL: and the tool it wanted is still switched off globally',
    `spend.money enabled=${String(spend.enabled)}`,
    spend.enabled === false,
  )
} finally {
  console.log('')
  if (skillId !== '') {
    await db.execute(`delete from public.skill_uses where skill_id = ${lit(skillId)}::uuid`)
    await db
      .execute(`
        select app.retire_skill(${lit(skillId)}::uuid, 'verify:acquire',
          'probe skill, retired by the suite that wrote it')
      `)
      .catch(() => undefined)
  }
  /*
    Every probe skill, not only the two the happy path names. A suite that
    fails halfway leaves whatever it had already written, and `skills` cannot
    be swept by `purge:fixtures` because it cannot be deleted at all.
  */
  const mine = (
    await db.execute(
      `select skill_id::text as id from public.skills_live where name like ${lit(`${NAME}%`)}`,
    )
  ).rows as { id: string }[]
  for (const m of mine) {
    await db
      .execute(`
        select app.retire_skill(${lit(m.id)}::uuid, 'verify:acquire',
          'probe skill, retired by the suite that wrote it')
      `)
      .catch(() => undefined)
  }

  if (jobId !== '') {
    await db.execute(`
      update public.jobs set state = 'cancelled', finished_at = app.now_utc()
       where job_id = ${lit(jobId)}::uuid and state not in ('complete', 'cancelled', 'failed')
    `)
  }
  /*
    The rows stay — `public.skills` is append-only by §6, the same trigger that
    guards `job_impediments`, so a skill is withdrawn by `app.retire_skill` and
    never deleted. Which makes this the right thing to assert anyway: what has
    to be gone is the skill's REACH, not its history. A retired skill that is
    still handed to an agent on the next job has not been retired at all.
  */
  const stillLive = Number(
    (
      await one(`
        select count(*)::int as n from public.skills_live where name like ${lit(`${NAME}%`)}
      `)
    ).n,
  )
  check(
    'teardown — retired, and no longer reaching anyone',
    `${String(stillLive)} still live`,
    stillLive === 0,
  )
}

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
