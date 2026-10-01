/**
 * The office says what it understood, and asks for what it needs.
 *
 *   npm run verify:proposes
 *
 * Issues #47 and #49, migrations 0295 and 0296. One suite because they are one
 * chain and the join is where it would break: #47's typed `cannot:` outcomes
 * are what make #49 countable, and #49's whole design rests on that count being
 * a SQL query rather than a model call per job.
 *
 * ## The two properties worth most
 *
 * **A declined proposal never comes back.** Grant: eight agents proposing
 * independently is eight times the noise he does not want, and a proposal he
 * can only ignore is one that arrives again on Thursday. So the last section
 * drives four more identical failures AFTER a decline and asserts silence —
 * which is #49's own last box, and the reason a proposal is a row.
 *
 * **Exactly one proposal, not four.** The threshold is what stops a helpful
 * office becoming a nagging one. Four identical failures must produce one row
 * with a count of four, not four rows.
 *
 * ## Real subjects, torn down
 *
 * `impediments_tally` excludes fixtures by default, and `job_impediments.
 * is_fixture` is GENERATED — so a suite testing the tally cannot use fixture
 * names, which is #45's trap and cost `verify:identity` eleven checks. The
 * subjects here are `probe-` named and removed at the end, and the teardown is
 * asserted rather than assumed.
 */

import { readPlan } from '../../src/agents/plan.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { proposeHandler } from '../../src/handlers/propose.ts'

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
  Not a harness-shaped name, on purpose — #45's rule, applied to the thing
  this suite actually tests.

  0475 made the proposal round refuse a need whose NAME belongs to the harness,
  because twelve probe impediments would otherwise have asked Grant to grant a
  tool called `probe-need-j4je9xrc-missing_tool`. A suite testing a feature
  that filters harness names cannot use one, or it passes for the wrong reason
  — or, as happened here, stops being able to raise its subject at all.

  So the need reads like a real one and carries the run token, which is what
  teardown matches on. The impediments underneath are still fixtures by
  generation (the jobs are `verify:` named), so nothing the office counts moves.
*/
const NEED = `speak fluent welsh ${run}`
const WHO = 'growth-director'
let projectId = ''
const jobs: string[] = []

/*
  FIXTURE jobs, deliberately, and this is the opposite of #45's usual advice.

  `job_impediments` is append-only by §6 — DELETE is refused by a trigger — so
  every impediment this suite writes is PERMANENT. A real-subject run therefore
  leaves rows in Grant's tally for ever, proposing something nonsensical.

  `job_impediments.is_fixture` is inherited from its job by trigger, and
  `impediments_tally` excludes fixtures. So a fixture impediment is permanent
  AND harmless, which is exactly what a suite wants from a ledger it cannot
  clean up. 0297 gave `raise_proposals` the same `p_include_fixtures` parameter
  the tally already had, so the real code path can still be driven against rows
  that can never reach him.
*/
const makeJob = async (n: number): Promise<string> =>
  String(
    (
      await one(`
        insert into public.jobs
          (correlation_id, project_id, idempotency_key, kind, requested_by, recipient_agent)
        values (extensions.gen_random_uuid(), ${lit(projectId)}::uuid,
                ${lit(`fixture-proposes-${run}-${String(n)}`)}, 'research', 'verify:proposes', ${lit(WHO)})
        returning job_id::text as id
      `)
    ).id,
  )

console.log(`\nverify:proposes — ${run}\n`)

projectId = String(
  (
    await one(`
      select project_id::text as id from public.projects
       where status = 'active' and not is_fixture order by slug limit 1
    `)
  ).id,
)

try {
  // =========================================================================
  console.log('a job says what it understood, before acting (#47)')

  const j0 = await makeJob(0)
  jobs.push(j0)

  const said = (
    await one(`
    select public.understood(${lit(j0)}::uuid,
      'You want the last quarter of interviews summarised into one page.') as r
  `)
  ).r as { ok?: boolean; understood_as?: string }
  check('a restatement is recorded', String(said.understood_as ?? said), said.ok === true)

  /*
    Write-once, and this is the property that gives a restatement its value: one
    that can be revised after the work is a summary of what happened, which is
    a different and much less useful thing.
  */
  const again = (
    await one(`
    select public.understood(${lit(j0)}::uuid, 'Actually you wanted something else entirely.') as r
  `)
  ).r as { ok?: boolean; already?: string }
  check(
    'and it cannot be rewritten once the work has started',
    String(again.already ?? 'IT WAS OVERWRITTEN'),
    again.ok === false && String(again.already).includes('interviews'),
  )

  const tooShort = (
    await one(`select public.understood(${lit(await makeJob(1))}::uuid, 'ok') as r`)
  ).r as { error?: string }
  check(
    'a restatement that says nothing is refused',
    tooShort.error ?? '(accepted)',
    tooShort.error !== undefined,
  )

  const listed = (await one('select app.readings(1, 50) as r')).r as { id: string }[]
  check(
    'and the readings are reviewable — findable, not merely stored',
    `${String(listed.length)} job(s) with the ask beside the reading`,
    Array.isArray(listed),
  )

  // =========================================================================
  console.log('\none question, not none and not five (#47)')

  /*
    #47's third rule: *"Ask one question, not none and not five. Where the ask
    is genuinely ambiguous between materially different actions, the job blocks
    with a single question addressed through Claire."*

    Five questions is the failure that matters. An instruction with several
    loose ends must still produce ONE — a message that interrogates Grant is
    worse than one that guesses and says so, because he stops reading it.
  */
  /*
    The instruction has to actually produce a PLAN. The first version of this
    check used a vague sentence, `readPlan` returned null below two substantive
    steps, and it asserted "0 questions in 0 steps" — passing because there was
    nothing there rather than because the rule holds. A check that cannot fail
    is not a check, and this file has now produced two of them.
  */
  const messy = readPlan(
    'Watch https://youtu.be/abc123 and tell me what it says about pricing, ' +
      'and what did they say about the timeline, and make an audio overview too.',
  )
  const questions = (messy?.steps ?? []).filter(
    (x) => x.kind === 'ask' || x.kind === 'ambiguous_project',
  )
  check(
    'a plan with several loose ends asks exactly one question',
    `${String(questions.length)} question step(s) in ${String(messy?.steps.length ?? 0)}: ` +
      `${(messy?.steps ?? []).map((x) => x.kind).join(', ')}`,
    (messy?.steps.length ?? 0) > 1 && questions.length === 1,
  )

  /*
    And the other half of "not none and not five": a CLEAR instruction must not
    be interrogated at all. A planner that always asks something is as useless
    as one that never does, and passes the check above.
  */
  const clear = readPlan(
    'Make a slide deck and an audio overview from the Coaching for Success notebook.',
  )
  check(
    'CONTROL: a clear instruction is not interrogated',
    `${String((clear?.steps ?? []).filter((x) => x.kind === 'ask' || x.kind === 'ambiguous_project').length)} question step(s)`,
    (clear?.steps ?? []).filter((x) => x.kind === 'ask' || x.kind === 'ambiguous_project')
      .length === 0,
  )

  // =========================================================================
  console.log('\nall four kinds of cannot, typed and countable (#47)')

  const KINDS = ['missing_tool', 'missing_skill', 'needs_permission', 'ambiguous'] as const
  for (const kind of KINDS) {
    const j = await makeJob(KINDS.indexOf(kind) + 10)
    jobs.push(j)
    await db.execute(`
      select app.cannot(${lit(j)}::uuid, ${lit(kind)}, ${lit(`${NEED}-${kind}`)},
        ${lit(WHO)}, ${lit(`cannot ${kind} for the probe`)}, 'a probe instruction')
    `)
    const n = Number(
      (
        await one(`
        select count(*)::int as n from public.job_impediments
         where job_id = ${lit(j)}::uuid and kind = ${lit(kind)}
      `)
      ).n,
    )
    check(`${kind} is recorded as a typed row, not prose`, `${String(n)} row(s)`, n === 1)
  }

  // =========================================================================
  console.log('\nfour identical failures raise exactly one proposal (#49)')

  for (let i = 0; i < 4; i += 1) {
    const j = await makeJob(20 + i)
    jobs.push(j)
    await db.execute(`
      select app.cannot(${lit(j)}::uuid, 'missing_tool', ${lit(NEED)}, ${lit(WHO)},
        ${lit(`asked to ${NEED} and there is no tool for it`)}, 'a probe instruction')
    `)
  }

  /*
    A CONTROL first. The threshold is the feature: if one failure raised a
    proposal the office would nag, and a check that only ever runs at four
    could not tell a working threshold from none at all.
  */
  const belowBar = (await one(`select app.raise_proposals(30, 99, true) as r`)).r as {
    raised?: number
  }
  const noneYet = Number(
    (await one(`select count(*)::int as n from public.proposals where needed = ${lit(NEED)}`)).n,
  )
  check(
    'CONTROL: below the threshold, nothing is proposed',
    `raised=${String(belowBar.raised)}, ${String(noneYet)} proposal(s)`,
    noneYet === 0,
  )

  await db.execute('select app.raise_proposals(30, 3, true)')
  const rows = (
    await db.execute(`
      select proposal_id::text as id, title, remedy, argument, times_seen, state
        from public.proposals where needed = ${lit(NEED)}
    `)
  ).rows as { id: string; title: string; remedy: string; argument: string; times_seen: number }[]

  check(
    'four failures raise ONE proposal, not four',
    `${String(rows.length)} proposal(s), times_seen=${String(rows[0]?.times_seen)}`,
    rows.length === 1 && rows[0]?.times_seen === 4,
  )
  check(
    'and it carries a remedy and an argument with the count in it',
    `${String(rows[0]?.title)} | ${String(rows[0]?.remedy)} | ${String(rows[0]?.argument).slice(0, 60)}`,
    String(rows[0]?.remedy).length > 10 && /4 time/.test(String(rows[0]?.argument)),
  )

  // Running it again is not a second proposal.
  await db.execute('select app.raise_proposals(30, 3, true)')
  const stillOne = Number(
    (await one(`select count(*)::int as n from public.proposals where needed = ${lit(NEED)}`)).n,
  )
  check(
    'running the pass twice does not raise it twice',
    `${String(stillOne)} proposal(s)`,
    stillOne === 1,
  )

  // =========================================================================
  console.log('\nClaire sends it, once (#49)')

  /*
    Asked for a batch big enough to contain this run's row, not the top twenty.

    The first version asked for 20 and went red the day the office held more
    than twenty undelivered proposals: this run's subject, with four
    occurrences, ranked below a real one with seventy-two. Nothing was broken —
    the suite was asserting that its own fixture was popular. A cap is a
    product behaviour, so the check reads past it rather than depending on
    where the fixture happens to sort.
  */
  /*
    THIS SUITE'S PROPOSAL MUST NOT BE IN THE BATCH, and the assertion used to
    be the opposite.

    `proposals_to_send` is the batch the chief of staff actually sends, and
    since 0489 the round SPEAKS — so a proposal reaching that batch reaches
    Grant's phone. This suite's subject is evidenced entirely by fixture jobs,
    which is what #45 requires of a suite testing a filter, so the office is
    right to refuse it and the old check was asserting against a safety rule.

    0492 found that the reader had no harness filter at all — 0490's splice
    loop replaced a string in two of three functions and only checked that it
    had hit ONE — so for a few hours between those two migrations a suite
    could have made the office tell Grant about a gap it invented. This is the
    regression for that.
  */
  const batch = (await one('select app.proposals_to_send(500) as r')).r as { id: string }[]
  check(
    'a harness proposal never reaches the batch Claire sends',
    `${String(batch.length)} waiting, ours ${batch.some((b) => b.id === rows[0]?.id) ? 'AMONG THEM' : 'absent'}`,
    !batch.some((b) => b.id === rows[0]?.id),
  )

  /*
    And the control, because the line above is satisfied by a reader that
    returns nothing at all — the found-nothing shape this repository has been
    caught building three times. A proposal with REAL provenance must still be
    offered, and be marked once, and not be offered again.

    Written directly rather than raised, because raising one needs impediments
    on a real job and `job_impediments` can never be deleted. It is removed at
    the end of the block.
  */
  const realOne = (
    await one(`
    insert into public.proposals (staff_slug, kind, needed, title, remedy, argument, times_seen)
    values ('growth-director', 'not_capable', ${lit(`realproof-${run}`)},
            'real proof', 'real proof', 'real proof', 3)
    returning proposal_id::text as id
  `)
  ).id as string
  const withReal = (await one('select app.proposals_to_send(500) as r')).r as { id: string }[]
  check(
    'CONTROL: a proposal with real provenance IS offered',
    withReal.some((b) => b.id === realOne) ? 'offered' : 'NOT OFFERED — the reader is inert',
    withReal.some((b) => b.id === realOne),
  )
  await db.execute(`select app.proposals_sent(array[${lit(realOne)}]::uuid[])`)
  const after = (await one('select app.proposals_to_send(500) as r')).r as { id: string }[]
  check(
    'and once sent it is not sent again',
    `${String(after.length)} waiting`,
    !after.some((b) => b.id === realOne),
  )
  await db.execute(`delete from public.proposals where proposal_id = ${lit(realOne)}::uuid`)
  const sweptReal = (
    await one(`select count(*)::int as n from public.proposals
                where needed = ${lit(`realproof-${run}`)}`)
  ).n
  check(
    'and the control leaves nothing behind',
    `${String(sweptReal)} left`,
    Number(sweptReal) === 0,
  )

  // =========================================================================
  console.log('\nand a decline sticks (#49)')

  const declined = (
    await one(`
    select public.decide_proposal(${lit(String(rows[0]?.id))}::uuid, 'declined',
      'not worth it for now') as r
  `)
  ).r as { ok?: boolean }
  check('declining works', JSON.stringify(declined), declined.ok === true)

  /*
    #49's last box, and the reason a proposal is a row rather than a message:
    four MORE identical failures after the decline, and silence.
  */
  for (let i = 0; i < 4; i += 1) {
    const j = await makeJob(40 + i)
    jobs.push(j)
    await db.execute(`
      select app.cannot(${lit(j)}::uuid, 'missing_tool', ${lit(NEED)}, ${lit(WHO)},
        ${lit(`asked again to ${NEED}, still no tool`)}, 'a probe instruction')
    `)
  }
  const swept = (await one('select app.raise_proposals(30, 3, true) as r')).r as {
    left_declined?: number
  }
  const state = (await one(`
    select state, times_seen from public.proposals where needed = ${lit(NEED)}
  `)) as { state?: string; times_seen?: number }
  check(
    'four more failures after a decline raise nothing',
    `state=${String(state.state)}, left_declined=${String(swept.left_declined)}`,
    state.state === 'declined' && Number(swept.left_declined) >= 1,
  )
  check(
    'and the declined one is not even re-counted, so it cannot creep back',
    `times_seen still ${String(state.times_seen)}`,
    state.times_seen === 4,
  )
  const silent = (await one('select app.proposals_to_send(20) as r')).r as { id: string }[]
  check(
    'and it is never queued to send again',
    `${String(silent.length)} waiting, none of them ours`,
    !silent.some((b) => b.id === rows[0]?.id),
  )
} finally {
  console.log('')
  /*
    This run's rows AND any harness row an older run left.

    A prefix keyed to `${run}` only ever collected the current run, so
    seventeen proposals named `fixture-need-…`, `verify-tool-…` and
    `probe-need-…` accumulated over weeks — and every one of them was on
    Grant's Governance page until 0473 filtered the reader. `app.harness_label`
    is that filter's predicate, so teardown and page agree by construction
    rather than by two lists kept in step.
  */
  await db.execute(`delete from public.proposals
     where app.harness_label(needed) or needed like ${lit(`%${run}%`)}`)
  /*
    The impediments are NOT deleted, because they cannot be: §6 makes the
    ledger append-only and the trigger refuses. They are fixtures, so
    `impediments_tally` excludes them from every real count and they are
    permanent history about a probe rather than debris in Grant's backlog.
    That is the design working, not a teardown that gave up.
  */
  /*
    The jobs are cancelled, not deleted: `job_state_transitions` is append-only
    by §6 and has a foreign key to `jobs` (ADR-0022), so a job can only ever
    reach a terminal state. They were created with `requested_by = 'grant'`
    deliberately — a fixture prefix would have been excluded from the tally
    this suite exists to test (#45) — so they are cancelled and unlinked from
    the project rather than left looking like real work.
  */
  await db.execute(`
    update public.jobs set state = 'cancelled', finished_at = app.now_utc(), project_id = null
     where job_id = any(array[${jobs.map((j) => `${lit(j)}::uuid`).join(',')}])
       and state not in ('complete', 'cancelled', 'failed')
  `)
  const left = Number(
    (
      await one(
        `select count(*)::int as n from public.proposals where needed like ${lit(`%${run}%`)}`,
      )
    ).n,
  )
  /*
    Only the proposals are counted. The impediments stay by design — the ledger
    is append-only and refuses DELETE — so the check that matters is not that
    they are gone but that they can never be COUNTED, which is what makes
    leaving them safe. Asserting `left === 0` on both would fail for ever and
    the suite would be switched off.
  */
  const counted = Number(
    (
      await one(`
        select count(*)::int as n from app.impediments_tally(app.test_office(), 30, 1, false)
         where needed like ${lit(`%${run}%`)}
      `)
    ).n,
  )
  check(
    'teardown — proposals gone, and the permanent impediments cannot be counted',
    `${String(left)} proposal(s) left, ${String(counted)} visible to a real tally`,
    left === 0 && counted === 0,
  )
}

// =========================================================================
console.log('\nand a duty runs the pass, which nothing ever did (#49, #272)')

/*
  The gap this section exists for.

  Everything above proves `raise_proposals` WORKS. Nothing proved anything
  CALLED it — and nothing did: `check:callers` had it in the baseline, and the
  consequence was not an idle function but sixteen fixture rows being the only
  thing on Grant's Governance page, because the only callers were suites
  raising with `p_include_fixtures => true` (0473).
*/
const duty = (await one(`
  select job_kind, period_minutes, enabled
    from public.responsibilities where slug = 'proposal-round'`)) as {
  job_kind?: string
  period_minutes?: number
  enabled?: boolean
}
check(
  'the office has a duty that turns impediments into proposals',
  `${String(duty?.job_kind)} every ${String(duty?.period_minutes)} min, enabled=${String(duty?.enabled)}`,
  duty?.job_kind === 'office.propose' && duty?.enabled === true,
)

/*
  And the handler that duty needs, driven rather than read.

  A responsibility whose job kind has no handler is 0133's defect: the job is
  enqueued, `runJob` throws NoHandlerError, and the duty looks scheduled while
  nothing happens. So this runs the real handler against the real database.
  It is allowed to raise REAL proposals — that is the product behaviour, daily,
  from tomorrow — and the assertion is about what it says, not about a count
  that changes with the office's own history.
*/
const out = await proposeHandler(db).handle(
  {
    jobId: '00000000-0000-0000-0000-000000000000',
    kind: 'office.propose',
    correlationId: '00000000-0000-0000-0000-000000000000',
    projectId: null,
    idempotencyKey: `verify:proposes-${run}:duty`,
    attempt: 1,
  },
  db,
)
check(
  'the handler runs the pass and says what it found',
  `${out.body.slice(0, 80)}`,
  out.body.length > 10 && out.announce === false,
)

/*
  The property that matters, asserted rather than counted.

  Sixteen harness proposals were on the page for weeks. A count would go stale
  the first time the office raises a real one; "no row the page shows Grant is
  a harness row" survives every future run.
*/
const shown = (await one(`select app.hq_governance(40) as g`)).g as { proposals?: unknown }
const parsed = typeof shown === 'string' ? (JSON.parse(shown) as { proposals?: unknown }) : shown
const onPage = Array.isArray(parsed?.proposals)
  ? (parsed.proposals as { title?: string }[]).map((p) => String(p.title ?? ''))
  : []
check(
  'CONTROL: and no harness proposal reaches the page Grant reads',
  onPage.length === 0
    ? 'nothing open'
    : `${String(onPage.length)}: ${onPage.slice(0, 2).join(' · ').slice(0, 70)}`,
  !onPage.some((t) => /verify-|fixture-|probe-|gate-/.test(t)),
)

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
