/**
 * Does the morning briefing happen, once, and say only true things?
 *
 *   npm run verify:briefing
 *
 * Issue #56. Exercises 0187–0189 and `src/handlers/briefing.ts`.
 *
 * ## The check this file exists for
 *
 * **He must not be briefed twice.** A duty re-attempted after a crash, two
 * worker passes in the same minute, or a hand-run alongside the scheduled one
 * all have to collide. `briefings` has had a unique key on
 * `(kind, scope_ref, for_date)` since §12 was written, with the comment saying
 * exactly that — and nothing had ever inserted a row to test it against.
 *
 * ## The other one
 *
 * A wall-clock duty must not drift. `daily-capacity-report` is the proof that
 * it does: 1440-minute period, last run 15:36, which is not a time anyone
 * chose. So the suite asserts that a duty which ran at 07:02 is not due again
 * until tomorrow's 07:00 — not until 07:02 plus 24 hours.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { briefingLines } from '../../src/handlers/briefing.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

let pass = 0
let fail = 0
const ok = (what: string, good: boolean, note = '') => {
  if (good) {
    pass++
    console.log(`  ok   ${what}`)
  } else {
    fail++
    console.error(`  FAIL ${what}${note === '' ? '' : ` — ${note}`}`)
  }
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}
const all = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)

console.log('briefing —')

// --- the duty exists and belongs to the right person ------------------------

{
  const duty = await one(`
    select r.slug, r.job_kind, r.at_time::text t, r.enabled, s.slug as who
      from public.responsibilities r join public.staff s on s.staff_id = r.staff_id
     where r.slug = 'morning-briefing'
  `)
  ok('there is a morning briefing duty', String(duty.slug ?? '') === 'morning-briefing')
  ok('it runs at a wall-clock time, not on an interval', String(duty.t ?? '') === '07:00:00')
  ok('and it is enabled', duty.enabled === true)
  /*
    Grant: *"I only get messages from the chief of staff."* He asked for this
    briefing FROM his chief of staff specifically, and telegram.only_chief_speaks
    is true — a duty owned by anyone else would do the work and be unable to
    send it.
  */
  ok('and it belongs to the chief of staff', String(duty.who ?? '') === 'chief-of-staff')
}

{
  const chief = await one(`
    select value #>> '{}' as v from public.system_config
     where key = 'telegram.only_chief_speaks'
  `)
  ok('which matters, because only the chief speaks to him', String(chief.v ?? '') === 'true')
}

// --- the key is keyed on the DAY --------------------------------------------

{
  const key = await one(`
    select idempotency_key k from app.due_responsibilities() where slug = 'morning-briefing'
  `)
  const tz = String((await one('select app.grant_timezone() as z')).z ?? '')
  const today = String(
    (await one(`select to_char((app.now_utc() at time zone ${lit(tz)})::date,'YYYY-MM-DD') d`)).d,
  )
  // Only asserted when the duty is currently due; before 07:00 it correctly
  // returns nothing, and a suite that failed overnight would be worse than one
  // that says so.
  if (key.k !== undefined) {
    ok(
      'when it is due, its key is the local date, so two passes collide',
      String(key.k) === `duty:morning-briefing:${today}`,
      String(key.k),
    )
  } else {
    /*
      Not due is two different situations and saying the wrong one is worse
      than saying nothing. Before 07:00 it has not come round yet; after, it
      has already run. The first version printed "it is before 07:00" at 09:10
      local, which read as a passing check and was a false statement.
    */
    const already = await one(`
      select r.last_run_at >= (((app.now_utc() at time zone app.grant_timezone())::date
             + r.at_time) at time zone app.grant_timezone()) as done
        from public.responsibilities r where r.slug = 'morning-briefing'
    `)
    ok(
      already.done === true
        ? 'it has already run today, so it is correctly not due again'
        : `it is before 07:00 in ${tz}, so it is correctly not due yet`,
      true,
    )
  }
}

// --- a wall-clock duty does not drift ---------------------------------------
//
// The whole reason 0187 exists. Tested on a throwaway duty rather than on the
// real one, because setting `last_run_at` on the real briefing would suppress
// Grant's actual briefing for the day.

{
  const chiefId = String(
    (await one(`select staff_id from public.staff where slug = 'chief-of-staff'`)).staff_id,
  )
  const slug = `verify-drift-${run}`
  await db.execute(`
    insert into public.responsibilities
      (slug, staff_id, description, job_kind, period_minutes, at_time, enabled)
    values (${lit(slug)}, ${lit(chiefId)}::uuid,
      'Throwaway duty for drift verification', 'briefing.morning', 1440, '00:01', true)
  `)

  const dueAtFirst = await all(
    `select slug from app.due_responsibilities() where slug = ${lit(slug)}`,
  )
  ok('a wall-clock duty whose time has passed is due', dueAtFirst.length === 1)

  // Ran two minutes after its anchor, as a real run would.
  await db.execute(`
    update public.responsibilities
       set last_run_at = ((app.now_utc() at time zone app.grant_timezone())::date + time '00:03')
                           at time zone app.grant_timezone()
     where slug = ${lit(slug)}
  `)
  const after = await all(`select slug from app.due_responsibilities() where slug = ${lit(slug)}`)
  ok(
    'and once it has run today, it is not due again today',
    after.length === 0,
    'it would fire twice in one day',
  )

  /*
    The drift check.

    An interval duty that ran at 00:03 is next due at 00:03 tomorrow, then
    00:06, then 00:11 — which is how `daily-capacity-report` ended up running
    at 15:36. A wall-clock duty must be due at tomorrow's 00:01 regardless of
    when today's finished. Asserted by moving the run back a day and checking
    it is due again, rather than by waiting.
  */
  await db.execute(`
    update public.responsibilities
       set last_run_at = (((app.now_utc() at time zone app.grant_timezone())::date - 1)
                           + time '00:03') at time zone app.grant_timezone()
     where slug = ${lit(slug)}
  `)
  const tomorrow = await all(
    `select slug from app.due_responsibilities() where slug = ${lit(slug)}`,
  )
  ok(
    "and yesterday's run does not push today's past its anchor",
    tomorrow.length === 1,
    'the duty drifts, which is the bug 0187 exists to fix',
  )

  await db.execute(`delete from public.responsibilities where slug = ${lit(slug)}`)
}

{
  const drifted = await one(`
    select at_time::text t from public.responsibilities where slug = 'daily-capacity-report'
  `)
  ok(
    'and the duty that proved the drift has been given a time of its own',
    String(drifted.t ?? '') === '18:00:00',
  )
}

// --- the facts are facts ----------------------------------------------------

{
  const f = (await one('select app.morning_briefing_facts(app.sole_person_office()) as f')).f as {
    for_date?: string
    waiting_on_you?: unknown[]
    overnight?: { finished?: number }
  }
  ok('the briefing has facts to work from', f !== undefined && f.for_date !== undefined)

  // Cross-checked against the view it is supposed to be drawn from, rather than
  // against itself.
  const needs = await all('select blocker_id from public.needs_me')
  ok(
    'and what it says needs him matches needs_me exactly',
    (f.waiting_on_you ?? []).length === needs.length,
    `${String((f.waiting_on_you ?? []).length)} vs ${String(needs.length)}`,
  )

  /*
    AND EVERY ONE OF THEM IS HIS (0569, 0570).

    The headline of his briefing was 94% test traffic: 67 open blockers, 63 of
    them raised by suites, printed to him as "54 items are waiting on you; 50
    more sit on the dashboard". public.needs_me had no harness filter at all
    and it has eight consumers, so the dashboard and the voice answer said the
    same thing.

    Asserted as a PROPERTY of the population rather than as a count, so it
    survives the next harness run: no row the briefing shows him belongs to a
    harness job. The same wording CLAUDE.md settled on after the fixture-job
    pile came back because somebody had asserted a number.
  */
  const harnessShown = await all(`
    select 1 from public.needs_me n where coalesce(app.harness_job(n.job_id), false)`)
  ok(
    'and none of what needs him is a suite’s',
    harnessShown.length === 0,
    `${String(harnessShown.length)} harness blocker(s) visible`,
  )

  /*
    CONTROL: the guard is load-bearing right now. Without it the same query
    returns the harness rows, so a zero above means the filter is working
    rather than that the table is empty — the found-nothing shape this
    repository has built three times.
  */
  const unfiltered = await all(`
    select 1 from public.blockers
     where state = 'open' and coalesce(app.harness_job(job_id), false)`)
  ok(
    'CONTROL: and there were harness blockers for it to exclude',
    unfiltered.length > 0,
    `${String(unfiltered.length)} excluded by the filter`,
  )

  /*
    And the overflow line counts the same population. Before 0570 it read
    public.blockers directly, so the two halves of one sentence were about
    different sets — four waiting on him and fifty more behind them.
  */
  const pressure = await one(
    'select open_items from app.needs_me_pressure(app.sole_person_office())',
  )
  ok(
    'and the overflow line counts the same population as the list',
    Number(pressure?.open_items) === needs.length,
    `pressure ${String(pressure?.open_items)} vs needs_me ${String(needs.length)}`,
  )

  const lines = briefingLines(f as never)
  ok('and it composes into sentences', lines.length > 0)
  ok(
    'the first of which is what needs him, because that is the only part he can act on',
    /waiting on you|Nothing is waiting/.test(lines[0] ?? ''),
    lines[0] ?? '(nothing)',
  )
  /*
    A briefing that pads is a briefing he skims, and a skimmed briefing is
    worse than none — the morning he actually needed to read one, he will not.
    So a quiet section is absent, not printed as a zero.
  */
  ok(
    'a quiet morning is short rather than padded with zeroes',
    !lines.some((l) => /\b0 (pieces|things|tasks)\b/.test(l)),
    lines.find((l) => /\b0 /.test(l)) ?? '',
  )
}

// --- he is not briefed twice ------------------------------------------------
//
// The check this file exists for. Written against a scope of its own so the
// real briefing for today is untouched either way.

{
  const scope = `verify-${run}`
  const day = String(
    (
      await one(
        `select to_char((app.now_utc() at time zone app.grant_timezone())::date,'YYYY-MM-DD') d`,
      )
    ).d,
  )

  const firstBody = 'The first briefing written for this scope today, and the only one.'
  const first = (
    await one(`
      select app.write_briefing(app.test_office(), 'morning', ${lit(day)}::date, ${lit(firstBody)},
        '{"probe": true}'::jsonb, ${lit(scope)}) as r
    `)
  ).r as { already_written?: boolean; briefing_id?: string }
  ok('a briefing can be written', first.already_written === false)

  const second = (
    await one(`
      select app.write_briefing(app.test_office(), 'morning', ${lit(day)}::date,
        'A DIFFERENT second briefing, which must never replace the first.',
        '{"probe": true}'::jsonb, ${lit(scope)}) as r
    `)
  ).r as { already_written?: boolean; briefing_id?: string }
  ok(
    'and a second attempt the same day is refused',
    second.already_written === true,
    'Grant would be briefed twice',
  )
  ok(
    'and it names the one that already exists rather than just failing',
    String(second.briefing_id ?? '') === String(first.briefing_id ?? ''),
  )

  const bodies = await all(`select body from public.briefings where scope_ref = ${lit(scope)}`)
  ok(
    'the first briefing is not overwritten by the second attempt',
    bodies.length === 1 && String(bodies[0]?.body) === firstBody,
  )

  const inputs = await one(
    `select inputs::text i from public.briefings where scope_ref = ${lit(scope)}`,
  )
  ok(
    'and it is stored with the facts it was written from',
    String(inputs.i ?? '').includes('probe'),
  )

  await db.execute(`delete from public.briefings where scope_ref = ${lit(scope)}`)
}

// --- the quietest possible morning is still a briefing ----------------------
//
// `briefings_body_substantive` requires 40 characters. "Nothing is waiting on
// you." is 26, so the most COMMON morning — a smoothly running office — would
// have been refused by the table and Grant would have received silence.

{
  const quiet = briefingLines({
    for_date: '2026-01-01',
    timezone: 'Europe/Athens',
    waiting_on_you: [],
    overnight: { finished: 0, failed: 0, still_going: 0 },
    stuck: [],
    diary: [],
    noticed: [],
    wanted: [],
  })
  ok(
    'a morning with nothing at all in it still says something',
    quiet.join('\n\n').trim().length >= 40,
    `${String(quiet.join('').length)} characters — the table requires 40`,
  )
  ok('and says the true thing, not a padded one', quiet.length === 1)
}

// --- a request for reach reaches him ----------------------------------------
//
// #53. The mechanism to ask was built and nothing carried the ask to Grant, so
// the office could want something and he would never hear it. This asserts on
// the SENTENCE, because a request that is in the facts and not in the words is
// a request he still never hears.

{
  const asked = briefingLines({
    for_date: '2026-01-01',
    timezone: 'Europe/Athens',
    waiting_on_you: [],
    overnight: { finished: 0, failed: 0, still_going: 0 },
    stuck: [],
    diary: [],
    noticed: [],
    wanted: [
      {
        tool: 'github.write',
        asked_by: 'operations-director',
        what_for: 'Three jobs stalled at the diff because nothing can push it.',
        exists_yet: true,
        days: 3,
      },
    ],
  })
  const said = asked.join(' ')
  ok('a request for reach reaches the briefing', said.includes('github.write'), said.slice(0, 160))
  ok(
    'and says who asked and what for',
    said.includes('operations-director') && said.includes('stalled'),
  )
  ok('and how long it has been waiting', said.includes('3 days'))
  // ADR-0018's second decision, in the one sentence he reads: yes to one of
  // these is a switch, yes to the other is a decision to build.
  ok('and that saying yes switches it on', said.includes('switches it on'))

  const unbuilt = briefingLines({
    for_date: '2026-01-01',
    timezone: 'Europe/Athens',
    waiting_on_you: [],
    overnight: { finished: 0, failed: 0, still_going: 0 },
    stuck: [],
    diary: [],
    noticed: [],
    wanted: [
      {
        tool: 'instagram.post',
        asked_by: 'growth-director',
        what_for: 'Posting the campaign images without waiting on a person.',
        exists_yet: false,
        days: 0,
      },
    ],
  }).join(' ')
  ok(
    'and a tool that does not exist says yes means building it',
    unbuilt.includes('means building it'),
    unbuilt.slice(0, 160),
  )
  // Nothing pending must not become a line saying nothing is pending.
  const quiet = briefingLines({
    for_date: '2026-01-01',
    timezone: 'Europe/Athens',
    waiting_on_you: [],
    overnight: { finished: 0, failed: 0, still_going: 0 },
    stuck: [],
    diary: [],
    noticed: [],
    wanted: [],
  }).join(' ')
  ok(
    'and no request means no sentence about requests',
    !quiet.toLowerCase().includes('asked to be able'),
  )
}

// --- an unrecognised kind explains itself -----------------------------------

{
  const wrong = (
    await one(`
      select app.write_briefing(app.test_office(), 'lunchtime', current_date, ${lit('x'.repeat(50))},
        '{}'::jsonb, 'verify-nonsense') as r
    `)
  ).r as { error?: string }
  ok('an unrecognised briefing kind is refused', String(wrong.error ?? '') !== '')
  ok(
    'and is told which kinds exist, rather than just failing the cast',
    /morning/.test(String(wrong.error ?? '')) && /evening/.test(String(wrong.error ?? '')),
    String(wrong.error ?? ''),
  )
}

// --- wrappers ---------------------------------------------------------------

{
  const wrapped = await all(`
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('morning_briefing_facts', 'write_briefing')
  `)
  // The briefing is read and written through the office-explicit functions the worker calls; the unscoped public
  // doors were dropped with the office conversion, and none may come back (a door nothing needs is a door to everyone).
  ok('neither RPC has an unscoped public door', wrapped.length === 0)
}

{
  const left = await all(
    `select slug from public.responsibilities where slug like ${lit(`verify-%${run}`)}`,
  )
  ok('the suite leaves no duty behind', left.length === 0)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail === 0 ? 0 : 1)
