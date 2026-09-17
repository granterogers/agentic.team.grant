/**
 * Delegation that leaves a trace.
 *
 *   npm run verify:handoff
 *
 * Issue #65. Grant: *"If it's truly being delegated, if it's just one bot now
 * doing all the work, it's not really what we want, is it?"*
 *
 * ## Why this is measured and not described
 *
 * #65 is the only Issue in the cluster written entirely in numbers — 0 of 499
 * jobs addressed, 0 consultations ever, 140 outputs with no author — because
 * the question *"is it actually delegating"* cannot be answered by reading the
 * code. It was answered by counting, and it has to stay answered that way.
 *
 * So the last section asks `app.delegation_health` for the same numbers and
 * prints them. It does not assert a threshold: a suite that failed when the
 * office happened to do three Claire-shaped jobs in a row would be a suite
 * somebody switches off. The mechanism is asserted; the rate is reported.
 *
 * ## The bug this is written against
 *
 * `consultations` had never held a row, and not because nothing was delegated:
 * three real jobs went to specialists. The INSERT was hand-written with a
 * `text[]` and a slug where two UUIDs belong, so it raised on every hand-off —
 * and the call site ended `.catch(() => undefined)`.
 *
 * **A swallowed error on a write nobody reads back is indistinguishable from a
 * feature that was never built.** Every check below that touches the
 * consultation path exists because of that, and the refusal cases are asserted
 * as hard as the success case.
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
let jobId = ''
let plainJob = ''

/*
  Fixture jobs: `jobs.is_fixture` is GENERATED from `requested_by`, and
  `verify:%` is one of the prefixes it matches. So these are collected by
  `purge:fixtures` and excluded from every health count, which is what makes it
  safe to create them against a real project.
*/
async function setUp(): Promise<void> {
  const project = String(
    (
      await one(`
        select project_id::text as id from public.projects
         where status = 'active' and not is_fixture order by slug limit 1
      `)
    ).id,
  )
  jobId = String(
    (
      await one(`
        insert into public.jobs
          (correlation_id, project_id, idempotency_key, kind, requested_by, recipient_agent)
        values (extensions.gen_random_uuid(), ${lit(project)}::uuid,
                ${lit(`verify-handoff-${run}`)}, 'research', 'verify:handoff', 'research-director')
        returning job_id::text as id
      `)
    ).id,
  )
  plainJob = String(
    (
      await one(`
        insert into public.jobs
          (correlation_id, project_id, idempotency_key, kind, requested_by)
        values (extensions.gen_random_uuid(), ${lit(project)}::uuid,
                ${lit(`verify-handoff-plain-${run}`)}, 'research', 'verify:handoff')
        returning job_id::text as id
      `)
    ).id,
  )
}

console.log(`\nverify:handoff — ${run}\n`)
await setUp()

try {
  // =========================================================================
  console.log('a hand-off is recorded, in the vocabulary the caller has')

  const made = (
    await one(`
    select public.record_consultation(${lit(jobId)}::uuid, 'research-director',
      'chief-of-staff', 'it is a research question') as r
  `)
  ).r as { ok?: boolean; error?: string; consulted?: string }
  check(
    'recording a hand-off works, given slugs',
    made.error ?? `consulted ${String(made.consulted)}`,
    made.ok === true,
  )

  /*
    The exact call the old code made. It raised on every hand-off and the
    failure was swallowed; asserting it still raises is what stops somebody
    "simplifying" the RPC back into a hand-written insert.
  */
  let raw = '(accepted)'
  try {
    await db.execute(`
      insert into public.consultations
        (job_id, consulted_staff, requested_by, reason, provider_requests)
      values (${lit(jobId)}::uuid, array['research-director']::text[], 'chief-of-staff', 'x', 0)
    `)
  } catch (error) {
    raw = (error as Error).message.includes('uuid') ? 'refused: uuid vs text[]' : 'refused'
  }
  check(
    'CONTROL: the hand-written insert the old code used still cannot work',
    raw,
    raw !== '(accepted)',
  )

  const self = (
    await one(`
    select public.record_consultation(${lit(jobId)}::uuid, 'chief-of-staff',
      'chief-of-staff', 'talking to myself') as r
  `)
  ).r as { error?: string }
  check(
    'consulting yourself is refused — it would make the rate look healthy',
    self.error ?? '(accepted)',
    String(self.error ?? '').includes('same person'),
  )

  const nobody = (
    await one(`
    select public.record_consultation(${lit(jobId)}::uuid, 'nobody-here') as r
  `)
  ).r as { error?: string }
  check(
    'and a name nobody answers to is refused rather than written as null',
    nobody.error ?? '(accepted)',
    String(nobody.error ?? '').includes('nobody here'),
  )

  // =========================================================================
  console.log('\nan output takes its author from the job it belonged to')

  const authored = (
    await one(`
    with made as (
      insert into public.outputs (job_id, body, confidence, evidence)
      values (${lit(jobId)}::uuid, 'A research finding.', 'high', 'verified')
      returning staff_id
    )
    select coalesce((select s.slug from public.staff s
                      where s.staff_id = (select staff_id from made)), 'nobody') as who
  `)
  ).who as string
  check(
    'an output written with no author takes the one the job was addressed to',
    String(authored),
    authored === 'research-director',
  )

  /*
    And the honest limit of it: a job nobody was addressed to still produces an
    output with no author. Asserted rather than hidden, because the alternative
    — inventing a name — is what makes 1,060 historic rows unfixable.
  */
  const orphan = (
    await one(`
    with made as (
      insert into public.outputs (job_id, body, confidence, evidence)
      values (${lit(plainJob)}::uuid, 'Nobody was asked for this.', 'high', 'verified')
      returning staff_id
    )
    select (select staff_id from made) is null as none
  `)
  ).none as boolean
  check(
    'and a job addressed to nobody still says nobody, rather than guessing',
    orphan ? 'staff_id is null' : 'a name was invented',
    orphan === true,
  )

  // =========================================================================
  console.log('\nwhether it was worth it, from evidence')

  const before = Number(
    (
      await one(`select count(*)::int as n from public.consultations
                 where job_id = ${lit(jobId)}::uuid and changed_outcome is not null`)
    ).n,
  )
  check(
    'CONTROL: a consultation starts unjudged — recording one is not claiming it helped',
    `${String(before)} judged`,
    before === 0,
  )

  await db.execute(`
    update public.outputs
       set reviewer_status = 'approved', reviewed_at = app.now_utc()
     where job_id = ${lit(jobId)}::uuid
  `)
  const judged = (await one(`
    select changed_outcome, outcome_note from public.consultations
     where job_id = ${lit(jobId)}::uuid limit 1
  `)) as { changed_outcome?: boolean; outcome_note?: string }
  check(
    'approving the output judges the consultation, and says what from',
    `${String(judged.changed_outcome)} — ${String(judged.outcome_note)}`,
    judged.changed_outcome === true && String(judged.outcome_note).includes('approved'),
  )

  // =========================================================================
  console.log('\nand the right person is chosen, from something Grant can edit')

  /*
    #65's last box: *"a verify suite drives a research request and asserts
    Emma, not Claire, produced the output."*

    Asked of `app.who_knows_about`, which is where the decision is actually
    made, and which reads `staff.expertise` — the column Grant edits in the
    dashboard. The five regexes in `router.ts` remain only as the fallback for
    an unreachable database, so testing THOSE would test the thing he cannot
    change.
  */
  const research = (
    await db.execute(`
    select slug, score from app.who_knows_about(
      'do some research on how coaching programmes are structured', 3)
     order by score desc
  `)
  ).rows as { slug: string; score: number }[]
  check(
    'a research request finds Emma, not Claire',
    research.map((r) => `${r.slug}=${String(r.score)}`).join(', ') || 'nobody',
    research.some((r) => r.slug === 'research-director') &&
      !research.some((r) => r.slug === 'chief-of-staff'),
  )

  /*
    And a CONTROL, because "it named a specialist" is satisfied by a router
    that names the same specialist for everything. A different subject has to
    reach a different person or the first check proves nothing.
  */
  const money = (
    await db.execute(`
    select slug, score from app.who_knows_about(
      'what did we spend on subscriptions last quarter', 3) order by score desc
  `)
  ).rows as { slug: string }[]
  check(
    'CONTROL: a different subject reaches a different person',
    money.map((r) => r.slug).join(', ') || 'nobody',
    money.length > 0 && money[0]?.slug !== research[0]?.slug,
  )

  /*
    And that it is driven by data rather than by code, which is the half that
    makes it Grant's. `staff.expertise` is a column he edits; if routing were
    the regexes in `router.ts` he could not change who does what without a
    coding session — the thing he said outranks most others.
  */
  const fromData = Number(
    (
      await one(`
      select count(*)::int as n from public.staff
       where active and coalesce(array_length(expertise, 1), 0) > 0
    `)
    ).n,
  )
  check(
    'and the routing reads expertise Grant can edit, not a regex in a file',
    `${String(fromData)} active staff with expertise recorded`,
    fromData >= 4,
  )

  // =========================================================================
  console.log('\nand the question can be asked')

  const health = (await one('select app.delegation_health(30) as h')).h as Record<string, unknown>
  check(
    'delegation_health answers #65 in the numbers it was filed with',
    JSON.stringify(health),
    typeof health.jobs === 'number' &&
      typeof health.delegated === 'number' &&
      typeof health.consultations === 'number' &&
      typeof health.outputs_without_author === 'number',
  )
  /*
    Reported, not asserted against a threshold. A suite that went red because
    the office happened to do three Claire-shaped jobs in a row is a suite
    somebody switches off — and the point of #65 is that the number is VISIBLE,
    not that it is high today.
  */
  console.log(
    `\n  delegation over 30 days: ${String(health.delegated)} of ${String(health.addressed)} addressed ` +
      `job(s) went to a specialist; ${String(health.consultations)} consultation(s), ` +
      `${String(health.judged)} judged, ${String(health.helped)} helped; ` +
      `${String(health.outputs_without_author)} output(s) still with no author.`,
  )
  console.log(`  to whom: ${JSON.stringify(health.to_whom)}`)
} finally {
  console.log('')
  await db.execute(`delete from public.consultations where job_id in (
    ${lit(jobId)}::uuid, ${lit(plainJob)}::uuid)`)
  await db.execute(`delete from public.outputs where job_id in (
    ${lit(jobId)}::uuid, ${lit(plainJob)}::uuid)`)
  /*
    The jobs stay. `job_state_transitions` is append-only by §6 and has a
    foreign key to `jobs` (ADR-0022), so a job can only ever be cancelled —
    and `is_fixture` is GENERATED from `requested_by`, so `verify:handoff`
    keeps them out of every health count and `purge:fixtures` can retire them.
  */
  await db.execute(`
    update public.jobs set state = 'cancelled', finished_at = app.now_utc()
     where job_id in (${lit(jobId)}::uuid, ${lit(plainJob)}::uuid)
       and state not in ('complete', 'cancelled', 'failed')
  `)
  const left = Number(
    (
      await one(`select count(*)::int as n from public.outputs
                 where job_id in (${lit(jobId)}::uuid, ${lit(plainJob)}::uuid)`)
    ).n,
  )
  check('teardown', `${String(left)} output(s) left, jobs cancelled as fixtures`, left === 0)
}

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
