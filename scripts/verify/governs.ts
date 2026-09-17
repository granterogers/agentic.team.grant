/**
 * Grant can see what the office learned, and change it.
 *
 *   npm run verify:governs
 *
 * Issue #54, migration 0302. The last child of #46, and the one that makes the
 * rest of that epic safe rather than unnerving: #48 lets behaviour change for
 * reasons that live in a table, and a table nobody surfaced removes his
 * ability to tell a system that is getting better from one that is drifting.
 *
 * ## The four things this asserts, which are #54's four boxes
 *
 *   1. a lesson is visible, scoped, placed, traceable to a job — and retractable
 *   2. a proposal can be approved or declined in place, and a DECLINE STICKS
 *   3. a suggestion and its outcome are visible, dismissals included
 *   4. every agent's remit, tool count and failed attempts are on one page
 *
 * ## Retraction is the teardown, and that is the point
 *
 * `lessons` is append-only (§6). A suite that writes one cannot delete it, so
 * the obvious trap is to write fixtures — but `lessons` has no `is_fixture`
 * column and `lessons_live` filters on supersession, not on origin. So this
 * suite writes a REAL lesson and retracts it, which is the feature under test
 * doing its own cleanup: the row survives, the reader stops returning it, and
 * the check that the payload no longer carries it is the same check that
 * proves the teardown worked.
 *
 * The opposite of `verify:proposes`, which had to use fixtures for exactly the
 * reason this one must not — the deciding question, as CLAUDE.md puts it, is
 * which one the thing under test filters.
 *
 * ## A refusal for the right reason
 *
 * Two checks here assert on the MESSAGE, not merely that something was refused.
 * A raw insert that throws because a column is spelled differently looks
 * exactly like a rule working, and `verify:identity` reported a PASS twice on
 * that shape.
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
const refusal = async (sql: string): Promise<string> => {
  try {
    await db.execute(sql)
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

const run = Math.random().toString(36).slice(2, 10)
const BODY = `Governance probe ${run} — this sentence exists only to be retracted.`
const NEED = `probe-governs-${run}`
const WHO = 'growth-director'

type Payload = {
  at?: string
  lessons?: {
    id?: string
    body?: string
    scope?: string
    where?: string
    who?: string
    job?: string
  }[]
  proposals?: { id?: string; state?: string; note?: string; title?: string }[]
  noticed?: { id?: string; state?: string; dismissed?: number; because?: unknown }[]
  agents?: {
    slug?: string
    name?: string
    remit?: string
    tools?: number
    tried_and_could_not?: unknown[]
  }[]
}
const governance = async (): Promise<Payload> =>
  ((await one('select public.hq_governance(200) as g')).g ?? {}) as Payload

console.log(`\nverify:governs — ${run}\n`)

let lessonId = ''
let proposalId = ''
let suggestionId = ''
let projectId = ''
let jobId = ''

try {
  projectId = String(
    (
      await one(`
        select project_id::text as id from public.projects
         where status = 'active' and not is_fixture order by slug limit 1
      `)
    ).id,
  )
  /*
    A fixture job to hang the lesson on. `from_job` is what makes a lesson
    traceable — #54 asks for it by name — and a lesson pointing at a real job
    would attribute a probe to work Grant actually asked for.
  */
  jobId = String(
    (
      await one(`
        insert into public.jobs
          (correlation_id, project_id, idempotency_key, kind, requested_by, recipient_agent)
        values (extensions.gen_random_uuid(), ${lit(projectId)}::uuid,
                ${lit(`fixture-governs-${run}`)}, 'research', 'verify:governs', ${lit(WHO)})
        returning job_id::text as id
      `)
    ).id,
  )

  // =========================================================================
  console.log('the page exists, and answers four questions in one call')

  const shape = await governance()
  check(
    'hq_governance returns all four lists and a clock',
    Object.keys(shape).sort().join(', '),
    typeof shape.at === 'string' &&
      Array.isArray(shape.lessons) &&
      Array.isArray(shape.proposals) &&
      Array.isArray(shape.noticed) &&
      Array.isArray(shape.agents),
  )

  /*
    Through the PUBLIC wrapper, because that is the half the page reaches:
    PostgREST exposes only `public`, and an `app.` function without one is a
    function the studio cannot call. A suite that tests the inner half only
    passes for the wrong reason.
  */
  const exposed = await one(`
    select count(*)::int as n from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('hq_governance', 'retract_lesson', 'decide_proposal')
  `)
  check(
    'all three are exposed on public, where PostgREST can see them',
    `${String(exposed.n)} of 3`,
    Number(exposed.n) === 3,
  )

  // =========================================================================
  console.log('\n1. a lesson is visible, scoped, placed and traceable (#54 box 1)')

  lessonId = String(
    (
      await one(`
        insert into public.lessons (scope, project_id, body, learned_by, from_job, observations)
        values ('project', ${lit(projectId)}::uuid, ${lit(BODY)}, 'quality-director',
                ${lit(jobId)}::uuid, 3)
        returning lesson_id::text as id
      `)
    ).id,
  )

  const withLesson = await governance()
  const mine = (withLesson.lessons ?? []).find((l) => l.id === lessonId)
  check(
    'it reaches the page',
    mine === undefined ? 'not found' : String(mine.body),
    mine !== undefined,
  )
  check(
    'scoped, placed, attributed and traceable to its job',
    mine === undefined
      ? '—'
      : `${String(mine.scope)} · ${String(mine.where)} · ${String(mine.who)} · job ${String(mine.job ?? 'none').slice(0, 8)}`,
    mine?.scope === 'project' &&
      typeof mine.where === 'string' &&
      mine.where !== '' &&
      mine.where !== 'everywhere' &&
      mine.who === 'quality-director' &&
      mine.job === jobId,
  )

  /*
    And the other half, which is #181 (migrations 0388, 0389).

    The lesson above is attributed to an AGENT rather than to `verify:governs`,
    because the Governance page now filters harness traffic and a suite
    asserting its own fixture reaches that page would be asserting the defect.
    155 of 195 rows in `public.lessons` were written by verification suites, on
    the ledger Grant reads to find out what the office learned.

    So the suite writes one of each and checks both directions. A filter proved
    only by the thing it lets through is a filter that could be letting
    everything through.
  */
  const harnessLesson = String(
    (
      await one(`
        insert into public.lessons (scope, project_id, body, learned_by, from_job, observations)
        values ('project', ${lit(projectId)}::uuid, ${lit(`${BODY} (harness)`)}, 'verify:governs',
                ${lit(jobId)}::uuid, 1)
        returning lesson_id::text as id
      `)
    ).id,
  )
  const afterHarness = await governance()
  check(
    'and a lesson a verification suite wrote does NOT reach it',
    (afterHarness.lessons ?? []).some((l) => l.id === harnessLesson)
      ? 'THE HARNESS LESSON IS ON THE PAGE'
      : 'filtered, while the real one above is still there',
    !(afterHarness.lessons ?? []).some((l) => l.id === harnessLesson) &&
      (afterHarness.lessons ?? []).some((l) => l.id === lessonId),
  )

  // =========================================================================
  console.log('\n   and it can be retracted, without anything being deleted')

  const before = Number((await one('select count(*)::int as n from public.lessons')).n)
  const gone = (
    await one(`
      select public.retract_lesson(${lit(lessonId)}::uuid,
        'Written by a verification run.', 'verify:governs') as r
    `)
  ).r as { ok?: boolean; retraction?: string }
  check('retract_lesson answers ok', JSON.stringify(gone), gone.ok === true)

  const after = Number((await one('select count(*)::int as n from public.lessons')).n)
  check(
    'the ledger GREW — a retraction is a row, not a delete (§6)',
    `${String(before)} → ${String(after)}`,
    after === before + 1,
  )

  const trace = await one(`
    select row_kind::text as kind, body, learned_by
      from public.lessons where supersedes = ${lit(lessonId)}::uuid
  `)
  check(
    'the retraction says why, and who',
    `${String(trace.kind)} · ${String(trace.learned_by)} · ${String(trace.body ?? '').slice(0, 40)}`,
    trace.kind === 'retraction' &&
      trace.learned_by === 'verify:governs' &&
      String(trace.body ?? '').includes('verification run'),
  )

  const withoutLesson = await governance()
  check(
    'and the page stops showing it',
    `${String((withoutLesson.lessons ?? []).length)} lesson(s), mine absent: ${String(!(withoutLesson.lessons ?? []).some((l) => l.id === lessonId))}`,
    !(withoutLesson.lessons ?? []).some((l) => l.id === lessonId),
  )

  /*
    CONTROL. Every check above would also pass if `hq_governance` returned an
    empty list for any reason at all — a bad join, a wrong limit, a permission
    error swallowed upstream. So: something else is still there.
  */
  check(
    'CONTROL — other lessons are unaffected',
    `${String((withoutLesson.lessons ?? []).length)} still live`,
    (withoutLesson.lessons ?? []).length > 0,
  )

  // =========================================================================
  console.log('\n   retracting twice, and retracting a retraction')

  const twice = (
    await one(`select public.retract_lesson(${lit(lessonId)}::uuid, null, 'verify:governs') as r`)
  ).r as { ok?: boolean; already?: boolean }
  const stillOne = Number(
    (
      await one(`
        select count(*)::int as n from public.lessons where supersedes = ${lit(lessonId)}::uuid
      `)
    ).n,
  )
  check(
    'a second retraction is a no-op, not a second row',
    `${JSON.stringify(twice)} · ${String(stillOne)} retraction(s)`,
    twice.already === true && stillOne === 1,
  )

  const retractionId = String(
    (
      await one(`
        select lesson_id::text as id from public.lessons where supersedes = ${lit(lessonId)}::uuid
      `)
    ).id,
  )
  const nested = (
    await one(
      `select public.retract_lesson(${lit(retractionId)}::uuid, null, 'verify:governs') as r`,
    )
  ).r as { ok?: boolean; error?: string }
  /*
    On the MESSAGE, not merely on "something was refused".

    A raw call that throws because a column is spelled differently looks
    exactly like a rule working; `verify:identity` reported a PASS twice on
    that shape. So the sentence has to name what it refused.
  */
  check(
    'retracting a retraction is refused, and says what it refused',
    JSON.stringify(nested),
    nested.ok !== true && String(nested.error ?? '').includes('retraction, not a lesson'),
  )

  // =========================================================================
  console.log('\n2. a proposal is decided in place, and a decline sticks (#54 box 2)')

  proposalId = String(
    (
      await one(`
        insert into public.proposals
          (staff_slug, kind, needed, title, remedy, argument, cost_note, times_seen)
        values (${lit(WHO)}, 'missing_tool', ${lit(NEED)},
                ${lit(`Probe capability ${run}`)}, ${lit(NEED)},
                'Raised by a verification run, and decided by one.', 'Free', 4)
        returning proposal_id::text as id
      `)
    ).id,
  )

  const open = (await governance()).proposals?.find((p) => p.id === proposalId)
  check('an open proposal reaches the page', String(open?.state), open?.state === 'open')

  const declined = (
    await one(`
      select public.decide_proposal(${lit(proposalId)}::uuid, 'declined',
        'Not this time — a probe.', 'verify:governs') as r
    `)
  ).r as { ok?: boolean; was?: string; now?: string }
  check(
    'it can be declined in place',
    JSON.stringify(declined),
    declined.ok === true && declined.was === 'open' && declined.now === 'declined',
  )

  const settled = (await governance()).proposals?.find((p) => p.id === proposalId)
  check(
    'the decline STAYS ON THE PAGE, with the note',
    `${String(settled?.state)} · ${String(settled?.note)}`,
    settled?.state === 'declined' && String(settled.note ?? '').includes('a probe'),
  )

  /*
    The durable half, and #49's own last box. A decline that the office can
    talk itself out of is a decline that arrives again on Thursday — so the
    same need must not be raisable while the row stands. `proposals_one_per_
    need` is the mechanism; the PROPERTY is what is asserted, because a
    correct refactor that replaced the index with a trigger should not fail
    here (that mistake cost `verify:identity` a false red).
  */
  const again = await refusal(`
    insert into public.proposals (staff_slug, kind, needed, title, remedy, argument)
    values (${lit(WHO)}, 'missing_tool', ${lit(NEED)}, 'Asking again', ${lit(NEED)}, 'Nagging.')
  `)
  check(
    'the same need cannot be raised again while the decline stands',
    again === '' ? 'IT WAS RAISED AGAIN' : (again.split('\n')[0] ?? again).slice(0, 90),
    again !== '' && /duplicate key|unique|proposals_one_per_need|already/i.test(again),
  )

  const reopened = (
    await one(`
      select public.decide_proposal(${lit(proposalId)}::uuid, 'open', null, 'verify:governs') as r
    `)
  ).r as { ok?: boolean; now?: string }
  check(
    'and a person — never the office — can reopen it',
    JSON.stringify(reopened),
    reopened.ok === true && reopened.now === 'open',
  )

  // =========================================================================
  console.log('\n3. a suggestion and its outcome are visible (#54 box 3)')

  suggestionId = String(
    (
      await one(`
        insert into public.suggestions
          (project_id, kind, subject_ref, body, because, weight, state, dismissals)
        values (${lit(projectId)}::uuid, 'attach', ${lit(NEED)},
                ${lit(`Probe suggestion ${run}`)},
                '{"documents": 11, "notebooks": 0}'::jsonb, 60, 'open', 4)
        returning suggestion_id::text as id
      `)
    ).id,
  )

  const seen = (await governance()).noticed?.find((s) => s.id === suggestionId)
  check(
    'it reaches the page with its state and its dismissals',
    seen === undefined
      ? 'not found'
      : `${String(seen.state)} · dismissed ${String(seen.dismissed)}×`,
    seen?.state === 'open' && seen.dismissed === 4,
  )
  /*
    `because` is JSONB — the numbers the noticing pass counted, not a sentence.
    Asserted here because the first draft of the studio rendered it with an
    escaper and produced the words "object Object" on Grant's governance page.
  */
  check(
    'and its evidence arrives as counted facts, not as prose',
    JSON.stringify(seen?.because),
    typeof seen?.because === 'object' &&
      seen.because !== null &&
      (seen.because as Record<string, unknown>).documents === 11,
  )

  // =========================================================================
  console.log('\n4. every agent, with what it could not do (#54 box 4)')

  const agents = (await governance()).agents ?? []
  check(
    'the whole active roster is here, chief of staff first',
    `${String(agents.length)} agents, first is ${String(agents[0]?.name)}`,
    agents.length >= 8 && agents[0]?.slug === 'chief-of-staff',
  )
  check(
    'each carries a remit and a tool count',
    agents
      .slice(0, 3)
      .map((a) => `${String(a.name)} (${String(a.tools)})`)
      .join(', '),
    agents.every(
      (a) => typeof a.remit === 'string' && a.remit !== '' && typeof a.tools === 'number',
    ),
  )
  check(
    'and the list of walls it has hit — the most useful thing on the page',
    `${String(agents.filter((a) => (a.tried_and_could_not ?? []).length > 0).length)} of ${String(agents.length)} have hit one`,
    agents.every((a) => Array.isArray(a.tried_and_could_not)),
  )

  /*
    And not one of them is a probe.

    This is the check that was missing when #54 shipped. Ruby's card read
    "probe-need-j4je9xrc — the office has no such tool — 8x" on the live page
    for an hour: five rows of `verify:proposes` debris presented as things a
    member of staff had genuinely been stopped by. Everything above passed
    while it did, because everything above asked whether the list was an array.

    Asserted on the SHAPE OF THE NAME rather than on a count, because a count
    is a moving target — the office should hit real walls, and a check that
    says "zero walls" would fail the day #49 starts working properly.
  */
  const debris = agents.flatMap((a) =>
    ((a.tried_and_could_not as { needed?: string }[] | undefined) ?? [])
      .map((w) => String(w.needed ?? ''))
      .filter((n) => /^(?:probe|fixture|verify)[-:]/i.test(n)),
  )
  check(
    'and not one of those walls is harness debris',
    debris.length === 0 ? 'none' : `ON THE PAGE: ${debris.slice(0, 4).join(', ')}`,
    debris.length === 0,
  )

  /*
    The rule underneath it, asserted directly (0303-0304).

    Two witnesses to whether a row is harness traffic: the job's `is_fixture`,
    which is GENERATED and always current, and the ledger's copy, frozen at
    insert by §6 and correctable never. Each may only EXCLUDE. 0303 used
    `coalesce` — job first, ledger as fallback — and two rows whose ledger copy
    said fixture and whose job said real came back onto the page it was written
    to clear.

    So: every row the real tally returns must be denied by BOTH.
  */
  /*
    Asked as "is any tally row backed ONLY by harness traffic", not as "does any
    fixture row share its text".

    The first form counted 21 and reported a leak that is not there. The tally
    groups by (kind, needed, staff_slug) and that triple is not unique in
    `job_impediments` — a real impediment and a fixture one can say the same
    sentence, which is exactly what happens when a suite reproduces a real
    failure on purpose. Joining back on the triple fans a single real tally row
    out across every row that matches it, fixtures included, and then counts the
    fixtures.

    Three tally rows, and every one of them has a genuinely real impediment
    behind it. The property that actually matters — a row Grant is shown was put
    there by the office and not by a suite — is what this asks now.
  */
  const witnesses = await one(`
    select count(*)::int as n
      from app.impediments_tally(3650, 1, false) t
     where not exists (
       select 1 from public.job_impediments i
         left join public.jobs j on j.job_id = i.job_id
        where i.kind = t.kind and i.needed = t.needed and i.staff_slug = t.staff_slug
          and not i.is_fixture and not coalesce(j.is_fixture, false))
  `)
  check(
    'a row either witness calls a fixture never reaches the real tally',
    `${String(witnesses.n)} row(s) got through`,
    Number(witnesses.n) === 0,
  )
} finally {
  // =======================================================================
  console.log('\nteardown')

  if (suggestionId !== '') {
    await db.execute(
      `delete from public.suggestions where suggestion_id = ${lit(suggestionId)}::uuid`,
    )
  }
  if (proposalId !== '') {
    await db.execute(`delete from public.proposals where proposal_id = ${lit(proposalId)}::uuid`)
  }
  /*
    Cancelled, so it does not sit in the queue.

    It cannot be DELETED — `job_state_transitions` is append-only by §6 and
    holds a foreign key to it (ADR-0022) — but a terminal state is always
    reachable, and leaving it queued is not free: `verify:slack` and
    `verify:worker` both refuse to run while the queue holds anything, because
    dequeue is global and would hand them a job they have no handler for. Two
    suites were blocked by twelve of these before anyone noticed, which is why
    `purge:fixtures` now sweeps them too.
  */
  if (jobId !== '') {
    await db.execute(`
      update public.jobs set state = 'cancelled', finished_at = app.now_utc()
       where job_id = ${lit(jobId)}::uuid and state not in ('complete', 'cancelled', 'failed')
    `)
  }

  /*
    The row STAYS, and cannot do otherwise: `job_state_transitions` is
    append-only by §6 and holds a foreign key to it, so deleting the job is
    refused by the ledger it wrote on the way in. What makes leaving it safe is
    that it is a fixture — `jobs.is_fixture` is GENERATED from `requested_by`,
    and `verify:governs` matches — so `office_health()` and every tally that
    excludes fixtures cannot see it. Asserted below rather than assumed, since
    a fixture that is not one is harness traffic reported to Grant as the
    office collapsing.
  */

  /*
    The lesson stays — it cannot be removed and that is the design. What is
    asserted is that it is INVISIBLE: retracted, out of `lessons_live`, and out
    of the payload. A teardown that matched nothing would look identical to one
    that worked, so this counts what it expects rather than what it removed.
  */
  const left = Number(
    (
      await one(`
        select
          (select count(*) from public.suggestions where subject_ref = ${lit(NEED)})
        + (select count(*) from public.proposals where needed = ${lit(NEED)})
        + (select count(*) from public.jobs
            where idempotency_key = ${lit(`fixture-governs-${run}`)} and not is_fixture)
        + (select count(*) from public.lessons_live where body = ${lit(BODY)})
        as n
      `)
    ).n,
  )
  const kept = Number(
    (await one(`select count(*)::int as n from public.lessons where body = ${lit(BODY)}`)).n,
  )
  check(
    'teardown — nothing visible left, and the retracted lesson is still on the ledger',
    `${String(left)} visible, ${String(kept)} kept for the record`,
    left === 0 && kept === 1,
  )
}

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
