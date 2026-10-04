/**
 * An unresolved problem is told once (#413), driven live through the real code path.
 *   npm run verify:incidents
 *
 * Runs against the Sample office with a throwaway service name, never Grant's. Proves, from the database's own answers:
 *   - 200 identical failures give exactly ONE alert;
 *   - twelve workers reporting the same NEW problem at the same instant give exactly ONE first (the race);
 *   - a reminder is due only once the interval has passed, and then only once;
 *   - fixing it closes the incident and says so exactly once, and only if the person had been told;
 *   - a later failure is a NEW incident and is told as a first;
 *   - another office's problem is a different incident, and an unknown office is refused.
 * Teardown removes what it made and asserts nothing is left (a teardown that matches nothing looks like one that worked).
 */
import { resolveProblems, seeProblem } from '../../src/incidents/report.ts'
import { db, lit, rows, sampleOffice } from '../sample/lib.ts'

let failed = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}

const office = (await sampleOffice()).officeId
const run = Math.random().toString(36).slice(2, 8)
const service = `zz-verify-incident-${run}`
const problem = 'needs_reconnect'

const foreign = String(
  (
    await rows(
      `select office_id::text o from public.offices
        where office_id not in (app.operator_office(), ${lit(office)}::uuid) and state = 'active' limit 1`,
    )
  )[0]?.o ?? '',
)

const sweep = async (): Promise<number> => {
  await db.execute(`delete from public.incidents where service like 'zz-verify-incident-%'`)
  return Number(
    (
      await rows(
        `select count(*) n from public.incidents where service like 'zz-verify-incident-%'`,
      )
    )[0]?.n ?? -1,
  )
}

try {
  await sweep()

  // 1. The flood.
  let firsts = 0
  let quiets = 0
  let last = 0
  for (let i = 0; i < 200; i++) {
    const v = await seeProblem(db, office, service, problem, { n: i })
    if (v.reason === 'first') firsts += 1
    if (v.reason === 'quiet') quiets += 1
    last = v.occurrences
  }
  check(
    '200 identical failures give ONE alert',
    firsts === 1 && quiets === 199,
    `firsts ${firsts}, quiet ${quiets}`,
  )
  check('every occurrence is still counted', last === 200, `occurrences ${last}`)

  // 2. The race, on a problem nobody has reported yet.
  const racing = 'race_condition'
  const verdicts = await Promise.all(
    Array.from({ length: 12 }, () => seeProblem(db, office, service, racing, { race: true })),
  )
  const racers = verdicts.filter((v) => v.reason === 'first').length
  check(
    'twelve workers at once give exactly ONE first alert',
    racers === 1,
    `${racers} firsts of 12`,
  )

  // 3. A reminder: only after the interval, and only once.
  await db.execute(
    `update public.incidents set told_at = told_at - interval '25 hours'
      where office_id = ${lit(office)}::uuid and service = ${lit(service)} and problem = ${lit(problem)} and state = 'open'`,
  )
  const due = await seeProblem(db, office, service, problem, {})
  const after = await seeProblem(db, office, service, problem, {})
  check('a reminder is due once the interval has passed', due.reason === 'reminder' && due.notify)
  check('and not again straight after', after.reason === 'quiet' && !after.notify)

  // 4. Recovery.
  const fixed = await resolveProblems(db, office, service, [problem, 'something_else'])
  check(
    'fixing it closes the incident and says it had been told',
    fixed.closed === 1 && fixed.wasTold,
    JSON.stringify(fixed),
  )
  const again = await resolveProblems(db, office, service, [problem])
  check('and the recovery is said only once', again.closed === 0 && !again.wasTold)

  // 5. A recurrence is a new incident.
  const back = await seeProblem(db, office, service, problem, {})
  check(
    'a later failure is a NEW incident, told as a first',
    back.reason === 'first' && back.occurrences === 1,
  )

  // 6. An incident nobody was told about does not announce its own recovery.
  const quietProblem = 'never_told'
  await seeProblem(db, office, service, quietProblem, {})
  await db.execute(
    `update public.incidents set told_at = null, told_count = 0
      where office_id = ${lit(office)}::uuid and service = ${lit(service)} and problem = ${lit(quietProblem)}`,
  )
  const silent = await resolveProblems(db, office, service, [quietProblem])
  check(
    'an incident the person was never told about closes without a recovery notice',
    silent.closed === 1 && !silent.wasTold,
  )

  // 7. Offices.
  if (foreign !== '') {
    const theirs = await seeProblem(db, foreign, service, problem, {})
    check(
      "another office's identical problem is its own incident (its own first)",
      theirs.reason === 'first' && theirs.occurrences === 1,
    )
    const mine = await resolveProblems(db, foreign, service, [problem])
    check('and resolving it does not touch this office', mine.closed === 1)
    const stillOpen = Number(
      (
        await rows(
          `select count(*) n from public.incidents where office_id = ${lit(office)}::uuid and service = ${lit(service)} and problem = ${lit(problem)} and state = 'open'`,
        )
      )[0]?.n ?? 0,
    )
    check("this office's incident is still open", stillOpen === 1, `open ${stillOpen}`)
  } else console.log('  (no second office to test isolation against)')

  const refused = await db
    .execute(
      `select app.incident_seen('00000000-0000-4000-8000-000000000000'::uuid, ${lit(service)}, 'x', '{}'::jsonb, 24)`,
    )
    .then(() => false)
    .catch((e: Error) => /no_office/.test(e.message))
  check('an office that does not exist is refused, by its own error', refused)
} finally {
  const left = await sweep()
  check('teardown left nothing behind', left === 0, `${left} rows`)
}
console.log(failed === 0 ? '\nINCIDENTS: PASS' : `\nINCIDENTS: ${failed} FAILED`)
process.exitCode = failed === 0 ? 0 : 1
